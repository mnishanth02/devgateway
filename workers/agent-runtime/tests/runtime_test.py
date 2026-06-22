from __future__ import annotations

import builtins
import json
import os
import subprocess
import sys
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from devgateway_agent_runtime import (  # noqa: E402
    BoundedDispatcher,
    DelegationContract,
    DispatcherPolicy,
    FIXTURE_MODEL_ALIASES,
    FIXTURE_POLICY_VERSION,
    FIXTURE_REGISTRY_VERSION,
    FixtureSubAgentExecutor,
    FixtureSupervisor,
    GovernedFixtureModelAdapter,
    FixtureWorkflowRunner,
    InMemoryRuntimeRepository,
    Lease,
    LeasePolicy,
    ModelPolicyError,
    ModelRequest,
    ModelResult,
    OutputSchemaContract,
    PollingBackoffPolicy,
    PrimitiveSchemaType,
    ScopeRefs,
    StepKind,
    StepExecutionResult,
    StepState,
    TraceContext,
    Workflow,
    WorkflowState,
    WorkflowStep,
    WorkflowTransitionError,
    run_supervisor_execution_fixture,
    validate_structured_output,
)
from devgateway_agent_runtime.contracts import utc_now  # noqa: E402
from devgateway_agent_runtime.contracts import (  # noqa: E402
    ApprovalDecision,
    ApprovalRequest,
    ApprovalRiskTier,
    ApprovalStatus,
    ArtifactLifecycleEvent,
    ArtifactLifecycleStage,
    CancellationRecord,
    CancellationTarget,
    FailureClass,
    ManualReviewItem,
    ManualReviewStatus,
    OutboxEventStatus,
    NonIdempotentFallbackBehavior,
    RetryBackoffPolicy,
    RetryBackoffType,
    RetryDecision,
    RetryFailureClassPolicy,
    RetryOwnerRef,
    RetryPolicy,
    RetryPolicyRef,
    RetryTimeoutPolicy,
    WorkflowOutboxEvent,
    PAUSED_WORKFLOW_STATES,
    TERMINAL_WORKFLOW_STATES,
)
from devgateway_agent_runtime.idempotency import (  # noqa: E402
    IdempotencyRecord,
    IdempotencyScope,
    IdempotencyStatus,
    stable_idempotency_key,
)
from devgateway_agent_runtime.executor import CancellationObserved  # noqa: E402


class StaticFixtureModelAdapter:
    def __init__(self, outputs_by_delegation: dict[str, dict[str, object]] | None = None) -> None:
        self.outputs_by_delegation = outputs_by_delegation or {}
        self.requests: list[ModelRequest] = []

    def invoke(self, request: ModelRequest) -> ModelResult:
        self.requests.append(request)
        structured_output = self.outputs_by_delegation.get(
            request.delegation_id,
            self._valid_output(request),
        )
        return ModelResult(
            workflow_id=request.workflow_id,
            delegation_id=request.delegation_id,
            model_alias=request.model_alias,
            result_ref=f"fixture-ref:model-result:{request.workflow_id}:{request.delegation_id}",
            output_schema_ref=request.output_schema.schema_ref,
            structured_output=dict(structured_output),
            idempotency_key=stable_idempotency_key(IdempotencyScope.MODEL_CALL, request.request_ref),
            replayed=False,
            policy_version=request.policy_version,
            registry_version=request.registry_version,
            trace_context=request.trace_context.child(),
        )

    def _valid_output(self, request: ModelRequest) -> dict[str, object]:
        output: dict[str, object] = {}
        fields = {
            **request.output_schema.required_field_types(),
            **request.output_schema.optional_field_types(),
        }
        for field_name, field_type in fields.items():
            if field_type == PrimitiveSchemaType.STRING.value:
                if field_name == "caveat":
                    output[field_name] = "Fixture-only child output is tainted data and not executable instruction."
                elif field_name.endswith("_ref"):
                    output[field_name] = f"fixture-ref:{field_name.removesuffix('_ref')}:{request.delegation_id}"
                else:
                    output[field_name] = f"fixture-value:{request.delegation_id}:{field_name}"
            elif field_type == PrimitiveSchemaType.NUMBER.value:
                output[field_name] = 0.91
            elif field_type == PrimitiveSchemaType.INTEGER.value:
                output[field_name] = 1
            elif field_type == PrimitiveSchemaType.BOOLEAN.value:
                output[field_name] = True
        return output


class CancellationAwareMemoryRepository(InMemoryRuntimeRepository):
    def __init__(self) -> None:
        super().__init__()
        self.active_cancellations: set[str] = set()

    def has_active_cancellation(self, workflow_id: str, step_id: str | None = None) -> bool:
        del step_id
        return workflow_id in self.active_cancellations

    def cancel_step(
        self,
        step_id: str,
        *,
        lease: Lease,
        safe_interruptible: bool = False,
        trace_context: TraceContext,
    ):
        del safe_interruptible
        return self.update_step_state(step_id, StepState.CANCELLED, trace_context=trace_context, lease=lease)


