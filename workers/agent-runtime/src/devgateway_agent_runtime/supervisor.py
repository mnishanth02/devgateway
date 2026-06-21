from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, replace
from uuid import NAMESPACE_URL, uuid4, uuid5

from .contracts import (
    DelegationContract,
    OutputSchemaContract,
    PersistedWorkflowContext,
    PrimitiveSchemaType,
    ScopeRefs,
    SubAgentExecutionResult,
    SynthesisResult,
    TraceContext,
    Workflow,
    WorkflowEvent,
    WorkflowState,
)
from .executor import FixtureSubAgentExecutor
from .idempotency import IdempotencyRecord, IdempotencyScope, IdempotencyStatus, stable_idempotency_key
from .memory import InMemoryRuntimeRepository
from .model_adapter import (
    FIXTURE_MODEL_ALIASES,
    FIXTURE_POLICY_VERSION,
    FIXTURE_REGISTRY_VERSION,
    GovernedFixtureModelAdapter,
)


CHILD_OUTPUT_SCHEMA_REF = "fixture-ref:output-schema:child-analysis:v1"


@dataclass(frozen=True, slots=True)
class FixtureExecutionPlan:
    context: PersistedWorkflowContext
    plan_scope: ScopeRefs
    delegations: tuple[DelegationContract, ...]
    budget_reservation_refs: tuple[str, ...]
    output_schema: OutputSchemaContract

    def to_dict(self) -> dict[str, object]:
        return {
            "context_ref": self.context.context_ref,
            "plan_scope": self.plan_scope.to_dict(),
            "delegations": [delegation.to_dict() for delegation in self.delegations],
            "budget_reservation_refs": list(self.budget_reservation_refs),
            "output_schema": self.output_schema.to_dict(),
        }


