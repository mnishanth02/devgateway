from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid5, NAMESPACE_URL

from .contracts import TraceContext, Workflow, WorkflowState, WorkflowStep, StepKind, StepState
from .dispatcher import BoundedDispatcher, DispatcherPolicy, StepExecutionResult
from .idempotency import IdempotencyRecord, IdempotencyScope, stable_idempotency_key
from .memory import InMemoryRuntimeRepository


PHASES: tuple[tuple[WorkflowState, StepKind], ...] = (
    (WorkflowState.PLANNING, StepKind.PLANNING),
    (WorkflowState.DELEGATING, StepKind.DELEGATING),
    (WorkflowState.RUNNING, StepKind.RUNNING),
    (WorkflowState.SYNTHESIZING, StepKind.SYNTHESIZING),
)


@dataclass(slots=True)
class FixtureWorkflowRunner:
    repository: InMemoryRuntimeRepository
    dispatcher_policy: DispatcherPolicy = field(default_factory=DispatcherPolicy)

    @classmethod
    def default(cls) -> "FixtureWorkflowRunner":
        return cls(repository=InMemoryRuntimeRepository())

    def run(self, *, workflow_ref: str = "fixture-ref:workflow-smoke") -> dict[str, object]:
        workflow = self._create_workflow(workflow_ref)
        trace = workflow.trace_context
        self.repository.transition_workflow(
            workflow.workflow_id,
            WorkflowState.QUEUED,
            trace_context=trace.child(),
            refs={"queue_ref": "fixture-ref:queue:local"},
        )
        self._create_fixture_steps(workflow)

        dispatcher = BoundedDispatcher(
            self.repository,
            self._handle_fixture_step,
            policy=self.dispatcher_policy,
        )
        dispatch_stats: list[dict[str, int]] = []
        for target_state, kind in PHASES:
            self.repository.transition_workflow(
                workflow.workflow_id,
                target_state,
                trace_context=trace.child(baggage_refs=(f"fixture-ref:phase:{target_state.value}",)),
                refs={"phase_ref": f"fixture-ref:phase:{target_state.value}"},
            )
            dispatch_stats.append(dispatcher.run_until_idle(workflow_id=workflow.workflow_id, kinds=(kind,), trace_context=trace))

        completed = self.repository.transition_workflow(
            workflow.workflow_id,
            WorkflowState.COMPLETED,
            trace_context=trace.child(),
            refs={"result_ref": f"fixture-ref:workflow-result:{workflow.workflow_id}"},
        )
        return self._smoke_payload(completed.workflow_id, dispatch_stats)

    def _create_workflow(self, workflow_ref: str) -> Workflow:
        workflow_id = f"wf_{uuid5(NAMESPACE_URL, workflow_ref).hex[:16]}"
        idempotency_key = stable_idempotency_key(IdempotencyScope.WORKFLOW_CREATION, workflow_ref)
        record = IdempotencyRecord(
            scope=IdempotencyScope.WORKFLOW_CREATION,
            key=idempotency_key,
            workflow_id=workflow_id,
            request_ref=workflow_ref,
        )
        self.repository.reserve_idempotency(record)
        self.repository.complete_idempotency(
            IdempotencyScope.WORKFLOW_CREATION,
            idempotency_key,
            result_ref=f"fixture-ref:workflow:{workflow_id}",
        )
        workflow = Workflow(
            workflow_id=workflow_id,
            state=WorkflowState.CREATED,
            idempotency_key=idempotency_key,
            trace_context=TraceContext.new(correlation_id=workflow_id, baggage_refs=(workflow_ref,)),
            workflow_ref=workflow_ref,
        )
        return self.repository.create_workflow(workflow)

    def _create_fixture_steps(self, workflow: Workflow) -> None:
        for index, (_state, kind) in enumerate(PHASES, start=1):
            step_id = f"{workflow.workflow_id}_{index}_{kind.value}"
            step_ref = f"fixture-ref:step-input:{workflow.workflow_id}:{kind.value}"
            key = stable_idempotency_key(IdempotencyScope.STEP_EXECUTION, step_ref)
            self.repository.reserve_idempotency(
                IdempotencyRecord(
                    scope=IdempotencyScope.STEP_EXECUTION,
                    key=key,
                    workflow_id=workflow.workflow_id,
                    step_id=step_id,
                    request_ref=step_ref,
                )
            )
            self.repository.add_step(
                WorkflowStep(
                    step_id=step_id,
                    workflow_id=workflow.workflow_id,
                    kind=kind,
                    state=StepState.PENDING,
                    input_ref=step_ref,
                    idempotency_key=key,
                ),
                trace_context=workflow.trace_context.child(),
            )

    def _handle_fixture_step(self, step: WorkflowStep, trace_context: TraceContext) -> StepExecutionResult:
        output_ref = f"fixture-ref:step-output:{step.step_id}"
        self.repository.complete_idempotency(IdempotencyScope.STEP_EXECUTION, step.idempotency_key, result_ref=output_ref)
        event_refs = {"handler_ref": f"fixture-ref:handler:{step.kind.value}", "trace_ref": f"fixture-ref:trace:{trace_context.span_id}"}
        for scope in scopes_for_step(step.kind):
            request_ref = f"fixture-ref:{scope.value}:request:{step.step_id}"
            key = stable_idempotency_key(scope, request_ref)
            self.repository.reserve_idempotency(
                IdempotencyRecord(
                    scope=scope,
                    key=key,
                    workflow_id=step.workflow_id,
                    step_id=step.step_id,
                    request_ref=request_ref,
                )
            )
            result_ref = f"fixture-ref:{scope.value}:result:{step.step_id}"
            self.repository.complete_idempotency(scope, key, result_ref=result_ref)
            event_refs[f"{scope.value}_ref"] = result_ref
        return StepExecutionResult(output_ref=output_ref, event_refs=event_refs)

    def _smoke_payload(self, workflow_id: str, dispatch_stats: list[dict[str, int]]) -> dict[str, object]:
        workflow = self.repository.get_workflow(workflow_id)
        if workflow is None:
            raise RuntimeError(f"fixture workflow disappeared: {workflow_id}")
        idempotency_records = self.repository.list_idempotency_records()
        return {
            "runtime": "devgateway-agent-runtime",
            "mode": "fixture",
            "fixture_mode": True,
            "no_live_external_calls": True,
            "workflow": workflow.to_dict(),
            "steps": [step.to_dict() for step in self.repository.list_steps(workflow_id)],
            "events": [event.to_dict() for event in self.repository.list_events(workflow_id)],
            "idempotency_scopes": sorted({record.scope.value for record in idempotency_records}),
            "idempotency_record_count": len(idempotency_records),
            "dispatch_stats": dispatch_stats,
            "open_lease_count": len(self.repository.list_leases()),
        }


def scopes_for_step(kind: StepKind) -> tuple[IdempotencyScope, ...]:
    common = (IdempotencyScope.AUDIT_EVENT,)
    if kind == StepKind.PLANNING:
        return (IdempotencyScope.MODEL_CALL, IdempotencyScope.BUDGET_RESERVATION, *common)
    if kind == StepKind.DELEGATING:
        return (IdempotencyScope.TOOL_CALL, *common)
    if kind == StepKind.RUNNING:
        return (IdempotencyScope.TOOL_CALL, IdempotencyScope.COST_EVENT, *common)
    if kind == StepKind.SYNTHESIZING:
        return (IdempotencyScope.MODEL_CALL, IdempotencyScope.ARTIFACT_WRITE, *common)
    return common


def run_fixture_workflow_smoke() -> dict[str, object]:
    return FixtureWorkflowRunner.default().run()