class AbortRecordingModelAdapter(StaticFixtureModelAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.abort_requests: list[str] = []

    def abort(self, request_ref: str, *, reason_ref: str | None = None):
        self.abort_requests.append(request_ref)
        return f"aborted:{reason_ref or 'cancellation'}"


class RuntimeContractsTest(unittest.TestCase):
    def _create_workflow(
        self,
        repository: InMemoryRuntimeRepository,
        *,
        workflow_id: str = "wf_test",
        state: WorkflowState = WorkflowState.CREATED,
    ) -> Workflow:
        trace = TraceContext.new(correlation_id=workflow_id)
        return repository.create_workflow(
            Workflow(
                workflow_id=workflow_id,
                state=state,
                idempotency_key=stable_idempotency_key(
                    IdempotencyScope.WORKFLOW_CREATION,
                    f"fixture-ref:workflow:{workflow_id}",
                ),
                trace_context=trace,
                workflow_ref=f"fixture-ref:workflow:{workflow_id}",
            )
        )

    def _add_step(
        self,
        repository: InMemoryRuntimeRepository,
        workflow: Workflow,
        *,
        step_id: str = "step_test",
        kind: StepKind = StepKind.PLANNING,
    ) -> WorkflowStep:
        step_ref = f"fixture-ref:step-input:{workflow.workflow_id}:{step_id}"
        return repository.add_step(
            WorkflowStep(
                step_id=step_id,
                workflow_id=workflow.workflow_id,
                kind=kind,
                state=StepState.PENDING,
                input_ref=step_ref,
                idempotency_key=stable_idempotency_key(IdempotencyScope.STEP_EXECUTION, step_ref),
            ),
            trace_context=workflow.trace_context.child(),
        )

    def _execution_schema(self, schema_ref: str = "fixture-ref:output-schema:execution-test:v1") -> OutputSchemaContract:
        return OutputSchemaContract(
            schema_ref=schema_ref,
            required_fields={
                "summary": PrimitiveSchemaType.STRING,
                "confidence": PrimitiveSchemaType.NUMBER,
                "caveat": PrimitiveSchemaType.STRING,
            },
        )

    def _execution_parent_scope(self, schema: OutputSchemaContract, workflow_id: str) -> ScopeRefs:
        return ScopeRefs(
            principal_ref="fixture-ref:principal:supervisor",
            project_ref="fixture-ref:project:devgateway",
            data_class_ref="fixture-ref:data-class:internal-fixture",
            budget_pool_ref="fixture-ref:budget-pool:phase2-5",
            budget_reservation_refs=(
                f"fixture-ref:budget-reservation:{workflow_id}:child-a",
                f"fixture-ref:budget-reservation:{workflow_id}:child-b",
            ),
            context_refs=(f"fixture-ref:context:{workflow_id}",),
            tool_refs=("fixture-ref:tool:context-read", "fixture-ref:tool:artifact-write"),
            model_aliases=(FIXTURE_MODEL_ALIASES[0], FIXTURE_MODEL_ALIASES[1]),
            output_schema_refs=(schema.schema_ref,),
            max_timeout_seconds=600,
        )

    def _execution_delegation(
        self,
        workflow: Workflow,
        schema: OutputSchemaContract,
        scope: ScopeRefs,
        *,
        delegation_id: str = "child-execution",
        model_alias: str = FIXTURE_MODEL_ALIASES[0],
        context_ref: str | None = None,
        timeout_seconds: int = 300,
        allowed_context_refs: tuple[str, ...] | None = None,
    ) -> DelegationContract:
        effective_context_ref = context_ref or f"fixture-ref:context:{workflow.workflow_id}"
        return DelegationContract(
            workflow_id=workflow.workflow_id,
            delegation_id=delegation_id,
            delegation_ref=f"fixture-ref:delegation:{workflow.workflow_id}:{delegation_id}",
            agent_ref=f"fixture-ref:sub-agent:{delegation_id}",
            task_ref=f"fixture-ref:task:{workflow.workflow_id}:{delegation_id}",
            context_ref=effective_context_ref,
            model_alias=model_alias,
            output_schema=schema,
            scope=scope,
            policy_version=FIXTURE_POLICY_VERSION,
            registry_version=FIXTURE_REGISTRY_VERSION,
            trace_context=workflow.trace_context.child(
                baggage_refs=(
                    f"fixture-ref:context:{workflow.workflow_id}",
                    f"fixture-ref:delegation:{delegation_id}",
                    schema.schema_ref,
                )
            ),
            timeout_seconds=timeout_seconds,
            allowed_context_refs=allowed_context_refs or (effective_context_ref,),
        )

    def test_workflow_transition_contract_allows_phase_path(self) -> None:
        workflow = Workflow(
            workflow_id="wf_contract",
            state=WorkflowState.CREATED,
            idempotency_key="fixture-key",
            trace_context=TraceContext.new(correlation_id="wf_contract"),
        )
        for target in [
            WorkflowState.QUEUED,
            WorkflowState.PLANNING,
            WorkflowState.DELEGATING,
            WorkflowState.RUNNING,
            WorkflowState.SYNTHESIZING,
            WorkflowState.COMPLETED,
        ]:
            workflow = workflow.transition_to(target)
        self.assertEqual(workflow.state, WorkflowState.COMPLETED)
        with self.assertRaises(WorkflowTransitionError):
            workflow.transition_to(WorkflowState.RUNNING)

    def test_fixture_runner_happy_path_records_completed_phase_transitions(self) -> None:
        repository = InMemoryRuntimeRepository()
        payload = FixtureWorkflowRunner(repository=repository).run()

        workflow = payload["workflow"]  # type: ignore[assignment]
        self.assertIsInstance(workflow, dict)
        workflow_id = str(workflow["workflow_id"])
        self.assertEqual(workflow["state"], "completed")
        workflow_events = [
            event.event_type
            for event in repository.list_events(workflow_id)
            if event.event_type.startswith("workflow.")
        ]
        self.assertEqual(
            workflow_events,
            [
                "workflow.created",
                "workflow.queued",
                "workflow.planning",
                "workflow.delegating",
                "workflow.running",
                "workflow.synthesizing",
                "workflow.completed",
            ],
        )
        self.assertEqual([step["state"] for step in payload["steps"]], ["completed"] * 4)  # type: ignore[index]
        self.assertEqual([stats["executed_steps"] for stats in payload["dispatch_stats"]], [1, 1, 1, 1])  # type: ignore[index]

    def test_idempotency_replay_returns_prior_results_without_duplicate_side_effect_refs(self) -> None:
        repository = InMemoryRuntimeRepository()
        trace = TraceContext.new(correlation_id="wf_replay")
        workflow_ref = "fixture-ref:workflow:replay"
        workflow_key = stable_idempotency_key(IdempotencyScope.WORKFLOW_CREATION, workflow_ref)
        workflow_record = IdempotencyRecord(
            scope=IdempotencyScope.WORKFLOW_CREATION,
            key=workflow_key,
            workflow_id="wf_replay",
            request_ref=workflow_ref,
        )
        reserved_workflow, created = repository.reserve_idempotency(workflow_record)
        self.assertTrue(created)
        self.assertEqual(reserved_workflow.status, IdempotencyStatus.RESERVED)
        workflow = repository.create_workflow(
            Workflow(
                workflow_id="wf_replay",
                state=WorkflowState.CREATED,
                idempotency_key=workflow_key,
                trace_context=trace,
                workflow_ref=workflow_ref,
            )
        )
        workflow_result_ref = f"fixture-ref:workflow:{workflow.workflow_id}"
        repository.complete_idempotency(
            IdempotencyScope.WORKFLOW_CREATION,
            workflow_key,
            result_ref=workflow_result_ref,
        )
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=trace.child())
        step = self._add_step(repository, workflow, step_id="step_replay", kind=StepKind.SYNTHESIZING)
        claim = repository.claim_next_step(
            owner_id="owner-a",
            lease_policy=LeasePolicy(ttl_seconds=30),
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.SYNTHESIZING,),
        )
        self.assertIsNotNone(claim)
        repository.update_step_state(step.step_id, StepState.RUNNING, trace_context=trace.child())

        operation_results: dict[IdempotencyScope, tuple[str, str]] = {}
        event_refs = {
            "artifact_write_ref": "fixture-ref:artifact_write:result:step_replay",
            "cost_event_ref": "fixture-ref:cost_event:result:step_replay",
            "audit_event_ref": "fixture-ref:audit_event:result:step_replay",
        }
        for scope, result_ref in [
            (IdempotencyScope.ARTIFACT_WRITE, event_refs["artifact_write_ref"]),
            (IdempotencyScope.COST_EVENT, event_refs["cost_event_ref"]),
            (IdempotencyScope.AUDIT_EVENT, event_refs["audit_event_ref"]),
        ]:
            request_ref = f"fixture-ref:{scope.value}:request:{step.step_id}"
            key = stable_idempotency_key(scope, request_ref)
            repository.reserve_idempotency(
                IdempotencyRecord(
                    scope=scope,
                    key=key,
                    workflow_id=workflow.workflow_id,
                    step_id=step.step_id,
                    request_ref=request_ref,
                )
            )
            repository.complete_idempotency(scope, key, result_ref=result_ref)
            operation_results[scope] = (key, result_ref)

        repository.complete_step(
            step.step_id,
            output_ref="fixture-ref:step-output:step_replay",
            trace_context=trace.child(),
            refs=event_refs,
        )
        if claim is not None:
            repository.release_lease(claim.lease.lease_id, owner_id="owner-a")
        before_event_refs = [
            dict(event.refs)
            for event in repository.list_events(workflow.workflow_id)
            if any(key in event.refs for key in event_refs)
        ]
        before_event_count = len(repository.list_events(workflow.workflow_id))
        before_idempotency_count = len(repository.list_idempotency_records())

        replayed_workflow, workflow_created = repository.reserve_idempotency(
            IdempotencyRecord(
                scope=IdempotencyScope.WORKFLOW_CREATION,
                key=workflow_key,
                workflow_id="wf_replay",
                request_ref=workflow_ref,
            )
        )
        self.assertFalse(workflow_created)
        self.assertEqual(replayed_workflow.result_ref, workflow_result_ref)
        for scope, (key, result_ref) in operation_results.items():
            replayed_operation, operation_created = repository.reserve_idempotency(
                IdempotencyRecord(
                    scope=scope,
                    key=key,
                    workflow_id=workflow.workflow_id,
                    step_id=step.step_id,
                    request_ref=f"fixture-ref:{scope.value}:request:{step.step_id}",
                )
            )
            self.assertFalse(operation_created)
            self.assertEqual(replayed_operation.result_ref, result_ref)

        self.assertEqual(len(repository.list_idempotency_records()), before_idempotency_count)
        self.assertEqual(len(repository.list_events(workflow.workflow_id)), before_event_count)
        after_event_refs = [
            dict(event.refs)
            for event in repository.list_events(workflow.workflow_id)
            if any(key in event.refs for key in event_refs)
        ]
        self.assertEqual(after_event_refs, before_event_refs)

    def test_lease_lifecycle_and_stale_running_step_recovery_marking(self) -> None:
        repository = InMemoryRuntimeRepository()
        policy = LeasePolicy(ttl_seconds=10, heartbeat_seconds=2)
        now = utc_now()
        lease = repository.acquire_lease("resource:exclusive", owner_id="owner-a", policy=policy, now=now)
        self.assertIsNotNone(lease)
        self.assertIsNone(
            repository.acquire_lease(
                "resource:exclusive",
                owner_id="owner-b",
                policy=policy,
                now=now + timedelta(seconds=1),
            )
        )
        self.assertIsNone(
            repository.heartbeat_lease(
                lease.lease_id,  # type: ignore[union-attr]
                owner_id="owner-b",
                policy=policy,
                now=now + timedelta(seconds=2),
            )
        )
        heartbeat = repository.heartbeat_lease(
            lease.lease_id,  # type: ignore[union-attr]
            owner_id="owner-a",
            policy=policy,
            now=now + timedelta(seconds=3),
        )
        self.assertIsNotNone(heartbeat)
        self.assertGreater(heartbeat.expires_at, lease.expires_at)  # type: ignore[union-attr]
        self.assertFalse(repository.release_lease(lease.lease_id, owner_id="owner-b"))  # type: ignore[union-attr]
        self.assertTrue(repository.release_lease(lease.lease_id, owner_id="owner-a"))  # type: ignore[union-attr]
        reacquired = repository.acquire_lease(
            "resource:exclusive",
            owner_id="owner-b",
            policy=policy,
            now=now + timedelta(seconds=4),
        )
        self.assertIsNotNone(reacquired)
        self.assertTrue(repository.release_lease(reacquired.lease_id, owner_id="owner-b"))  # type: ignore[union-attr]

        workflow = self._create_workflow(repository, workflow_id="wf_stale_running")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = self._add_step(repository, workflow, step_id="step_stale_running")
        claim = repository.claim_next_step(
            owner_id="owner-a",
            lease_policy=LeasePolicy(ttl_seconds=1),
            workflow_id=workflow.workflow_id,
            now=now,
        )
        self.assertIsNotNone(claim)
        repository.update_step_state(step.step_id, StepState.RUNNING, trace_context=workflow.trace_context.child(), now=now)
        recovered = repository.recover_stale_leases(now=now + timedelta(seconds=2))
        self.assertEqual(recovered, 1)
        recovered_step = repository.get_step(step.step_id)
        self.assertIsNotNone(recovered_step)
        self.assertEqual(recovered_step.state, StepState.MANUAL_REVIEW)  # type: ignore[union-attr]
        recovery_events = [
            event
            for event in repository.list_events(workflow.workflow_id)
            if event.event_type == "step.lease_stale_recovered"
        ]
        self.assertEqual(len(recovery_events), 1)
        self.assertEqual(recovery_events[0].step_id, step.step_id)
        self.assertEqual(
            recovery_events[0].refs.get("manual_review_reason_ref"),
            "fixture-ref:failure-class:worker_crash_active_lease",
        )

    def test_stale_step_lease_recovery_makes_step_claimable(self) -> None:
        repository = InMemoryRuntimeRepository()
        trace = TraceContext.new(correlation_id="wf_stale")
        workflow = repository.create_workflow(
            Workflow(
                workflow_id="wf_stale",
                state=WorkflowState.CREATED,
                idempotency_key="fixture-key",
                trace_context=trace,
            )
        )
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=trace.child())
        repository.add_step(
            WorkflowStep(
                step_id="step_stale",
                workflow_id=workflow.workflow_id,
                kind=StepKind.PLANNING,
                state=StepState.PENDING,
                input_ref="fixture-ref:input:stale",
                idempotency_key=stable_idempotency_key(IdempotencyScope.STEP_EXECUTION, "fixture-ref:input:stale"),
            ),
            trace_context=trace.child(),
        )

        now = utc_now()
        claim = repository.claim_next_step(owner_id="owner-a", lease_policy=LeasePolicy(ttl_seconds=1), now=now)
        self.assertIsNotNone(claim)
        recovered = repository.recover_stale_leases(now=now + timedelta(seconds=2))
        self.assertEqual(recovered, 1)
        self.assertEqual(repository.get_step("step_stale").state, StepState.PENDING)  # type: ignore[union-attr]
        second_claim = repository.claim_next_step(owner_id="owner-b", lease_policy=LeasePolicy(ttl_seconds=1))
        self.assertIsNotNone(second_claim)

    def test_dispatcher_claim_next_step_filters_and_bounded_no_work_polling(self) -> None:
        repository = InMemoryRuntimeRepository()
        workflow = self._create_workflow(repository, workflow_id="wf_dispatch")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        planning_step = self._add_step(repository, workflow, step_id="step_plan", kind=StepKind.PLANNING)
        running_step = self._add_step(repository, workflow, step_id="step_run", kind=StepKind.RUNNING)

        self.assertIsNone(
            repository.claim_next_step(
                owner_id="owner-a",
                lease_policy=LeasePolicy(),
                workflow_id="wf_other",
                kinds=(StepKind.PLANNING,),
            )
        )
        self.assertIsNone(
            repository.claim_next_step(
                owner_id="owner-a",
                lease_policy=LeasePolicy(),
                workflow_id=workflow.workflow_id,
                kinds=(StepKind.DELEGATING,),
            )
        )
        claim = repository.claim_next_step(
            owner_id="owner-a",
            lease_policy=LeasePolicy(),
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.RUNNING,),
        )
        self.assertIsNotNone(claim)
        self.assertEqual(claim.step_id, running_step.step_id)  # type: ignore[union-attr]
        self.assertEqual(repository.get_step(running_step.step_id).state, StepState.CLAIMED)  # type: ignore[union-attr]
        self.assertEqual(repository.get_step(running_step.step_id).attempt, 1)  # type: ignore[union-attr]
        self.assertEqual(repository.get_step(planning_step.step_id).state, StepState.PENDING)  # type: ignore[union-attr]

        sleep_delays: list[float] = []
        handler_calls: list[str] = []

        def handler(step: WorkflowStep, _trace_context: TraceContext) -> StepExecutionResult:
            handler_calls.append(step.step_id)
            return StepExecutionResult(
                output_ref=f"fixture-ref:step-output:{step.step_id}",
                event_refs={"handler_ref": f"fixture-ref:handler:{step.kind.value}"},
            )

        no_work_dispatcher = BoundedDispatcher(
            repository,
            handler,
            policy=DispatcherPolicy(
                max_steps_per_run=5,
                polling=PollingBackoffPolicy(max_idle_polls=3, initial_delay_seconds=0.1, multiplier=2.0),
            ),
            sleep=sleep_delays.append,
        )
        stats = no_work_dispatcher.run_until_idle(
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.DELEGATING,),
            trace_context=workflow.trace_context,
        )
        self.assertEqual(stats, {"executed_steps": 0, "idle_polls": 3, "recovered_stale_leases": 0})
        self.assertEqual(sleep_delays, [0.1, 0.2, 0.4])
        self.assertEqual(handler_calls, [])

    def test_dispatcher_respects_max_steps_per_run_bound(self) -> None:
        repository = InMemoryRuntimeRepository()
        workflow = self._create_workflow(repository, workflow_id="wf_dispatch_bound")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        for index in range(3):
            self._add_step(repository, workflow, step_id=f"step_bound_{index}", kind=StepKind.PLANNING)

        def handler(step: WorkflowStep, _trace_context: TraceContext) -> StepExecutionResult:
            return StepExecutionResult(
                output_ref=f"fixture-ref:step-output:{step.step_id}",
                event_refs={"handler_ref": f"fixture-ref:handler:{step.kind.value}"},
            )

        dispatcher = BoundedDispatcher(
            repository,
            handler,
            policy=DispatcherPolicy(max_steps_per_run=2, polling=PollingBackoffPolicy(max_idle_polls=5)),
        )
        stats = dispatcher.run_until_idle(
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.PLANNING,),
            trace_context=workflow.trace_context,
        )
        self.assertEqual(stats["executed_steps"], 2)
        self.assertEqual(stats["idle_polls"], 0)
        self.assertEqual([step.state for step in repository.list_steps(workflow.workflow_id)].count(StepState.COMPLETED), 2)
        self.assertEqual([step.state for step in repository.list_steps(workflow.workflow_id)].count(StepState.PENDING), 1)

    def test_runtime_service_routes_retryable_handler_failures_through_retry_policy(self) -> None:
        from devgateway_agent_runtime.service import RuntimeServicePolicy, RuntimeWorkerService

        repository = InMemoryRuntimeRepository()
        workflow = self._create_workflow(repository, workflow_id="wf_service_retry", state=WorkflowState.RUNNING)
        self._add_step(repository, workflow, step_id="step_service_retry", kind=StepKind.PLANNING)

        def handler(_step: WorkflowStep, _trace_context: TraceContext) -> StepExecutionResult:
            raise OSError("transient adapter failure")

        service = RuntimeWorkerService(
            repository,
            handler,
            policy=RuntimeServicePolicy(
                retry=RetryPolicy(max_attempts=3, base_delay_seconds=0.0, max_delay_seconds=0.0, jitter=False),
            ),
        )

        self.assertTrue(service.run_once(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,)))
        self.assertEqual(repository.get_step("step_service_retry").state, StepState.PENDING)  # type: ignore[union-attr]
        self.assertEqual(service.stats.failed_steps, 1)

    def test_runtime_service_opens_manual_review_for_ambiguous_handler_failures(self) -> None:
        from devgateway_agent_runtime.service import RuntimeWorkerService

        repository = InMemoryRuntimeRepository()
        workflow = self._create_workflow(repository, workflow_id="wf_service_review", state=WorkflowState.RUNNING)
        self._add_step(repository, workflow, step_id="step_service_review", kind=StepKind.PLANNING)

        def handler(_step: WorkflowStep, _trace_context: TraceContext) -> StepExecutionResult:
            raise RuntimeError("unknown side effect status")

        service = RuntimeWorkerService(repository, handler)

        self.assertTrue(service.run_once(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,)))
        self.assertEqual(repository.get_step("step_service_review").state, StepState.MANUAL_REVIEW)  # type: ignore[union-attr]
        self.assertEqual(service.stats.failed_steps, 1)

    def test_runtime_service_marks_abrupt_base_exception_for_review_and_reraises(self) -> None:
        from devgateway_agent_runtime.service import RuntimeWorkerService

        class AbruptStop(BaseException):
            pass

        repository = InMemoryRuntimeRepository()
        workflow = self._create_workflow(repository, workflow_id="wf_service_abrupt", state=WorkflowState.RUNNING)
        self._add_step(repository, workflow, step_id="step_service_abrupt", kind=StepKind.PLANNING)

        def handler(_step: WorkflowStep, _trace_context: TraceContext) -> StepExecutionResult:
            raise AbruptStop()

        service = RuntimeWorkerService(repository, handler)

        with self.assertRaises(AbruptStop):
            service.run_once(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,))
        self.assertEqual(repository.get_step("step_service_abrupt").state, StepState.MANUAL_REVIEW)  # type: ignore[union-attr]
        self.assertEqual(service.stats.failed_steps, 1)

    def test_background_workers_rollback_and_reraise_base_exceptions(self) -> None:
        from devgateway_agent_runtime.approval_expiry_worker import ApprovalExpiryWorker
        from devgateway_agent_runtime.budget_reaper import BudgetReaper
        from devgateway_agent_runtime.cancellation_worker import CancellationWorker

        class AbruptStop(BaseException):
            pass

        class CancellationRepo:
            def propagate_cancellations(self, **_kwargs: object) -> dict[str, int]:
                raise AbruptStop()

        class BudgetRepo:
            def reap_orphaned_budget_reservations(self, **_kwargs: object) -> dict[str, int]:
                raise AbruptStop()

        class ApprovalRepo:
            def expire_due_approvals(self, **_kwargs: object) -> int:
                raise AbruptStop()

        for worker in (
            CancellationWorker(CancellationRepo(), commit=lambda: commits.append("commit"), rollback=lambda: rollbacks.append("rollback")),
            BudgetReaper(BudgetRepo(), commit=lambda: commits.append("commit"), rollback=lambda: rollbacks.append("rollback")),
            ApprovalExpiryWorker(ApprovalRepo(), commit=lambda: commits.append("commit"), rollback=lambda: rollbacks.append("rollback")),
        ):
            commits: list[str] = []
            rollbacks: list[str] = []
            with self.subTest(worker=type(worker).__name__):
                with self.assertRaises(AbruptStop):
                    worker.run_once()
                self.assertEqual(commits, [])
                self.assertEqual(rollbacks, ["rollback"])

    def test_dispatcher_checks_cancellation_before_claim(self) -> None:
        repository = CancellationAwareMemoryRepository()
        workflow = self._create_workflow(repository, workflow_id="wf_dispatch_cancel")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        self._add_step(repository, workflow, step_id="step_dispatch_cancel", kind=StepKind.PLANNING)
        repository.active_cancellations.add(workflow.workflow_id)
        handler_calls: list[str] = []

        dispatcher = BoundedDispatcher(
            repository,
            lambda step, _trace_context: handler_calls.append(step.step_id) or StepExecutionResult(
                output_ref=f"fixture-ref:step-output:{step.step_id}",
                event_refs={},
            ),
            policy=DispatcherPolicy(max_steps_per_run=1, polling=PollingBackoffPolicy(max_idle_polls=1)),
        )

        self.assertTrue(dispatcher.dispatch_one(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,)))
        self.assertEqual(handler_calls, [])
        self.assertEqual(repository.get_step("step_dispatch_cancel").state, StepState.CANCELLED)  # type: ignore[union-attr]

    def test_executor_observes_cancellation_and_attempts_abort_before_side_effects(self) -> None:
        repository = CancellationAwareMemoryRepository()
        workflow = self._create_workflow(repository, workflow_id="wf_executor_cancel")
        schema = self._execution_schema()
        parent_scope = self._execution_parent_scope(schema, workflow.workflow_id)
        delegation = self._execution_delegation(workflow, schema, parent_scope)
        adapter = AbortRecordingModelAdapter()

        def activate_after_model(request: ModelRequest) -> ModelResult:
            result = StaticFixtureModelAdapter.invoke(adapter, request)
            repository.active_cancellations.add(request.workflow_id)
            return result

        adapter.invoke = activate_after_model  # type: ignore[method-assign]

        with self.assertRaises(CancellationObserved):
            FixtureSubAgentExecutor(repository, adapter).execute(delegation, parent_scope=parent_scope)  # type: ignore[arg-type]

        self.assertEqual(adapter.abort_requests, [delegation.to_model_request().request_ref])
        self.assertEqual(
            [record.scope for record in repository.list_idempotency_records()],
            [],
        )

    def test_fixture_runner_completes_and_records_all_idempotency_scopes(self) -> None:
        payload = FixtureWorkflowRunner.default().run()
        self.assertTrue(payload["fixture_mode"])
        self.assertTrue(payload["no_live_external_calls"])
        self.assertEqual(payload["workflow"]["state"], "completed")  # type: ignore[index]
        self.assertEqual(payload["open_lease_count"], 0)
        scopes = set(payload["idempotency_scopes"])  # type: ignore[arg-type]
        # The fixture runner exercises the pre-Track-3 scopes exactly.
        # Track-3 scopes (approval, outbox, cancellation, etc.) require durable
        # workflow features and are verified in dedicated Track-3 tests below.
        FIXTURE_RUNNER_SCOPES = frozenset(
            scope.value
            for scope in (
                IdempotencyScope.WORKFLOW_CREATION,
                IdempotencyScope.STEP_EXECUTION,
                IdempotencyScope.MODEL_CALL,
                IdempotencyScope.TOOL_CALL,
                IdempotencyScope.BUDGET_RESERVATION,
                IdempotencyScope.COST_EVENT,
                IdempotencyScope.AUDIT_EVENT,
                IdempotencyScope.ARTIFACT_WRITE,
            )
        )
        self.assertEqual(scopes, FIXTURE_RUNNER_SCOPES)
        for step in payload["steps"]:  # type: ignore[union-attr]
            self.assertEqual(step["state"], "completed")
            self.assertTrue(str(step["output_ref"]).startswith("fixture-ref:"))

    def test_supervisor_persisted_context_replay_reuses_existing_workflow(self) -> None:
        repository = InMemoryRuntimeRepository()
        supervisor = FixtureSupervisor(repository=repository, model_adapter=GovernedFixtureModelAdapter(repository))
        workflow_ref = "fixture-ref:workflow:supervisor-replay"

        first = supervisor._create_persisted_context(workflow_ref)
        second = supervisor._create_persisted_context(workflow_ref)

        self.assertEqual(second.workflow_id, first.workflow_id)
        self.assertEqual(second.workflow_ref, workflow_ref)
        self.assertEqual(second.context_ref, first.context_ref)
        self.assertEqual(repository.get_workflow(first.workflow_id).workflow_id, first.workflow_id)  # type: ignore[union-attr]
        workflow_created_events = [
            event for event in repository.list_events(first.workflow_id) if event.event_type == "workflow.created"
        ]
        self.assertEqual(len(workflow_created_events), 1)

    def test_fixture_completion_uses_only_opaque_refs_without_live_dependency_imports(self) -> None:
        blocked_roots = {
            "asyncpg",
            "boto3",
            "httpx",
            "openai",
            "psycopg",
            "psycopg2",
            "requests",
            "sqlalchemy",
        }
        original_import = builtins.__import__

        def guarded_import(name: str, *args: object, **kwargs: object) -> object:
            if name.partition(".")[0] in blocked_roots:
                raise AssertionError(f"fixture runtime imported live dependency {name}")
            return original_import(name, *args, **kwargs)

        repository = InMemoryRuntimeRepository()
        with patch("builtins.__import__", guarded_import):
            payload = FixtureWorkflowRunner(repository=repository).run()

        self.assertTrue(payload["no_live_external_calls"])
        workflow = payload["workflow"]  # type: ignore[assignment]
        self.assertIsInstance(workflow, dict)
        workflow_id = str(workflow["workflow_id"])
        self.assertTrue(str(workflow["workflow_ref"]).startswith("fixture-ref:"))
        for step in payload["steps"]:  # type: ignore[union-attr]
            self.assertTrue(str(step["input_ref"]).startswith("fixture-ref:"))
            self.assertTrue(str(step["output_ref"]).startswith("fixture-ref:"))
        for event in repository.list_events(workflow_id):
            for ref in event.refs.values():
                self.assertTrue(ref.startswith("fixture-ref:"), ref)

        required_scopes = {
            IdempotencyScope.ARTIFACT_WRITE,
            IdempotencyScope.COST_EVENT,
            IdempotencyScope.AUDIT_EVENT,
        }
        records = [
            record
            for record in repository.list_idempotency_records()
            if record.scope in required_scopes
        ]
        self.assertGreaterEqual(len(records), len(required_scopes))
        self.assertEqual({record.scope for record in records}, required_scopes)
        for record in records:
            self.assertEqual(record.status, IdempotencyStatus.COMPLETED)
            self.assertIsNotNone(record.request_ref)
            self.assertIsNotNone(record.result_ref)
            self.assertTrue(record.request_ref.startswith("fixture-ref:"))  # type: ignore[union-attr]
            self.assertTrue(record.result_ref.startswith("fixture-ref:"))  # type: ignore[union-attr]

    def test_result_validation_rejects_invalid_structured_output_without_raw_values(self) -> None:
        schema = OutputSchemaContract(
            schema_ref="fixture-ref:output-schema:test:v1",
            required_fields={"summary": PrimitiveSchemaType.STRING, "confidence": PrimitiveSchemaType.NUMBER},
        )
        valid = validate_structured_output(
            {"summary": "fixture summary", "confidence": 0.81},
            schema,
            output_ref="fixture-ref:model-result:valid",
        )
        self.assertTrue(valid.valid)
        invalid = validate_structured_output(
            {"summary": "fixture summary", "confidence": "very high"},
            schema,
            output_ref="fixture-ref:model-result:invalid",
        )
        self.assertFalse(invalid.valid)
        self.assertEqual(invalid.failure_code, "type_mismatch")
        self.assertEqual(invalid.failure_path, "$.confidence")
        self.assertNotIn("very high", json.dumps(invalid.to_dict()))

    def test_governed_fixture_model_adapter_uses_idempotency_and_alias_allow_list(self) -> None:
        repository = InMemoryRuntimeRepository()
        schema = OutputSchemaContract(
            schema_ref="fixture-ref:output-schema:model:v1",
            required_fields={"summary": PrimitiveSchemaType.STRING, "confidence": PrimitiveSchemaType.NUMBER},
        )
        request = ModelRequest(
            workflow_id="wf_model",
            delegation_id="child-model",
            request_ref="fixture-ref:model-request:wf_model:child-model",
            model_alias=FIXTURE_MODEL_ALIASES[0],
            policy_version=FIXTURE_POLICY_VERSION,
            registry_version=FIXTURE_REGISTRY_VERSION,
            trace_context=TraceContext.new(correlation_id="wf_model"),
            budget_reservation_refs=("fixture-ref:budget-reservation:wf_model:child-model",),
            output_schema_refs=(schema.schema_ref,),
            output_schema=schema,
            context_ref="fixture-ref:context:wf_model",
            task_ref="fixture-ref:task:wf_model:child-model",
        )
        adapter = GovernedFixtureModelAdapter(repository)
        first = adapter.invoke(request)
        second = adapter.invoke(request)
        self.assertFalse(first.replayed)
        self.assertTrue(second.replayed)
        self.assertEqual(first.result_ref, second.result_ref)
        self.assertEqual(first.structured_output, second.structured_output)
        model_records = [record for record in repository.list_idempotency_records() if record.scope == IdempotencyScope.MODEL_CALL]
        self.assertEqual(len(model_records), 1)
        bad_request = ModelRequest(
            workflow_id=request.workflow_id,
            delegation_id=request.delegation_id,
            request_ref=request.request_ref,
            model_alias="prod-live-model",
            policy_version=request.policy_version,
            registry_version=request.registry_version,
            trace_context=request.trace_context,
            budget_reservation_refs=request.budget_reservation_refs,
            output_schema_refs=request.output_schema_refs,
            output_schema=request.output_schema,
            context_ref=request.context_ref,
            task_ref=request.task_ref,
        )
        with self.assertRaises(ModelPolicyError):
            adapter.invoke(bad_request)

    def test_governed_fixture_model_adapter_requires_execution_governance_refs(self) -> None:
        repository = InMemoryRuntimeRepository()
        schema = self._execution_schema("fixture-ref:output-schema:model-governance:v1")
        adapter = GovernedFixtureModelAdapter(repository)
        base_request = ModelRequest(
            workflow_id="wf_model_governance",
            delegation_id="child-model-governance",
            request_ref="fixture-ref:model-request:wf_model_governance:child-model-governance",
            model_alias=FIXTURE_MODEL_ALIASES[0],
            policy_version=FIXTURE_POLICY_VERSION,
            registry_version=FIXTURE_REGISTRY_VERSION,
            trace_context=TraceContext.new(correlation_id="wf_model_governance"),
            budget_reservation_refs=("fixture-ref:budget-reservation:wf_model_governance:child-model-governance",),
            output_schema_refs=(schema.schema_ref,),
            output_schema=schema,
            context_ref="fixture-ref:context:wf_model_governance",
            task_ref="fixture-ref:task:wf_model_governance:child-model-governance",
        )

        for index, alias in enumerate(FIXTURE_MODEL_ALIASES):
            with self.subTest(alias=alias):
                request = replace(
                    base_request,
                    delegation_id=f"child-model-governance-{index}",
                    request_ref=f"fixture-ref:model-request:wf_model_governance:child-model-governance-{index}",
                    model_alias=alias,
                )
                result = adapter.invoke(request)
                self.assertEqual(result.model_alias, alias)
                self.assertTrue(result.result_ref.startswith("fixture-ref:"))
                self.assertEqual(result.output_schema_ref, schema.schema_ref)

        invalid_requests = {
            "missing_policy_version": replace(base_request, policy_version=""),
            "missing_registry_version": replace(base_request, registry_version=""),
            "missing_trace_context": replace(base_request, trace_context=None),  # type: ignore[arg-type]
            "missing_budget_refs": replace(base_request, budget_reservation_refs=()),
            "non_fixture_budget_ref": replace(base_request, budget_reservation_refs=("budget-reservation:live",)),
            "missing_output_schema_refs": replace(base_request, output_schema_refs=()),
            "wrong_output_schema_ref": replace(
                base_request,
                output_schema_refs=("fixture-ref:output-schema:other:v1",),
            ),
            "non_fixture_output_schema_ref": replace(
                base_request,
                output_schema_refs=(schema.schema_ref, "output-schema:live"),
            ),
            "fixture_mode_disabled": replace(base_request, fixture_mode=False),
            "production_enabled": replace(base_request, production_enabled=True),
            "production_alias": replace(base_request, model_alias="prod-live-model"),
            "live_provider_alias": replace(base_request, model_alias="openai:gpt-4o-live"),
        }
        for label, invalid_request in invalid_requests.items():
            with self.subTest(label=label):
                with self.assertRaises(ModelPolicyError):
                    adapter.invoke(invalid_request)

    def test_supervisor_creates_scoped_nonproduction_delegations_that_narrow_parent_scope(self) -> None:
        payload = run_supervisor_execution_fixture()
        plan = payload["plan"]  # type: ignore[assignment]
        parent_scope = plan["plan_scope"]  # type: ignore[index]
        delegations = plan["delegations"]  # type: ignore[index]

        self.assertGreaterEqual(len(delegations), 2)  # type: ignore[arg-type]
        aliases = [delegation["model_alias"] for delegation in delegations]  # type: ignore[index]
        self.assertEqual(len(aliases), len(set(aliases)))
        for alias in aliases:
            self.assertIn(alias, FIXTURE_MODEL_ALIASES)
            self.assertTrue(str(alias).startswith("fixture-nonprod-"))

        for delegation in delegations:  # type: ignore[union-attr]
            child_scope = delegation["scope"]
            for scalar_field in ("principal_ref", "project_ref", "data_class_ref", "budget_pool_ref"):
                self.assertEqual(child_scope[scalar_field], parent_scope[scalar_field])
                self.assertTrue(str(child_scope[scalar_field]).startswith("fixture-ref:"))
            for subset_field in (
                "budget_reservation_refs",
                "context_refs",
                "tool_refs",
                "model_aliases",
                "output_schema_refs",
            ):
                child_values = set(child_scope[subset_field])
                parent_values = set(parent_scope[subset_field])
                self.assertTrue(child_values)
                self.assertTrue(child_values.issubset(parent_values), subset_field)
            self.assertEqual(child_scope["model_aliases"], [delegation["model_alias"]])
            self.assertEqual(child_scope["output_schema_refs"], [delegation["output_schema_ref"]])
            self.assertEqual(len(child_scope["budget_reservation_refs"]), 1)
            self.assertEqual(delegation["allowed_context_refs"], [delegation["context_ref"]])
            self.assertLessEqual(delegation["timeout_seconds"], parent_scope["max_timeout_seconds"])

    def test_sub_agent_executor_rejects_widening_for_every_scope_dimension(self) -> None:
        schema = self._execution_schema("fixture-ref:output-schema:scope-widening:v1")
        base_workflow_id = "wf_scope_widening"
        parent_scope = self._execution_parent_scope(schema, base_workflow_id)
        valid_child_scope = replace(
            parent_scope,
            budget_reservation_refs=(parent_scope.budget_reservation_refs[0],),
            tool_refs=("fixture-ref:tool:context-read",),
            model_aliases=(FIXTURE_MODEL_ALIASES[0],),
        )
        widened_cases = {
            "principal_ref": replace(valid_child_scope, principal_ref="fixture-ref:principal:other"),
            "project_ref": replace(valid_child_scope, project_ref="fixture-ref:project:other"),
            "data_class_ref": replace(valid_child_scope, data_class_ref="fixture-ref:data-class:public"),
            "budget_pool_ref": replace(valid_child_scope, budget_pool_ref="fixture-ref:budget-pool:other"),
            "budget_reservation_refs": replace(
                valid_child_scope,
                budget_reservation_refs=(
                    parent_scope.budget_reservation_refs[0],
                    "fixture-ref:budget-reservation:outside",
                ),
            ),
            "context_refs": replace(
                valid_child_scope,
                context_refs=(parent_scope.context_refs[0], "fixture-ref:context:outside"),
            ),
            "tool_refs": replace(
                valid_child_scope,
                tool_refs=("fixture-ref:tool:context-read", "fixture-ref:tool:live-shell"),
            ),
            "model_aliases": replace(
                valid_child_scope,
                model_aliases=(FIXTURE_MODEL_ALIASES[0], "fixture-nonprod-outside"),
            ),
            "output_schema_refs": replace(
                valid_child_scope,
                output_schema_refs=(schema.schema_ref, "fixture-ref:output-schema:outside:v1"),
            ),
            "max_timeout_seconds": replace(valid_child_scope, max_timeout_seconds=parent_scope.max_timeout_seconds + 1),
        }

        for field_name, widened_scope in widened_cases.items():
            with self.subTest(field_name=field_name):
                repository = InMemoryRuntimeRepository()
                workflow = self._create_workflow(repository, workflow_id=f"{base_workflow_id}_{field_name}")
                delegation = self._execution_delegation(
                    workflow,
                    schema,
                    widened_scope,
                    context_ref=parent_scope.context_refs[0],
                    allowed_context_refs=parent_scope.context_refs,
                )
                result = FixtureSubAgentExecutor(
                    repository,
                    GovernedFixtureModelAdapter(repository),
                ).execute(delegation, parent_scope=parent_scope)
                self.assertEqual(result.status, "scope_rejected")
                self.assertIn(field_name, result.scope_violations)
                self.assertFalse(result.validation.valid)
                self.assertEqual(
                    [record for record in repository.list_idempotency_records() if record.scope == IdempotencyScope.MODEL_CALL],
                    [],
                )

    def test_sub_agent_executor_rejects_context_and_timeout_widening_before_model_call(self) -> None:
        schema = self._execution_schema("fixture-ref:output-schema:delegation-bounds:v1")
        parent_scope = self._execution_parent_scope(schema, "wf_delegation_bounds")
        child_scope = replace(
            parent_scope,
            budget_reservation_refs=(parent_scope.budget_reservation_refs[0],),
            tool_refs=("fixture-ref:tool:context-read",),
            model_aliases=(FIXTURE_MODEL_ALIASES[0],),
        )
        cases = {
            "allowed_context_refs": {
                "allowed_context_refs": (parent_scope.context_refs[0], "fixture-ref:context:outside"),
            },
            "context_ref": {
                "context_ref": "fixture-ref:context:outside",
                "allowed_context_refs": parent_scope.context_refs,
            },
            "timeout_seconds": {
                "timeout_seconds": parent_scope.max_timeout_seconds + 1,
            },
        }

        for violation, overrides in cases.items():
            with self.subTest(violation=violation):
                repository = InMemoryRuntimeRepository()
                workflow = self._create_workflow(repository, workflow_id="wf_delegation_bounds")
                delegation = self._execution_delegation(workflow, schema, child_scope, **overrides)  # type: ignore[arg-type]
                result = FixtureSubAgentExecutor(
                repository,
                GovernedFixtureModelAdapter(repository),
                ).execute(delegation, parent_scope=parent_scope)

                self.assertEqual(result.status, "scope_rejected")
                self.assertIn(violation, result.scope_violations)
                self.assertEqual(
                [record for record in repository.list_idempotency_records() if record.scope == IdempotencyScope.MODEL_CALL],
                [],
                )

    def test_sub_agent_executor_rejects_scope_widening_before_model_call(self) -> None:
        repository = InMemoryRuntimeRepository()
        workflow = self._create_workflow(repository, workflow_id="wf_scope")
        schema = OutputSchemaContract(
            schema_ref="fixture-ref:output-schema:scope:v1",
            required_fields={"summary": PrimitiveSchemaType.STRING, "confidence": PrimitiveSchemaType.NUMBER},
        )
        parent_scope = ScopeRefs(
            principal_ref="fixture-ref:principal:supervisor",
            project_ref="fixture-ref:project:devgateway",
            data_class_ref="fixture-ref:data-class:internal-fixture",
            budget_pool_ref="fixture-ref:budget-pool:phase2-5",
            budget_reservation_refs=("fixture-ref:budget-reservation:wf_scope:child",),
            context_refs=("fixture-ref:context:wf_scope",),
            tool_refs=("fixture-ref:tool:context-read",),
            model_aliases=(FIXTURE_MODEL_ALIASES[0],),
            output_schema_refs=(schema.schema_ref,),
            max_timeout_seconds=600,
        )
        child_scope = ScopeRefs(
            principal_ref=parent_scope.principal_ref,
            project_ref=parent_scope.project_ref,
            data_class_ref=parent_scope.data_class_ref,
            budget_pool_ref=parent_scope.budget_pool_ref,
            budget_reservation_refs=parent_scope.budget_reservation_refs,
            context_refs=parent_scope.context_refs,
            tool_refs=parent_scope.tool_refs,
            model_aliases=(FIXTURE_MODEL_ALIASES[1],),
            output_schema_refs=parent_scope.output_schema_refs,
            max_timeout_seconds=parent_scope.max_timeout_seconds,
        )
        delegation = DelegationContract(
            workflow_id=workflow.workflow_id,
            delegation_id="child-scope",
            delegation_ref="fixture-ref:delegation:wf_scope:child-scope",
            agent_ref="fixture-ref:sub-agent:child-scope",
            task_ref="fixture-ref:task:wf_scope:child-scope",
            context_ref="fixture-ref:context:wf_scope",
            model_alias=FIXTURE_MODEL_ALIASES[1],
            output_schema=schema,
            scope=child_scope,
            policy_version=FIXTURE_POLICY_VERSION,
            registry_version=FIXTURE_REGISTRY_VERSION,
            trace_context=workflow.trace_context.child(),
            timeout_seconds=300,
            allowed_context_refs=("fixture-ref:context:wf_scope",),
        )
        supervisor = FixtureSupervisor(repository=repository, model_adapter=GovernedFixtureModelAdapter(repository))
        adapter = supervisor.model_adapter
        self.assertIsNotNone(adapter)

        result = FixtureSubAgentExecutor(repository, adapter).execute(delegation, parent_scope=parent_scope)  # type: ignore[arg-type]
        self.assertEqual(result.status, "scope_rejected")
        self.assertIn("model_aliases", result.scope_violations)
        self.assertFalse(result.validation.valid)
        self.assertEqual(
            [record for record in repository.list_idempotency_records() if record.scope == IdempotencyScope.MODEL_CALL],
            [],
        )

    def test_sub_agent_executor_validates_output_before_artifact_and_cost_refs(self) -> None:
        schema = self._execution_schema("fixture-ref:output-schema:executor-validation:v1")

        valid_repository = InMemoryRuntimeRepository()
        valid_workflow = self._create_workflow(valid_repository, workflow_id="wf_executor_valid")
        valid_parent_scope = self._execution_parent_scope(schema, valid_workflow.workflow_id)
        valid_child_scope = replace(
            valid_parent_scope,
            budget_reservation_refs=(valid_parent_scope.budget_reservation_refs[0],),
            tool_refs=("fixture-ref:tool:context-read",),
            model_aliases=(FIXTURE_MODEL_ALIASES[0],),
        )
        valid_delegation = self._execution_delegation(valid_workflow, schema, valid_child_scope)
        valid_result = FixtureSubAgentExecutor(
            valid_repository,
            StaticFixtureModelAdapter(),
        ).execute(valid_delegation, parent_scope=valid_parent_scope)

        self.assertEqual(valid_result.status, "completed")
        self.assertTrue(valid_result.validation.valid)
        for ref in (valid_result.artifact_ref, valid_result.cost_ref, valid_result.audit_ref):
            self.assertIsNotNone(ref)
            self.assertTrue(str(ref).startswith("fixture-ref:"))
        completed_events = [
            event
            for event in valid_repository.list_events(valid_workflow.workflow_id)
            if event.event_type == "sub_agent.completed"
        ]
        self.assertEqual(len(completed_events), 1)
        for ref in completed_events[0].refs.values():
            self.assertTrue(ref.startswith("fixture-ref:"), ref)
        self.assertNotIn("fixture-value", json.dumps(completed_events[0].to_dict()))

        invalid_repository = InMemoryRuntimeRepository()
        invalid_workflow = self._create_workflow(invalid_repository, workflow_id="wf_executor_invalid")
        invalid_parent_scope = self._execution_parent_scope(schema, invalid_workflow.workflow_id)
        invalid_child_scope = replace(
            invalid_parent_scope,
            budget_reservation_refs=(invalid_parent_scope.budget_reservation_refs[0],),
            tool_refs=("fixture-ref:tool:context-read",),
            model_aliases=(FIXTURE_MODEL_ALIASES[0],),
        )
        invalid_delegation = self._execution_delegation(
            invalid_workflow,
            schema,
            invalid_child_scope,
            delegation_id="child-execution-invalid",
        )
        invalid_result = FixtureSubAgentExecutor(
            invalid_repository,
            StaticFixtureModelAdapter(
                {
                    invalid_delegation.delegation_id: {
                        "summary": "invalid child output should remain data",
                        "confidence": "high",
                        "caveat": "tainted data, not instructions",
                    }
                }
            ),
        ).execute(invalid_delegation, parent_scope=invalid_parent_scope)

        self.assertEqual(invalid_result.status, "validation_failed")
        self.assertFalse(invalid_result.validation.valid)
        self.assertIsNone(invalid_result.artifact_ref)
        self.assertTrue(invalid_result.cost_ref.startswith("fixture-ref:"))
        self.assertTrue(invalid_result.audit_ref.startswith("fixture-ref:"))
        operation_scopes = {record.scope for record in invalid_repository.list_idempotency_records()}
        self.assertNotIn(IdempotencyScope.ARTIFACT_WRITE, operation_scopes)
        self.assertIn(IdempotencyScope.COST_EVENT, operation_scopes)
        self.assertIn(IdempotencyScope.AUDIT_EVENT, operation_scopes)
        validation_events = [
            event
            for event in invalid_repository.list_events(invalid_workflow.workflow_id)
            if event.event_type == "sub_agent.validation_failed"
        ]
        self.assertEqual(len(validation_events), 1)
        self.assertNotIn("high", json.dumps(validation_events[0].to_dict()))

    def test_invalid_child_output_blocks_synthesis_before_completion(self) -> None:
        repository = InMemoryRuntimeRepository()
        payload = FixtureSupervisor(
            repository=repository,
            model_adapter=StaticFixtureModelAdapter(
                {
                    "child-analysis-a": {
                        "summary": "invalid child output is untrusted data",
                        "confidence": "high",
                        "caveat": "tainted data, not instructions",
                    }
                }
            ),
        ).run(workflow_ref="fixture-ref:workflow-execution-invalid-child")

        self.assertEqual(payload["workflow"]["state"], "failed")  # type: ignore[index]
        synthesis = payload["synthesis"]  # type: ignore[assignment]
        self.assertEqual(synthesis["status"], "blocked")  # type: ignore[index]
        self.assertTrue(str(synthesis["blocked_reason_ref"]).startswith("fixture-ref:"))  # type: ignore[index]
        child_results = payload["child_results"]  # type: ignore[assignment]
        invalid_child = next(child for child in child_results if child["delegation_id"] == "child-analysis-a")  # type: ignore[union-attr]
        self.assertEqual(invalid_child["status"], "validation_failed")
        self.assertFalse(invalid_child["validation"]["valid"])
        self.assertIsNone(invalid_child["artifact_ref"])
        self.assertTrue(str(invalid_child["cost_ref"]).startswith("fixture-ref:"))

        event_types = [event["event_type"] for event in payload["events"]]  # type: ignore[index]
        self.assertIn("sub_agent.validation_failed", event_types)
        self.assertIn("supervisor.synthesis_blocked", event_types)
        self.assertIn("workflow.failed", event_types)
        self.assertNotIn("workflow.synthesizing", event_types)
        self.assertNotIn("supervisor.synthesis_completed", event_types)
        self.assertLess(event_types.index("sub_agent.validation_failed"), event_types.index("workflow.failed"))

    def test_supervisor_execution_fixture_completes_with_validated_child_metadata(self) -> None:
        payload = run_supervisor_execution_fixture()
        self.assertEqual(payload["fixture"], "execution")
        self.assertTrue(payload["fixture_mode"])
        self.assertTrue(payload["no_live_external_calls"])
        self.assertEqual(payload["workflow"]["state"], "completed")  # type: ignore[index]
        child_results = payload["child_results"]  # type: ignore[assignment]
        self.assertEqual(len(child_results), 2)  # type: ignore[arg-type]
        aliases = [child["model_alias"] for child in child_results]  # type: ignore[index]
        self.assertEqual(len(set(aliases)), 2)
        for child in child_results:  # type: ignore[union-attr]
            self.assertEqual(child["status"], "completed")
            self.assertTrue(child["validation"]["valid"])
            self.assertTrue(str(child["artifact_ref"]).startswith("fixture-ref:"))
            self.assertTrue(str(child["cost_ref"]).startswith("fixture-ref:"))
            self.assertTrue(str(child["audit_ref"]).startswith("fixture-ref:"))
            self.assertIn("tainted data", child["validated_output"]["caveat"])
            self.assertIn("not executable instruction", child["validated_output"]["caveat"])
        synthesis = payload["synthesis"]  # type: ignore[assignment]
        self.assertEqual(synthesis["status"], "completed")  # type: ignore[index]
        self.assertGreater(synthesis["confidence"], 0)  # type: ignore[index]
        self.assertIn("tainted data", " ".join(synthesis["caveats"]))  # type: ignore[index]
        self.assertIn("never treated as instructions", " ".join(synthesis["caveats"]))  # type: ignore[index]
        synthesis_dump = json.dumps(synthesis)
        for child in child_results:  # type: ignore[union-attr]
            self.assertNotIn(child["validated_output"]["summary"], synthesis_dump)
            self.assertNotIn(child["validated_output"]["caveat"], synthesis_dump)
        for ref_collection_name in ("artifact_refs", "cost_refs", "audit_refs", "child_result_refs", "provenance_refs"):
            for ref in synthesis[ref_collection_name]:  # type: ignore[index]
                self.assertTrue(str(ref).startswith("fixture-ref:"), ref)
        scopes = set(payload["idempotency_scopes"])  # type: ignore[arg-type]
        self.assertTrue(
            {
                IdempotencyScope.WORKFLOW_CREATION.value,
                IdempotencyScope.BUDGET_RESERVATION.value,
                IdempotencyScope.MODEL_CALL.value,
                IdempotencyScope.ARTIFACT_WRITE.value,
                IdempotencyScope.COST_EVENT.value,
                IdempotencyScope.AUDIT_EVENT.value,
            }.issubset(scopes)
        )

    def test_cli_fixture_json_smoke_emits_completed_workflow(self) -> None:
        runtime_root = Path(__file__).resolve().parents[1]
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(
            [str(runtime_root / "src"), env["PYTHONPATH"]]
            if env.get("PYTHONPATH")
            else [str(runtime_root / "src")]
        )
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "devgateway_agent_runtime",
                "--mode",
                "fixture",
                "--format",
                "json",
            ],
            cwd=runtime_root,
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["workflow"]["state"], "completed")
        self.assertTrue(payload["fixture_mode"])
        self.assertEqual(completed.stderr, "")

    def test_cli_execution_fixture_json_smoke_emits_completed_synthesis(self) -> None:
        runtime_root = Path(__file__).resolve().parents[1]
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(
            [str(runtime_root / "src"), env["PYTHONPATH"]]
            if env.get("PYTHONPATH")
            else [str(runtime_root / "src")]
        )
        guarded_cli = """
import builtins
blocked_roots = {
    "asyncpg",
    "boto3",
    "httpx",
    "openai",
    "psycopg",
    "psycopg2",
    "requests",
    "sqlalchemy",
}
original_import = builtins.__import__
def guarded_import(name, *args, **kwargs):
    if name.partition(".")[0] in blocked_roots:
        raise AssertionError(f"fixture runtime imported live dependency {name}")
    return original_import(name, *args, **kwargs)
builtins.__import__ = guarded_import
from devgateway_agent_runtime.cli import main
raise SystemExit(main(["--mode", "fixture", "--fixture", "execution", "--format", "json"]))
"""
        completed = subprocess.run(
            [
                sys.executable,
                "-c",
                guarded_cli,
            ],
            cwd=runtime_root,
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["workflow"]["state"], "completed")
        self.assertEqual(payload["synthesis"]["status"], "completed")
        self.assertTrue(payload["no_live_external_calls"])
        self.assertEqual(completed.stderr, "")