@dataclass(slots=True)
class FixtureSupervisor:
    repository: InMemoryRuntimeRepository
    model_adapter: GovernedFixtureModelAdapter | None = None
    child_model_aliases: tuple[str, str] = (FIXTURE_MODEL_ALIASES[0], FIXTURE_MODEL_ALIASES[1])
    _last_plan: FixtureExecutionPlan | None = field(default=None, init=False)

    @classmethod
    def default(cls) -> "FixtureSupervisor":
        repository = InMemoryRuntimeRepository()
        return cls(repository=repository, model_adapter=GovernedFixtureModelAdapter(repository))

    def run(self, *, workflow_ref: str = "fixture-ref:workflow-execution-smoke") -> dict[str, object]:
        context = self._create_persisted_context(workflow_ref)
        trace = context.trace_context
        self.repository.transition_workflow(
            context.workflow_id,
            WorkflowState.QUEUED,
            trace_context=trace.child(),
            refs={"queue_ref": "fixture-ref:queue:execution-fixture"},
        )
        self.repository.transition_workflow(
            context.workflow_id,
            WorkflowState.PLANNING,
            trace_context=trace.child(baggage_refs=("fixture-ref:phase:execution-planning",)),
            refs={
                "policy_ref": f"fixture-ref:policy:{context.policy_version}",
                "registry_ref": f"fixture-ref:registry:{context.registry_version}",
            },
        )
        plan = self.build_fixture_plan(context)
        self.repository.transition_workflow(
            context.workflow_id,
            WorkflowState.DELEGATING,
            trace_context=trace.child(baggage_refs=("fixture-ref:phase:execution-delegating",)),
            refs={"plan_ref": f"fixture-ref:plan:{context.workflow_id}"},
        )
        self.repository.transition_workflow(
            context.workflow_id,
            WorkflowState.RUNNING,
            trace_context=trace.child(baggage_refs=("fixture-ref:phase:execution-running",)),
            refs={"delegation_count_ref": f"fixture-ref:delegation-count:{len(plan.delegations)}"},
        )

        executor = FixtureSubAgentExecutor(
            repository=self.repository,
            model_adapter=self.model_adapter or GovernedFixtureModelAdapter(self.repository),
        )
        child_results = tuple(executor.execute(delegation, parent_scope=plan.plan_scope) for delegation in plan.delegations)
        if any(result.status != "completed" or not result.validation.valid for result in child_results):
            synthesis = self._blocked_synthesis(context, child_results, reason="child_validation_or_scope_failure")
            self.repository.transition_workflow(
                context.workflow_id,
                WorkflowState.FAILED,
                trace_context=trace.child(baggage_refs=("fixture-ref:phase:synthesis-blocked",)),
                refs={"blocked_reason_ref": synthesis.blocked_reason_ref or synthesis.result_ref},
            )
        else:
            self.repository.transition_workflow(
                context.workflow_id,
                WorkflowState.SYNTHESIZING,
                trace_context=trace.child(baggage_refs=("fixture-ref:phase:execution-synthesizing",)),
                refs={"taint_notice_ref": "fixture-ref:taint:sub-agent-output-data-only"},
            )
            synthesis = self._synthesize(context, child_results)
            self.repository.transition_workflow(
                context.workflow_id,
                WorkflowState.COMPLETED,
                trace_context=trace.child(),
                refs={"synthesis_result_ref": synthesis.result_ref},
            )
        workflow = self.repository.get_workflow(context.workflow_id)
        if workflow is None:
            raise RuntimeError(f"fixture workflow disappeared: {context.workflow_id}")
        return self._payload(workflow, plan, child_results, synthesis)

    def build_fixture_plan(self, context: PersistedWorkflowContext) -> FixtureExecutionPlan:
        if len(set(self.child_model_aliases)) != len(self.child_model_aliases):
            raise ValueError("fixture child model aliases must be distinct")
        schema = OutputSchemaContract(
            schema_ref=CHILD_OUTPUT_SCHEMA_REF,
            required_fields={
                "summary": PrimitiveSchemaType.STRING,
                "confidence": PrimitiveSchemaType.NUMBER,
                "caveat": PrimitiveSchemaType.STRING,
            },
        )
        child_ids = ("child-analysis-a", "child-analysis-b")
        budget_refs = tuple(self._reserve_budget_ref(context, child_id) for child_id in child_ids)
        plan_scope = replace(context.scope, budget_reservation_refs=budget_refs)
        delegations: list[DelegationContract] = []
        for child_id, model_alias, budget_ref in zip(child_ids, self.child_model_aliases, budget_refs, strict=True):
            child_scope = replace(
                plan_scope,
                budget_reservation_refs=(budget_ref,),
                tool_refs=("fixture-ref:tool:context-read",),
                model_aliases=(model_alias,),
                output_schema_refs=(schema.schema_ref,),
            )
            delegations.append(
                DelegationContract(
                    workflow_id=context.workflow_id,
                    delegation_id=child_id,
                    delegation_ref=f"fixture-ref:delegation:{context.workflow_id}:{child_id}",
                    agent_ref=f"fixture-ref:sub-agent:{child_id}",
                    task_ref=f"fixture-ref:task:{context.workflow_id}:{child_id}",
                    context_ref=context.context_ref,
                    model_alias=model_alias,
                    output_schema=schema,
                    scope=child_scope,
                    policy_version=context.policy_version,
                    registry_version=context.registry_version,
                    trace_context=context.trace_context.child(
                        baggage_refs=(context.context_ref, f"fixture-ref:delegation:{child_id}", schema.schema_ref)
                    ),
                    timeout_seconds=300,
                    allowed_context_refs=(context.context_ref,),
                )
            )
        plan = FixtureExecutionPlan(
            context=context,
            plan_scope=plan_scope,
            delegations=tuple(delegations),
            budget_reservation_refs=budget_refs,
            output_schema=schema,
        )
        self._last_plan = plan
        self._append_event(
            context,
            "supervisor.plan_created",
            refs={
                "plan_ref": f"fixture-ref:plan:{context.workflow_id}",
                "budget_refs": f"fixture-ref:budget-reservation-set:{self._digest(*budget_refs)}",
                "schema_ref": schema.schema_ref,
            },
        )
        return plan

    def _create_persisted_context(self, workflow_ref: str) -> PersistedWorkflowContext:
        workflow_id = f"wf_exec_{uuid5(NAMESPACE_URL, workflow_ref).hex[:12]}"
        idempotency_key = stable_idempotency_key(IdempotencyScope.WORKFLOW_CREATION, workflow_ref)
        record, _created = self.repository.reserve_idempotency(
            IdempotencyRecord(
                scope=IdempotencyScope.WORKFLOW_CREATION,
                key=idempotency_key,
                workflow_id=workflow_id,
                request_ref=workflow_ref,
            )
        )
        existing_workflow = self.repository.get_workflow(workflow_id)
        if existing_workflow is not None:
            return self._context_from_workflow(existing_workflow)

        if record.status != IdempotencyStatus.COMPLETED or record.result_ref is None:
            self.repository.complete_idempotency(
                IdempotencyScope.WORKFLOW_CREATION,
                idempotency_key,
                result_ref=f"fixture-ref:workflow:{workflow_id}",
            )
        trace = TraceContext.new(correlation_id=workflow_id, baggage_refs=(workflow_ref,))
        workflow = self.repository.create_workflow(
            Workflow(
                workflow_id=workflow_id,
                state=WorkflowState.CREATED,
                idempotency_key=idempotency_key,
                trace_context=trace,
                workflow_ref=workflow_ref,
            )
        )
        return self._context_from_workflow(workflow)

    def _context_from_workflow(self, workflow: Workflow) -> PersistedWorkflowContext:
        scope = ScopeRefs(
            principal_ref="fixture-ref:principal:supervisor",
            project_ref="fixture-ref:project:devgateway",
            data_class_ref="fixture-ref:data-class:internal-fixture",
            budget_pool_ref="fixture-ref:budget-pool:phase2-5",
            context_refs=(f"fixture-ref:persisted-context:{workflow.workflow_id}",),
            tool_refs=("fixture-ref:tool:context-read", "fixture-ref:tool:artifact-write"),
            model_aliases=(FIXTURE_MODEL_ALIASES[0], FIXTURE_MODEL_ALIASES[1]),
            output_schema_refs=(CHILD_OUTPUT_SCHEMA_REF,),
            max_timeout_seconds=600,
        )
        return PersistedWorkflowContext(
            workflow_id=workflow.workflow_id,
            workflow_ref=workflow.workflow_ref,
            context_ref=f"fixture-ref:persisted-context:{workflow.workflow_id}",
            scope=scope,
            policy_version=FIXTURE_POLICY_VERSION,
            registry_version=FIXTURE_REGISTRY_VERSION,
            trace_context=workflow.trace_context,
        )

    def _reserve_budget_ref(self, context: PersistedWorkflowContext, child_id: str) -> str:
        request_ref = f"fixture-ref:budget_reservation:request:{context.workflow_id}:{child_id}"
        key = stable_idempotency_key(IdempotencyScope.BUDGET_RESERVATION, request_ref)
        result_ref = f"fixture-ref:budget-reservation:{context.workflow_id}:{child_id}"
        record, _created = self.repository.reserve_idempotency(
            IdempotencyRecord(
                scope=IdempotencyScope.BUDGET_RESERVATION,
                key=key,
                workflow_id=context.workflow_id,
                request_ref=request_ref,
            )
        )
        if record.status == IdempotencyStatus.COMPLETED and record.result_ref is not None:
            result_ref = record.result_ref
        else:
            self.repository.complete_idempotency(IdempotencyScope.BUDGET_RESERVATION, key, result_ref=result_ref)
        self._append_event(
            context,
            "budget.reserved",
            refs={
                "budget_pool_ref": context.scope.budget_pool_ref,
                "budget_reservation_ref": result_ref,
                "child_ref": f"fixture-ref:sub-agent:{child_id}",
            },
        )
        return result_ref

    def _synthesize(
        self,
        context: PersistedWorkflowContext,
        child_results: tuple[SubAgentExecutionResult, ...],
    ) -> SynthesisResult:
        final_artifact_ref = self._complete_operation(context, IdempotencyScope.ARTIFACT_WRITE, "synthesis-final")
        final_cost_ref = self._complete_operation(context, IdempotencyScope.COST_EVENT, "synthesis-cost")
        final_audit_ref = self._complete_operation(context, IdempotencyScope.AUDIT_EVENT, "synthesis-completed")
        confidence_values = [result.confidence for result in child_results if result.confidence is not None]
        confidence = round(sum(confidence_values) / len(confidence_values), 2) if confidence_values else 0.0
        child_result_refs = tuple(ref for result in child_results if (ref := result.model_result_ref))
        result = SynthesisResult(
            workflow_id=context.workflow_id,
            status="completed",
            result_ref=f"fixture-ref:synthesis-result:{self._digest(context.workflow_id, *child_result_refs)}",
            provenance_refs=tuple(
                ref
                for result in child_results
                for ref in (result.delegation_ref, result.model_result_ref or "", result.validation.evidence_ref)
                if ref
            ),
            confidence=confidence,
            cost_refs=tuple(ref for ref in (*[result.cost_ref for result in child_results], final_cost_ref) if ref),
            artifact_refs=tuple(ref for ref in (*[result.artifact_ref for result in child_results], final_artifact_ref) if ref),
            audit_refs=tuple(result.audit_ref for result in child_results) + (final_audit_ref,),
            caveats=(
                "Fixture-only synthesis; no live provider, Bifrost, Tool Broker, external tool, or DB connection was used.",
                "Persisted context and child outputs are tainted data and were never treated as instructions.",
            ),
            child_result_refs=child_result_refs,
        )
        self._append_event(
            context,
            "supervisor.synthesis_completed",
            refs={
                "synthesis_result_ref": result.result_ref,
                "artifact_ref": final_artifact_ref,
                "cost_ref": final_cost_ref,
                "audit_ref": final_audit_ref,
            },
        )
        return result

    def _blocked_synthesis(
        self,
        context: PersistedWorkflowContext,
        child_results: tuple[SubAgentExecutionResult, ...],
        *,
        reason: str,
    ) -> SynthesisResult:
        audit_ref = self._complete_operation(context, IdempotencyScope.AUDIT_EVENT, f"synthesis-blocked:{reason}")
        child_result_refs = tuple(ref for result in child_results if (ref := result.model_result_ref))
        blocked_reason_ref = f"fixture-ref:synthesis-blocked:{self._digest(context.workflow_id, reason)}"
        result = SynthesisResult(
            workflow_id=context.workflow_id,
            status="blocked",
            result_ref=blocked_reason_ref,
            provenance_refs=tuple(result.validation.evidence_ref for result in child_results),
            confidence=0.0,
            cost_refs=tuple(ref for result in child_results if (ref := result.cost_ref)),
            artifact_refs=tuple(ref for result in child_results if (ref := result.artifact_ref)),
            audit_refs=tuple(result.audit_ref for result in child_results) + (audit_ref,),
            caveats=("Synthesis blocked before final aggregation because a child result failed validation or scope checks.",),
            child_result_refs=child_result_refs,
            blocked_reason_ref=blocked_reason_ref,
        )
        self._append_event(
            context,
            "supervisor.synthesis_blocked",
            refs={"blocked_reason_ref": blocked_reason_ref, "audit_ref": audit_ref},
        )
        return result

    def _complete_operation(self, context: PersistedWorkflowContext, scope: IdempotencyScope, purpose: str) -> str:
        request_ref = f"fixture-ref:{scope.value}:request:{context.workflow_id}:{purpose}"
        key = stable_idempotency_key(scope, request_ref)
        result_ref = f"fixture-ref:{scope.value}:result:{self._digest(request_ref, key)}"
        record, _created = self.repository.reserve_idempotency(
            IdempotencyRecord(
                scope=scope,
                key=key,
                workflow_id=context.workflow_id,
                request_ref=request_ref,
            )
        )
        if record.status == IdempotencyStatus.COMPLETED and record.result_ref is not None:
            return record.result_ref
        self.repository.complete_idempotency(scope, key, result_ref=result_ref)
        return result_ref

    def _append_event(self, context: PersistedWorkflowContext, event_type: str, *, refs: dict[str, str]) -> None:
        self.repository.append_event(
            WorkflowEvent(
                event_id=f"evt_{uuid4().hex}",
                workflow_id=context.workflow_id,
                event_type=event_type,
                trace_context=context.trace_context.child(),
                refs=refs,
            )
        )

    def _payload(
        self,
        workflow: Workflow,
        plan: FixtureExecutionPlan,
        child_results: tuple[SubAgentExecutionResult, ...],
        synthesis: SynthesisResult,
    ) -> dict[str, object]:
        idempotency_records = self.repository.list_idempotency_records()
        return {
            "runtime": "devgateway-agent-runtime",
            "mode": "fixture",
            "fixture": "execution",
            "fixture_mode": True,
            "no_live_external_calls": True,
            "workflow": workflow.to_dict(),
            "plan": plan.to_dict(),
            "child_results": [result.to_dict() for result in child_results],
            "synthesis": synthesis.to_dict(),
            "events": [event.to_dict() for event in self.repository.list_events(workflow.workflow_id)],
            "idempotency_scopes": sorted({record.scope.value for record in idempotency_records}),
            "idempotency_record_count": len(idempotency_records),
            "open_lease_count": len(self.repository.list_leases()),
        }

    @staticmethod
    def _digest(*parts: str) -> str:
        return hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()[:16]


def run_supervisor_execution_fixture() -> dict[str, object]:
    return FixtureSupervisor.default().run()
