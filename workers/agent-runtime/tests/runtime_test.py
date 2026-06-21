from __future__ import annotations

import builtins
import json
import os
import subprocess
import sys
import unittest
from dataclasses import replace
from datetime import timedelta
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
from devgateway_agent_runtime.idempotency import (  # noqa: E402
    IdempotencyRecord,
    IdempotencyScope,
    IdempotencyStatus,
    stable_idempotency_key,
)


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
        self.assertEqual(recovered_step.state, StepState.PENDING)  # type: ignore[union-attr]
        recovery_events = [
            event
            for event in repository.list_events(workflow.workflow_id)
            if event.event_type == "step.lease_stale_recovered"
        ]
        self.assertEqual(len(recovery_events), 1)
        self.assertEqual(recovery_events[0].step_id, step.step_id)

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

    def test_fixture_runner_completes_and_records_all_idempotency_scopes(self) -> None:
        payload = FixtureWorkflowRunner.default().run()
        self.assertTrue(payload["fixture_mode"])
        self.assertTrue(payload["no_live_external_calls"])
        self.assertEqual(payload["workflow"]["state"], "completed")  # type: ignore[index]
        self.assertEqual(payload["open_lease_count"], 0)
        scopes = set(payload["idempotency_scopes"])  # type: ignore[arg-type]
        self.assertEqual(scopes, {scope.value for scope in IdempotencyScope})
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


if __name__ == "__main__":
    unittest.main()