class Track3ContractPrimitivesTest(unittest.TestCase):
    """Targeted tests for Track 3 durable-workflow contract primitives."""

    # ------------------------------------------------------------------
    # WorkflowState: new transitions
    # ------------------------------------------------------------------

    def _make_workflow(self, workflow_id: str, state: WorkflowState = WorkflowState.CREATED) -> Workflow:
        return Workflow(
            workflow_id=workflow_id,
            state=state,
            idempotency_key=stable_idempotency_key(
                IdempotencyScope.WORKFLOW_CREATION,
                f"fixture-ref:workflow:{workflow_id}",
            ),
            trace_context=TraceContext.new(correlation_id=workflow_id),
            workflow_ref=f"fixture-ref:workflow:{workflow_id}",
        )

    def test_pending_approval_reachable_from_active_states_and_resumable(self) -> None:
        for origin in (
            WorkflowState.QUEUED,
            WorkflowState.PLANNING,
            WorkflowState.DELEGATING,
            WorkflowState.RUNNING,
            WorkflowState.SYNTHESIZING,
        ):
            with self.subTest(origin=origin):
                wf = self._make_workflow(f"wf_approval_{origin.value}", state=WorkflowState.CREATED)
                # Advance to origin state via the required path
                path_to_origin = {
                    WorkflowState.QUEUED: [WorkflowState.QUEUED],
                    WorkflowState.PLANNING: [WorkflowState.QUEUED, WorkflowState.PLANNING],
                    WorkflowState.DELEGATING: [WorkflowState.QUEUED, WorkflowState.PLANNING, WorkflowState.DELEGATING],
                    WorkflowState.RUNNING: [WorkflowState.QUEUED, WorkflowState.PLANNING, WorkflowState.DELEGATING, WorkflowState.RUNNING],
                    WorkflowState.SYNTHESIZING: [WorkflowState.QUEUED, WorkflowState.PLANNING, WorkflowState.DELEGATING, WorkflowState.RUNNING, WorkflowState.SYNTHESIZING],
                }
                for step in path_to_origin[origin]:
                    wf = wf.transition_to(step)
                self.assertEqual(wf.state, origin)

                # Transition to pending_approval
                wf_paused = wf.transition_to(WorkflowState.PENDING_APPROVAL)
                self.assertEqual(wf_paused.state, WorkflowState.PENDING_APPROVAL)
                self.assertIn(WorkflowState.PENDING_APPROVAL, PAUSED_WORKFLOW_STATES)
                self.assertNotIn(WorkflowState.PENDING_APPROVAL, TERMINAL_WORKFLOW_STATES)

                # Approved → resume running
                wf_resumed = wf_paused.transition_to(WorkflowState.RUNNING)
                self.assertEqual(wf_resumed.state, WorkflowState.RUNNING)

                # Rejected → cancelled
                wf_rejected = wf_paused.transition_to(WorkflowState.CANCELLED)
                self.assertEqual(wf_rejected.state, WorkflowState.CANCELLED)

                # Expired → failed
                wf_expired = wf_paused.transition_to(WorkflowState.FAILED)
                self.assertEqual(wf_expired.state, WorkflowState.FAILED)

    def test_cancel_requested_reachable_from_all_non_terminal_states_and_terminates(self) -> None:
        for origin in (
            WorkflowState.CREATED,
            WorkflowState.QUEUED,
            WorkflowState.RUNNING,
            WorkflowState.PENDING_APPROVAL,
        ):
            with self.subTest(origin=origin):
                wf = self._make_workflow(f"wf_cancel_{origin.value}", state=origin)
                wf_cancelling = wf.transition_to(WorkflowState.CANCEL_REQUESTED)
                self.assertEqual(wf_cancelling.state, WorkflowState.CANCEL_REQUESTED)
                self.assertNotIn(WorkflowState.CANCEL_REQUESTED, TERMINAL_WORKFLOW_STATES)
                self.assertNotIn(WorkflowState.CANCEL_REQUESTED, PAUSED_WORKFLOW_STATES)

                # Cleanup completed → cancelled
                wf_done = wf_cancelling.transition_to(WorkflowState.CANCELLED)
                self.assertEqual(wf_done.state, WorkflowState.CANCELLED)
                self.assertIn(WorkflowState.CANCELLED, TERMINAL_WORKFLOW_STATES)

                # Cleanup failed → failed
                wf_fail = wf_cancelling.transition_to(WorkflowState.FAILED)
                self.assertEqual(wf_fail.state, WorkflowState.FAILED)

                # Ambiguous non-idempotent cleanup → manual review.
                wf_review = wf_cancelling.transition_to(WorkflowState.MANUAL_REVIEW)
                self.assertEqual(wf_review.state, WorkflowState.MANUAL_REVIEW)

    def test_manual_review_reachable_from_active_states_and_resumable(self) -> None:
        for origin in (WorkflowState.PLANNING, WorkflowState.DELEGATING, WorkflowState.RUNNING):
            with self.subTest(origin=origin):
                wf = self._make_workflow(f"wf_review_{origin.value}", state=origin)
                wf_review = wf.transition_to(WorkflowState.MANUAL_REVIEW)
                self.assertEqual(wf_review.state, WorkflowState.MANUAL_REVIEW)
                self.assertIn(WorkflowState.MANUAL_REVIEW, PAUSED_WORKFLOW_STATES)

                # Reviewer approves → resume
                self.assertEqual(wf_review.transition_to(WorkflowState.RUNNING).state, WorkflowState.RUNNING)
                # Reviewer rejects → failed
                self.assertEqual(wf_review.transition_to(WorkflowState.FAILED).state, WorkflowState.FAILED)
                # Cancelled during review → cancelled
                self.assertEqual(wf_review.transition_to(WorkflowState.CANCELLED).state, WorkflowState.CANCELLED)

    def test_existing_happy_path_still_valid_after_new_state_additions(self) -> None:
        wf = self._make_workflow("wf_happy_compat")
        for target in [
            WorkflowState.QUEUED,
            WorkflowState.PLANNING,
            WorkflowState.DELEGATING,
            WorkflowState.RUNNING,
            WorkflowState.SYNTHESIZING,
            WorkflowState.COMPLETED,
        ]:
            wf = wf.transition_to(target)
        self.assertEqual(wf.state, WorkflowState.COMPLETED)
        # Terminal states still reject further transitions
        with self.assertRaises(WorkflowTransitionError):
            wf.transition_to(WorkflowState.RUNNING)
        with self.assertRaises(WorkflowTransitionError):
            wf.transition_to(WorkflowState.PENDING_APPROVAL)

    def test_new_workflow_states_not_in_terminal_set(self) -> None:
        for state in (WorkflowState.PENDING_APPROVAL, WorkflowState.CANCEL_REQUESTED, WorkflowState.MANUAL_REVIEW):
            self.assertNotIn(state, TERMINAL_WORKFLOW_STATES)

    def test_db_terminal_workflow_states_are_supported_and_terminal(self) -> None:
        for state in (WorkflowState.SUCCEEDED, WorkflowState.TIMED_OUT, WorkflowState.DENIED):
            with self.subTest(state=state):
                workflow = self._make_workflow(f"wf_terminal_{state.value}", state=state)
                self.assertIn(workflow.state, TERMINAL_WORKFLOW_STATES)
                with self.assertRaises(WorkflowTransitionError):
                    workflow.transition_to(WorkflowState.RUNNING)

    def test_version_increments_through_new_states(self) -> None:
        wf = self._make_workflow("wf_version")
        wf = wf.transition_to(WorkflowState.QUEUED)
        wf = wf.transition_to(WorkflowState.PENDING_APPROVAL)
        self.assertEqual(wf.version, 2)
        wf = wf.transition_to(WorkflowState.RUNNING)
        self.assertEqual(wf.version, 3)

    # ------------------------------------------------------------------
    # StepState / StepKind Track 3 additions
    # ------------------------------------------------------------------

    def test_step_awaiting_approval_transition_from_running(self) -> None:
        step = WorkflowStep(
            step_id="step_approval",
            workflow_id="wf_step_approval",
            kind=StepKind.APPROVAL,
            state=StepState.RUNNING,
            input_ref="fixture-ref:step-input:step_approval",
            idempotency_key=stable_idempotency_key(IdempotencyScope.STEP_EXECUTION, "fixture-ref:step-input:step_approval"),
        )
        paused = step.transition_to(StepState.AWAITING_APPROVAL)
        self.assertEqual(paused.state, StepState.AWAITING_APPROVAL)

        # Approved → resume running
        resumed = paused.transition_to(StepState.RUNNING)
        self.assertEqual(resumed.state, StepState.RUNNING)

        # Rejected → failed
        failed = paused.transition_to(StepState.FAILED)
        self.assertEqual(failed.state, StepState.FAILED)

        # Cancelled → cancelled
        cancelled = paused.transition_to(StepState.CANCELLED)
        self.assertEqual(cancelled.state, StepState.CANCELLED)

    def test_step_cancelled_reachable_from_pending_claimed_running(self) -> None:
        for origin in (StepState.PENDING, StepState.CLAIMED, StepState.RUNNING):
            with self.subTest(origin=origin):
                step = WorkflowStep(
                    step_id=f"step_cancel_{origin.value}",
                    workflow_id="wf_step_cancel",
                    kind=StepKind.RUNNING,
                    state=origin,
                    input_ref=f"fixture-ref:step-input:step_cancel_{origin.value}",
                    idempotency_key=stable_idempotency_key(
                        IdempotencyScope.STEP_EXECUTION,
                        f"fixture-ref:step-input:step_cancel_{origin.value}",
                    ),
                )
                cancelled = step.transition_to(StepState.CANCELLED)
                self.assertEqual(cancelled.state, StepState.CANCELLED)
                # CANCELLED is terminal for steps
                with self.assertRaises(WorkflowTransitionError):
                    cancelled.transition_to(StepState.PENDING)

    # ------------------------------------------------------------------
    # Lease fencing token
    # ------------------------------------------------------------------

    def test_lease_fencing_token_defaults_to_zero(self) -> None:
        policy = LeasePolicy(ttl_seconds=30)
        repository = InMemoryRuntimeRepository()
        lease = repository.acquire_lease("resource:fence_test", owner_id="owner-a", policy=policy)
        self.assertIsNotNone(lease)
        # Default fencing token is 0 (in-memory repo does not yet track counter)
        self.assertEqual(lease.fencing_token, 0)  # type: ignore[union-attr]
        self.assertIn("fencing_token", lease.to_dict())  # type: ignore[union-attr]
        self.assertEqual(lease.to_dict()["fencing_token"], 0)  # type: ignore[union-attr]

    def test_lease_heartbeat_preserves_fencing_token(self) -> None:
        from devgateway_agent_runtime.leases import Lease
        from dataclasses import replace as dc_replace

        policy = LeasePolicy(ttl_seconds=30)
        lease = Lease(
            resource_id="resource:fence",
            owner_id="owner-a",
            expires_at=policy.expires_at(),
            fencing_token=7,
        )
        hb = lease.heartbeat(policy)
        self.assertEqual(hb.fencing_token, 7)  # token preserved on heartbeat

    def test_step_claim_exposes_lease_with_fencing_token(self) -> None:
        repository = InMemoryRuntimeRepository()
        trace = TraceContext.new(correlation_id="wf_fc")
        wf = repository.create_workflow(
            Workflow(
                workflow_id="wf_fc",
                state=WorkflowState.CREATED,
                idempotency_key="fixture-key-fc",
                trace_context=trace,
            )
        )
        repository.transition_workflow(wf.workflow_id, WorkflowState.QUEUED, trace_context=trace.child())
        repository.add_step(
            WorkflowStep(
                step_id="step_fc",
                workflow_id=wf.workflow_id,
                kind=StepKind.PLANNING,
                state=StepState.PENDING,
                input_ref="fixture-ref:step-input:step_fc",
                idempotency_key=stable_idempotency_key(IdempotencyScope.STEP_EXECUTION, "fixture-ref:step-input:step_fc"),
            ),
            trace_context=trace.child(),
        )
        claim = repository.claim_next_step(owner_id="owner-a", lease_policy=LeasePolicy())
        self.assertIsNotNone(claim)
        self.assertIn("fencing_token", claim.to_dict()["lease"])  # type: ignore[union-attr]

    # ------------------------------------------------------------------
    # Track 3 IdempotencyScope: stable keys and reserve/complete lifecycle
    # ------------------------------------------------------------------

    def test_track3_idempotency_scopes_produce_stable_keys(self) -> None:
        track3_scopes = [
            IdempotencyScope.APPROVAL,
            IdempotencyScope.OUTBOX,
            IdempotencyScope.CANCELLATION,
            IdempotencyScope.RETRY,
            IdempotencyScope.MANUAL_REVIEW,
            IdempotencyScope.RESERVATION_RELEASE,
            IdempotencyScope.ARTIFACT_LIFECYCLE,
            IdempotencyScope.TEMPLATE_INSTANTIATION,
        ]
        for scope in track3_scopes:
            with self.subTest(scope=scope):
                ref = f"fixture-ref:{scope.value}:idempotency-test"
                key1 = stable_idempotency_key(scope, ref)
                key2 = stable_idempotency_key(scope, ref)
                self.assertEqual(key1, key2)
                self.assertTrue(key1.startswith(f"{scope.value}:"))
                # Different scopes for same ref must not collide
                other_scope = IdempotencyScope.WORKFLOW_CREATION
                other_key = stable_idempotency_key(other_scope, ref)
                self.assertNotEqual(key1, other_key)

    def test_track3_idempotency_scopes_can_be_reserved_and_completed(self) -> None:
        repository = InMemoryRuntimeRepository()
        track3_scopes = [
            IdempotencyScope.APPROVAL,
            IdempotencyScope.OUTBOX,
            IdempotencyScope.CANCELLATION,
            IdempotencyScope.RETRY,
            IdempotencyScope.MANUAL_REVIEW,
            IdempotencyScope.RESERVATION_RELEASE,
            IdempotencyScope.ARTIFACT_LIFECYCLE,
            IdempotencyScope.TEMPLATE_INSTANTIATION,
        ]
        for scope in track3_scopes:
            with self.subTest(scope=scope):
                ref = f"fixture-ref:{scope.value}:lifecycle-test"
                key = stable_idempotency_key(scope, ref)
                record = IdempotencyRecord(scope=scope, key=key, workflow_id="wf_track3", request_ref=ref)

                reserved, created = repository.reserve_idempotency(record)
                self.assertTrue(created)
                self.assertEqual(reserved.status, IdempotencyStatus.RESERVED)

                # Second reserve must be idempotent (no duplicate)
                replayed, created2 = repository.reserve_idempotency(record)
                self.assertFalse(created2)
                self.assertEqual(replayed.key, key)

                result_ref = f"fixture-ref:{scope.value}:result"
                completed = repository.complete_idempotency(scope, key, result_ref=result_ref)
                self.assertEqual(completed.status, IdempotencyStatus.COMPLETED)
                self.assertEqual(completed.result_ref, result_ref)

    # ------------------------------------------------------------------
    # Track 3 dataclass smoke: to_dict() produces opaque refs only
    # ------------------------------------------------------------------

    def test_track3_dataclasses_serialise_with_opaque_refs(self) -> None:
        import json
        now = utc_now()

        # RetryPolicy / RetryDecision
        policy = RetryPolicy(
            max_attempts=5,
            backoff_type=RetryBackoffType.EXPONENTIAL,
            eligible_failure_classes=(FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,),
        )
        self.assertEqual(policy.to_dict()["backoff_policy"]["backoff_type"], "exponential")
        self.assertEqual(
            policy.to_dict()["failure_class_policies"][0]["failure_class"],
            "transient_timeout_before_accept",
        )

        decision = RetryDecision(
            workflow_id="wf_retry",
            step_id="step_retry",
            attempt=2,
            failure_class=FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
            eligible=True,
            delay_seconds=4.0,
            reason_ref="fixture-ref:reason:transient",
        )
        d = decision.to_dict()
        self.assertEqual(d["failure_class"], "transient_timeout_before_accept")
        self.assertTrue(str(d["reason_ref"]).startswith("fixture-ref:"))
        self.assertIn("eligible", d)
        self.assertIn("delay_seconds", d)

        # CancellationRecord
        cancel = CancellationRecord(
            cancellation_id="cancel-001",
            target=CancellationTarget.WORKFLOW,
            workflow_id="wf_cancel_dc",
            requested_at=now,
            reason_ref="fixture-ref:reason:user-requested",
        )
        cd = cancel.to_dict()
        self.assertEqual(cd["target"], "workflow")
        self.assertTrue(str(cd["reason_ref"]).startswith("fixture-ref:"))
        self.assertIsNone(cd["completed_at"])

        # ApprovalRequest / ApprovalDecision
        req = ApprovalRequest(
            approval_id="appr-001",
            workflow_id="wf_appr",
            approval_ref="fixture-ref:approval:appr-001",
            requester_ref="fixture-ref:principal:supervisor",
            policy_ref="fixture-ref:policy:approval:v1",
            requested_at=now,
        )
        self.assertTrue(str(req.to_dict()["approval_ref"]).startswith("fixture-ref:"))

        dec = ApprovalDecision(
            approval_id="appr-001",
            workflow_id="wf_appr",
            decision=ApprovalStatus.APPROVED,
            decided_by_ref="fixture-ref:principal:reviewer",
            decided_at=now,
        )
        self.assertEqual(dec.to_dict()["decision"], "approved")
        self.assertEqual(dec.to_dict()["evidence_refs"], [])

        # WorkflowOutboxEvent
        outbox_event = WorkflowOutboxEvent(
            outbox_id="outbox-001",
            workflow_id="wf_outbox",
            source_event_ref="fixture-ref:workflow-event:approved-001",
            destination_kind="webhook_ref",
            payload_artifact_ref="fixture-ref:payload:outbox-001",
            idempotency_key=stable_idempotency_key(IdempotencyScope.OUTBOX, "fixture-ref:outbox-001"),
            delivery_state=OutboxEventStatus.PENDING,
        )
        od = outbox_event.to_dict()
        self.assertEqual(od["delivery_state"], "pending")
        self.assertIsNone(od["delivered_at"])
        self.assertTrue(str(od["payload_artifact_ref"]).startswith("fixture-ref:"))

        # ManualReviewItem
        review = ManualReviewItem(
            review_id="review-001",
            workflow_id="wf_review",
            review_ref="fixture-ref:review:review-001",
            status=ManualReviewStatus.IN_PROGRESS,
            reviewer_ref="fixture-ref:principal:reviewer",
            artifact_refs=("fixture-ref:artifact:evidence-001",),
        )
        rv = review.to_dict()
        self.assertEqual(rv["status"], "in_progress")
        self.assertEqual(len(rv["artifact_refs"]), 1)
        self.assertTrue(str(rv["artifact_refs"][0]).startswith("fixture-ref:"))

        # ArtifactLifecycleEvent
        lifecycle = ArtifactLifecycleEvent(
            lifecycle_id="lifecycle-001",
            artifact_ref="fixture-ref:artifact:artifact-001",
            workflow_id="wf_lifecycle",
            stage=ArtifactLifecycleStage.VERIFIED,
            triggered_by_ref="fixture-ref:principal:supervisor",
        )
        lv = lifecycle.to_dict()
        self.assertEqual(lv["stage"], "verified")
        self.assertTrue(str(lv["artifact_ref"]).startswith("fixture-ref:"))
        self.assertTrue(str(lv["triggered_by_ref"]).startswith("fixture-ref:"))

        # Ensure no raw values leak into JSON representation
        serialised = json.dumps(lv)
        self.assertNotIn("lifecycle-001", serialised.replace(lv["lifecycle_id"], ""))  # opaque ref check


# ---------------------------------------------------------------------------
# Phase 3.3: Postgres repository tests (fake cursor, no real DB required)
# ---------------------------------------------------------------------------


class _FakeCursor:
    """Minimal PEP-249-ish cursor that records executed SQL and serves preset rows."""

    def __init__(self) -> None:
        self.executed: list[tuple[str, object]] = []
        # Each entry is a list of rows for one execute+fetch cycle.
        self._result_queue: list[list[object]] = []

    def queue_rows(self, rows: list[object]) -> None:
        """Pre-configure rows returned by the next fetchone/fetchall call."""
        self._result_queue.append(list(rows))

    def execute(self, sql: str, params: object = None) -> None:
        self.executed.append((sql, params))

    def fetchone(self) -> object:
        if not self._result_queue:
            return None
        bucket = self._result_queue[0]
        if not bucket:
            self._result_queue.pop(0)
            return None
        row = bucket.pop(0)
        if not bucket:
            self._result_queue.pop(0)
        return row

    def fetchall(self) -> list[object]:
        if not self._result_queue:
            return []
        return self._result_queue.pop(0)

    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, *_: object) -> None:
        pass


class _FakeConnection:
    """Minimal connection that returns a single shared _FakeCursor."""

    def __init__(self) -> None:
        self.cur = _FakeCursor()

    def cursor(self) -> "_FakeCursor":
        return self.cur


class PostgresRepositoryTest(unittest.TestCase):
    """Targeted tests for postgres_repository – no real Postgres required."""

    # ------------------------------------------------------------------
    # 1. Module import safety
    # ------------------------------------------------------------------

    def test_postgres_module_import_does_not_require_psycopg(self) -> None:
        """Importing postgres_repository must not trigger psycopg / asyncpg imports."""
        blocked = {"psycopg", "psycopg2", "asyncpg", "sqlalchemy"}
        original_import = builtins.__import__

        def guarded(name: str, *args: object, **kwargs: object) -> object:
            if name.partition(".")[0] in blocked:
                raise AssertionError(
                    f"postgres_repository triggered live DB import: {name}"
                )
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", guarded):
            import importlib
            import devgateway_agent_runtime.postgres_repository as pg_mod

            importlib.reload(pg_mod)

    # ------------------------------------------------------------------
    # 2. Pure row-mapping helpers
    # ------------------------------------------------------------------

    def test_row_to_workflow_maps_columns_and_metadata(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_workflow

        now = utc_now()
        row = {
            "workflow_run_id": "wf_pg_map",
            "state": WorkflowState.RUNNING.value,
            "idempotency_key": "idem-key-abc",
            "task_ref": "fixture-ref:workflow:pg-map",
            "trace_id": "trace_pg_map",
            "request_id": "req_span_01",
            "metadata": json.dumps(
                {
                    "version": 5,
                    "span_id": "span_01",
                    "parent_span_id": "parent_00",
                    "correlation_id": "corr_pg",
                    "baggage_refs": ["bag-a", "bag-b"],
                }
            ),
            "created_at": now,
            "updated_at": now,
        }

        wf = row_to_workflow(row)

        self.assertEqual(wf.workflow_id, "wf_pg_map")
        self.assertEqual(wf.state, WorkflowState.RUNNING)
        self.assertEqual(wf.idempotency_key, "idem-key-abc")
        self.assertEqual(wf.workflow_ref, "fixture-ref:workflow:pg-map")
        self.assertEqual(wf.version, 5)
        self.assertEqual(wf.trace_context.trace_id, "trace_pg_map")
        self.assertEqual(wf.trace_context.span_id, "span_01")
        self.assertEqual(wf.trace_context.parent_span_id, "parent_00")
        self.assertEqual(wf.trace_context.correlation_id, "corr_pg")
        self.assertEqual(wf.trace_context.baggage_refs, ("bag-a", "bag-b"))

    def test_row_to_step_maps_columns_and_metadata(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_step

        now = utc_now()
        row = {
            "workflow_step_id": "step_pg_map",
            "workflow_run_id": "wf_pg_map",
            "step_type": "plan",
            "state": "planning",
            "task_ref": "fixture-ref:input:pg-map",
            "idempotency_key": "step-idem-abc",
            "ordinal": 2,
            "metadata": json.dumps(
                {
                    "input_ref": "fixture-ref:input:pg-map",
                    "output_ref": "fixture-ref:output:pg-map",
                }
            ),
            "created_at": now,
            "updated_at": now,
        }

        step = row_to_step(row)

        self.assertEqual(step.step_id, "step_pg_map")
        self.assertEqual(step.workflow_id, "wf_pg_map")
        self.assertEqual(step.kind, StepKind.PLANNING)
        self.assertEqual(step.state, StepState.CLAIMED)
        self.assertEqual(step.input_ref, "fixture-ref:input:pg-map")
        self.assertEqual(step.output_ref, "fixture-ref:output:pg-map")
        self.assertEqual(step.attempt, 2)
        self.assertEqual(step.idempotency_key, "step-idem-abc")

    def test_step_kind_and_state_db_bridges_match_locked_schema_values(self) -> None:
        from devgateway_agent_runtime.postgres_repository import (
            db_to_step_kind,
            db_to_step_state,
            step_kind_to_db,
            step_state_to_db,
        )

        self.assertEqual(step_kind_to_db(StepKind.PLANNING), "plan")
        self.assertEqual(step_kind_to_db(StepKind.DELEGATING), "delegate")
        self.assertEqual(step_kind_to_db(StepKind.RUNNING), "agent")
        self.assertEqual(step_kind_to_db(StepKind.SYNTHESIZING), "synthesize")
        self.assertEqual(step_kind_to_db(StepKind.APPROVAL_GATE), "approval_gate")
        self.assertEqual(step_kind_to_db(StepKind.REVIEW), "review")
        self.assertEqual(db_to_step_kind("plan"), StepKind.PLANNING)
        self.assertEqual(db_to_step_kind("approval_gate"), StepKind.APPROVAL_GATE)

        self.assertEqual(step_state_to_db(StepState.PENDING), "created")
        self.assertEqual(step_state_to_db(StepState.CLAIMED), "planning")
        self.assertEqual(step_state_to_db(StepState.PENDING_APPROVAL), "pending_approval")
        self.assertEqual(step_state_to_db(StepState.MANUAL_REVIEW), "manual_review")
        self.assertEqual(db_to_step_state("created"), StepState.PENDING)
        self.assertEqual(db_to_step_state("planning"), StepState.CLAIMED)
        self.assertEqual(db_to_step_state("pending_approval"), StepState.PENDING_APPROVAL)
        self.assertEqual(db_to_step_state("manual_review"), StepState.MANUAL_REVIEW)

    def test_row_to_event_maps_state_and_refs(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_event

        now = utc_now()
        row = {
            "workflow_event_id": "evt_pg_test",
            "workflow_run_id": "wf_pg_evt",
            "event_type": "workflow.created",
            "state": WorkflowState.CREATED.value,
            "trace_id": "trace_evt",
            "request_id": "span_evt",
            "metadata": json.dumps(
                {
                    "refs": {"workflow_ref": "fixture-ref:workflow:pg-evt"},
                    "span_id": "span_evt",
                }
            ),
            "event_time": now,
            "workflow_step_id_text": None,
        }

        evt = row_to_event(row)

        self.assertEqual(evt.event_id, "evt_pg_test")
        self.assertEqual(evt.workflow_id, "wf_pg_evt")
        self.assertEqual(evt.event_type, "workflow.created")
        self.assertEqual(evt.state, WorkflowState.CREATED)
        self.assertEqual(evt.refs.get("workflow_ref"), "fixture-ref:workflow:pg-evt")
        self.assertIsNone(evt.step_id)

    # ------------------------------------------------------------------
    # 3. Idempotency status round-trip
    # ------------------------------------------------------------------

    def test_idempotency_status_round_trip(self) -> None:
        from devgateway_agent_runtime.postgres_repository import (
            db_to_idempotency_status,
            idempotency_status_to_db,
        )
        from devgateway_agent_runtime.idempotency import IdempotencyStatus

        for py_status, db_val in [
            (IdempotencyStatus.RESERVED, "pending"),
            (IdempotencyStatus.COMPLETED, "succeeded"),
            (IdempotencyStatus.FAILED, "failed"),
        ]:
            self.assertEqual(idempotency_status_to_db(py_status), db_val)
            self.assertEqual(db_to_idempotency_status(db_val), py_status)

        # in_progress and expired are DB-only; map to RESERVED and FAILED resp.
        from devgateway_agent_runtime.idempotency import IdempotencyStatus

        self.assertEqual(
            db_to_idempotency_status("in_progress"), IdempotencyStatus.RESERVED
        )
        self.assertEqual(
            db_to_idempotency_status("expired"), IdempotencyStatus.FAILED
        )

    def test_row_to_idempotency_maps_db_status_to_python_status(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_idempotency
        from devgateway_agent_runtime.idempotency import IdempotencyScope, IdempotencyStatus

        now = utc_now()
        for db_status, expected in [
            ("pending", IdempotencyStatus.RESERVED),
            ("succeeded", IdempotencyStatus.COMPLETED),
            ("failed", IdempotencyStatus.FAILED),
        ]:
            row = {
                "operation": "workflow_create",
                "idempotency_key": "test-key-map",
                "status": db_status,
                "result_ref": None,
                "metadata": "{}",
                "created_at": now,
                "updated_at": now,
            }
            record = row_to_idempotency(row)
            self.assertEqual(record.status, expected, f"db_status={db_status!r}")
            self.assertEqual(record.scope, IdempotencyScope.WORKFLOW_CREATION)
            self.assertEqual(record.key, "test-key-map")

    def test_event_type_to_db_maps_approval_resume_events(self) -> None:
        from devgateway_agent_runtime.postgres_repository import event_type_to_db

        self.assertEqual(event_type_to_db("approval.approved.resumed"), "approval_approved")
        self.assertEqual(event_type_to_db("approval.denied.resumed"), "approval_denied")
        self.assertEqual(event_type_to_db("approval.expired.resumed"), "approval_expired")

    def test_step_attempt_replay_decisions_include_runtime_recovery_values(self) -> None:
        from devgateway_agent_runtime.postgres_repository import STEP_ATTEMPT_REPLAY_DECISIONS

        self.assertTrue(
            {
                "pre_side_effect",
                "idempotent_pre_side_effect",
                "ambiguous_post_side_effect",
                "retry_scheduled",
                "terminal_failure",
                "manual_review",
            }.issubset(STEP_ATTEMPT_REPLAY_DECISIONS)
        )

    # ------------------------------------------------------------------
    # 4. SQL generation – FOR UPDATE SKIP LOCKED
    # ------------------------------------------------------------------

    def test_build_claim_step_query_contains_for_update_skip_locked(self) -> None:
        from devgateway_agent_runtime.postgres_repository import build_claim_step_query
        from devgateway_agent_runtime.contracts import TERMINAL_WORKFLOW_STATES

        terminal = [s.value for s in TERMINAL_WORKFLOW_STATES]
        now = utc_now()
        sql, params = build_claim_step_query(
            workflow_id="wf_claim_sql",
            kinds=[StepKind.PLANNING, StepKind.RUNNING],
            project_id=1,
            now=now,
            terminal_states=terminal,
        )

        sql_upper = sql.upper()
        self.assertIn("FOR UPDATE", sql_upper)
        self.assertIn("SKIP LOCKED", sql_upper)
        self.assertIn("(WS.NEXT_ATTEMPT_AT IS NULL OR WS.NEXT_ATTEMPT_AT <= %S)", sql_upper)
        self.assertIn("wf_claim_sql", params)
        self.assertIn("created", params)
        self.assertIn("planning", params)
        self.assertEqual(params.count(now), 2)
        for t in terminal:
            self.assertIn(t, params)

    def test_build_claim_step_query_no_workflow_filter(self) -> None:
        from devgateway_agent_runtime.postgres_repository import build_claim_step_query
        from devgateway_agent_runtime.contracts import TERMINAL_WORKFLOW_STATES

        terminal = [s.value for s in TERMINAL_WORKFLOW_STATES]
        sql, params = build_claim_step_query(
            workflow_id=None,
            kinds=None,
            project_id=1,
            now=utc_now(),
            terminal_states=terminal,
        )

        self.assertIn("FOR UPDATE", sql.upper())
        self.assertIn("SKIP LOCKED", sql.upper())
        # No specific workflow_id or kind values in params
        self.assertNotIn("wf_claim_sql", params)

    # ------------------------------------------------------------------
    # 5. claim_next_step: StepClaim with non-zero fencing token
    # ------------------------------------------------------------------

    def _make_scope(self) -> "RepositoryScope":  # type: ignore[name-defined]
        from devgateway_agent_runtime.postgres_repository import RepositoryScope

        return RepositoryScope(
            project_id=1, principal_id=2, budget_scope_id=3
        )

    def test_claim_next_step_returns_step_claim_with_nonzero_fencing_token(
        self,
    ) -> None:
        """Using a fake cursor, claim_next_step returns StepClaim with fencing_token > 0."""
        from devgateway_agent_runtime.postgres_repository import (
            PostgresRuntimeRepository,
            RepositoryScope,
        )

        now = utc_now()
        step_row = {
            "workflow_step_id": "step_claim_pg",
            "workflow_run_id": "wf_claim_pg",
            "run_pk": 10,
            "step_pk": 20,
            "step_trace_id": "trace_claim",
            "step_type": "plan",
            "task_ref": "fixture-ref:input:claim-pg",
            "idempotency_key": "claim-idem-001",
            "metadata": "{}",
            "ordinal": 1,
            "created_at": now,
            "updated_at": now,
        }
        # fencing_token row returned by the lease INSERT (SELECT … RETURNING)
        lease_row = {
            "workflow_lease_id": "lease_claim_pg",
            "lease_key": "step:step_claim_pg",
            "lease_owner": "worker-1",
            "fencing_token": 3,
            "acquired_at": now,
            "heartbeat_at": now,
            "expires_at": now + timedelta(seconds=30),
        }

        conn = _FakeConnection()
        cur = conn.cur

        # Queue:
        # 1) claim CTE returns step_row
        # 2) lease INSERT returns lease_row
        # 3) workflow_run FOR UPDATE row for event sequence allocation
        # 4) next workflow_event sequence value
        cur.queue_rows([step_row])
        cur.queue_rows([lease_row])
        cur.queue_rows([{"id": 10}])
        cur.queue_rows([{"next_sequence": 1}])

        scope = RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)
        repo = PostgresRuntimeRepository(conn, scope)

        claim = repo.claim_next_step(
            owner_id="worker-1",
            lease_policy=LeasePolicy(ttl_seconds=30),
            workflow_id="wf_claim_pg",
            now=now,
        )

        self.assertIsNotNone(claim)
        assert claim is not None
        self.assertEqual(claim.step_id, "step_claim_pg")
        self.assertEqual(claim.workflow_id, "wf_claim_pg")
        self.assertEqual(claim.lease.fencing_token, 3)
        self.assertGreater(claim.lease.fencing_token, 0)
        self.assertEqual(claim.lease.owner_id, "worker-1")

        # Verify the claim SQL contained FOR UPDATE SKIP LOCKED
        claim_sql = cur.executed[0][0].upper()
        self.assertIn("FOR UPDATE", claim_sql)
        self.assertIn("SKIP LOCKED", claim_sql)

    def test_claim_next_step_returns_none_when_no_step_available(self) -> None:
        from devgateway_agent_runtime.postgres_repository import (
            PostgresRuntimeRepository,
            RepositoryScope,
        )

        conn = _FakeConnection()
        conn.cur.queue_rows([])  # CTE returns nothing

        repo = PostgresRuntimeRepository(
            conn, RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)
        )
        result = repo.claim_next_step(
            owner_id="worker-1",
            lease_policy=LeasePolicy(),
        )
        self.assertIsNone(result)

    def test_acquire_lease_resolves_step_with_project_scope(self) -> None:
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository

        now = utc_now()
        conn = _FakeConnection()
        cur = conn.cur
        cur.queue_rows([{"run_pk": 10, "step_pk": 20}])
        cur.queue_rows([])
        cur.queue_rows([
            {
                "workflow_lease_id": "lease_project_scoped",
                "lease_key": "step:step_project_scoped",
                "lease_owner": "worker-1",
                "fencing_token": 1,
                "acquired_at": now,
                "heartbeat_at": now,
                "expires_at": now + timedelta(seconds=30),
            }
        ])

        repo = PostgresRuntimeRepository(conn, self._make_scope())
        lease = repo.acquire_lease(
            "step:step_project_scoped",
            owner_id="worker-1",
            policy=LeasePolicy(ttl_seconds=30),
            now=now,
        )

        self.assertIsNotNone(lease)
        resolve_sql, resolve_params = cur.executed[0]
        self.assertIn("ws.project_id = %s", resolve_sql)
        self.assertIn("wr.project_id = %s", resolve_sql)
        self.assertEqual(resolve_params, ("step_project_scoped", 1, 1))

    def test_update_step_state_fenced_update_requires_target_and_lease_project_scope(self) -> None:
        from devgateway_agent_runtime.leases import Lease
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository

        now = utc_now()
        conn = _FakeConnection()
        cur = conn.cur
        cur.queue_rows([
            {
                "id": 20,
                "state": "planning",
                "metadata": "{}",
                "run_pk": 10,
                "workflow_run_id": "wf_project_scoped",
                "wf_state": "running",
            }
        ])
        cur.queue_rows([
            {
                "workflow_step_id": "step_project_scoped",
                "workflow_run_id": "wf_project_scoped",
                "step_type": "agent",
                "state": "running",
                "task_ref": "fixture-ref:task:project-scoped",
                "idempotency_key": "step-project-scoped",
                "ordinal": 1,
                "metadata": "{}",
                "created_at": now,
                "updated_at": now,
            }
        ])
        cur.queue_rows([{"id": 10}])
        cur.queue_rows([{"next_sequence": 1}])

        repo = PostgresRuntimeRepository(conn, self._make_scope())
        repo.update_step_state(
            "step_project_scoped",
            StepState.RUNNING,
            trace_context=TraceContext(trace_id="trace_project_scoped", span_id="span_project_scoped"),
            lease=Lease(
                lease_id="lease_project_scoped",
                resource_id="step:step_project_scoped",
                owner_id="worker-1",
                fencing_token=3,
                expires_at=now + timedelta(seconds=30),
            ),
            now=now,
        )

        update_sql, update_params = cur.executed[1]
        self.assertIn("project_id = %s", update_sql)
        self.assertIn("workflow_run_id = %s", update_sql)
        self.assertIn("wl.project_id = %s", update_sql)
        self.assertIn("JOIN workflow_run wr ON wr.id = %s AND wr.project_id = %s", update_sql)
        self.assertEqual(update_params[3:7], (1, 10, 10, 1))
        self.assertEqual(update_params[-2:], (10, 1))

    # ------------------------------------------------------------------
    # 6. reserve_idempotency duplicate returns (existing, False)
    # ------------------------------------------------------------------

    def test_reserve_idempotency_duplicate_returns_existing_and_false(
        self,
    ) -> None:
        """When ON CONFLICT DO NOTHING fires, reserve_idempotency fetches the
        existing row and returns (existing_record, False)."""
        from devgateway_agent_runtime.postgres_repository import (
            PostgresRuntimeRepository,
            RepositoryScope,
        )
        from devgateway_agent_runtime.idempotency import (
            IdempotencyRecord,
            IdempotencyScope,
            IdempotencyStatus,
        )

        now = utc_now()
        existing_key = "workflow_creation:abc123def456789012345678"
        existing_row = {
            "operation": "workflow_create",
            "idempotency_key": existing_key,
            "status": "succeeded",
            "result_ref": "fixture-ref:workflow:wf_pg_idem",
            "metadata": json.dumps(
                {"request_ref": "fixture-ref:workflow:wf_pg_idem", "workflow_id": "wf_pg_idem"}
            ),
            "created_at": now,
            "updated_at": now,
        }

        conn = _FakeConnection()
        cur = conn.cur
        # INSERT … ON CONFLICT DO NOTHING → RETURNING returns nothing (empty)
        cur.queue_rows([])
        # SELECT of existing row returns existing_row
        cur.queue_rows([existing_row])

        scope = RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)
        repo = PostgresRuntimeRepository(conn, scope)

        record = IdempotencyRecord(
            scope=IdempotencyScope.WORKFLOW_CREATION,
            key=existing_key,
            workflow_id="wf_pg_idem",
            request_ref="fixture-ref:workflow:wf_pg_idem",
        )
        returned_record, created = repo.reserve_idempotency(record)

        self.assertFalse(created)
        self.assertEqual(returned_record.scope, IdempotencyScope.WORKFLOW_CREATION)
        self.assertEqual(returned_record.key, existing_key)
        self.assertEqual(returned_record.status, IdempotencyStatus.COMPLETED)
        self.assertEqual(returned_record.result_ref, "fixture-ref:workflow:wf_pg_idem")

    def test_reserve_idempotency_new_record_returns_true(self) -> None:
        from devgateway_agent_runtime.postgres_repository import (
            PostgresRuntimeRepository,
            RepositoryScope,
        )
        from devgateway_agent_runtime.idempotency import (
            IdempotencyRecord,
            IdempotencyScope,
            IdempotencyStatus,
        )

        now = utc_now()
        new_key = "step_execution:newkey123456789012345678"
        # INSERT … RETURNING returns a row (newly inserted)
        inserted_id_row = {"workflow_idempotency_key_id": "new-id-123"}

        conn = _FakeConnection()
        conn.cur.queue_rows([inserted_id_row])

        scope = RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)
        repo = PostgresRuntimeRepository(conn, scope)

        record = IdempotencyRecord(
            scope=IdempotencyScope.STEP_EXECUTION,
            key=new_key,
            step_id="step_new",
            created_at=now,
        )
        returned_record, created = repo.reserve_idempotency(record)

        self.assertTrue(created)
        self.assertEqual(returned_record.scope, IdempotencyScope.STEP_EXECUTION)
        self.assertEqual(returned_record.key, new_key)
        self.assertEqual(returned_record.status, IdempotencyStatus.RESERVED)

    # ------------------------------------------------------------------
    # 7. RepositoryScope is a frozen dataclass with the right fields
    # ------------------------------------------------------------------

    def test_repository_scope_fields(self) -> None:
        from devgateway_agent_runtime.postgres_repository import RepositoryScope

        scope = RepositoryScope(
            project_id=42, principal_id=7, budget_scope_id=99,
            policy_version="v2", registry_version="r1", data_class="internal"
        )
        self.assertEqual(scope.project_id, 42)
        self.assertEqual(scope.principal_id, 7)
        self.assertEqual(scope.budget_scope_id, 99)
        self.assertEqual(scope.policy_version, "v2")
        # Ensure it is frozen (immutable)
        with self.assertRaises((AttributeError, TypeError)):
            scope.project_id = 999  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Phase 3.4: retry.py – pure classification, backoff, and decision tests
# ---------------------------------------------------------------------------


class RetryHelpersTest(unittest.TestCase):
    """Targeted tests for retry.py pure functions; no real DB or providers required."""

    # ------------------------------------------------------------------
    # Exception classification
    # ------------------------------------------------------------------

    def test_classify_timeout_error_requires_before_acceptance_context(self) -> None:
        from devgateway_agent_runtime.retry import classify_exception

        fc = classify_exception(TimeoutError("deadline exceeded"))
        self.assertEqual(fc, FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT)

        fc = classify_exception(TimeoutError("deadline exceeded"), before_external_acceptance=True)
        self.assertEqual(fc, FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT)

    def test_classify_connection_error_subclasses_to_tool_adapter_transient(self) -> None:
        from devgateway_agent_runtime.retry import classify_exception

        for exc_type in (
            ConnectionError,
            BrokenPipeError,
            ConnectionRefusedError,
            ConnectionResetError,
            ConnectionAbortedError,
        ):
            with self.subTest(exc_type=exc_type.__name__):
                fc = classify_exception(exc_type("io error"))
                self.assertEqual(fc, FailureClass.TOOL_ADAPTER_TRANSIENT)

    def test_classify_os_error_to_tool_adapter_transient(self) -> None:
        from devgateway_agent_runtime.retry import classify_exception

        fc = classify_exception(OSError("disk error"))
        self.assertEqual(fc, FailureClass.TOOL_ADAPTER_TRANSIENT)

    def test_classify_unknown_exception_types_to_non_idempotent(self) -> None:
        from devgateway_agent_runtime.retry import classify_exception

        for exc in (
            ValueError("bad input"),
            RuntimeError("unexpected"),
            Exception("generic"),
            KeyError("missing"),
        ):
            with self.subTest(exc_type=type(exc).__name__):
                fc = classify_exception(exc)
                self.assertEqual(fc, FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT)

    def test_classify_does_not_inspect_exception_message(self) -> None:
        """Type-only classification: message content must not influence the result."""
        from devgateway_agent_runtime.retry import classify_exception

        # RuntimeError with 'timeout' in message must still be NON_IDEMPOTENT
        exc = RuntimeError("connection timeout failure")
        fc = classify_exception(exc)
        self.assertEqual(fc, FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT)

    # ------------------------------------------------------------------
    # Backoff calculation
    # ------------------------------------------------------------------

    def test_fixed_backoff_returns_base_for_all_attempts(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=5,
            backoff_type=RetryBackoffType.FIXED,
            base_delay_seconds=3.0,
            max_delay_seconds=100.0,
        )
        for attempt in range(1, 6):
            with self.subTest(attempt=attempt):
                self.assertAlmostEqual(calculate_backoff(policy, attempt), 3.0)

    def test_linear_backoff_scales_with_attempt(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=5,
            backoff_type=RetryBackoffType.LINEAR,
            base_delay_seconds=2.0,
            max_delay_seconds=1000.0,
        )
        self.assertAlmostEqual(calculate_backoff(policy, 1), 2.0)
        self.assertAlmostEqual(calculate_backoff(policy, 2), 4.0)
        self.assertAlmostEqual(calculate_backoff(policy, 3), 6.0)
        self.assertAlmostEqual(calculate_backoff(policy, 4), 8.0)

    def test_exponential_backoff_doubles_each_attempt(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=6,
            backoff_type=RetryBackoffType.EXPONENTIAL,
            base_delay_seconds=1.0,
            max_delay_seconds=1000.0,
        )
        # attempt=1 → 1.0 * 2^0 = 1.0
        # attempt=2 → 1.0 * 2^1 = 2.0
        # attempt=3 → 1.0 * 2^2 = 4.0
        # attempt=4 → 1.0 * 2^3 = 8.0
        self.assertAlmostEqual(calculate_backoff(policy, 1), 1.0)
        self.assertAlmostEqual(calculate_backoff(policy, 2), 2.0)
        self.assertAlmostEqual(calculate_backoff(policy, 3), 4.0)
        self.assertAlmostEqual(calculate_backoff(policy, 4), 8.0)

    def test_exponential_with_jitter_type_behaves_like_exponential_without_jitter_fn(
        self,
    ) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=4,
            backoff_type=RetryBackoffType.EXPONENTIAL_WITH_JITTER,
            base_delay_seconds=1.0,
            max_delay_seconds=1000.0,
        )
        # Without jitter_fn the result is deterministic (same as EXPONENTIAL)
        r1 = calculate_backoff(policy, 3)
        r2 = calculate_backoff(policy, 3)
        self.assertEqual(r1, r2)
        self.assertAlmostEqual(r1, 4.0)  # 1.0 * 2^2

    def test_backoff_clamped_to_max_delay(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=20,
            backoff_type=RetryBackoffType.EXPONENTIAL,
            base_delay_seconds=1.0,
            max_delay_seconds=10.0,
        )
        # attempt=10: 1.0 * 2^9 = 512, clamped to 10.0
        self.assertAlmostEqual(calculate_backoff(policy, 10), 10.0)

    def test_jitter_fn_injected_and_applied_deterministically(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=5,
            backoff_type=RetryBackoffType.EXPONENTIAL_WITH_JITTER,
            base_delay_seconds=1.0,
            max_delay_seconds=100.0,
        )
        # deterministic jitter: multiply by 1.5
        jitter_fn = lambda d: d * 1.5

        # attempt=2: raw = 1.0 * 2^1 = 2.0; with jitter: 2.0 * 1.5 = 3.0
        result = calculate_backoff(policy, 2, jitter_fn=jitter_fn)
        self.assertAlmostEqual(result, 3.0)

    def test_jitter_fn_clamped_even_after_amplification(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=5,
            backoff_type=RetryBackoffType.EXPONENTIAL_WITH_JITTER,
            base_delay_seconds=1.0,
            max_delay_seconds=5.0,
        )
        # jitter_fn doubles the delay; still clamped
        result = calculate_backoff(policy, 4, jitter_fn=lambda d: d * 100)
        self.assertAlmostEqual(result, 5.0)

    def test_jitter_fn_negative_clamped_to_zero(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=3,
            backoff_type=RetryBackoffType.FIXED,
            base_delay_seconds=2.0,
            max_delay_seconds=100.0,
        )
        # jitter_fn that subtracts more than the delay
        result = calculate_backoff(policy, 1, jitter_fn=lambda _: -99.0)
        self.assertAlmostEqual(result, 0.0)

    def test_nested_retry_backoff_policy_multiplier_is_used(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        policy = RetryPolicy(
            max_attempts=5,
            backoff_policy=RetryBackoffPolicy(
                backoff_type=RetryBackoffType.EXPONENTIAL,
                initial_delay_seconds=2.0,
                max_delay_seconds=100.0,
                jitter_fraction=0.0,
                multiplier=3.0,
            ),
        )

        self.assertAlmostEqual(calculate_backoff(policy, 1), 2.0)
        self.assertAlmostEqual(calculate_backoff(policy, 2), 6.0)
        self.assertAlmostEqual(calculate_backoff(policy, 3), 18.0)

    def test_exponential_backoff_overflow_clamps_to_safe_max_delay(self) -> None:
        from devgateway_agent_runtime.retry import MAX_SAFE_RETRY_DELAY_SECONDS, calculate_backoff

        policy = RetryPolicy(
            max_attempts=3,
            backoff_policy=RetryBackoffPolicy(
                backoff_type=RetryBackoffType.EXPONENTIAL,
                initial_delay_seconds=1.0,
                max_delay_seconds=float("inf"),
                multiplier=1e308,
            ),
        )

        self.assertAlmostEqual(calculate_backoff(policy, 1000), MAX_SAFE_RETRY_DELAY_SECONDS)

    def test_backoff_rejects_nan_and_negative_bounds_to_zero(self) -> None:
        from devgateway_agent_runtime.retry import calculate_backoff

        nan_policy = RetryPolicy(
            max_attempts=3,
            backoff_policy=RetryBackoffPolicy(
                backoff_type=RetryBackoffType.FIXED,
                initial_delay_seconds=float("nan"),
                max_delay_seconds=60.0,
            ),
        )
        negative_bound_policy = RetryPolicy(
            max_attempts=3,
            backoff_policy=RetryBackoffPolicy(
                backoff_type=RetryBackoffType.FIXED,
                initial_delay_seconds=5.0,
                max_delay_seconds=-1.0,
            ),
        )

        self.assertEqual(calculate_backoff(nan_policy, 1), 0.0)
        self.assertEqual(calculate_backoff(negative_bound_policy, 1), 0.0)

    # ------------------------------------------------------------------
    # Retry decision eligibility
    # ------------------------------------------------------------------

    def test_make_retry_decision_eligible_within_max_attempts(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=3,
            backoff_type=RetryBackoffType.FIXED,
            base_delay_seconds=2.0,
            max_delay_seconds=60.0,
            eligible_failure_classes=(FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,),
        )
        # attempt 1 of 3 → eligible
        decision = make_retry_decision(
            "wf_retry",
            "step_retry",
            1,
            FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
            policy,
        )
        self.assertTrue(decision.eligible)
        self.assertAlmostEqual(decision.delay_seconds, 2.0)
        self.assertEqual(decision.workflow_id, "wf_retry")
        self.assertEqual(decision.step_id, "step_retry")
        self.assertEqual(decision.attempt, 1)
        self.assertEqual(decision.failure_class, FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT)

    def test_make_retry_decision_eligible_up_to_but_not_including_max_attempts(
        self,
    ) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=3,
            backoff_type=RetryBackoffType.FIXED,
            base_delay_seconds=1.0,
            eligible_failure_classes=(FailureClass.TOOL_ADAPTER_TRANSIENT,),
        )
        # attempt 2 of 3 → still eligible
        d2 = make_retry_decision("wf", "s", 2, FailureClass.TOOL_ADAPTER_TRANSIENT, policy)
        self.assertTrue(d2.eligible)
        # attempt 3 of 3 → exhausted
        d3 = make_retry_decision("wf", "s", 3, FailureClass.TOOL_ADAPTER_TRANSIENT, policy)
        self.assertFalse(d3.eligible)
        self.assertAlmostEqual(d3.delay_seconds, 0.0)

    def test_make_retry_decision_ineligible_when_attempts_exactly_max(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=3,
            eligible_failure_classes=(FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,),
        )
        decision = make_retry_decision(
            "wf_x", "s_x", 3, FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT, policy
        )
        self.assertFalse(decision.eligible)
        self.assertAlmostEqual(decision.delay_seconds, 0.0)

    def test_make_retry_decision_ineligible_when_class_not_in_policy(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=5,
            eligible_failure_classes=(FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,),
        )
        decision = make_retry_decision(
            "wf_nc", "s_nc", 1, FailureClass.VALIDATION_FAILURE, policy
        )
        self.assertFalse(decision.eligible)

    def test_make_retry_decision_uses_nested_failure_class_policy(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=5,
            failure_class_policies=(
                RetryFailureClassPolicy(
                    failure_class=FailureClass.TOOL_ADAPTER_TRANSIENT,
                    retryable=False,
                    idempotency_required=True,
                    non_idempotent_fallback=NonIdempotentFallbackBehavior.MANUAL_REVIEW,
                ),
                RetryFailureClassPolicy(
                    failure_class=FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
                    retryable=True,
                    idempotency_required=True,
                    non_idempotent_fallback=NonIdempotentFallbackBehavior.MANUAL_REVIEW,
                ),
            ),
        )

        blocked = make_retry_decision("wf", "step", 1, FailureClass.TOOL_ADAPTER_TRANSIENT, policy)
        allowed = make_retry_decision("wf", "step", 1, FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT, policy)

        self.assertFalse(blocked.eligible)
        self.assertTrue(allowed.eligible)

    def test_make_retry_decision_ineligible_for_non_idempotent_unknown_side_effect(
        self,
    ) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        # Even if the class is listed in eligible_failure_classes, it must be
        # blocked by NON_RETRYABLE_FAILURE_CLASSES.
        policy = RetryPolicy(
            max_attempts=10,
            eligible_failure_classes=(
                FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
                FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT,
            ),
        )
        decision = make_retry_decision(
            "wf_niue", "s_niue", 1, FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT, policy
        )
        self.assertFalse(decision.eligible)

    def test_make_retry_decision_ineligible_for_worker_crash_active_lease(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=10,
            eligible_failure_classes=(
                FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
                FailureClass.WORKER_CRASH_ACTIVE_LEASE,
            ),
        )
        decision = make_retry_decision(
            "wf_wc", "s_wc", 1, FailureClass.WORKER_CRASH_ACTIVE_LEASE, policy
        )
        self.assertFalse(decision.eligible)

    def test_make_retry_decision_reason_ref_preserved(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=3,
            eligible_failure_classes=(FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,),
        )
        decision = make_retry_decision(
            "wf_reason",
            "step_reason",
            1,
            FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
            policy,
            reason_ref="fixture-ref:reason:transient-001",
        )
        self.assertEqual(decision.reason_ref, "fixture-ref:reason:transient-001")

    def test_make_retry_decision_jitter_fn_affects_eligible_delay(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=5,
            backoff_type=RetryBackoffType.EXPONENTIAL_WITH_JITTER,
            base_delay_seconds=1.0,
            max_delay_seconds=100.0,
            eligible_failure_classes=(FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,),
        )
        # attempt=2: 1.0 * 2^1 = 2.0; +0.5 → 2.5
        decision = make_retry_decision(
            "wf_jitter",
            "step_jitter",
            2,
            FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
            policy,
            jitter_fn=lambda d: d + 0.5,
        )
        self.assertTrue(decision.eligible)
        self.assertAlmostEqual(decision.delay_seconds, 2.5)

    def test_ineligible_decision_always_has_zero_delay(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(
            max_attempts=3,
            backoff_type=RetryBackoffType.EXPONENTIAL,
            base_delay_seconds=10.0,
            eligible_failure_classes=(FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,),
        )
        # Exhausted → no delay even with jitter_fn
        decision = make_retry_decision(
            "wf_zero", "s_zero", 3, FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT, policy,
            jitter_fn=lambda d: d * 999,
        )
        self.assertFalse(decision.eligible)
        self.assertAlmostEqual(decision.delay_seconds, 0.0)

    # ------------------------------------------------------------------
    # NON_RETRYABLE_FAILURE_CLASSES export
    # ------------------------------------------------------------------

    def test_non_retryable_failure_classes_contains_expected_values(self) -> None:
        from devgateway_agent_runtime.retry import NON_RETRYABLE_FAILURE_CLASSES

        self.assertIn(FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT, NON_RETRYABLE_FAILURE_CLASSES)
        self.assertIn(FailureClass.WORKER_CRASH_ACTIVE_LEASE, NON_RETRYABLE_FAILURE_CLASSES)
        # Budget/policy denials are not in the non-retryable set
        self.assertNotIn(FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT, NON_RETRYABLE_FAILURE_CLASSES)

    # ------------------------------------------------------------------
    # round-trip: to_dict() does not expose raw payload values
    # ------------------------------------------------------------------

    def test_retry_decision_to_dict_exposes_only_opaque_refs(self) -> None:
        from devgateway_agent_runtime.retry import make_retry_decision

        policy = RetryPolicy(max_attempts=3)
        decision = make_retry_decision(
            "wf_dict",
            "step_dict",
            1,
            FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
            policy,
            reason_ref="fixture-ref:reason:dict-test",
        )
        d = decision.to_dict()
        self.assertEqual(d["failure_class"], "transient_timeout_before_accept")
        self.assertTrue(str(d["reason_ref"]).startswith("fixture-ref:"))

    def test_retry_policy_to_dict_matches_nested_contract_shape(self) -> None:
        now = utc_now()
        policy = RetryPolicy(
            max_attempts=4,
            backoff_policy=RetryBackoffPolicy(
                backoff_type=RetryBackoffType.LINEAR,
                initial_delay_seconds=2.0,
                max_delay_seconds=20.0,
                jitter_fraction=0.1,
                multiplier=1.0,
            ),
            timeout_policy=RetryTimeoutPolicy(
                queue_seconds=1.0,
                execution_seconds=30.0,
                idle_seconds=5.0,
                overall_seconds=60.0,
            ),
            failure_class_policies=(
                RetryFailureClassPolicy(
                    failure_class=FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
                    retryable=True,
                ),
            ),
            policy_ref=RetryPolicyRef(
                policy_version="policy-retry-v1",
                policy_decision_ref="runtime-ref:policy-decision:retry-v1",
                evaluated_at=now,
            ),
            owner_ref=RetryOwnerRef(
                owner_type="service",
                owner_id="agent-runtime",
                project_id="project-demo",
                principal_id=None,
            ),
            created_at=now,
            updated_at=now,
        )

        data = policy.to_dict()

        self.assertEqual(data["contract_version"], "0.1.0")
        self.assertEqual(data["backoff_policy"]["backoff_type"], "linear")
        self.assertEqual(data["timeout_policy"]["execution_seconds"], 30.0)
        self.assertEqual(data["failure_class_policies"][0]["failure_class"], "transient_timeout_before_accept")
        self.assertEqual(data["policy_ref"]["policy_version"], "policy-retry-v1")
        self.assertEqual(data["owner_ref"]["project_id"], "project-demo")
        self.assertNotIn("eligible_failure_classes", data)
        self.assertNotIn("base_delay_seconds", data)

    # ------------------------------------------------------------------
    # __init__ re-exports
    # ------------------------------------------------------------------

    def test_retry_helpers_exported_from_package_init(self) -> None:
        import devgateway_agent_runtime as rt

        self.assertTrue(hasattr(rt, "classify_exception"))
        self.assertTrue(hasattr(rt, "calculate_backoff"))
        self.assertTrue(hasattr(rt, "make_retry_decision"))
        self.assertTrue(hasattr(rt, "NON_RETRYABLE_FAILURE_CLASSES"))

    def test_retry_module_import_does_not_require_live_dependencies(self) -> None:
        blocked = {"psycopg", "psycopg2", "asyncpg", "sqlalchemy", "boto3", "httpx", "openai"}
        original_import = builtins.__import__

        def guarded(name: str, *args: object, **kwargs: object) -> object:
            if name.partition(".")[0] in blocked:
                raise AssertionError(f"retry module triggered live import: {name}")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", guarded):
            import importlib
            import devgateway_agent_runtime.retry as retry_mod

            importlib.reload(retry_mod)


# ---------------------------------------------------------------------------
# Phase 3.4: stale lease SQL hardening tests (fake cursor, no real DB)
# ---------------------------------------------------------------------------


class PostgresStaleLeaseRecoveryTest(unittest.TestCase):
    """Targeted SQL-inspection tests for recover_stale_leases hardening.

    Uses _FakeCursor/_FakeConnection from the existing PostgresRepositoryTest
    suite. No real Postgres connection is required.
    """

    def _make_repo(self) -> "PostgresRuntimeRepository":  # type: ignore[name-defined]
        from devgateway_agent_runtime.postgres_repository import (
            PostgresRuntimeRepository,
            RepositoryScope,
        )

        self._conn = _FakeConnection()
        scope = RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)
        return PostgresRuntimeRepository(self._conn, scope)

    def _run_recover(self, *, count: int = 0) -> None:
        """Execute recover_stale_leases with a fake cursor pre-loaded with a count row."""
        # Queue a COUNT(*) row for the second execute inside the method.
        self._conn.cur.queue_rows([{"count": count}])
        self._repo.recover_stale_leases(now=utc_now())

    def setUp(self) -> None:
        self._repo = self._make_repo()

    def test_recover_stale_leases_returns_zero_when_count_row_is_zero(self) -> None:
        self._conn.cur.queue_rows([{"count": 0}])
        result = self._repo.recover_stale_leases(now=utc_now())
        self.assertEqual(result, 0)

    def test_recover_stale_leases_executes_exactly_two_sql_statements(self) -> None:
        self._run_recover()
        self.assertEqual(len(self._conn.cur.executed), 2)

    def test_recover_stale_leases_first_sql_targets_active_expired_leases(self) -> None:
        self._run_recover()
        sql_upper = self._conn.cur.executed[0][0].upper()
        # Must expire workflow_lease rows WHERE status='active' AND expires_at < now
        self.assertIn("WORKFLOW_LEASE", sql_upper)
        self.assertIn("ACTIVE", sql_upper)
        self.assertIn("EXPIRES_AT", sql_upper)

    def test_recover_stale_leases_first_sql_is_cte_updating_workflow_step(self) -> None:
        self._run_recover()
        sql_upper = self._conn.cur.executed[0][0].upper()
        # Should use CTE (WITH ... UPDATE)
        self.assertIn("WITH", sql_upper)
        self.assertIn("WORKFLOW_STEP", sql_upper)
        self.assertIn("STATE", sql_upper)

    def test_recover_stale_leases_params_include_claimed_to_pending_mapping(
        self,
    ) -> None:
        """CLAIMED (='planning') must map to PENDING (='created') in params."""
        from devgateway_agent_runtime.postgres_repository import step_state_to_db

        self._run_recover()
        params = list(self._conn.cur.executed[0][1])

        claimed_db = step_state_to_db(StepState.CLAIMED)    # "planning"
        pending_db = step_state_to_db(StepState.PENDING)    # "created"

        self.assertIn(claimed_db, params, f"CLAIMED db value '{claimed_db}' must appear in params")
        self.assertIn(pending_db, params, f"PENDING db value '{pending_db}' must appear in params")

        # Verify relative ordering: claimed appears before pending in the CASE expression
        idx_claimed = params.index(claimed_db)
        idx_pending = params.index(pending_db)
        self.assertLess(idx_claimed, idx_pending, "CLAIMED must precede PENDING in the CASE params")

    def test_recover_stale_leases_params_include_running_to_manual_review_mapping(
        self,
    ) -> None:
        """RUNNING (='running') must map to MANUAL_REVIEW (='manual_review') in params."""
        from devgateway_agent_runtime.postgres_repository import step_state_to_db

        self._run_recover()
        params = list(self._conn.cur.executed[0][1])

        running_db = step_state_to_db(StepState.RUNNING)           # "running"
        manual_review_db = step_state_to_db(StepState.MANUAL_REVIEW)  # "manual_review"

        self.assertIn(running_db, params)
        self.assertIn(manual_review_db, params)

    def test_recover_stale_leases_params_do_not_send_running_to_pending(
        self,
    ) -> None:
        """Running stale steps must NOT be re-queued: RUNNING→PENDING must not appear."""
        from devgateway_agent_runtime.postgres_repository import step_state_to_db

        self._run_recover()
        params = list(self._conn.cur.executed[0][1])

        running_db = step_state_to_db(StepState.RUNNING)   # "running"
        pending_db = step_state_to_db(StepState.PENDING)   # "created"

        # It's OK that both values appear individually, but the pair
        # (running_db → pending_db) must not be adjacent in the CASE logic.
        # We verify this by checking that MANUAL_REVIEW is in params
        # (since that is the actual target for RUNNING steps).
        manual_review_db = step_state_to_db(StepState.MANUAL_REVIEW)
        self.assertIn(manual_review_db, params)

        # The CLAIMED→PENDING mapping is the only PENDING occurrence; RUNNING
        # must never immediately precede PENDING in the params tuple.
        for i, val in enumerate(params[:-1]):
            if val == running_db:
                self.assertNotEqual(
                    params[i + 1],
                    pending_db,
                    "RUNNING must not be followed by PENDING in CASE params (no auto-requeue)",
                )

    def test_recover_stale_leases_params_include_worker_crash_failure_class(
        self,
    ) -> None:
        """failure_class must be set to worker_crash_active_lease for RUNNING steps."""
        self._run_recover()
        params = list(self._conn.cur.executed[0][1])
        self.assertIn(FailureClass.WORKER_CRASH_ACTIVE_LEASE.value, params)

    def test_recover_stale_leases_sql_includes_metadata_evidence_merge(self) -> None:
        """SQL must merge manual_review_reason into metadata for RUNNING stale steps."""
        self._run_recover()
        sql_upper = self._conn.cur.executed[0][0].upper()
        self.assertIn("METADATA", sql_upper)
        # The JSONB merge must include the manual_review_reason evidence key
        sql_raw = self._conn.cur.executed[0][0]
        self.assertIn("manual_review_reason", sql_raw)

    def test_recover_stale_leases_second_sql_is_count_query(self) -> None:
        self._run_recover()
        count_sql = self._conn.cur.executed[1][0].upper()
        self.assertIn("COUNT", count_sql)
        self.assertIn("WORKFLOW_LEASE", count_sql)


# ---------------------------------------------------------------------------
# Phase 3.5: Cancellation runtime tests
# ---------------------------------------------------------------------------


class CancellationRuntimeTest(unittest.TestCase):
    """Tests for pure cancellation helpers, dispatcher integration, and Postgres SQL paths."""

    # ------------------------------------------------------------------
    # 1. Pure decide_cancellation_action
    # ------------------------------------------------------------------

    def test_pending_and_claimed_yield_skip(self) -> None:
        from devgateway_agent_runtime.cancellation import decide_cancellation_action
        from devgateway_agent_runtime.contracts import CancellationAction

        for state in (StepState.PENDING, StepState.CLAIMED):
            with self.subTest(state=state):
                self.assertEqual(
                    decide_cancellation_action(state),
                    CancellationAction.SKIP,
                )

    def test_running_without_safe_flag_yields_manual_review(self) -> None:
        from devgateway_agent_runtime.cancellation import decide_cancellation_action
        from devgateway_agent_runtime.contracts import CancellationAction

        self.assertEqual(
            decide_cancellation_action(StepState.RUNNING, safe_interruptible=False),
            CancellationAction.MANUAL_REVIEW,
        )

    def test_running_safe_interruptible_yields_cancel(self) -> None:
        from devgateway_agent_runtime.cancellation import decide_cancellation_action
        from devgateway_agent_runtime.contracts import CancellationAction

        self.assertEqual(
            decide_cancellation_action(StepState.RUNNING, safe_interruptible=True),
            CancellationAction.CANCEL,
        )

    def test_terminal_step_states_yield_no_action(self) -> None:
        from devgateway_agent_runtime.cancellation import decide_cancellation_action
        from devgateway_agent_runtime.contracts import CancellationAction

        for state in (
            StepState.COMPLETED,
            StepState.FAILED,
            StepState.SKIPPED,
            StepState.CANCELLED,
            StepState.PENDING_APPROVAL,
            StepState.MANUAL_REVIEW,
        ):
            with self.subTest(state=state):
                self.assertEqual(
                    decide_cancellation_action(state),
                    CancellationAction.NO_ACTION,
                )

    def test_active_and_terminal_propagation_state_sets_are_disjoint_and_complete(self) -> None:
        from devgateway_agent_runtime.cancellation import (
            CANCELLATION_ACTIVE_PROPAGATION_STATES,
            CANCELLATION_TERMINAL_PROPAGATION_STATES,
        )
        from devgateway_agent_runtime.contracts import CancellationPropagationState

        all_states = set(CancellationPropagationState)
        self.assertEqual(
            CANCELLATION_ACTIVE_PROPAGATION_STATES | CANCELLATION_TERMINAL_PROPAGATION_STATES,
            all_states,
        )
        self.assertTrue(
            CANCELLATION_ACTIVE_PROPAGATION_STATES.isdisjoint(CANCELLATION_TERMINAL_PROPAGATION_STATES),
        )

    def test_is_cancellation_active_returns_true_for_requested(self) -> None:
        from devgateway_agent_runtime.cancellation import is_cancellation_active
        from devgateway_agent_runtime.contracts import CancellationPropagationState

        self.assertTrue(is_cancellation_active(CancellationPropagationState.REQUESTED))
        self.assertTrue(is_cancellation_active(CancellationPropagationState.PROPAGATING))
        self.assertFalse(is_cancellation_active(CancellationPropagationState.COMPLETED))
        self.assertFalse(is_cancellation_active(CancellationPropagationState.PARTIALLY_COMPLETED))

    def test_cancellation_record_propagation_state_defaults_and_serialises(self) -> None:
        from devgateway_agent_runtime.contracts import (
            CancellationPropagationState,
            CancellationRecord,
            CancellationTarget,
        )

        record = CancellationRecord(
            cancellation_id="cancel-default-001",
            target=CancellationTarget.WORKFLOW,
            workflow_id="wf_cancel_default",
        )
        self.assertEqual(record.propagation_state, CancellationPropagationState.REQUESTED)
        d = record.to_dict()
        self.assertEqual(d["propagation_state"], "requested")
        self.assertIsNone(d["completed_at"])

    def test_cancellation_record_with_explicit_propagation_state(self) -> None:
        from devgateway_agent_runtime.contracts import (
            CancellationPropagationState,
            CancellationRecord,
            CancellationTarget,
        )

        record = CancellationRecord(
            cancellation_id="cancel-prop-001",
            target=CancellationTarget.WORKFLOW,
            workflow_id="wf_cancel_prop",
            propagation_state=CancellationPropagationState.PROPAGATING,
        )
        self.assertEqual(record.to_dict()["propagation_state"], "propagating")

    # ------------------------------------------------------------------
    # 2. Dispatcher skips handler when cancellation is active
    # ------------------------------------------------------------------

    def _make_cancellation_aware_repository(
        self,
        *,
        active_cancellation: bool,
    ) -> "InMemoryRuntimeRepository":
        """Wrap InMemoryRuntimeRepository with a minimal cancellation capability."""

        base = InMemoryRuntimeRepository()

        class _CancellationAwareRepository(InMemoryRuntimeRepository):
            """Thin subclass that adds cancellation awareness for testing."""

            def __init__(self, inner: InMemoryRuntimeRepository) -> None:
                # Re-use the inner repository's state stores directly
                super().__init__()
                # Shallow-copy state from the inner repo (share underlying dicts)
                self._workflows = inner._workflows
                self._steps = inner._steps
                self._events = inner._events
                self._leases_by_id = inner._leases_by_id
                self._lease_ids_by_resource = inner._lease_ids_by_resource
                self._idempotency = inner._idempotency
                self._active = active_cancellation
                self._cancel_calls: list[str] = []

            def has_active_cancellation(self, workflow_id: str, step_id: str | None = None) -> bool:
                return self._active

            def cancel_step(
                self,
                step_id: str,
                *,
                lease: object = None,
                safe_interruptible: bool = False,
                trace_context: object = None,
                now: object = None,
            ) -> object:
                from devgateway_agent_runtime.contracts import CancellationAction

                self._cancel_calls.append(step_id)
                # Actually transition the step to CANCELLED so assertions work
                step = self._steps.get(step_id)
                if step and step.state in (StepState.PENDING, StepState.CLAIMED):
                    from dataclasses import replace
                    self._steps[step_id] = replace(step, state=StepState.CANCELLED)
                return CancellationAction.SKIP

        repo = _CancellationAwareRepository(base)
        return repo  # type: ignore[return-value]

    def test_dispatcher_skips_handler_when_cancellation_is_active(self) -> None:
        from dataclasses import replace

        inner = InMemoryRuntimeRepository()
        trace = TraceContext.new(correlation_id="wf_cancel_dispatch")
        wf = inner.create_workflow(
            Workflow(
                workflow_id="wf_cancel_dispatch",
                state=WorkflowState.CANCEL_REQUESTED,
                idempotency_key="fixture-key-cancel-dispatch",
                trace_context=trace,
            )
        )

        repo = self._make_cancellation_aware_repository(active_cancellation=True)
        # Sync shared state
        repo._workflows = inner._workflows
        repo._steps = inner._steps
        repo._events = inner._events
        repo._leases_by_id = inner._leases_by_id
        repo._lease_ids_by_resource = inner._lease_ids_by_resource

        from devgateway_agent_runtime.idempotency import stable_idempotency_key
        step = inner.add_step(
            WorkflowStep(
                step_id="step_cancel_dispatch",
                workflow_id=wf.workflow_id,
                kind=StepKind.RUNNING,
                state=StepState.PENDING,
                input_ref="fixture-ref:input:cancel-dispatch",
                idempotency_key=stable_idempotency_key(
                    IdempotencyScope.STEP_EXECUTION,
                    "fixture-ref:input:cancel-dispatch",
                ),
            ),
            trace_context=trace.child(),
        )

        handler_calls: list[str] = []

        def handler(s: WorkflowStep, _tc: TraceContext) -> StepExecutionResult:
            handler_calls.append(s.step_id)
            return StepExecutionResult(
                output_ref=f"fixture-ref:output:{s.step_id}",
                event_refs={},
            )

        dispatcher = BoundedDispatcher(
            repo,
            handler,
            policy=DispatcherPolicy(
                max_steps_per_run=5,
                polling=PollingBackoffPolicy(max_idle_polls=2),
            ),
        )
        stats = dispatcher.run_until_idle(workflow_id=wf.workflow_id)

        # Handler must NOT have been called
        self.assertEqual(handler_calls, [], "handler must not be invoked under active cancellation")
        # cancel_step must have been called for the step
        self.assertIn("step_cancel_dispatch", repo._cancel_calls)  # type: ignore[attr-defined]
        # Step must be CANCELLED (not RUNNING or COMPLETED)
        final_step = repo.get_step(step.step_id)
        self.assertIsNotNone(final_step)
        self.assertEqual(final_step.state, StepState.CANCELLED)  # type: ignore[union-attr]

    def test_dispatcher_invokes_handler_when_no_cancellation_support(self) -> None:
        """InMemoryRuntimeRepository has no cancellation support; handler must be called."""
        repository = InMemoryRuntimeRepository()
        trace = TraceContext.new(correlation_id="wf_no_cancel")
        wf = repository.create_workflow(
            Workflow(
                workflow_id="wf_no_cancel",
                state=WorkflowState.RUNNING,
                idempotency_key="fixture-key-no-cancel",
                trace_context=trace,
            )
        )
        from devgateway_agent_runtime.idempotency import stable_idempotency_key
        repository.add_step(
            WorkflowStep(
                step_id="step_no_cancel",
                workflow_id=wf.workflow_id,
                kind=StepKind.RUNNING,
                state=StepState.PENDING,
                input_ref="fixture-ref:input:no-cancel",
                idempotency_key=stable_idempotency_key(
                    IdempotencyScope.STEP_EXECUTION,
                    "fixture-ref:input:no-cancel",
                ),
            ),
            trace_context=trace.child(),
        )

        handler_calls: list[str] = []

        def handler(s: WorkflowStep, _tc: TraceContext) -> StepExecutionResult:
            handler_calls.append(s.step_id)
            return StepExecutionResult(
                output_ref=f"fixture-ref:output:{s.step_id}",
                event_refs={},
            )

        dispatcher = BoundedDispatcher(
            repository,
            handler,
            policy=DispatcherPolicy(
                max_steps_per_run=5,
                polling=PollingBackoffPolicy(max_idle_polls=1),
            ),
        )
        dispatcher.run_until_idle(workflow_id=wf.workflow_id)
        self.assertIn("step_no_cancel", handler_calls)

    def test_dispatcher_invokes_handler_when_cancellation_inactive(self) -> None:
        """When has_active_cancellation returns False the handler must be invoked."""
        inner = InMemoryRuntimeRepository()
        trace = TraceContext.new(correlation_id="wf_cancel_inactive")
        wf = inner.create_workflow(
            Workflow(
                workflow_id="wf_cancel_inactive",
                state=WorkflowState.RUNNING,
                idempotency_key="fixture-key-cancel-inactive",
                trace_context=trace,
            )
        )
        repo = self._make_cancellation_aware_repository(active_cancellation=False)
        repo._workflows = inner._workflows
        repo._steps = inner._steps
        repo._events = inner._events
        repo._leases_by_id = inner._leases_by_id
        repo._lease_ids_by_resource = inner._lease_ids_by_resource

        from devgateway_agent_runtime.idempotency import stable_idempotency_key
        inner.add_step(
            WorkflowStep(
                step_id="step_cancel_inactive",
                workflow_id=wf.workflow_id,
                kind=StepKind.RUNNING,
                state=StepState.PENDING,
                input_ref="fixture-ref:input:cancel-inactive",
                idempotency_key=stable_idempotency_key(
                    IdempotencyScope.STEP_EXECUTION,
                    "fixture-ref:input:cancel-inactive",
                ),
            ),
            trace_context=trace.child(),
        )

        handler_calls: list[str] = []

        def handler(s: WorkflowStep, _tc: TraceContext) -> StepExecutionResult:
            handler_calls.append(s.step_id)
            return StepExecutionResult(
                output_ref=f"fixture-ref:output:{s.step_id}",
                event_refs={},
            )

        dispatcher = BoundedDispatcher(
            repo,
            handler,
            policy=DispatcherPolicy(
                max_steps_per_run=5,
                polling=PollingBackoffPolicy(max_idle_polls=1),
            ),
        )
        dispatcher.run_until_idle(workflow_id=wf.workflow_id)
        self.assertIn("step_cancel_inactive", handler_calls)

    # ------------------------------------------------------------------
    # 3. Postgres SQL paths (fake cursor, no real DB)
    # ------------------------------------------------------------------

    def _make_pg_scope(self) -> object:
        from devgateway_agent_runtime.postgres_repository import RepositoryScope
        return RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)

    def test_postgres_has_active_cancellation_queries_workflow_cancellation_table(
        self,
    ) -> None:
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository

        conn = _FakeConnection()
        # Return a row with has_active = True
        conn.cur.queue_rows([{"has_active": True}])
        repo = PostgresRuntimeRepository(conn, self._make_pg_scope())  # type: ignore[arg-type]

        result = repo.has_active_cancellation("wf_has_active")

        self.assertTrue(result)
        sql_upper = conn.cur.executed[0][0].upper()
        self.assertIn("WORKFLOW_CANCELLATION", sql_upper)
        self.assertIn("PROPAGATION_STATE", sql_upper)
        self.assertIn("wf_has_active", conn.cur.executed[0][1])

    def test_postgres_has_active_cancellation_returns_false_when_no_row(
        self,
    ) -> None:
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository

        conn = _FakeConnection()
        conn.cur.queue_rows([{"has_active": False}])
        repo = PostgresRuntimeRepository(conn, self._make_pg_scope())  # type: ignore[arg-type]

        self.assertFalse(repo.has_active_cancellation("wf_no_active"))

    def test_postgres_create_cancellation_inserts_into_table(self) -> None:
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository
        from devgateway_agent_runtime.contracts import (
            CancellationRecord,
            CancellationPropagationState,
            CancellationTarget,
        )

        now = utc_now()
        record = CancellationRecord(
            cancellation_id="cancel-pg-001",
            target=CancellationTarget.WORKFLOW,
            workflow_id="wf_cancel_pg",
            reason_ref="fixture-ref:reason:cancellation-pg",
            propagation_state=CancellationPropagationState.REQUESTED,
            requested_at=now,
        )

        conn = _FakeConnection()
        cur = conn.cur
        # Queue: workflow_run PK lookup, then INSERT RETURNING
        cur.queue_rows([{"id": 42}])
        cur.queue_rows([{"workflow_cancellation_id": "cancel-pg-001"}])

        repo = PostgresRuntimeRepository(conn, self._make_pg_scope())  # type: ignore[arg-type]
        returned = repo.create_cancellation(record)

        self.assertEqual(returned.cancellation_id, "cancel-pg-001")
        insert_sql_upper = cur.executed[1][0].upper()
        self.assertIn("INSERT", insert_sql_upper)
        self.assertIn("WORKFLOW_CANCELLATION", insert_sql_upper)
        insert_params = cur.executed[1][1]
        self.assertIn("cancel-pg-001", insert_params)
        self.assertIn("requested", insert_params)

    def test_postgres_get_cancellation_returns_none_when_missing(self) -> None:
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository

        conn = _FakeConnection()
        conn.cur.queue_rows([])  # SELECT returns no row
        repo = PostgresRuntimeRepository(conn, self._make_pg_scope())  # type: ignore[arg-type]

        result = repo.get_cancellation("cancel-nonexistent")
        self.assertIsNone(result)
        sql, params = conn.cur.executed[0]
        self.assertIn("wc.project_id = %s", sql)
        self.assertIn("wr.project_id = %s", sql)
        self.assertEqual(params, ("cancel-nonexistent", 1, 1))

    def test_postgres_get_cancellation_maps_row_correctly(self) -> None:
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository, row_to_cancellation
        from devgateway_agent_runtime.contracts import (
            CancellationPropagationState,
            CancellationTarget,
        )

        now = utc_now()
        row = {
            "workflow_cancellation_id": "cancel-pg-get-001",
            "workflow_run_id_text": "wf_cancel_get",
            "task_ref": "fixture-ref:reason:get-test",
            "propagation_state": "propagating",
            "created_at": now,
            "updated_at": now,
        }

        record = row_to_cancellation(row)

        self.assertEqual(record.cancellation_id, "cancel-pg-get-001")
        self.assertEqual(record.workflow_id, "wf_cancel_get")
        self.assertEqual(record.target, CancellationTarget.WORKFLOW)
        self.assertEqual(record.propagation_state, CancellationPropagationState.PROPAGATING)
        self.assertEqual(record.reason_ref, "fixture-ref:reason:get-test")
        self.assertIsNone(record.completed_at)  # propagating is not terminal

    def test_postgres_create_cancellation_rejects_idempotency_conflict_with_different_request(self) -> None:
        from devgateway_agent_runtime.contracts import CancellationRecord, CancellationTarget
        from devgateway_agent_runtime.memory import RepositoryError
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository

        now = utc_now()
        conn = _FakeConnection()
        cur = conn.cur
        cur.queue_rows([{"id": 42}])
        cur.queue_rows([])
        cur.queue_rows([])
        cur.queue_rows([
            {
                "workflow_cancellation_id": "cancel-existing-001",
                "workflow_run_id_text": "wf_other",
                "task_ref": "fixture-ref:reason:other",
                "target_refs": json.dumps({"target": "workflow", "workflow_id": "wf_other", "step_id": None}),
                "propagation_state": "requested",
                "created_at": now,
                "updated_at": now,
            }
        ])

        repo = PostgresRuntimeRepository(conn, self._make_pg_scope())  # type: ignore[arg-type]
        record = CancellationRecord(
            cancellation_id="cancel-new-001",
            target=CancellationTarget.WORKFLOW,
            workflow_id="wf_cancel",
            reason_ref="fixture-ref:reason:new",
            idempotency_key="cancel-idem-conflict",
            requested_at=now,
        )

        with self.assertRaises(RepositoryError):
            repo.create_cancellation(record)

    def test_postgres_row_to_cancellation_sets_completed_at_for_terminal_state(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_cancellation
        from devgateway_agent_runtime.contracts import CancellationPropagationState

        now = utc_now()
        row = {
            "workflow_cancellation_id": "cancel-pg-done",
            "workflow_run_id_text": "wf_cancel_done",
            "task_ref": None,
            "propagation_state": "completed",
            "created_at": now,
            "updated_at": now,
        }
        record = row_to_cancellation(row)
        self.assertEqual(record.propagation_state, CancellationPropagationState.COMPLETED)
        self.assertIsNotNone(record.completed_at)

    def test_postgres_complete_cancellation_executes_cte_update(self) -> None:
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository

        now = utc_now()
        returning_row = {
            "workflow_cancellation_id": "cancel-complete-001",
            "workflow_run_id_text": "wf_cancel_complete",
            "task_ref": None,
            "propagation_state": "completed",
            "created_at": now,
            "updated_at": now,
        }
        conn = _FakeConnection()
        conn.cur.queue_rows([returning_row])

        repo = PostgresRuntimeRepository(conn, self._make_pg_scope())  # type: ignore[arg-type]
        record = repo.complete_cancellation("cancel-complete-001", now=now)

        self.assertEqual(record.cancellation_id, "cancel-complete-001")
        sql_upper = conn.cur.executed[0][0].upper()
        self.assertIn("UPDATE", sql_upper)
        self.assertIn("WORKFLOW_CANCELLATION", sql_upper)
        self.assertIn("COMPLETED", sql_upper)
        self.assertIn("PROJECT_ID = %S", sql_upper)
        self.assertEqual(conn.cur.executed[0][1], (now, "cancel-complete-001", 1, 1))

    def test_postgres_cancel_step_claimed_calls_update_step_state_to_cancelled(
        self,
    ) -> None:
        """cancel_step on a CLAIMED step (with active lease) transitions it to CANCELLED."""
        from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository
        from devgateway_agent_runtime.contracts import CancellationAction
        from devgateway_agent_runtime.leases import Lease

        now = utc_now()
        step_row = {
            "workflow_step_id": "step_cancel_pg",
            "workflow_run_id": "wf_cancel_pg",
            "step_type": "plan",
            "state": "planning",  # CLAIMED in DB
            "task_ref": "fixture-ref:input:cancel-pg",
            "idempotency_key": "cancel-idem-001",
            "ordinal": 1,
            "metadata": "{}",
            "created_at": now,
            "updated_at": now,
        }
        # Queue rows for:
        # 1. get_step SELECT (join with workflow_run)
        # 2. update_step_state: context SELECT
        # 3. update_step_state: fenced UPDATE CTE
        ctx_row = {
            "id": 20,
            "state": "planning",
            "metadata": "{}",
            "run_pk": 10,
            "workflow_run_id": "wf_cancel_pg",
            "wf_state": "cancel_requested",
        }
        updated_row = {
            "workflow_step_id": "step_cancel_pg",
            "state": "cancelled",
            "step_type": "plan",
            "task_ref": "fixture-ref:input:cancel-pg",
            "idempotency_key": "cancel-idem-001",
            "ordinal": 1,
            "metadata": "{}",
            "created_at": now,
            "updated_at": now,
            "workflow_run_id": "wf_cancel_pg",
        }
        # event seq lock rows
        run_lock_row = {"id": 10}
        seq_row = {"seq": 1}

        conn = _FakeConnection()
        cur = conn.cur
        cur.queue_rows([step_row])        # get_step
        cur.queue_rows([ctx_row])         # update_step_state context SELECT
        cur.queue_rows([updated_row])     # update_step_state fenced UPDATE
        cur.queue_rows([run_lock_row])    # _next_seq FOR UPDATE lock
        cur.queue_rows([seq_row])         # _next_seq MAX(sequence_number)
        # _insert_event INSERT has no RETURNING to fetch; nothing queued

        lease = Lease(
            resource_id="step:step_cancel_pg",
            owner_id="worker-1",
            expires_at=now + timedelta(seconds=30),
            fencing_token=3,
        )
        scope_obj = self._make_pg_scope()
        repo = PostgresRuntimeRepository(conn, scope_obj)  # type: ignore[arg-type]
        trace = TraceContext.new(correlation_id="wf_cancel_pg")

        action = repo.cancel_step(
            "step_cancel_pg",
            lease=lease,
            safe_interruptible=False,
            trace_context=trace,
            now=now,
        )

        self.assertEqual(action, CancellationAction.SKIP)
        # Verify that update_step_state was called with CANCELLED
        all_sqls = " ".join(e[0].upper() for e in cur.executed)
        self.assertIn("WORKFLOW_STEP", all_sqls)
        # Verify the CANCELLED db state value was used
        from devgateway_agent_runtime.postgres_repository import step_state_to_db
        cancelled_db = step_state_to_db(StepState.CANCELLED)
        all_params = [p for _, p in cur.executed if p is not None]
        flat_params = []
        for p in all_params:
            if isinstance(p, (list, tuple)):
                flat_params.extend(p)
            else:
                flat_params.append(p)
        self.assertIn(cancelled_db, flat_params, f"Expected '{cancelled_db}' in SQL params for cancel")


# ---------------------------------------------------------------------------
# Phase 3.6: Approval runtime tests
# ---------------------------------------------------------------------------


class ApprovalRuntimeTest(unittest.TestCase):
    """Tests for pure approval helpers, DB state bridges, and Postgres SQL paths."""

    # ------------------------------------------------------------------
    # 1. Pure approval lifecycle helpers (approvals.py)
    # ------------------------------------------------------------------

    def test_terminal_states_are_complete_and_disjoint_from_active(self) -> None:
        from devgateway_agent_runtime.approvals import (
            APPROVAL_ACTIVE_STATES,
            APPROVAL_TERMINAL_STATES,
            is_approval_active,
            is_approval_terminal,
        )

        all_states = set(ApprovalStatus)
        self.assertEqual(APPROVAL_TERMINAL_STATES | APPROVAL_ACTIVE_STATES, all_states)
        self.assertTrue(APPROVAL_TERMINAL_STATES.isdisjoint(APPROVAL_ACTIVE_STATES))

        for state in all_states:
            self.assertEqual(is_approval_terminal(state), state in APPROVAL_TERMINAL_STATES)
            self.assertEqual(is_approval_active(state), state in APPROVAL_ACTIVE_STATES)

    def test_pending_is_active_not_terminal(self) -> None:
        from devgateway_agent_runtime.approvals import is_approval_active, is_approval_terminal

        self.assertTrue(is_approval_active(ApprovalStatus.PENDING))
        self.assertFalse(is_approval_terminal(ApprovalStatus.PENDING))

    def test_all_non_pending_states_are_terminal(self) -> None:
        from devgateway_agent_runtime.approvals import is_approval_terminal

        for state in (
            ApprovalStatus.APPROVED,
            ApprovalStatus.DENIED,
            ApprovalStatus.EXPIRED,
            ApprovalStatus.CANCELLED,
            ApprovalStatus.SUPERSEDED,
        ):
            with self.subTest(state=state):
                self.assertTrue(is_approval_terminal(state))

    # ------------------------------------------------------------------
    # 2. approval_decision_to_workflow_state mapping
    # ------------------------------------------------------------------

    def test_approved_maps_to_running(self) -> None:
        from devgateway_agent_runtime.approvals import approval_decision_to_workflow_state

        self.assertEqual(
            approval_decision_to_workflow_state(ApprovalStatus.APPROVED),
            WorkflowState.RUNNING,
        )

    def test_denied_maps_to_cancelled(self) -> None:
        from devgateway_agent_runtime.approvals import approval_decision_to_workflow_state

        self.assertEqual(
            approval_decision_to_workflow_state(ApprovalStatus.DENIED),
            WorkflowState.CANCELLED,
        )

    def test_cancelled_maps_to_cancelled(self) -> None:
        from devgateway_agent_runtime.approvals import approval_decision_to_workflow_state

        self.assertEqual(
            approval_decision_to_workflow_state(ApprovalStatus.CANCELLED),
            WorkflowState.CANCELLED,
        )

    def test_expired_maps_to_failed(self) -> None:
        from devgateway_agent_runtime.approvals import approval_decision_to_workflow_state

        self.assertEqual(
            approval_decision_to_workflow_state(ApprovalStatus.EXPIRED),
            WorkflowState.FAILED,
        )

    def test_superseded_maps_to_failed(self) -> None:
        from devgateway_agent_runtime.approvals import approval_decision_to_workflow_state

        self.assertEqual(
            approval_decision_to_workflow_state(ApprovalStatus.SUPERSEDED),
            WorkflowState.FAILED,
        )

    def test_pending_raises_value_error(self) -> None:
        from devgateway_agent_runtime.approvals import approval_decision_to_workflow_state

        with self.assertRaises(ValueError):
            approval_decision_to_workflow_state(ApprovalStatus.PENDING)

    # ------------------------------------------------------------------
    # 3. should_pause_for_approval
    # ------------------------------------------------------------------

    def test_approval_gate_step_always_pauses(self) -> None:
        from devgateway_agent_runtime.approvals import should_pause_for_approval

        for tier in ApprovalRiskTier:
            with self.subTest(tier=tier):
                self.assertTrue(
                    should_pause_for_approval(
                        StepKind.APPROVAL_GATE, tier, policy_required=False
                    )
                )

    def test_policy_required_pauses_regardless_of_tier(self) -> None:
        from devgateway_agent_runtime.approvals import should_pause_for_approval

        for tier in (ApprovalRiskTier.LOW, ApprovalRiskTier.MEDIUM):
            with self.subTest(tier=tier):
                self.assertTrue(
                    should_pause_for_approval(
                        StepKind.RUNNING, tier, policy_required=True
                    )
                )

    def test_high_and_critical_tier_pauses_without_policy_required(self) -> None:
        from devgateway_agent_runtime.approvals import should_pause_for_approval

        for tier in (ApprovalRiskTier.HIGH, ApprovalRiskTier.CRITICAL):
            with self.subTest(tier=tier):
                self.assertTrue(
                    should_pause_for_approval(
                        StepKind.RUNNING, tier, policy_required=False
                    )
                )

    def test_low_and_medium_tier_without_policy_required_does_not_pause(self) -> None:
        from devgateway_agent_runtime.approvals import should_pause_for_approval

        for tier in (ApprovalRiskTier.LOW, ApprovalRiskTier.MEDIUM):
            with self.subTest(tier=tier):
                self.assertFalse(
                    should_pause_for_approval(
                        StepKind.RUNNING, tier, policy_required=False
                    )
                )

    def test_should_pause_does_not_inspect_content(self) -> None:
        """Verify no string content inspection: same inputs always produce same output."""
        from devgateway_agent_runtime.approvals import should_pause_for_approval

        r1 = should_pause_for_approval(StepKind.PLANNING, ApprovalRiskTier.LOW, policy_required=False)
        r2 = should_pause_for_approval(StepKind.PLANNING, ApprovalRiskTier.LOW, policy_required=False)
        self.assertEqual(r1, r2)
        self.assertFalse(r1)

    # ------------------------------------------------------------------
    # 4. ApprovalRiskTier enum aligned with DB vocabulary
    # ------------------------------------------------------------------

    def test_approval_risk_tier_values_match_db_check_constraint(self) -> None:
        # DB: CHECK risk_tier IN ('low', 'medium', 'high', 'critical')
        expected_values = {"low", "medium", "high", "critical"}
        actual_values = {tier.value for tier in ApprovalRiskTier}
        self.assertEqual(actual_values, expected_values)

    def test_approval_risk_tier_exported_from_package(self) -> None:
        import devgateway_agent_runtime as rt

        self.assertTrue(hasattr(rt, "ApprovalRiskTier"))

    # ------------------------------------------------------------------
    # 5. ApprovalRequest risk_tier field and to_dict
    # ------------------------------------------------------------------

    def test_approval_request_default_risk_tier_is_high(self) -> None:
        req = ApprovalRequest(
            approval_id="appr-tier-default",
            workflow_id="wf_tier",
            approval_ref="fixture-ref:approval:appr-tier-default",
            requester_ref="fixture-ref:principal:supervisor",
            policy_ref="fixture-ref:policy:approval:v1",
        )
        self.assertEqual(req.risk_tier, ApprovalRiskTier.HIGH)

    def test_default_approval_ttl_by_risk_tier(self) -> None:
        from devgateway_agent_runtime.approvals import default_approval_ttl_seconds

        self.assertEqual(default_approval_ttl_seconds(ApprovalRiskTier.LOW), 72 * 60 * 60)
        self.assertEqual(default_approval_ttl_seconds(ApprovalRiskTier.MEDIUM), 24 * 60 * 60)
        self.assertEqual(default_approval_ttl_seconds(ApprovalRiskTier.HIGH), 4 * 60 * 60)
        self.assertEqual(default_approval_ttl_seconds("internal-default"), 24 * 60 * 60)

    def test_approved_decision_requeues_paused_step_for_durable_resume(self) -> None:
        from devgateway_agent_runtime.approvals import approval_decision_to_step_state

        self.assertEqual(approval_decision_to_step_state(ApprovalStatus.APPROVED), StepState.PENDING)
        self.assertEqual(approval_decision_to_step_state(ApprovalStatus.DENIED), StepState.CANCELLED)
        self.assertEqual(approval_decision_to_step_state(ApprovalStatus.EXPIRED), StepState.FAILED)

    def test_approval_request_to_dict_includes_risk_tier(self) -> None:
        req = ApprovalRequest(
            approval_id="appr-dict-001",
            workflow_id="wf_dict",
            approval_ref="fixture-ref:approval:appr-dict-001",
            requester_ref="fixture-ref:principal:supervisor",
            policy_ref="fixture-ref:policy:approval:v1",
            risk_tier=ApprovalRiskTier.CRITICAL,
        )
        d = req.to_dict()
        self.assertEqual(d["risk_tier"], "critical")
        self.assertTrue(str(d["approval_ref"]).startswith("fixture-ref:"))
        self.assertTrue(str(d["requester_ref"]).startswith("fixture-ref:"))
        self.assertTrue(str(d["policy_ref"]).startswith("fixture-ref:"))

    # ------------------------------------------------------------------
    # 6. DB bridge helpers (postgres_repository)
    # ------------------------------------------------------------------

    def test_approval_status_round_trip_through_db_bridge(self) -> None:
        from devgateway_agent_runtime.postgres_repository import (
            approval_status_to_db,
            db_to_approval_status,
        )

        for status in ApprovalStatus:
            db_val = approval_status_to_db(status)
            self.assertEqual(db_val, status.value)
            py_status = db_to_approval_status(db_val)
            self.assertEqual(py_status, status)

    def test_db_to_approval_status_raises_on_unknown_value(self) -> None:
        from devgateway_agent_runtime.postgres_repository import db_to_approval_status
        from devgateway_agent_runtime.memory import RepositoryError

        with self.assertRaises(RepositoryError):
            db_to_approval_status("totally_unknown_state")

    def test_approval_risk_tier_round_trip_through_db_bridge(self) -> None:
        from devgateway_agent_runtime.postgres_repository import (
            approval_risk_tier_to_db,
            db_to_approval_risk_tier,
        )

        for tier in ApprovalRiskTier:
            db_val = approval_risk_tier_to_db(tier)
            self.assertEqual(db_val, tier.value)
            py_tier = db_to_approval_risk_tier(db_val)
            self.assertEqual(py_tier, tier)

    def test_db_to_approval_risk_tier_raises_on_unknown_value(self) -> None:
        from devgateway_agent_runtime.postgres_repository import db_to_approval_risk_tier
        from devgateway_agent_runtime.memory import RepositoryError

        with self.assertRaises(RepositoryError):
            db_to_approval_risk_tier("extreme")

    # ------------------------------------------------------------------
    # 7. row_to_approval_request pure helper
    # ------------------------------------------------------------------

    def test_row_to_approval_request_maps_columns_correctly(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_approval_request

        now = utc_now()
        row = {
            "approval_request_id": "appr-row-001",
            "workflow_run_id_text": "wf_row_appr",
            "task_id": "fixture-ref:approval:appr-row-001",
            "approver_policy_ref": "fixture-ref:policy:approval:v1",
            "approver_policy_metadata": json.dumps({
                "requester_ref": "fixture-ref:principal:supervisor",
                "context_ref": "fixture-ref:context:wf_row_appr",
            }),
            "risk_tier": "high",
            "expires_at": None,
            "created_at": now,
            "workflow_step_id_text": None,
        }

        req = row_to_approval_request(row)

        self.assertEqual(req.approval_id, "appr-row-001")
        self.assertEqual(req.workflow_id, "wf_row_appr")
        self.assertEqual(req.approval_ref, "fixture-ref:approval:appr-row-001")
        self.assertEqual(req.requester_ref, "fixture-ref:principal:supervisor")
        self.assertEqual(req.policy_ref, "fixture-ref:policy:approval:v1")
        self.assertEqual(req.risk_tier, ApprovalRiskTier.HIGH)
        self.assertIsNone(req.step_id)
        self.assertIsNone(req.expires_at)
        self.assertEqual(req.context_ref, "fixture-ref:context:wf_row_appr")

    def test_row_to_approval_request_with_step_and_expires(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_approval_request

        now = utc_now()
        expires = now + timedelta(hours=1)
        row = {
            "approval_request_id": "appr-row-002",
            "workflow_run_id_text": "wf_row_appr_2",
            "task_id": "fixture-ref:approval:appr-row-002",
            "approver_policy_ref": "fixture-ref:policy:critical-ops:v1",
            "approver_policy_metadata": json.dumps({
                "requester_ref": "fixture-ref:principal:agent-worker",
                "context_ref": None,
            }),
            "risk_tier": "critical",
            "expires_at": expires,
            "created_at": now,
            "workflow_step_id_text": "step_approval_gate",
        }

        req = row_to_approval_request(row)

        self.assertEqual(req.risk_tier, ApprovalRiskTier.CRITICAL)
        self.assertEqual(req.step_id, "step_approval_gate")
        self.assertIsNotNone(req.expires_at)

    # ------------------------------------------------------------------
    # 8. Postgres SQL paths via fake cursor
    # ------------------------------------------------------------------

    def _make_repo(self) -> "PostgresRuntimeRepository":  # type: ignore[name-defined]
        from devgateway_agent_runtime.postgres_repository import (
            PostgresRuntimeRepository,
            RepositoryScope,
        )

        self._conn = _FakeConnection()
        scope = RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)
        return PostgresRuntimeRepository(self._conn, scope)

    def test_create_approval_request_executes_insert_sql(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        # 1) lookup workflow run pk
        cur.queue_rows([{"id": 10}])
        # 2) INSERT approval_request RETURNING id
        cur.queue_rows([{"id": 99}])

        req = ApprovalRequest(
            approval_id="appr-pg-001",
            workflow_id="wf_pg_appr",
            approval_ref="fixture-ref:approval:appr-pg-001",
            requester_ref="fixture-ref:principal:supervisor",
            policy_ref="fixture-ref:policy:approval:v1",
            risk_tier=ApprovalRiskTier.HIGH,
            requested_at=now,
        )

        result = repo.create_approval_request(req)

        self.assertEqual(result.approval_id, req.approval_id)
        all_sql = " ".join(e[0].upper() for e in cur.executed)
        self.assertIn("APPROVAL_REQUEST", all_sql)
        self.assertIn("INSERT", all_sql)
        self.assertIn("ON CONFLICT DO NOTHING", all_sql)
        # Verify risk_tier value in params
        all_params = [p for _, p in cur.executed if p]
        flat = [str(v) for row in all_params for v in (row if isinstance(row, (list, tuple)) else [row])]
        self.assertIn("high", flat)
        # production_enabled is false
        self.assertNotIn("true", flat)

    def test_create_approval_request_rejects_idempotency_conflict_with_different_request(self) -> None:
        from devgateway_agent_runtime.memory import RepositoryError

        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        cur.queue_rows([{"id": 10}])
        cur.queue_rows([])
        cur.queue_rows([
            {
                "approval_request_id": "appr-conflict-001",
                "workflow_run_id_text": "wf_pg_appr",
                "task_id": "fixture-ref:approval:appr-conflict-001",
                "approver_policy_ref": "fixture-ref:policy:approval:old",
                "approver_policy_metadata": json.dumps({
                    "requester_ref": "fixture-ref:principal:supervisor",
                    "context_ref": None,
                }),
                "risk_tier": "high",
                "expires_at": None,
                "created_at": now,
                "workflow_step_id_text": None,
            }
        ])

        req = ApprovalRequest(
            approval_id="appr-conflict-001",
            workflow_id="wf_pg_appr",
            approval_ref="fixture-ref:approval:appr-conflict-001",
            requester_ref="fixture-ref:principal:supervisor",
            policy_ref="fixture-ref:policy:approval:new",
            risk_tier=ApprovalRiskTier.HIGH,
            requested_at=now,
        )

        with self.assertRaises(RepositoryError):
            repo.create_approval_request(req)

    def test_get_approval_request_executes_select_join_sql(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        row = {
            "approval_request_id": "appr-get-001",
            "workflow_run_id_text": "wf_get_appr",
            "task_id": "fixture-ref:approval:appr-get-001",
            "approver_policy_ref": "fixture-ref:policy:approval:v1",
            "approver_policy_metadata": json.dumps({
                "requester_ref": "fixture-ref:principal:supervisor",
                "context_ref": None,
            }),
            "risk_tier": "medium",
            "expires_at": None,
            "created_at": now,
            "workflow_step_id_text": None,
        }
        cur.queue_rows([row])

        result = repo.get_approval_request("appr-get-001")

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.approval_id, "appr-get-001")
        self.assertEqual(result.risk_tier, ApprovalRiskTier.MEDIUM)
        # Verify SQL uses JOIN
        select_sql = cur.executed[0][0].upper()
        self.assertIn("APPROVAL_REQUEST", select_sql)
        self.assertIn("JOIN", select_sql)
        self.assertIn("WORKFLOW_RUN", select_sql)
        self.assertIn("AR.PROJECT_ID = %S", select_sql)
        self.assertIn("WR.PROJECT_ID = %S", select_sql)

    def test_get_approval_request_returns_none_when_not_found(self) -> None:
        repo = self._make_repo()
        self._conn.cur.queue_rows([])

        result = repo.get_approval_request("appr-missing-001")

        self.assertIsNone(result)

    def test_record_approval_decision_denied_updates_state(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        # UPDATE returns row with approval_request_id
        cur.queue_rows([{"approval_request_id": "appr-deny-001"}])

        decision = ApprovalDecision(
            approval_id="appr-deny-001",
            workflow_id="wf_deny",
            decision=ApprovalStatus.DENIED,
            decided_by_ref="fixture-ref:principal:reviewer",
            decided_at=now,
            reason_ref="fixture-ref:reason:policy-violation",
            evidence_refs=("fixture-ref:evidence:audit-001",),
        )

        result = repo.record_approval_decision(decision)

        self.assertEqual(result.decision, ApprovalStatus.DENIED)
        update_sql, update_params = next((sql, params) for sql, params in cur.executed if "decision_metadata" in sql)
        update_sql = update_sql.upper()
        self.assertIn("UPDATE", update_sql)
        self.assertIn("APPROVAL_REQUEST", update_sql)
        self.assertIn("PROJECT_ID = %S", update_sql)
        self.assertIn("WORKFLOW_RUN_ID = %S", update_sql)
        # 'denied' must appear in params
        flat_params = [str(v) for _, p in cur.executed if p for v in (p if isinstance(p, (list, tuple)) else [p])]
        self.assertIn("denied", flat_params)
        self.assertIn("wf_deny", [str(v) for v in update_params])
        # State guard: only transitions from pending
        self.assertIn("PENDING", update_sql)

    def test_record_approval_decision_expired_maps_correctly(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        cur.queue_rows([{"approval_request_id": "appr-expire-001"}])

        decision = ApprovalDecision(
            approval_id="appr-expire-001",
            workflow_id="wf_expire",
            decision=ApprovalStatus.EXPIRED,
            decided_by_ref="fixture-ref:principal:system",
            decided_at=now,
        )

        result = repo.record_approval_decision(decision)

        self.assertEqual(result.decision, ApprovalStatus.EXPIRED)
        flat_params = [str(v) for _, p in cur.executed if p for v in (p if isinstance(p, (list, tuple)) else [p])]
        self.assertIn("expired", flat_params)

    def test_record_approval_decision_approved_raises_repository_error(self) -> None:
        """Runtime must not record approved decisions — proof FKs are control-api concern."""
        from devgateway_agent_runtime.memory import RepositoryError

        repo = self._make_repo()
        now = utc_now()

        decision = ApprovalDecision(
            approval_id="appr-approve-001",
            workflow_id="wf_approve",
            decision=ApprovalStatus.APPROVED,
            decided_by_ref="fixture-ref:principal:reviewer",
            decided_at=now,
            evidence_refs=("fixture-ref:evidence:summary-001",),
        )

        with self.assertRaises(RepositoryError) as ctx:
            repo.record_approval_decision(decision)

        self.assertIn("approved", str(ctx.exception).lower())
        self.assertIn("control", str(ctx.exception).lower())

    def test_record_approval_decision_decision_meta_contains_no_raw_values(self) -> None:
        """decision_metadata JSON blob must only contain opaque refs."""
        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        cur.queue_rows([{"approval_request_id": "appr-meta-001"}])

        decision = ApprovalDecision(
            approval_id="appr-meta-001",
            workflow_id="wf_meta",
            decision=ApprovalStatus.CANCELLED,
            decided_by_ref="fixture-ref:principal:system",
            decided_at=now,
            reason_ref="fixture-ref:reason:system-cancel",
            evidence_refs=("fixture-ref:evidence:policy-001",),
        )

        repo.record_approval_decision(decision)

        # Find the JSON metadata param in the executed SQL
        all_params = [p for _, p in cur.executed if p]
        json_blobs = []
        for row in all_params:
            items = row if isinstance(row, (list, tuple)) else [row]
            for v in items:
                if isinstance(v, str) and v.startswith("{"):
                    try:
                        parsed = json.loads(v)
                        json_blobs.append(parsed)
                    except json.JSONDecodeError:
                        pass

        self.assertTrue(json_blobs, "Expected at least one JSON blob in SQL params")
        for blob in json_blobs:
            # No raw user content; all refs must be opaque
            for key, val in blob.items():
                if isinstance(val, str) and val:
                    self.assertTrue(
                        val.startswith("fixture-ref:") or key == "decided_at" or key == "decided_by_ref",
                        f"Unexpected raw value for key={key!r}: {val!r}",
                    )

    def test_list_pending_approvals_executes_filtered_select(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        pending_row = {
            "approval_request_id": "appr-list-001",
            "workflow_run_id_text": "wf_list_appr",
            "task_id": "fixture-ref:approval:appr-list-001",
            "approver_policy_ref": "fixture-ref:policy:approval:v1",
            "approver_policy_metadata": json.dumps({
                "requester_ref": "fixture-ref:principal:supervisor",
                "context_ref": None,
            }),
            "risk_tier": "high",
            "expires_at": None,
            "created_at": now,
            "workflow_step_id_text": None,
        }
        cur.queue_rows([pending_row])

        results = repo.list_pending_approvals("wf_list_appr")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].approval_id, "appr-list-001")
        select_sql = cur.executed[0][0].upper()
        self.assertIn("APPROVAL_REQUEST", select_sql)
        self.assertIn("PENDING", select_sql)
        self.assertIn("WORKFLOW_RUN", select_sql)

    def test_list_pending_approvals_returns_empty_tuple_when_none(self) -> None:
        repo = self._make_repo()
        self._conn.cur.queue_rows([])

        results = repo.list_pending_approvals("wf_no_approvals")

        self.assertEqual(results, ())

    def test_has_active_approval_returns_true_when_pending_exists(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([{"has_active": True}])

        result = repo.has_active_approval("wf_active_appr")

        self.assertTrue(result)
        exists_sql = cur.executed[1][0].upper()
        self.assertIn("EXISTS", exists_sql)
        self.assertIn("APPROVAL_REQUEST", exists_sql)
        self.assertIn("PENDING", exists_sql)

    def test_has_active_approval_returns_false_when_none_pending(self) -> None:
        repo = self._make_repo()
        self._conn.cur.queue_rows([{"has_active": False}])

        result = repo.has_active_approval("wf_no_active_appr")

        self.assertFalse(result)

    # ------------------------------------------------------------------
    # 9. approval helpers exported from package init
    # ------------------------------------------------------------------

    def test_approval_helpers_exported_from_package_init(self) -> None:
        import devgateway_agent_runtime as rt

        for name in (
            "APPROVAL_ACTIVE_STATES",
            "APPROVAL_TERMINAL_STATES",
            "DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER",
            "approval_decision_to_step_state",
            "approval_decision_to_workflow_state",
            "approval_expires_at",
            "default_approval_ttl_seconds",
            "is_approval_active",
            "is_approval_terminal",
            "should_pause_for_approval",
            "stable_approval_resume_token",
        ):
            with self.subTest(name=name):
                self.assertTrue(hasattr(rt, name), f"Missing export: {name}")

    def test_approvals_module_import_does_not_require_live_dependencies(self) -> None:
        blocked = {"psycopg", "psycopg2", "asyncpg", "sqlalchemy", "boto3", "httpx", "openai"}
        original_import = builtins.__import__

        def guarded(name: str, *args: object, **kwargs: object) -> object:
            if name.partition(".")[0] in blocked:
                raise AssertionError(f"approvals module triggered live import: {name}")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", guarded):
            import importlib
            import devgateway_agent_runtime.approvals as approvals_mod

            importlib.reload(approvals_mod)

    def test_stable_approval_resume_token_avoids_delimiter_collisions(self) -> None:
        from devgateway_agent_runtime.approvals import stable_approval_resume_token

        first = stable_approval_resume_token(workflow_id="wf:step", step_id="approval", approval_id="id")
        second = stable_approval_resume_token(workflow_id="wf", step_id="step:approval", approval_id="id")
        none_step = stable_approval_resume_token(workflow_id="wf", step_id=None, approval_id="approval")
        empty_step = stable_approval_resume_token(workflow_id="wf", step_id="", approval_id="approval")

        self.assertNotEqual(first, second)
        self.assertNotEqual(none_step, empty_step)


# ---------------------------------------------------------------------------
# Phase 3.7: outbox pure-helper and postgres tests
# ---------------------------------------------------------------------------


class OutboxLifecycleTest(unittest.TestCase):
    """Pure outbox.py helper tests — no cursor/DB required."""

    # ------------------------------------------------------------------
    # 1. Delivery state set helpers
    # ------------------------------------------------------------------

    def test_terminal_and_active_states_are_complete_and_disjoint(self) -> None:
        from devgateway_agent_runtime.outbox import (
            OUTBOX_ACTIVE_STATES,
            OUTBOX_TERMINAL_STATES,
            is_outbox_active,
            is_outbox_terminal,
        )

        all_states = set(OutboxEventStatus)
        self.assertEqual(OUTBOX_TERMINAL_STATES | OUTBOX_ACTIVE_STATES, all_states)
        self.assertTrue(OUTBOX_TERMINAL_STATES.isdisjoint(OUTBOX_ACTIVE_STATES))

        for state in all_states:
            with self.subTest(state=state.value):
                self.assertEqual(is_outbox_terminal(state), state in OUTBOX_TERMINAL_STATES)
                self.assertEqual(is_outbox_active(state), state in OUTBOX_ACTIVE_STATES)
                self.assertNotEqual(is_outbox_terminal(state), is_outbox_active(state))

    def test_delivered_and_dead_lettered_are_terminal(self) -> None:
        from devgateway_agent_runtime.outbox import is_outbox_terminal

        self.assertTrue(is_outbox_terminal(OutboxEventStatus.DELIVERED))
        self.assertTrue(is_outbox_terminal(OutboxEventStatus.DEAD_LETTERED))

    def test_pending_delivering_failed_are_active(self) -> None:
        from devgateway_agent_runtime.outbox import is_outbox_active

        for state in (
            OutboxEventStatus.PENDING,
            OutboxEventStatus.DELIVERING,
            OutboxEventStatus.FAILED,
        ):
            with self.subTest(state=state.value):
                self.assertTrue(is_outbox_active(state))

    # ------------------------------------------------------------------
    # 2. outbox_next_attempt_at backoff helper
    # ------------------------------------------------------------------

    def test_outbox_next_attempt_at_returns_future_datetime(self) -> None:
        from devgateway_agent_runtime.outbox import outbox_next_attempt_at

        now = utc_now()
        result = outbox_next_attempt_at(1, now=now)
        self.assertGreater(result, now)

    def test_outbox_next_attempt_at_uses_supplied_policy(self) -> None:
        from devgateway_agent_runtime.outbox import outbox_next_attempt_at

        policy = RetryPolicy(
            max_attempts=5,
            backoff_type=RetryBackoffType.FIXED,
            base_delay_seconds=10.0,
            max_delay_seconds=60.0,
        )
        now = utc_now()
        result = outbox_next_attempt_at(1, policy, now=now)
        self.assertAlmostEqual(
            (result - now).total_seconds(), 10.0, delta=0.01
        )

    def test_outbox_next_attempt_at_uses_default_policy_when_none(self) -> None:
        from devgateway_agent_runtime.outbox import (
            DEFAULT_OUTBOX_RETRY_POLICY,
            outbox_next_attempt_at,
        )
        from devgateway_agent_runtime.retry import calculate_backoff

        now = utc_now()
        result = outbox_next_attempt_at(2, None, now=now)
        expected_delay = calculate_backoff(DEFAULT_OUTBOX_RETRY_POLICY, 2)
        self.assertAlmostEqual(
            (result - now).total_seconds(), expected_delay, delta=0.01
        )

    # ------------------------------------------------------------------
    # 3. outbox_idempotency_key helper
    # ------------------------------------------------------------------

    def test_outbox_idempotency_key_is_deterministic(self) -> None:
        from devgateway_agent_runtime.outbox import outbox_idempotency_key

        k1 = outbox_idempotency_key("webhook_ref", "fixture-ref:event:evt-001")
        k2 = outbox_idempotency_key("webhook_ref", "fixture-ref:event:evt-001")
        self.assertEqual(k1, k2)

    def test_outbox_idempotency_key_differs_for_different_destinations(self) -> None:
        from devgateway_agent_runtime.outbox import outbox_idempotency_key

        k1 = outbox_idempotency_key("webhook_ref", "fixture-ref:event:evt-001")
        k2 = outbox_idempotency_key("notification", "fixture-ref:event:evt-001")
        self.assertNotEqual(k1, k2)

    def test_outbox_idempotency_key_differs_for_different_source_refs(self) -> None:
        from devgateway_agent_runtime.outbox import outbox_idempotency_key

        k1 = outbox_idempotency_key("webhook_ref", "fixture-ref:event:evt-001")
        k2 = outbox_idempotency_key("webhook_ref", "fixture-ref:event:evt-002")
        self.assertNotEqual(k1, k2)

    def test_outbox_idempotency_key_prefixed_with_outbox(self) -> None:
        from devgateway_agent_runtime.outbox import outbox_idempotency_key

        key = outbox_idempotency_key("webhook_ref", "fixture-ref:event:evt-001")
        self.assertTrue(key.startswith("outbox:"))

    def test_outbox_idempotency_key_never_contains_raw_payload(self) -> None:
        """Key must not embed raw destination or source_ref strings directly."""
        from devgateway_agent_runtime.outbox import outbox_idempotency_key

        dest = "my-super-secret-webhook-url"
        ref = "fixture-ref:event:top-secret-001"
        key = outbox_idempotency_key(dest, ref)
        # The raw strings must not appear verbatim in the key
        self.assertNotIn(dest, key)
        self.assertNotIn(ref, key)

    # ------------------------------------------------------------------
    # 4. outbox.py module import does not trigger live dependencies
    # ------------------------------------------------------------------

    def test_outbox_module_import_does_not_require_live_dependencies(self) -> None:
        blocked = {"psycopg", "psycopg2", "asyncpg", "sqlalchemy", "boto3", "httpx", "openai"}
        original_import = builtins.__import__

        def guarded(name: str, *args: object, **kwargs: object) -> object:
            if name.partition(".")[0] in blocked:
                raise AssertionError(f"outbox module triggered live import: {name}")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", guarded):
            import importlib
            import devgateway_agent_runtime.outbox as outbox_mod

            importlib.reload(outbox_mod)

    # ------------------------------------------------------------------
    # 5. WorkflowOutboxEvent dataclass round-trip
    # ------------------------------------------------------------------

    def test_workflow_outbox_event_to_dict_uses_db_vocabulary(self) -> None:
        from devgateway_agent_runtime.outbox import outbox_idempotency_key

        now = utc_now()
        ikey = outbox_idempotency_key("webhook_ref", "fixture-ref:event:evt-db-vocab")
        event = WorkflowOutboxEvent(
            outbox_id="outbox-db-001",
            workflow_id="wf_db_vocab",
            source_event_ref="fixture-ref:event:evt-db-vocab",
            destination_kind="webhook_ref",
            payload_artifact_ref="fixture-ref:artifact:payload-001",
            idempotency_key=ikey,
            delivery_state=OutboxEventStatus.FAILED,
            attempt_count=3,
            last_failure_ref="fixture-ref:reason:transient-timeout",
            enqueued_at=now,
        )
        d = event.to_dict()

        self.assertEqual(d["outbox_id"], "outbox-db-001")
        self.assertEqual(d["source_event_ref"], "fixture-ref:event:evt-db-vocab")
        self.assertEqual(d["destination_kind"], "webhook_ref")
        self.assertEqual(d["delivery_state"], "failed")
        self.assertEqual(d["attempt_count"], 3)
        self.assertEqual(d["last_failure_ref"], "fixture-ref:reason:transient-timeout")
        self.assertIsNone(d["delivered_at"])
        self.assertIsNone(d["next_attempt_at"])
        # Old field names must NOT appear
        self.assertNotIn("status", d)
        self.assertNotIn("event_type", d)
        self.assertNotIn("payload_ref", d)
        self.assertNotIn("attempt", d)
        self.assertNotIn("topic_ref", d)
        self.assertNotIn("updated_at", d)


class PostgresOutboxRepositoryTest(unittest.TestCase):
    """Targeted Postgres outbox tests using fake cursor — no real DB required."""

    def _make_repo(self) -> "PostgresRuntimeRepository":  # type: ignore[name-defined]
        from devgateway_agent_runtime.postgres_repository import (
            PostgresRuntimeRepository,
            RepositoryScope,
        )

        self._conn = _FakeConnection()
        scope = RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)
        return PostgresRuntimeRepository(self._conn, scope)

    def _make_event(self, **kwargs: object) -> WorkflowOutboxEvent:
        from devgateway_agent_runtime.outbox import outbox_idempotency_key

        defaults: dict[str, object] = {
            "outbox_id": "outbox-pg-001",
            "workflow_id": "wf_pg_outbox",
            "source_event_ref": "fixture-ref:event:evt-pg-001",
            "destination_kind": "webhook_ref",
            "idempotency_key": outbox_idempotency_key(
                "webhook_ref", "fixture-ref:event:evt-pg-001"
            ),
        }
        defaults.update(kwargs)
        return WorkflowOutboxEvent(**defaults)  # type: ignore[arg-type]

    def _make_outbox_lease(self, outbox_id: str, owner_id: str = "worker-1") -> Lease:
        from devgateway_agent_runtime.leases import Lease

        return Lease(
            lease_id=f"lease-{outbox_id}",
            resource_id=f"outbox:{outbox_id}",
            owner_id=owner_id,
            fencing_token=7,
            expires_at=utc_now() + timedelta(seconds=30),
        )

    # ------------------------------------------------------------------
    # 1. row_to_outbox_event pure mapping
    # ------------------------------------------------------------------

    def test_row_to_outbox_event_maps_columns_correctly(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_outbox_event

        now = utc_now()
        row = {
            "outbox_id": "outbox-row-001",
            "workflow_run_id_text": "wf_row_outbox",
            "source_event_id_text": "fixture-ref:event:evt-row-001",
            "destination_kind": "webhook_ref",
            "delivery_state": "pending",
            "attempt_count": 0,
            "next_attempt_at": None,
            "last_failure_ref": None,
            "idempotency_key": "outbox:abc123",
            "metadata": json.dumps({"payload_artifact_ref": "fixture-ref:artifact:pl-001"}),
            "created_at": now,
            "delivered_at": None,
        }

        event = row_to_outbox_event(row)

        self.assertEqual(event.outbox_id, "outbox-row-001")
        self.assertEqual(event.workflow_id, "wf_row_outbox")
        self.assertEqual(event.source_event_ref, "fixture-ref:event:evt-row-001")
        self.assertEqual(event.destination_kind, "webhook_ref")
        self.assertEqual(event.delivery_state, OutboxEventStatus.PENDING)
        self.assertEqual(event.attempt_count, 0)
        self.assertEqual(event.payload_artifact_ref, "fixture-ref:artifact:pl-001")
        self.assertIsNone(event.next_attempt_at)
        self.assertIsNone(event.delivered_at)

    # ------------------------------------------------------------------
    # 2. build_claim_outbox_query — FOR UPDATE SKIP LOCKED
    # ------------------------------------------------------------------

    def test_build_claim_outbox_query_contains_for_update_skip_locked(self) -> None:
        from devgateway_agent_runtime.postgres_repository import build_claim_outbox_query

        sql, params = build_claim_outbox_query(batch_size=5, project_id=1, now=utc_now())

        sql_upper = sql.upper()
        self.assertIn("FOR UPDATE", sql_upper)
        self.assertIn("SKIP LOCKED", sql_upper)
        self.assertIn("DELIVERING", sql_upper)
        self.assertIn("PENDING", sql_upper)
        self.assertIn("FAILED", sql_upper)
        self.assertIn("EXPIRED_DELIVERING", sql_upper)
        self.assertIn("DEAD_LETTERED", sql_upper)
        self.assertEqual(params[12], 5)

    def test_build_claim_outbox_query_increments_attempt_count(self) -> None:
        from devgateway_agent_runtime.postgres_repository import build_claim_outbox_query

        sql, _ = build_claim_outbox_query(batch_size=10, project_id=1, now=utc_now())

        self.assertIn("attempt_count", sql)
        self.assertIn("+ 1", sql)

    def test_build_claim_outbox_query_recovers_delivering_without_valid_active_lease(self) -> None:
        from devgateway_agent_runtime.postgres_repository import build_claim_outbox_query

        sql, _ = build_claim_outbox_query(batch_size=10, project_id=1, now=utc_now())

        sql_upper = sql.upper()
        self.assertIn("NOT EXISTS", sql_upper)
        self.assertIn("WL.STATUS = 'ACTIVE'", sql_upper)
        self.assertIn("WL.EXPIRES_AT > %S", sql_upper)
        self.assertNotIn("WL.EXPIRES_AT <= %S", sql_upper)

    def test_build_claim_outbox_query_dead_letters_exhausted_expired_deliveries(self) -> None:
        from devgateway_agent_runtime.postgres_repository import build_claim_outbox_query

        sql, params = build_claim_outbox_query(batch_size=10, project_id=1, now=utc_now())

        sql_upper = sql.upper()
        self.assertIn("WHEN WO.ATTEMPT_COUNT >= %S THEN 'DEAD_LETTERED'", sql_upper)
        self.assertIn("EXHAUSTED_FAILED", sql_upper)
        self.assertIn("WO.ATTEMPT_COUNT < %S", sql_upper)
        self.assertIn(10, params)

    # ------------------------------------------------------------------
    # 3. append_outbox_event — new insert
    # ------------------------------------------------------------------

    def test_append_outbox_event_inserts_new_row(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        # 1) lookup workflow run pk
        cur.queue_rows([{"id": 10}])
        # 2) lookup workflow event pk
        cur.queue_rows([{"id": 20}])
        # 3) INSERT RETURNING outbox_id (new row)
        cur.queue_rows([{"outbox_id": "outbox-pg-001"}])

        event = self._make_event()
        result = repo.append_outbox_event(event)

        self.assertEqual(result.outbox_id, event.outbox_id)
        all_sql = " ".join(e[0].upper() for e in cur.executed)
        self.assertIn("INSERT", all_sql)
        self.assertIn("WORKFLOW_OUTBOX", all_sql)
        # ON CONFLICT clause must be present
        self.assertIn("ON CONFLICT", " ".join(e[0] for e in cur.executed))

    # ------------------------------------------------------------------
    # 4. append_outbox_event — idempotency (conflict → return existing)
    # ------------------------------------------------------------------

    def test_append_outbox_event_returns_existing_on_conflict(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_outbox_event

        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        existing_row = {
            "outbox_id": "outbox-pg-001",
            "workflow_run_id_text": "wf_pg_outbox",
            "source_event_id_text": "fixture-ref:event:evt-pg-001",
            "destination_kind": "webhook_ref",
            "delivery_state": "delivered",
            "attempt_count": 1,
            "next_attempt_at": None,
            "last_failure_ref": None,
            "idempotency_key": "outbox:abc",
            "metadata": "{}",
            "created_at": now,
            "delivered_at": now,
        }

        # 1) lookup run pk
        cur.queue_rows([{"id": 10}])
        # 2) lookup event pk
        cur.queue_rows([{"id": 20}])
        # 3) INSERT ON CONFLICT DO NOTHING → RETURNING is empty (conflict)
        cur.queue_rows([])
        # 4) SELECT existing row
        cur.queue_rows([existing_row])

        event = self._make_event()
        result = repo.append_outbox_event(event)

        # Must return the existing delivered row, not the original pending event
        self.assertEqual(result.delivery_state, OutboxEventStatus.DELIVERED)
        self.assertIsNotNone(result.delivered_at)
        # Verify a SELECT was executed after the INSERT conflict
        select_sqls = [s for s, _ in cur.executed if "SELECT" in s.upper() and "WORKFLOW_OUTBOX" in s.upper()]
        self.assertTrue(select_sqls, "Expected a SELECT to fetch existing row on conflict")

    # ------------------------------------------------------------------
    # 5. claim_pending_outbox_events — SQL and return structure
    # ------------------------------------------------------------------

    def test_claim_pending_outbox_events_returns_event_and_lease(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        claimed_row = {
            "outbox_id": "outbox-claim-001",
            "workflow_run_id_text": "wf_claim_outbox",
            "source_event_id_text": "fixture-ref:event:evt-claim-001",
            "destination_kind": "notification",
            "delivery_state": "delivering",
            "attempt_count": 1,
            "next_attempt_at": None,
            "last_failure_ref": None,
            "idempotency_key": "outbox:claim001",
            "metadata": "{}",
            "created_at": now,
            "delivered_at": None,
            "run_pk": 10,
        }
        lease_row = {
            "workflow_lease_id": "lease-outbox-001",
            "lease_key": "outbox:outbox-claim-001",
            "lease_owner": "worker-1",
            "fencing_token": 1,
            "acquired_at": now,
            "heartbeat_at": now,
            "expires_at": now + timedelta(seconds=30),
        }

        # 1) UPDATE CTE → fetchall returns claimed rows
        cur.queue_rows([claimed_row])
        # 2) Expire stale leases UPDATE → no fetch
        # 3) INSERT lease → fetchone returns lease row
        cur.queue_rows([lease_row])

        results = repo.claim_pending_outbox_events(
            batch_size=1,
            owner_id="worker-1",
            policy=LeasePolicy(ttl_seconds=30),
            now=now,
        )

        self.assertEqual(len(results), 1)
        event, lease = results[0]
        self.assertEqual(event.outbox_id, "outbox-claim-001")
        self.assertEqual(event.delivery_state, OutboxEventStatus.DELIVERING)
        self.assertEqual(lease.owner_id, "worker-1")
        self.assertEqual(lease.resource_id, "outbox:outbox-claim-001")

        # Verify FOR UPDATE SKIP LOCKED in the claim SQL
        claim_sql = cur.executed[0][0].upper()
        self.assertIn("FOR UPDATE", claim_sql)
        self.assertIn("SKIP LOCKED", claim_sql)

    def test_claim_pending_outbox_events_returns_empty_when_none_available(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([])  # UPDATE CTE returns no rows

        results = repo.claim_pending_outbox_events(
            batch_size=5,
            owner_id="worker-1",
            policy=LeasePolicy(),
        )

        self.assertEqual(results, [])

    # ------------------------------------------------------------------
    # 6. ack_outbox_event — state transition
    # ------------------------------------------------------------------

    def test_ack_outbox_event_marks_delivered_and_returns_true(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        # UPDATE workflow_outbox RETURNING outbox_id (success)
        cur.queue_rows([{"outbox_id": "outbox-ack-001"}])
        # UPDATE workflow_lease SET status='released' → no fetch

        result = repo.ack_outbox_event("outbox-ack-001", lease=self._make_outbox_lease("outbox-ack-001"))

        self.assertTrue(result)
        # Verify the UPDATE used 'delivered' and lease fencing
        update_sql = cur.executed[0][0].upper()
        self.assertIn("DELIVERED", update_sql)
        self.assertIn("DELIVERING", update_sql)
        self.assertIn("EXISTS", update_sql)
        self.assertIn("WL.LEASE_KEY  = ('OUTBOX:' || WORKFLOW_OUTBOX.OUTBOX_ID)", update_sql)
        self.assertIn("WL.PROJECT_ID = %S", update_sql)

    def test_ack_outbox_event_rejects_lease_for_different_outbox(self) -> None:
        repo = self._make_repo()

        result = repo.ack_outbox_event("outbox-ack-001", lease=self._make_outbox_lease("outbox-other"))

        self.assertFalse(result)
        self.assertEqual(self._conn.cur.executed, [])

    def test_ack_outbox_event_returns_false_when_not_delivering(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([])  # UPDATE returns nothing (not in delivering state or lease mismatch)

        result = repo.ack_outbox_event("outbox-ack-miss", lease=self._make_outbox_lease("outbox-ack-miss"))

        self.assertFalse(result)

    # ------------------------------------------------------------------
    # 7. nack_outbox_event — state transition and next_attempt_at
    # ------------------------------------------------------------------

    def test_nack_outbox_event_marks_failed_and_returns_true(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        # 1) SELECT attempt_count
        cur.queue_rows([{"attempt_count": 1}])
        # 2) UPDATE workflow_outbox RETURNING outbox_id (success)
        cur.queue_rows([{"outbox_id": "outbox-nack-001"}])
        # 3) UPDATE workflow_lease SET status='released' → no fetch

        result = repo.nack_outbox_event("outbox-nack-001", lease=self._make_outbox_lease("outbox-nack-001"))

        self.assertTrue(result)
        # Verify the UPDATE set 'failed' and next_attempt_at
        update_sql, params = cur.executed[1]
        update_sql = update_sql.upper()
        self.assertEqual(params[0], "failed")
        self.assertIn("NEXT_ATTEMPT_AT", update_sql)
        self.assertIn("DELIVERING", update_sql)
        self.assertIn("WL.LEASE_KEY  = ('OUTBOX:' || WORKFLOW_OUTBOX.OUTBOX_ID)", update_sql)
        self.assertIn("WL.PROJECT_ID = %S", update_sql)

    def test_nack_outbox_event_schedules_next_attempt_using_backoff(self) -> None:
        """next_attempt_at in the params must be a future datetime (backoff applied)."""
        repo = self._make_repo()
        cur = self._conn.cur

        now = utc_now()
        cur.queue_rows([{"attempt_count": 2}])
        cur.queue_rows([{"outbox_id": "outbox-nack-bt"}])

        result = repo.nack_outbox_event("outbox-nack-bt", lease=self._make_outbox_lease("outbox-nack-bt"))

        self.assertTrue(result)
        # The second execute is the UPDATE with next_attempt_at in params
        _, params = cur.executed[1]
        # next_attempt_at is the first param (timestamp for next delivery)
        next_at = params[1] if isinstance(params, (list, tuple)) else None
        self.assertIsNotNone(next_at)
        self.assertIsInstance(next_at, datetime)
        self.assertGreater(next_at, now)

    def test_nack_outbox_event_dead_letters_after_max_attempts(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([{"attempt_count": 10}])
        cur.queue_rows([{"outbox_id": "outbox-dead-letter"}])

        result = repo.nack_outbox_event("outbox-dead-letter", lease=self._make_outbox_lease("outbox-dead-letter"))

        self.assertTrue(result)
        _, params = cur.executed[1]
        self.assertEqual(params[0], "dead_lettered")
        self.assertIsNone(params[1])

    def test_nack_outbox_event_rejects_lease_for_different_outbox(self) -> None:
        repo = self._make_repo()

        result = repo.nack_outbox_event("outbox-nack-001", lease=self._make_outbox_lease("outbox-other"))

        self.assertFalse(result)
        self.assertEqual(self._conn.cur.executed, [])

    def test_nack_outbox_event_returns_false_when_not_delivering(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([])  # SELECT attempt_count returns nothing

        result = repo.nack_outbox_event("outbox-nack-miss", lease=self._make_outbox_lease("outbox-nack-miss"))

        self.assertFalse(result)


class OutboxWorkerTest(unittest.TestCase):
    def _make_event(self, *, attempt_count: int = 1, destination_kind: str = "trace") -> WorkflowOutboxEvent:
        from devgateway_agent_runtime.outbox import outbox_idempotency_key

        source = "fixture-ref:event:worker-001"
        return WorkflowOutboxEvent(
            outbox_id="outbox-worker-001",
            workflow_id="wf_worker",
            source_event_ref=source,
            destination_kind=destination_kind,
            idempotency_key=outbox_idempotency_key(destination_kind, source),
            attempt_count=attempt_count,
        )

    def _make_lease(self, outbox_id: str = "outbox-worker-001") -> Lease:
        from devgateway_agent_runtime.leases import Lease

        return Lease(
            lease_id=f"lease-{outbox_id}",
            resource_id=f"outbox:{outbox_id}",
            owner_id="worker",
            fencing_token=1,
            expires_at=utc_now() + timedelta(seconds=30),
        )

    def test_worker_acks_successful_delivery(self) -> None:
        from devgateway_agent_runtime.outbox_worker import OutboxWorker, OutboxWorkerPolicy

        repo = _FakeOutboxWorkerRepository([(self._make_event(), self._make_lease())])
        delivered: list[str] = []
        worker = OutboxWorker(
            repo,
            consumers={"trace": lambda event: delivered.append(event.outbox_id)},
            policy=OutboxWorkerPolicy(owner_id="worker", batch_size=1),
        )

        stats = worker.run_once()

        self.assertEqual(delivered, ["outbox-worker-001"])
        self.assertEqual(repo.acked, ["outbox-worker-001"])
        self.assertEqual(stats.delivered, 1)

    def test_worker_nacks_failure_and_reports_dead_letter_exhaustion(self) -> None:
        from devgateway_agent_runtime.outbox import DEFAULT_OUTBOX_RETRY_POLICY
        from devgateway_agent_runtime.outbox_worker import OutboxWorker, OutboxWorkerPolicy

        event = self._make_event(attempt_count=DEFAULT_OUTBOX_RETRY_POLICY.max_attempts)
        repo = _FakeOutboxWorkerRepository([(event, self._make_lease())])

        def fail(_event: WorkflowOutboxEvent) -> None:
            raise RuntimeError("fixture-ref:failure")

        worker = OutboxWorker(
            repo,
            consumers={"trace": fail},
            policy=OutboxWorkerPolicy(owner_id="worker", batch_size=1),
        )

        stats = worker.run_once()

        self.assertEqual(repo.nacked, ["outbox-worker-001"])
        self.assertEqual(stats.dead_lettered, 1)

    def test_worker_exposes_backlog_summary(self) -> None:
        from devgateway_agent_runtime.outbox_worker import OutboxWorker, OutboxWorkerPolicy

        repo = _FakeOutboxWorkerRepository([])
        worker = OutboxWorker(repo, policy=OutboxWorkerPolicy(owner_id="worker"))

        self.assertEqual(worker.backlog_summary()["total"], 0)


class _FakeOutboxWorkerRepository:
    def __init__(self, claimed: list[tuple[WorkflowOutboxEvent, Lease]]) -> None:
        self.claimed = claimed
        self.acked: list[str] = []
        self.nacked: list[str] = []

    def append_outbox_event(self, event: WorkflowOutboxEvent) -> WorkflowOutboxEvent:
        return event

    def claim_pending_outbox_events(self, **_kwargs: object) -> list[tuple[WorkflowOutboxEvent, Lease]]:
        return self.claimed

    def ack_outbox_event(self, outbox_id: str, *, lease: Lease) -> bool:
        del lease
        self.acked.append(outbox_id)
        return True

    def nack_outbox_event(self, outbox_id: str, *, lease: Lease) -> bool:
        del lease
        self.nacked.append(outbox_id)
        return True

    def outbox_backlog_summary(self, **_kwargs: object) -> dict[str, object]:
        return {"total": 0, "due": 0, "by_state": {}, "by_destination": {}, "oldest_enqueued_at": None}


# ---------------------------------------------------------------------------
# Phase 3.8: Artifact lifecycle runtime primitives tests
# ---------------------------------------------------------------------------


class ArtifactLifecyclePrimitivesTest(unittest.TestCase):
    """Tests for pure artifact lifecycle helpers (no DB required)."""

    # ------------------------------------------------------------------
    # 1. Stage classification sets
    # ------------------------------------------------------------------

    def test_terminal_stages_contain_deleted_and_redacted(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import ARTIFACT_LIFECYCLE_TERMINAL_STAGES
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        self.assertIn(ArtifactLifecycleStage.DELETED, ARTIFACT_LIFECYCLE_TERMINAL_STAGES)
        self.assertIn(ArtifactLifecycleStage.REDACTED, ARTIFACT_LIFECYCLE_TERMINAL_STAGES)

    def test_active_stages_do_not_overlap_with_terminal(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import (
            ARTIFACT_LIFECYCLE_ACTIVE_STAGES,
            ARTIFACT_LIFECYCLE_TERMINAL_STAGES,
        )

        self.assertEqual(
            ARTIFACT_LIFECYCLE_ACTIVE_STAGES & ARTIFACT_LIFECYCLE_TERMINAL_STAGES,
            frozenset(),
        )

    def test_active_and_terminal_cover_all_stages(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import (
            ARTIFACT_LIFECYCLE_ACTIVE_STAGES,
            ARTIFACT_LIFECYCLE_TERMINAL_STAGES,
        )
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        all_stages = frozenset(ArtifactLifecycleStage)
        self.assertEqual(
            ARTIFACT_LIFECYCLE_ACTIVE_STAGES | ARTIFACT_LIFECYCLE_TERMINAL_STAGES,
            all_stages,
        )

    def test_is_lifecycle_terminal_returns_true_for_terminal_stages(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import is_lifecycle_terminal
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        self.assertTrue(is_lifecycle_terminal(ArtifactLifecycleStage.DELETED))
        self.assertTrue(is_lifecycle_terminal(ArtifactLifecycleStage.REDACTED))

    def test_is_lifecycle_active_returns_true_for_active_stages(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import is_lifecycle_active
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        self.assertTrue(is_lifecycle_active(ArtifactLifecycleStage.CREATED))
        self.assertTrue(is_lifecycle_active(ArtifactLifecycleStage.VERIFIED))
        self.assertTrue(is_lifecycle_active(ArtifactLifecycleStage.LEGAL_HOLD_APPLIED))
        self.assertFalse(is_lifecycle_active(ArtifactLifecycleStage.DELETED))

    # ------------------------------------------------------------------
    # 2. Legal hold deletion guard
    # ------------------------------------------------------------------

    def test_guard_legal_hold_deletion_raises_for_deletion_scheduled_with_hold(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import (
            LegalHoldViolation,
            guard_legal_hold_deletion,
        )
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        with self.assertRaises(LegalHoldViolation):
            guard_legal_hold_deletion(ArtifactLifecycleStage.DELETION_SCHEDULED, legal_hold=True)

    def test_guard_legal_hold_deletion_raises_for_deleted_with_hold(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import (
            LegalHoldViolation,
            guard_legal_hold_deletion,
        )
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        with self.assertRaises(LegalHoldViolation):
            guard_legal_hold_deletion(ArtifactLifecycleStage.DELETED, legal_hold=True)

    def test_guard_legal_hold_deletion_allows_deletion_without_hold(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import guard_legal_hold_deletion
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        # Should not raise
        guard_legal_hold_deletion(ArtifactLifecycleStage.DELETED, legal_hold=False)
        guard_legal_hold_deletion(ArtifactLifecycleStage.DELETION_SCHEDULED, legal_hold=False)

    def test_guard_legal_hold_deletion_allows_non_deletion_stages_with_hold(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import guard_legal_hold_deletion
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        # Non-deletion stages must not be blocked even with a legal hold
        for stage in (
            ArtifactLifecycleStage.VERIFIED,
            ArtifactLifecycleStage.LEGAL_HOLD_APPLIED,
            ArtifactLifecycleStage.LEGAL_HOLD_RELEASED,
            ArtifactLifecycleStage.REDACTED,
        ):
            with self.subTest(stage=stage):
                guard_legal_hold_deletion(stage, legal_hold=True)  # must not raise

    # ------------------------------------------------------------------
    # 3. Signed access eligibility guard
    # ------------------------------------------------------------------

    def test_guard_signed_access_raises_when_not_eligible(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import (
            SignedAccessViolation,
            guard_signed_access,
        )
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        with self.assertRaises(SignedAccessViolation):
            guard_signed_access(
                ArtifactLifecycleStage.SIGNED_ACCESS_GRANTED,
                signed_access_eligibility=False,
                requires_approval=True,
            )

    def test_guard_signed_access_raises_when_requires_approval_false(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import (
            SignedAccessViolation,
            guard_signed_access,
        )
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        with self.assertRaises(SignedAccessViolation):
            guard_signed_access(
                ArtifactLifecycleStage.SIGNED_ACCESS_GRANTED,
                signed_access_eligibility=True,
                requires_approval=False,
            )

    def test_guard_signed_access_passes_when_eligible_and_approval_required(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import guard_signed_access
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        # Must not raise
        guard_signed_access(
            ArtifactLifecycleStage.SIGNED_ACCESS_GRANTED,
            signed_access_eligibility=True,
            requires_approval=True,
        )

    def test_guard_signed_access_ignores_non_signed_access_stages(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import guard_signed_access
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        # For all non-SIGNED_ACCESS_GRANTED stages, guard must not raise
        for stage in (
            ArtifactLifecycleStage.CREATED,
            ArtifactLifecycleStage.VERIFIED,
            ArtifactLifecycleStage.DELETED,
            ArtifactLifecycleStage.SIGNED_ACCESS_REVOKED,
        ):
            with self.subTest(stage=stage):
                guard_signed_access(
                    stage,
                    signed_access_eligibility=False,
                    requires_approval=False,
                )  # must not raise

    # ------------------------------------------------------------------
    # 4. Checksum verifier
    # ------------------------------------------------------------------

    def test_verify_checksum_sha256_passes_for_matching_hex_strings(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import verify_checksum_sha256

        digest = "a" * 64  # valid-looking sha256 hex
        verify_checksum_sha256(digest, digest)  # must not raise

    def test_verify_checksum_sha256_passes_with_case_normalisation(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import verify_checksum_sha256

        lower = "ab" * 32
        upper = "AB" * 32
        verify_checksum_sha256(lower, upper)  # normalised comparison

    def test_verify_checksum_sha256_raises_for_mismatch(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import (
            ChecksumMismatch,
            verify_checksum_sha256,
        )

        with self.assertRaises(ChecksumMismatch):
            verify_checksum_sha256("a" * 64, "b" * 64)

    def test_verify_checksum_sha256_does_not_inspect_file_content(self) -> None:
        """Verifier is pure string comparison — must never open files or network."""
        import builtins as _builtins

        from devgateway_agent_runtime.artifact_lifecycle import verify_checksum_sha256

        original_open = _builtins.open

        def guarded_open(*args: object, **kwargs: object) -> object:
            raise AssertionError("checksum verifier must not open any file")

        _builtins.open = guarded_open  # type: ignore[assignment]
        try:
            verify_checksum_sha256("a" * 64, "a" * 64)
        finally:
            _builtins.open = original_open

    # ------------------------------------------------------------------
    # 5. ArtifactLifecycleEvent: aligned vocabulary fields in to_dict()
    # ------------------------------------------------------------------

    def test_artifact_lifecycle_event_aligned_fields_round_trip(self) -> None:
        from devgateway_agent_runtime.contracts import ArtifactLifecycleEvent, ArtifactLifecycleStage
        from devgateway_agent_runtime.contracts import utc_now

        now = utc_now()
        event = ArtifactLifecycleEvent(
            lifecycle_id="lc-align-001",
            artifact_ref="fixture-ref:artifact:align-001",
            workflow_id="wf_align",
            stage=ArtifactLifecycleStage.VERIFIED,
            occurred_at=now,
            task_id="fixture-ref:task:align-001",
            artifact_state="available",
            storage_ref="fixture-ref:storage:align-001",
            checksum_sha256="a" * 64,
            retention_policy="fixture-ref:policy:retention:90d",
            signed_access_eligibility=True,
            legal_hold=False,
            redacted=False,
            deletion_scheduled_at=None,
            audit_refs=("fixture-ref:audit:align-001",),
            idempotency="fixture-ref:idem:align-001",
        )
        d = event.to_dict()

        # Backward-compat field
        self.assertEqual(d["stage"], "verified")
        # Aligned vocabulary alias
        self.assertEqual(d["action"], "verified")
        self.assertEqual(d["task_id"], "fixture-ref:task:align-001")
        self.assertEqual(d["artifact_state"], "available")
        self.assertEqual(d["storage_ref"], "fixture-ref:storage:align-001")
        self.assertEqual(d["checksum_sha256"], "a" * 64)
        self.assertEqual(d["retention_policy"], "fixture-ref:policy:retention:90d")
        self.assertTrue(d["signed_access_eligibility"])
        self.assertFalse(d["legal_hold"])
        self.assertFalse(d["redacted"])
        self.assertIsNone(d["deletion_scheduled_at"])
        self.assertEqual(d["audit_refs"], ["fixture-ref:audit:align-001"])
        self.assertEqual(d["idempotency"], "fixture-ref:idem:align-001")

    def test_artifact_lifecycle_event_module_imports_do_not_require_live_deps(self) -> None:
        blocked = {"psycopg", "psycopg2", "asyncpg", "boto3", "httpx", "openai", "sqlalchemy"}
        original_import = builtins.__import__

        def guarded(name: str, *args: object, **kwargs: object) -> object:
            if name.partition(".")[0] in blocked:
                raise AssertionError(f"artifact_lifecycle module triggered live import: {name}")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", guarded):
            import importlib
            import devgateway_agent_runtime.artifact_lifecycle as art_mod

            importlib.reload(art_mod)

    def test_store_artifact_body_writes_object_storage_and_returns_metadata_only(self) -> None:
        from devgateway_agent_runtime.artifacts import store_artifact_body
        from devgateway_agent_runtime.object_storage import InMemoryObjectStorage

        storage = InMemoryObjectStorage()
        metadata = store_artifact_body(
            storage,
            project_id="project-1",
            artifact_id="artifact-1",
            body=b"x" * 2048,
            media_type="application/octet-stream",
            retention_policy_ref="retention:30d",
            sensitivity_label="confidential",
            acl_scopes=("project-1", "principal-1"),
        )

        self.assertEqual(metadata.size_bytes, 2048)
        self.assertEqual(metadata.media_type, "application/octet-stream")
        self.assertFalse(hasattr(metadata, "body"))
        self.assertFalse(hasattr(metadata, "object_body"))
        storage.head_object(metadata.object_ref)

    def test_artifact_object_key_rejects_path_traversal_segments(self) -> None:
        from devgateway_agent_runtime.artifacts import artifact_object_key

        for unsafe in (".", "..", " . ", " .. "):
            with self.subTest(unsafe=unsafe):
                with self.assertRaises(ValueError):
                    artifact_object_key("project-1", unsafe)
                with self.assertRaises(ValueError):
                    artifact_object_key(unsafe, "artifact-1")

    def test_verify_object_checksum_sha256_uses_metadata_before_signed_access(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import verify_object_checksum_sha256
        from devgateway_agent_runtime.artifacts import store_artifact_body
        from devgateway_agent_runtime.object_storage import InMemoryObjectStorage

        storage = InMemoryObjectStorage()
        metadata = store_artifact_body(
            storage,
            project_id="project-1",
            artifact_id="artifact-hash",
            body=b"hash me",
            media_type="text/plain",
            retention_policy_ref="retention:30d",
            sensitivity_label="internal",
            acl_scopes=("project-1",),
        )

        verify_object_checksum_sha256(storage, metadata.object_ref, metadata.sha256_hex)
        with self.assertRaises(Exception):
            verify_object_checksum_sha256(storage, metadata.object_ref, "0" * 64)

    def test_guard_artifact_displayable_blocks_expired_deleted_and_redacted(self) -> None:
        from datetime import timedelta

        from devgateway_agent_runtime.artifact_lifecycle import (
            SignedAccessViolation,
            guard_artifact_displayable,
        )
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage, utc_now

        now = utc_now()
        with self.assertRaises(SignedAccessViolation):
            guard_artifact_displayable(stage=ArtifactLifecycleStage.DELETED, now=now)
        with self.assertRaises(SignedAccessViolation):
            guard_artifact_displayable(stage=ArtifactLifecycleStage.VERIFIED, redacted=True, now=now)
        with self.assertRaises(SignedAccessViolation):
            guard_artifact_displayable(
                stage=ArtifactLifecycleStage.VERIFIED,
                expires_at=now - timedelta(seconds=1),
                now=now,
            )

    def test_reconcile_artifact_objects_detects_orphans_and_missing_objects(self) -> None:
        from devgateway_agent_runtime.artifacts import (
            PersistedArtifactMetadata,
            artifact_object_key,
            reconcile_artifact_objects,
            store_artifact_body,
        )
        from devgateway_agent_runtime.object_storage import InMemoryObjectStorage, ObjectRef

        storage = InMemoryObjectStorage()
        stored = store_artifact_body(
            storage,
            project_id="project-1",
            artifact_id="artifact-orphan",
            body=b"orphan",
            media_type="text/plain",
            retention_policy_ref="retention:30d",
            sensitivity_label="internal",
            acl_scopes=("project-1",),
        )
        missing = PersistedArtifactMetadata(
            artifact_id="artifact-missing",
            object_ref=ObjectRef(
                bucket=stored.object_ref.bucket,
                key=artifact_object_key("project-1", "artifact-missing"),
                provider=stored.object_ref.provider,
            ),
            sha256_hex="1" * 64,
        )

        actions = reconcile_artifact_objects(
            storage,
            (missing,),
            object_prefix="projects/project-1/artifacts/",
        )

        self.assertEqual(
            {action.kind for action in actions},
            {"object_without_db_metadata", "db_metadata_without_object"},
        )


# ---------------------------------------------------------------------------
# Phase 3.8: Artifact lifecycle Postgres repository tests (fake cursor)
# ---------------------------------------------------------------------------


class ArtifactLifecycleRepositoryTest(unittest.TestCase):
    """Targeted tests for PostgresRuntimeRepository artifact lifecycle methods.

    Uses _FakeCursor/_FakeConnection — no real Postgres or object storage required.
    """

    def _make_repo(self) -> "PostgresRuntimeRepository":  # type: ignore[name-defined]
        from devgateway_agent_runtime.postgres_repository import (
            PostgresRuntimeRepository,
            RepositoryScope,
        )

        self._conn = _FakeConnection()
        scope = RepositoryScope(project_id=1, principal_id=2, budget_scope_id=3)
        return PostgresRuntimeRepository(self._conn, scope)

    def _make_event(
        self,
        *,
        stage: "ArtifactLifecycleStage" = None,  # type: ignore[assignment]
        legal_hold: bool = False,
        signed_access_eligibility: bool = False,
        artifact_ref: str = "fixture-ref:artifact:lifecycle-001",
    ) -> "ArtifactLifecycleEvent":
        from devgateway_agent_runtime.contracts import ArtifactLifecycleEvent, ArtifactLifecycleStage

        return ArtifactLifecycleEvent(
            lifecycle_id="lc-pg-001",
            artifact_ref=artifact_ref,
            workflow_id="wf_lc_pg",
            stage=stage or ArtifactLifecycleStage.VERIFIED,
            legal_hold=legal_hold,
            signed_access_eligibility=signed_access_eligibility,
        )

    # ------------------------------------------------------------------
    # append_artifact_lifecycle_event
    # ------------------------------------------------------------------

    def test_append_artifact_lifecycle_event_inserts_row(self) -> None:
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        repo = self._make_repo()
        cur = self._conn.cur

        # Queue: 1) lookup artifact PK, 2) latest lifecycle row, 3) INSERT RETURNING
        cur.queue_rows([{"id": 99}])
        cur.queue_rows([])
        cur.queue_rows([{"artifact_lifecycle_event_id": "lc-pg-001"}])

        event = self._make_event(stage=ArtifactLifecycleStage.VERIFIED)
        result = repo.append_artifact_lifecycle_event(event)

        self.assertEqual(result.lifecycle_id, "lc-pg-001")
        self.assertEqual(result.stage, ArtifactLifecycleStage.VERIFIED)

        # Verify an INSERT SQL was executed with action = 'verified'
        insert_sql = next(
            sql for sql, _ in cur.executed if "INSERT INTO artifact_lifecycle_event" in sql
        )
        self.assertIn("INSERT INTO artifact_lifecycle_event", insert_sql)

        insert_params = next(
            params for sql, params in cur.executed if "INSERT INTO artifact_lifecycle_event" in sql
        )
        self.assertIn("verified", insert_params)
        self.assertNotIn("signed_url", str(insert_params))  # never emit signed URLs

    def test_append_blocks_deletion_when_legal_hold_active(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import LegalHoldViolation
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        repo = self._make_repo()

        for stage in (ArtifactLifecycleStage.DELETION_SCHEDULED, ArtifactLifecycleStage.DELETED):
            with self.subTest(stage=stage):
                event = self._make_event(stage=stage, legal_hold=True)
                with self.assertRaises(LegalHoldViolation):
                    repo.append_artifact_lifecycle_event(event)

    def test_append_blocks_deletion_when_prior_legal_hold_remains_active(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import LegalHoldViolation
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        repo = self._make_repo()
        cur = self._conn.cur
        cur.queue_rows([{"id": 11}])
        cur.queue_rows([
            {
                "action": "legal_hold_applied",
                "state": "legal_hold",
                "legal_hold_ref": "runtime-ref:legal-hold:active",
                "redaction_ref": None,
            },
            {
                "action": "verified",
                "state": "verified",
                "legal_hold_ref": None,
                "redaction_ref": None,
            },
        ])

        event = self._make_event(stage=ArtifactLifecycleStage.DELETED, legal_hold=False)

        with self.assertRaises(LegalHoldViolation):
            repo.append_artifact_lifecycle_event(event)

    def test_append_rejects_all_events_after_terminal_lifecycle(self) -> None:
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage
        from devgateway_agent_runtime.memory import RepositoryError

        repo = self._make_repo()
        cur = self._conn.cur
        cur.queue_rows([{"id": 12}])
        cur.queue_rows([
            {
                "action": "deleted",
                "state": "deleted",
                "legal_hold_ref": None,
                "redaction_ref": None,
            }
        ])

        event = self._make_event(stage=ArtifactLifecycleStage.LEGAL_HOLD_RELEASED)

        with self.assertRaises(RepositoryError):
            repo.append_artifact_lifecycle_event(event)

    def test_append_blocks_signed_access_when_not_eligible(self) -> None:
        from devgateway_agent_runtime.artifact_lifecycle import SignedAccessViolation
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        repo = self._make_repo()

        event = self._make_event(
            stage=ArtifactLifecycleStage.SIGNED_ACCESS_GRANTED,
            signed_access_eligibility=False,
        )
        with self.assertRaises(SignedAccessViolation):
            repo.append_artifact_lifecycle_event(event)

    def test_append_raises_when_artifact_not_found(self) -> None:
        from devgateway_agent_runtime.memory import RepositoryError
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([])  # artifact lookup returns nothing

        event = self._make_event(stage=ArtifactLifecycleStage.VERIFIED)
        with self.assertRaises(RepositoryError):
            repo.append_artifact_lifecycle_event(event)

    def test_append_includes_checksum_algorithm_when_checksum_set(self) -> None:
        from devgateway_agent_runtime.contracts import ArtifactLifecycleEvent, ArtifactLifecycleStage

        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([{"id": 5}])
        cur.queue_rows([])
        cur.queue_rows([{"artifact_lifecycle_event_id": "lc-chk-001"}])

        event = ArtifactLifecycleEvent(
            lifecycle_id="lc-chk-001",
            artifact_ref="fixture-ref:artifact:chk",
            workflow_id="wf_chk",
            stage=ArtifactLifecycleStage.VERIFIED,
            checksum_sha256="a" * 64,
        )
        repo.append_artifact_lifecycle_event(event)

        insert_params = next(
            params for sql, params in cur.executed if "INSERT INTO artifact_lifecycle_event" in sql
        )
        # content_hash should be the sha256 value; hash_algorithm should be 'sha256'
        self.assertIn("a" * 64, insert_params)
        self.assertIn("sha256", insert_params)

    def test_append_does_not_write_text_audit_ref_to_bigint_fk(self) -> None:
        from devgateway_agent_runtime.contracts import ArtifactLifecycleEvent, ArtifactLifecycleStage

        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([{"id": 7}])
        cur.queue_rows([])
        cur.queue_rows([{"artifact_lifecycle_event_id": "lc-audit-ref"}])

        event = ArtifactLifecycleEvent(
            lifecycle_id="lc-audit-ref",
            artifact_ref="fixture-ref:artifact:audit",
            workflow_id="wf_audit",
            stage=ArtifactLifecycleStage.VERIFIED,
            audit_refs=("fixture-ref:audit:text-ref",),
        )
        repo.append_artifact_lifecycle_event(event)

        insert_params = next(
            params for sql, params in cur.executed if "INSERT INTO artifact_lifecycle_event" in sql
        )
        self.assertNotIn("fixture-ref:audit:text-ref", insert_params)

    def test_append_omits_hash_algorithm_when_no_checksum(self) -> None:
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage

        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([{"id": 6}])
        cur.queue_rows([])
        cur.queue_rows([{"artifact_lifecycle_event_id": "lc-no-chk"}])

        event = self._make_event(stage=ArtifactLifecycleStage.CREATED)
        repo.append_artifact_lifecycle_event(event)

        insert_params = next(
            params for sql, params in cur.executed if "INSERT INTO artifact_lifecycle_event" in sql
        )
        self.assertIn(None, insert_params)  # hash_algorithm is NULL

    # ------------------------------------------------------------------
    # list_artifact_lifecycle_events
    # ------------------------------------------------------------------

    def test_list_artifact_lifecycle_events_returns_empty_tuple_when_no_rows(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([])  # fetchall returns empty

        result = repo.list_artifact_lifecycle_events("fixture-ref:artifact:empty")

        self.assertEqual(result, ())

    def test_list_artifact_lifecycle_events_maps_rows_to_dataclasses(self) -> None:
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage
        from devgateway_agent_runtime.contracts import utc_now

        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        rows = [
            {
                "artifact_lifecycle_event_id": "lc-list-001",
                "task_artifact_id_text": "fixture-ref:artifact:list-001",
                "action": "created",
                "state": "available",
                "storage_ref": "fixture-ref:storage:list-001",
                "content_hash": None,
                "retention_policy_ref": None,
                "signed_access_eligible": False,
                "signed_access_requires_approval": True,
                "legal_hold_ref": None,
                "redaction_ref": None,
                "expires_at": None,
                "audit_event_id": "fixture-ref:audit:list-001",
                "idempotency_key": "idem-list-001",
                "trace_id": "wf_list_trace",
                "created_at": now,
            },
            {
                "artifact_lifecycle_event_id": "lc-list-002",
                "task_artifact_id_text": "fixture-ref:artifact:list-001",
                "action": "verified",
                "state": "verified",
                "storage_ref": "fixture-ref:storage:list-001",
                "content_hash": "b" * 64,
                "retention_policy_ref": "fixture-ref:policy:retention",
                "signed_access_eligible": False,
                "signed_access_requires_approval": True,
                "legal_hold_ref": None,
                "redaction_ref": None,
                "expires_at": None,
                "audit_event_id": None,
                "idempotency_key": None,
                "trace_id": "wf_list_trace",
                "created_at": now,
            },
        ]
        cur.queue_rows(rows)

        result = repo.list_artifact_lifecycle_events("fixture-ref:artifact:list-001")

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].stage, ArtifactLifecycleStage.CREATED)
        self.assertEqual(result[0].artifact_ref, "fixture-ref:artifact:list-001")
        self.assertEqual(result[0].audit_refs, ("fixture-ref:audit:list-001",))
        self.assertEqual(result[0].idempotency, "idem-list-001")
        self.assertEqual(result[1].stage, ArtifactLifecycleStage.VERIFIED)
        self.assertEqual(result[1].checksum_sha256, "b" * 64)
        self.assertEqual(result[1].retention_policy, "fixture-ref:policy:retention")
        self.assertFalse(result[1].legal_hold)
        self.assertFalse(result[1].redacted)

    def test_list_sql_orders_by_created_at(self) -> None:
        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([])

        repo.list_artifact_lifecycle_events("fixture-ref:artifact:order-test")

        list_sql = cur.executed[0][0].upper()
        self.assertIn("ORDER BY", list_sql)
        self.assertIn("CREATED_AT", list_sql)

    def test_list_sql_never_selects_signed_url_column(self) -> None:
        """List query must never select a signed URL column."""
        repo = self._make_repo()
        cur = self._conn.cur

        cur.queue_rows([])

        repo.list_artifact_lifecycle_events("fixture-ref:artifact:url-guard")

        list_sql = cur.executed[0][0].lower()
        self.assertNotIn("signed_url", list_sql)
        self.assertNotIn("presigned", list_sql)

    def test_list_maps_legal_hold_ref_to_bool(self) -> None:
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage
        from devgateway_agent_runtime.contracts import utc_now

        repo = self._make_repo()
        cur = self._conn.cur
        now = utc_now()

        cur.queue_rows(
            [
                {
                    "artifact_lifecycle_event_id": "lc-hold-001",
                    "task_artifact_id_text": "fixture-ref:artifact:hold-001",
                    "action": "legal_hold_applied",
                    "state": "on_legal_hold",
                    "storage_ref": None,
                    "content_hash": None,
                    "retention_policy_ref": None,
                    "signed_access_eligible": False,
                    "signed_access_requires_approval": True,
                    "legal_hold_ref": "fixture-ref:legal-hold:hold-001",  # ref is present
                    "redaction_ref": None,
                    "expires_at": None,
                    "audit_event_id": None,
                    "idempotency_key": None,
                    "trace_id": "wf_hold_trace",
                    "created_at": now,
                }
            ]
        )

        result = repo.list_artifact_lifecycle_events("fixture-ref:artifact:hold-001")

        self.assertEqual(len(result), 1)
        self.assertTrue(result[0].legal_hold)  # ref present → True
        self.assertEqual(result[0].stage, ArtifactLifecycleStage.LEGAL_HOLD_APPLIED)

    # ------------------------------------------------------------------
    # row_to_artifact_lifecycle_event pure mapper
    # ------------------------------------------------------------------

    def test_row_to_artifact_lifecycle_event_maps_all_columns(self) -> None:
        from devgateway_agent_runtime.postgres_repository import row_to_artifact_lifecycle_event
        from devgateway_agent_runtime.contracts import ArtifactLifecycleStage, utc_now

        now = utc_now()
        row = {
            "artifact_lifecycle_event_id": "lc-mapper-001",
            "task_artifact_id_text": "fixture-ref:artifact:mapper-001",
            "action": "verified",
            "state": "available",
            "storage_ref": "fixture-ref:storage:mapper-001",
            "content_hash": "c" * 64,
            "retention_policy_ref": "fixture-ref:policy:ret",
            "signed_access_eligible": True,
            "signed_access_requires_approval": True,
            "legal_hold_ref": None,
            "redaction_ref": None,
            "expires_at": None,
            "audit_event_id": "fixture-ref:audit:mapper-001",
            "idempotency_key": "idem-mapper-001",
            "trace_id": "wf_mapper_trace",
            "created_at": now,
        }

        event = row_to_artifact_lifecycle_event(row)

        self.assertEqual(event.lifecycle_id, "lc-mapper-001")
        self.assertEqual(event.artifact_ref, "fixture-ref:artifact:mapper-001")
        self.assertEqual(event.stage, ArtifactLifecycleStage.VERIFIED)
        self.assertEqual(event.artifact_state, "available")
        self.assertEqual(event.storage_ref, "fixture-ref:storage:mapper-001")
        self.assertEqual(event.checksum_sha256, "c" * 64)
        self.assertEqual(event.retention_policy, "fixture-ref:policy:ret")
        self.assertTrue(event.signed_access_eligibility)
        self.assertFalse(event.legal_hold)
        self.assertFalse(event.redacted)
        self.assertEqual(event.audit_refs, ("fixture-ref:audit:mapper-001",))
        self.assertEqual(event.idempotency, "idem-mapper-001")
        self.assertEqual(event.workflow_id, "wf_mapper_trace")


from devgateway_agent_runtime.templates import (  # noqa: E402
    PRODUCTION_ROLLOUT_STATE,
    TERMINAL_ROLLOUT_STATES,
    TemplateRef,
    TemplateVersionRef,
    WorkflowTemplateRolloutState,
    assert_version_immutable,
    is_production_rollout_state,
    is_rollout_dispatch_allowed,
    is_version_immutable,
    rollout_state_allows_production,
)


class WorkflowTemplateHelpersTest(unittest.TestCase):
    """Tests for pure workflow-template metadata helpers (templates.py)."""

    # ------------------------------------------------------------------
    # TemplateVersionRef immutability
    # ------------------------------------------------------------------

    def _make_version_ref(
        self,
        *,
        template_version_id: str = "tmplv_001",
        template_id: str = "tmpl_001",
        version: str = "v1",
        rollout_state: WorkflowTemplateRolloutState = WorkflowTemplateRolloutState.DRAFT,
        allowed_model_aliases: tuple[str, ...] = ("default-safe-model-alias",),
        allowed_tool_bundle_ids: tuple[str, ...] = ("tool-bundle-opaque-ref:safe-tools-v1",),
        approval_policy_refs: tuple[str, ...] = ("approval-policy-ref:standard-v1",),
    ) -> TemplateVersionRef:
        return TemplateVersionRef(
            template_version_id=template_version_id,
            template_id=template_id,
            version=version,
            rollout_state=rollout_state,
            allowed_model_aliases=allowed_model_aliases,
            allowed_tool_bundle_ids=allowed_tool_bundle_ids,
            approval_policy_refs=approval_policy_refs,
        )

    def test_version_ref_is_frozen_dataclass(self) -> None:
        """TemplateVersionRef must reject any mutation attempt."""
        version_ref = self._make_version_ref()
        with self.assertRaises((AttributeError, TypeError)):
            version_ref.version = "v2"  # type: ignore[misc]

    def test_is_version_immutable_always_true(self) -> None:
        """is_version_immutable always returns True for any TemplateVersionRef."""
        for state in WorkflowTemplateRolloutState:
            version_ref = self._make_version_ref(rollout_state=state)
            self.assertTrue(is_version_immutable(version_ref), f"Expected True for state {state}")

    def test_assert_version_immutable_does_not_raise(self) -> None:
        """assert_version_immutable must not raise for any valid TemplateVersionRef."""
        version_ref = self._make_version_ref()
        assert_version_immutable(version_ref)  # should not raise

    def test_template_ref_is_frozen_dataclass(self) -> None:
        """TemplateRef must reject any mutation attempt."""
        template_ref = TemplateRef(
            template_id="tmpl_001",
            rollout_state=WorkflowTemplateRolloutState.DRAFT,
            owner_project_ref="project_demo",
        )
        with self.assertRaises((AttributeError, TypeError)):
            template_ref.template_id = "tmpl_other"  # type: ignore[misc]

    # ------------------------------------------------------------------
    # Allowed model/tool/approval refs are opaque identifiers
    # ------------------------------------------------------------------

    def test_allowed_model_aliases_are_opaque_identifiers(self) -> None:
        """allowed_model_aliases must store opaque alias strings, not raw model weights."""
        version_ref = self._make_version_ref(
            allowed_model_aliases=("opaque-model-alias:safe-v1", "opaque-model-alias:safe-v2"),
        )
        for alias in version_ref.allowed_model_aliases:
            self.assertIsInstance(alias, str)
            # Must not contain raw model-weight paths or API keys
            self.assertNotIn("sk-", alias)
            self.assertNotIn("raw_model", alias)

    def test_allowed_tool_bundle_ids_are_opaque_identifiers(self) -> None:
        """allowed_tool_bundle_ids must store opaque bundle ref strings, not raw tool bodies."""
        version_ref = self._make_version_ref(
            allowed_tool_bundle_ids=("tool-bundle-opaque-ref:bundle-a-v1",),
        )
        for bundle_id in version_ref.allowed_tool_bundle_ids:
            self.assertIsInstance(bundle_id, str)
            self.assertNotIn("exec(", bundle_id)
            self.assertNotIn("subprocess", bundle_id)

    def test_approval_policy_refs_are_opaque_identifiers(self) -> None:
        """approval_policy_refs must store opaque policy ref strings."""
        version_ref = self._make_version_ref(
            approval_policy_refs=("approval-policy-ref:standard-v1", "approval-policy-ref:high-risk-v2"),
        )
        for policy_ref in version_ref.approval_policy_refs:
            self.assertIsInstance(policy_ref, str)

    # ------------------------------------------------------------------
    # Rollout state classification
    # ------------------------------------------------------------------

    def test_rollout_state_values_match_shared_vocabulary(self) -> None:
        """WorkflowTemplateRolloutState values must match the shared contract vocabulary."""
        expected = {"draft", "eval_ready", "approved", "limited_rollout", "production", "disabled"}
        actual = {state.value for state in WorkflowTemplateRolloutState}
        self.assertEqual(actual, expected)

    def test_production_rollout_state_constant(self) -> None:
        """PRODUCTION_ROLLOUT_STATE must be the production enum member."""
        self.assertIs(PRODUCTION_ROLLOUT_STATE, WorkflowTemplateRolloutState.PRODUCTION)

    def test_is_production_rollout_state(self) -> None:
        """Only the production state returns True from is_production_rollout_state."""
        self.assertTrue(is_production_rollout_state(WorkflowTemplateRolloutState.PRODUCTION))
        for state in WorkflowTemplateRolloutState:
            if state is not WorkflowTemplateRolloutState.PRODUCTION:
                self.assertFalse(is_production_rollout_state(state), f"Expected False for {state}")

    def test_is_rollout_dispatch_allowed(self) -> None:
        """Dispatch is allowed for eval_ready, approved, limited_rollout, production; denied for others."""
        allowed = {
            WorkflowTemplateRolloutState.EVAL_READY,
            WorkflowTemplateRolloutState.APPROVED,
            WorkflowTemplateRolloutState.LIMITED_ROLLOUT,
            WorkflowTemplateRolloutState.PRODUCTION,
        }
        for state in WorkflowTemplateRolloutState:
            expected = state in allowed
            result = is_rollout_dispatch_allowed(state)
            self.assertEqual(result, expected, f"Unexpected dispatch decision for {state}")

    def test_terminal_rollout_states(self) -> None:
        """TERMINAL_ROLLOUT_STATES must contain disabled."""
        self.assertIn(WorkflowTemplateRolloutState.DISABLED, TERMINAL_ROLLOUT_STATES)
        # draft and eval_ready are NOT terminal (they can advance)
        self.assertNotIn(WorkflowTemplateRolloutState.DRAFT, TERMINAL_ROLLOUT_STATES)
        self.assertNotIn(WorkflowTemplateRolloutState.EVAL_READY, TERMINAL_ROLLOUT_STATES)

    # ------------------------------------------------------------------
    # Production fail-closed
    # ------------------------------------------------------------------

    def test_production_disabled_by_default_for_non_production_states(self) -> None:
        """Production execution is disabled for all states except production."""
        non_production_states = [
            WorkflowTemplateRolloutState.DRAFT,
            WorkflowTemplateRolloutState.EVAL_READY,
            WorkflowTemplateRolloutState.APPROVED,
            WorkflowTemplateRolloutState.LIMITED_ROLLOUT,
            WorkflowTemplateRolloutState.DISABLED,
        ]
        for state in non_production_states:
            self.assertFalse(
                rollout_state_allows_production(state, production=True),
                f"Expected production=False for state {state}",
            )

    def test_production_allowed_only_for_production_state(self) -> None:
        """rollout_state_allows_production(production=True) is True only for production."""
        self.assertTrue(
            rollout_state_allows_production(WorkflowTemplateRolloutState.PRODUCTION, production=True)
        )

    def test_non_production_dispatch_allowed_for_eval_ready_and_above(self) -> None:
        """Non-production dispatch is allowed for eval_ready, approved, limited_rollout, and production."""
        for state in (
            WorkflowTemplateRolloutState.EVAL_READY,
            WorkflowTemplateRolloutState.APPROVED,
            WorkflowTemplateRolloutState.LIMITED_ROLLOUT,
            WorkflowTemplateRolloutState.PRODUCTION,
        ):
            self.assertTrue(
                rollout_state_allows_production(state, production=False),
                f"Expected non-production dispatch for {state}",
            )

    def test_non_production_dispatch_denied_for_draft_and_disabled_states(self) -> None:
        """Non-production dispatch is denied for draft and disabled."""
        for state in (
            WorkflowTemplateRolloutState.DRAFT,
            WorkflowTemplateRolloutState.DISABLED,
        ):
            self.assertFalse(
                rollout_state_allows_production(state, production=False),
                f"Expected denied for {state}",
            )

    # ------------------------------------------------------------------
    # __init__.py re-exports
    # ------------------------------------------------------------------

    def test_template_symbols_are_exported_from_package(self) -> None:
        """All new template symbols must be importable from the top-level package."""
        import devgateway_agent_runtime as pkg  # noqa: PLC0415

        for symbol in (
            "WorkflowTemplateRolloutState",
            "TemplateRef",
            "TemplateVersionRef",
            "PRODUCTION_ROLLOUT_STATE",
            "TERMINAL_ROLLOUT_STATES",
            "is_production_rollout_state",
            "is_rollout_dispatch_allowed",
            "is_version_immutable",
            "assert_version_immutable",
            "rollout_state_allows_production",
        ):
            self.assertTrue(hasattr(pkg, symbol), f"Missing export: {symbol}")


if __name__ == "__main__":
    unittest.main()
