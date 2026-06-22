from __future__ import annotations

import re
import sys
from datetime import timedelta
from pathlib import Path
from typing import Callable
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from devgateway_agent_runtime.contracts import (
    ApprovalDecision,
    ApprovalRequest,
    ApprovalRiskTier,
    ApprovalStatus,
    CancellationRecord,
    CancellationTarget,
    DelegationContract,
    FailureClass,
    ModelRequest,
    ModelResult,
    OutputSchemaContract,
    PrimitiveSchemaType,
    RetryPolicy,
    ScopeRefs,
    TraceContext,
    Workflow,
    WorkflowOutboxEvent,
    WorkflowState,
    WorkflowStep,
    StepKind,
    StepState,
    utc_now,
)
from devgateway_agent_runtime.approval_expiry_worker import ApprovalExpiryWorker, ApprovalExpiryWorkerPolicy
from devgateway_agent_runtime.approvals import stable_approval_resume_token
from devgateway_agent_runtime.budget_reaper import BudgetReaper, BudgetReaperPolicy
from devgateway_agent_runtime.cancellation_worker import CancellationWorker, CancellationWorkerPolicy
from devgateway_agent_runtime.dispatcher import BoundedDispatcher, DispatcherPolicy, StepExecutionResult
from devgateway_agent_runtime.executor import CancellationObserved, FixtureSubAgentExecutor
from devgateway_agent_runtime.idempotency import IdempotencyRecord, IdempotencyScope, stable_idempotency_key
from devgateway_agent_runtime.lease_sweeper import LeaseSweeper
from devgateway_agent_runtime.leases import LeasePolicy
from devgateway_agent_runtime.memory import RepositoryError
from devgateway_agent_runtime.outbox import DEFAULT_OUTBOX_RETRY_POLICY, OUTBOX_DESTINATION_KINDS, outbox_idempotency_key
from devgateway_agent_runtime.outbox_worker import OutboxWorker, OutboxWorkerPolicy


def _postgres_repository(conn: object, scope: object):
    from devgateway_agent_runtime.postgres_repository import PostgresRuntimeRepository

    return PostgresRuntimeRepository(conn, scope)


def _create_workflow(repository: object, workflow_ref: str) -> Workflow:
    workflow_id = f"wf_pg_{uuid4().hex[:16]}"
    idempotency_key = stable_idempotency_key(IdempotencyScope.WORKFLOW_CREATION, workflow_ref)
    repository.reserve_idempotency(
        IdempotencyRecord(
            scope=IdempotencyScope.WORKFLOW_CREATION,
            key=idempotency_key,
            workflow_id=workflow_id,
            request_ref=workflow_ref,
        )
    )
    repository.complete_idempotency(
        IdempotencyScope.WORKFLOW_CREATION,
        idempotency_key,
        result_ref=f"fixture-ref:workflow:{workflow_id}",
    )
    return repository.create_workflow(
        Workflow(
            workflow_id=workflow_id,
            state=WorkflowState.CREATED,
            idempotency_key=idempotency_key,
            trace_context=TraceContext.new(correlation_id=workflow_id, baggage_refs=(workflow_ref,)),
            workflow_ref=workflow_ref,
        )
    )


def _add_step(
    repository: object,
    workflow: Workflow,
    *,
    step_id: str,
    kind: StepKind = StepKind.PLANNING,
    created_offset_seconds: int = 0,
) -> WorkflowStep:
    step_ref = f"fixture-ref:step-input:{workflow.workflow_id}:{step_id}"
    idempotency_key = stable_idempotency_key(IdempotencyScope.STEP_EXECUTION, step_ref)
    created_at = utc_now() + timedelta(seconds=created_offset_seconds)
    repository.reserve_idempotency(
        IdempotencyRecord(
            scope=IdempotencyScope.STEP_EXECUTION,
            key=idempotency_key,
            workflow_id=workflow.workflow_id,
            step_id=step_id,
            request_ref=step_ref,
        )
    )
    return repository.add_step(
        WorkflowStep(
            step_id=step_id,
            workflow_id=workflow.workflow_id,
            kind=kind,
            state=StepState.PENDING,
            input_ref=step_ref,
            idempotency_key=idempotency_key,
            created_at=created_at,
            updated_at=created_at,
        ),
        trace_context=workflow.trace_context.child(),
    )


def _handler(repository: object, executed_step_ids: list[str]):
    def handle(step: WorkflowStep, trace_context: TraceContext) -> StepExecutionResult:
        executed_step_ids.append(step.step_id)
        output_ref = f"fixture-ref:step-output:{step.step_id}"
        repository.complete_idempotency(
            IdempotencyScope.STEP_EXECUTION,
            step.idempotency_key,
            result_ref=output_ref,
        )
        return StepExecutionResult(
            output_ref=output_ref,
            event_refs={"handler_ref": f"fixture-ref:postgres-handler:{step.step_id}"},
        )

    return handle


class _AbortAfterCancellationAdapter:
    def __init__(self, repository: object, workflow_id: str) -> None:
        self.repository = repository
        self.workflow_id = workflow_id
        self.abort_requests: list[str] = []

    def invoke(self, request: ModelRequest) -> ModelResult:
        self.repository.create_cancellation(
            CancellationRecord(
                cancellation_id=f"cancel_pg_abort_{uuid4().hex[:12]}",
                target=CancellationTarget.WORKFLOW,
                workflow_id=self.workflow_id,
                reason_ref=f"fixture-ref:cancellation:{self.workflow_id}:model",
                idempotency_key=f"cancel_pg_abort_key_{uuid4().hex[:12]}",
            )
        )
        return ModelResult(
            workflow_id=request.workflow_id,
            delegation_id=request.delegation_id,
            model_alias=request.model_alias,
            result_ref=f"fixture-ref:model-result:{request.workflow_id}:{request.delegation_id}",
            output_schema_ref=request.output_schema.schema_ref,
            structured_output={"summary": "cancelled", "confidence": 0.9},
            idempotency_key=stable_idempotency_key(IdempotencyScope.MODEL_CALL, request.request_ref),
            replayed=False,
            policy_version=request.policy_version,
            registry_version=request.registry_version,
            trace_context=request.trace_context.child(),
        )

    def abort(self, request_ref: str, *, reason_ref: str | None = None) -> str:
        self.abort_requests.append(request_ref)
        return f"aborted:{reason_ref or 'cancellation'}"


def _delegation_for_workflow(workflow: Workflow) -> tuple[DelegationContract, ScopeRefs]:
    schema = OutputSchemaContract(
        schema_ref=f"fixture-ref:output-schema:{workflow.workflow_id}",
        required_fields={"summary": PrimitiveSchemaType.STRING, "confidence": PrimitiveSchemaType.NUMBER},
    )
    scope = ScopeRefs(
        principal_ref="fixture-ref:principal:postgres",
        project_ref="fixture-ref:project:postgres",
        data_class_ref="fixture-ref:data-class:internal",
        budget_pool_ref="fixture-ref:budget-pool:postgres",
        budget_reservation_refs=(f"fixture-ref:budget:{workflow.workflow_id}",),
        context_refs=(f"fixture-ref:context:{workflow.workflow_id}",),
        tool_refs=("fixture-ref:tool:read",),
        model_aliases=("fixture-nonprod-fast",),
        output_schema_refs=(schema.schema_ref,),
        max_timeout_seconds=300,
    )
    return (
        DelegationContract(
            workflow_id=workflow.workflow_id,
            delegation_id=f"delegation_{workflow.workflow_id}",
            delegation_ref=f"fixture-ref:delegation:{workflow.workflow_id}",
            agent_ref="fixture-ref:agent:postgres",
            task_ref=f"fixture-ref:task:{workflow.workflow_id}",
            context_ref=f"fixture-ref:context:{workflow.workflow_id}",
            model_alias="fixture-nonprod-fast",
            output_schema=schema,
            scope=scope,
            policy_version="fixture-policy.phase2_5.v1",
            registry_version="fixture-registry.phase2_5.v1",
            trace_context=workflow.trace_context.child(),
            allowed_context_refs=(f"fixture-ref:context:{workflow.workflow_id}",),
        ),
        scope,
    )


def _insert_budget_reservation(conn: object, scope: object, workflow_id: str) -> str:
    reservation_id = f"reservation_cancel_{uuid4().hex[:12]}"
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM workflow_run WHERE workflow_run_id = %s", (workflow_id,))
        run_pk = int(cur.fetchone()["id"])
        cur.execute(
            """
            INSERT INTO budget_reservation (
                reservation_id, budget_scope_id, workflow_run_id, currency,
                reserved_amount, status, reserve_idempotency_key, request_id,
                trace_id, policy_version, registry_version, production_enabled
            ) VALUES (%s, %s, %s, 'USD', 1.0, 'reserved', %s, %s, %s, %s, %s, false)
            """,
            (
                reservation_id,
                scope.budget_scope_id,
                run_pk,
                f"reserve_key_{reservation_id}",
                f"request_{reservation_id}",
                f"trace_{reservation_id}",
                scope.policy_version,
                scope.registry_version,
            ),
        )
    return reservation_id


def _create_approval_wait_with_budget(
    conn: object,
    repository: object,
    scope: object,
    *,
    workflow_ref: str,
    approval_id: str,
    requested_at,
    expires_at,
    owner_id: str,
) -> tuple[Workflow, WorkflowStep, str]:
    workflow = _create_workflow(repository, workflow_ref)
    repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
    step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_approval")
    reservation_id = _insert_budget_reservation(conn, scope, workflow.workflow_id)
    repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
    claim = repository.claim_next_step(owner_id=owner_id, lease_policy=LeasePolicy(ttl_seconds=30), workflow_id=workflow.workflow_id)
    assert claim is not None
    repository.update_step_state(step.step_id, StepState.RUNNING, trace_context=workflow.trace_context.child(), lease=claim.lease)
    repository.pause_step_for_approval(
        ApprovalRequest(
            approval_id=approval_id,
            workflow_id=workflow.workflow_id,
            step_id=step.step_id,
            approval_ref=f"fixture-ref:approval:{approval_id}",
            requester_ref="fixture-ref:principal:requester",
            policy_ref="fixture-ref:policy:approval",
            risk_tier=ApprovalRiskTier.HIGH,
            requested_at=requested_at,
            expires_at=expires_at,
        ),
        lease=claim.lease,
        trace_context=workflow.trace_context.child(),
        now=requested_at,
    )
    return workflow, step, reservation_id


def _finish_workflow(repository: object, workflow: Workflow) -> Workflow:
    current = repository.get_workflow(workflow.workflow_id)
    assert current is not None
    for target in (
        WorkflowState.DELEGATING,
        WorkflowState.RUNNING,
        WorkflowState.SYNTHESIZING,
        WorkflowState.COMPLETED,
    ):
        if current.state == target:
            continue
        current = repository.transition_workflow(
            workflow.workflow_id,
            target,
            trace_context=workflow.trace_context.child(),
            refs={"phase_ref": f"fixture-ref:phase:{target.value}"},
        )
    return current


def test_simple_workflow_completes_using_postgres_only(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        assert repository.__class__.__name__ == "PostgresRuntimeRepository"

        workflow = _create_workflow(repository, f"fixture-ref:postgres-simple:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_planning")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())

        executed_step_ids: list[str] = []
        dispatcher = BoundedDispatcher(
            repository,
            _handler(repository, executed_step_ids),
            policy=DispatcherPolicy(owner_id="postgres-simple-worker", max_steps_per_run=4),
        )
        stats = dispatcher.run_until_idle(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,))
        completed = _finish_workflow(repository, workflow)
        conn.commit()

    assert stats["executed_steps"] == 1
    assert executed_step_ids == [f"{workflow.workflow_id}_planning"]
    assert completed.state == WorkflowState.COMPLETED

    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        persisted = repository.get_workflow(workflow.workflow_id)
        persisted_steps = repository.list_steps(workflow.workflow_id)
        persisted_events = repository.list_events(workflow.workflow_id)

    assert persisted is not None
    assert persisted.state == WorkflowState.COMPLETED
    assert [step.state for step in persisted_steps] == [StepState.COMPLETED]
    assert any(event.event_type == "workflow_completed" for event in persisted_events)


def test_in_progress_workflow_resumes_after_process_restart_without_restarting(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-resume:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        first_step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_step_1", created_offset_seconds=1)
        second_step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_step_2", created_offset_seconds=2)
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())

        before_restart: list[str] = []
        dispatcher = BoundedDispatcher(
            repository,
            _handler(repository, before_restart),
            policy=DispatcherPolicy(
                owner_id="postgres-before-restart",
                max_steps_per_run=1,
                lease=LeasePolicy(ttl_seconds=30, heartbeat_seconds=5),
            ),
        )
        assert dispatcher.dispatch_one(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,))
        conn.commit()

    assert before_restart == [first_step.step_id]

    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        assert repository.get_step(first_step.step_id).state == StepState.COMPLETED
        assert repository.get_step(second_step.step_id).state == StepState.PENDING

        after_restart: list[str] = []
        dispatcher = BoundedDispatcher(
            repository,
            _handler(repository, after_restart),
            policy=DispatcherPolicy(owner_id="postgres-after-restart", max_steps_per_run=4),
        )
        stats = dispatcher.run_until_idle(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,))
        completed = _finish_workflow(repository, workflow)
        steps = repository.list_steps(workflow.workflow_id)
        conn.commit()

    assert stats["executed_steps"] == 1
    assert after_restart == [second_step.step_id]
    assert completed.state == WorkflowState.COMPLETED
    assert [(step.step_id, step.state, step.attempt) for step in steps] == [
        (first_step.step_id, StepState.COMPLETED, 1),
        (second_step.step_id, StepState.COMPLETED, 1),
    ]


def test_supervisor_and_sub_agent_logic_remain_sql_free(postgres_database_url: str) -> None:
    del postgres_database_url
    src_root = Path(__file__).resolve().parents[1] / "src" / "devgateway_agent_runtime"
    logic_files = (src_root / "supervisor.py", src_root / "executor.py")
    forbidden_patterns = {
        "psycopg import": re.compile(r"\bpsycopg\b", re.IGNORECASE),
        "postgres import": re.compile(r"\bpostgres\b", re.IGNORECASE),
        "cursor usage": re.compile(r"\.cursor\s*\(", re.IGNORECASE),
        "execute usage": re.compile(r"\.execute\s*\(", re.IGNORECASE),
        "select from": re.compile(r"\bSELECT\b[\s\S]*\bFROM\b", re.IGNORECASE),
        "insert into": re.compile(r"\bINSERT\s+INTO\b", re.IGNORECASE),
        "update statement": re.compile(r"\bUPDATE\s+[a-zA-Z_]", re.IGNORECASE),
        "delete from": re.compile(r"\bDELETE\s+FROM\b", re.IGNORECASE),
        "skip locked": re.compile(r"\bSKIP\s+LOCKED\b", re.IGNORECASE),
    }

    leaks: list[str] = []
    for path in logic_files:
        text = path.read_text(encoding="utf-8")
        for label, pattern in forbidden_patterns.items():
            if pattern.search(text):
                leaks.append(f"{path.name}: {label}")

    assert leaks == []


def test_required_approval_pause_releases_step_lease(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-approval-pause:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_approval")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        claim = repository.claim_next_step(
            owner_id="approval-pause-worker",
            lease_policy=LeasePolicy(ttl_seconds=30),
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.PLANNING,),
        )
        assert claim is not None
        running = repository.update_step_state(step.step_id, StepState.RUNNING, trace_context=workflow.trace_context.child(), lease=claim.lease)
        approval_id = f"approval_pg_{uuid4().hex[:12]}"
        token = stable_approval_resume_token(workflow_id=workflow.workflow_id, step_id=running.step_id, approval_id=approval_id)
        approval = repository.pause_step_for_approval(
            ApprovalRequest(
                approval_id=approval_id,
                workflow_id=workflow.workflow_id,
                step_id=running.step_id,
                approval_ref=f"fixture-ref:approval:{approval_id}",
                requester_ref="fixture-ref:principal:requester",
                policy_ref="fixture-ref:policy:approval",
                risk_tier=ApprovalRiskTier.HIGH,
            ),
            lease=claim.lease,
            trace_context=workflow.trace_context.child(),
            resume_token=token,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS count FROM workflow_lease WHERE workflow_lease_id = %s AND status = 'active'", (claim.lease.lease_id,))
            active_leases = int(cur.fetchone()["count"])
            cur.execute("SELECT metadata FROM workflow_step WHERE workflow_step_id = %s", (step.step_id,))
            metadata = cur.fetchone()["metadata"]
        paused_step = repository.get_step(step.step_id)
        paused_workflow = repository.get_workflow(workflow.workflow_id)
        conn.commit()

    assert approval.expires_at is not None
    assert paused_step is not None and paused_step.state == StepState.PENDING_APPROVAL
    assert paused_workflow is not None and paused_workflow.state == WorkflowState.PENDING_APPROVAL
    assert active_leases == 0
    assert metadata["approval_resume_token"] == token


def test_authorized_approved_approval_resumes_exactly_once(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-approval-resume:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_approval")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        claim = repository.claim_next_step(owner_id="approval-resume-worker", lease_policy=LeasePolicy(ttl_seconds=30), workflow_id=workflow.workflow_id)
        assert claim is not None
        repository.update_step_state(step.step_id, StepState.RUNNING, trace_context=workflow.trace_context.child(), lease=claim.lease)
        approval_id = f"approval_pg_{uuid4().hex[:12]}"
        token = stable_approval_resume_token(workflow_id=workflow.workflow_id, step_id=step.step_id, approval_id=approval_id)
        repository.pause_step_for_approval(
            ApprovalRequest(
                approval_id=approval_id,
                workflow_id=workflow.workflow_id,
                step_id=step.step_id,
                approval_ref=f"fixture-ref:approval:{approval_id}",
                requester_ref="fixture-ref:principal:requester",
                policy_ref="fixture-ref:policy:approval",
                risk_tier=ApprovalRiskTier.MEDIUM,
            ),
            lease=claim.lease,
            trace_context=workflow.trace_context.child(),
            resume_token=token,
        )
        _mark_approval_approved_for_test(conn, approval_id, workflow.workflow_id, postgres_runtime_scope)
        decision = ApprovalDecision(
            approval_id=approval_id,
            workflow_id=workflow.workflow_id,
            decision=ApprovalStatus.APPROVED,
            decided_by_ref="fixture-ref:principal:approver",
            reason_ref="fixture-ref:approval-decision:approved",
        )
        first = repository.resume_approval_decision(decision, trace_context=workflow.trace_context.child(), resume_token=token)
        second = repository.resume_approval_decision(decision, trace_context=workflow.trace_context.child(), resume_token=token)
        resumed_step = repository.get_step(step.step_id)
        resumed_workflow = repository.get_workflow(workflow.workflow_id)
        conn.commit()

    assert first is True
    assert second is False
    assert resumed_step is not None and resumed_step.state == StepState.PENDING
    assert resumed_workflow is not None and resumed_workflow.state == WorkflowState.RUNNING


def test_denied_approval_terminalizes_deterministically(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-approval-denied:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_approval")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        claim = repository.claim_next_step(owner_id="approval-deny-worker", lease_policy=LeasePolicy(ttl_seconds=30), workflow_id=workflow.workflow_id)
        assert claim is not None
        repository.update_step_state(step.step_id, StepState.RUNNING, trace_context=workflow.trace_context.child(), lease=claim.lease)
        approval_id = f"approval_pg_{uuid4().hex[:12]}"
        repository.pause_step_for_approval(
            ApprovalRequest(
                approval_id=approval_id,
                workflow_id=workflow.workflow_id,
                step_id=step.step_id,
                approval_ref=f"fixture-ref:approval:{approval_id}",
                requester_ref="fixture-ref:principal:requester",
                policy_ref="fixture-ref:policy:approval",
                risk_tier=ApprovalRiskTier.MEDIUM,
            ),
            lease=claim.lease,
            trace_context=workflow.trace_context.child(),
        )
        decision = repository.record_approval_decision(
            ApprovalDecision(
                approval_id=approval_id,
                workflow_id=workflow.workflow_id,
                decision=ApprovalStatus.DENIED,
                decided_by_ref="fixture-ref:principal:approver",
                reason_ref="fixture-ref:approval-denied",
            )
        )
        assert repository.resume_approval_decision(decision, trace_context=workflow.trace_context.child())
        denied_step = repository.get_step(step.step_id)
        denied_workflow = repository.get_workflow(workflow.workflow_id)
        conn.commit()

    assert denied_step is not None and denied_step.state == StepState.CANCELLED
    assert denied_workflow is not None and denied_workflow.state == WorkflowState.CANCELLED


def test_approval_expiry_worker_fails_closed(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    now = utc_now()
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-approval-expiry:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_approval")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        claim = repository.claim_next_step(owner_id="approval-expiry-worker", lease_policy=LeasePolicy(ttl_seconds=30), workflow_id=workflow.workflow_id)
        assert claim is not None
        repository.update_step_state(step.step_id, StepState.RUNNING, trace_context=workflow.trace_context.child(), lease=claim.lease)
        approval_id = f"approval_pg_{uuid4().hex[:12]}"
        repository.pause_step_for_approval(
            ApprovalRequest(
                approval_id=approval_id,
                workflow_id=workflow.workflow_id,
                step_id=step.step_id,
                approval_ref=f"fixture-ref:approval:{approval_id}",
                requester_ref="fixture-ref:principal:requester",
                policy_ref="fixture-ref:policy:approval",
                risk_tier=ApprovalRiskTier.HIGH,
                expires_at=now - timedelta(seconds=1),
            ),
            lease=claim.lease,
            trace_context=workflow.trace_context.child(),
        )
        worker = ApprovalExpiryWorker(
            repository,
            policy=ApprovalExpiryWorkerPolicy(batch_size=10),
            commit=conn.commit,
            rollback=conn.rollback,
        )
        stats = worker.run_once(now=now)
        expired_step = repository.get_step(step.step_id)
        expired_workflow = repository.get_workflow(workflow.workflow_id)
        with conn.cursor() as cur:
            cur.execute("SELECT state FROM approval_request WHERE approval_request_id = %s", (approval_id,))
            approval_state = cur.fetchone()["state"]
        conn.commit()

    assert stats is True
    assert approval_state == ApprovalStatus.EXPIRED.value
    assert expired_step is not None and expired_step.state == StepState.FAILED
    assert expired_workflow is not None and expired_workflow.state == WorkflowState.FAILED


def test_approval_expiry_reaps_only_expired_workflow_budget(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    now = utc_now()
    expired_approval_id = f"approval_expired_{uuid4().hex[:12]}"
    waiting_approval_id = f"approval_waiting_{uuid4().hex[:12]}"
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        expired_workflow, _expired_step, expired_reservation_id = _create_approval_wait_with_budget(
            conn,
            repository,
            postgres_runtime_scope,
            workflow_ref=f"fixture-ref:postgres-approval-expiry-budget:{uuid4().hex}",
            approval_id=expired_approval_id,
            requested_at=now - timedelta(hours=2),
            expires_at=now - timedelta(seconds=1),
            owner_id="approval-expiry-budget-expired",
        )
        waiting_workflow, _waiting_step, waiting_reservation_id = _create_approval_wait_with_budget(
            conn,
            repository,
            postgres_runtime_scope,
            workflow_ref=f"fixture-ref:postgres-approval-wait-budget:{uuid4().hex}",
            approval_id=waiting_approval_id,
            requested_at=now - timedelta(minutes=5),
            expires_at=now + timedelta(hours=1),
            owner_id="approval-expiry-budget-waiting",
        )

        expired = repository.expire_due_approvals(now=now, limit=1000)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, release_idempotency_key FROM budget_reservation WHERE reservation_id = %s",
                (expired_reservation_id,),
            )
            expired_reservation = cur.fetchone()
            cur.execute(
                "SELECT status, release_idempotency_key FROM budget_reservation WHERE reservation_id = %s",
                (waiting_reservation_id,),
            )
            waiting_reservation = cur.fetchone()
            cur.execute("SELECT state FROM approval_request WHERE approval_request_id = %s", (expired_approval_id,))
            expired_approval_state = cur.fetchone()["state"]
            cur.execute("SELECT state FROM approval_request WHERE approval_request_id = %s", (waiting_approval_id,))
            waiting_approval_state = cur.fetchone()["state"]
            cur.execute(
                """
                SELECT COUNT(*) AS count
                  FROM workflow_event we
                  JOIN workflow_run wr ON wr.id = we.workflow_run_id
                 WHERE wr.workflow_run_id = %s
                   AND we.metadata->>'runtime_event_type' = 'budget.reservation.reconciled'
                """,
                (waiting_workflow.workflow_id,),
            )
            waiting_reconciled_events = int(cur.fetchone()["count"])
        expired_workflow_after = repository.get_workflow(expired_workflow.workflow_id)
        waiting_workflow_after = repository.get_workflow(waiting_workflow.workflow_id)
        conn.commit()

    assert expired >= 1
    assert expired_approval_state == ApprovalStatus.EXPIRED.value
    assert expired_reservation["status"] == "released"
    assert expired_reservation["release_idempotency_key"].startswith("budget-reaper:terminal_workflow:")
    assert expired_workflow_after is not None and expired_workflow_after.state == WorkflowState.FAILED
    assert waiting_reservation["status"] == "reserved"
    assert waiting_reservation["release_idempotency_key"] is None
    assert waiting_approval_state == ApprovalStatus.PENDING.value
    assert waiting_workflow_after is not None and waiting_workflow_after.state == WorkflowState.PENDING_APPROVAL
    assert waiting_reconciled_events == 0


def _mark_approval_approved_for_test(conn: object, approval_id: str, workflow_id: str, scope: object) -> None:
    suffix = uuid4().hex[:12]
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM workflow_run WHERE workflow_run_id = %s", (workflow_id,))
        run_pk = int(cur.fetchone()["id"])
        cur.execute("SELECT workflow_step_id, id FROM workflow_step WHERE workflow_run_id = %s LIMIT 1", (run_pk,))
        step_row = cur.fetchone()
        cur.execute(
            """
            INSERT INTO role (role_id, name, scope_type, status)
            VALUES (%s, 'Approver', 'project', 'active')
            RETURNING id
            """,
            (f"role_approval_test_{suffix}",),
        )
        role_pk = int(cur.fetchone()["id"])
        cur.execute(
            """
            INSERT INTO task_artifact (
                task_artifact_id, workflow_run_id, workflow_step_id, task_ref,
                project_id, principal_id, budget_scope_id, artifact_type,
                storage_uri, content_hash, hash_algorithm, size_bytes,
                sensitivity, retention_policy_ref, artifact_storage_policy_ref,
                data_class, policy_version, registry_version, trace_id, request_id,
                idempotency_key, status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'trace_evidence',
                    %s, %s, 'sha256', 32,
                    'internal', 'retention-test', 'storage-policy-test',
                    'internal', %s, %s, %s, %s,
                    %s, 'available')
            RETURNING id
            """,
            (
                f"artifact_approval_test_{suffix}",
                run_pk,
                int(step_row["id"]),
                f"fixture-ref:approval-artifact:{suffix}",
                scope.project_id,
                scope.principal_id,
                scope.budget_scope_id,
                f"fixture-ref:artifact-storage:{suffix}",
                "a" * 64,
                scope.policy_version,
                scope.registry_version,
                f"trace_approval_{suffix}",
                f"request_approval_{suffix}",
                f"idem_approval_artifact_{suffix}",
            ),
        )
        artifact_pk = int(cur.fetchone()["id"])
        cur.execute(
            """
            INSERT INTO audit_event (
                audit_event_id, event_name, action, outcome,
                actor_principal_id, project_id, budget_scope_id,
                trace_id, request_id, policy_version, registry_version,
                environment
            )
            VALUES (%s, 'approval_decision', 'approve', 'success',
                    %s, %s, %s, %s, %s, %s, %s, 'test')
            RETURNING id
            """,
            (
                f"audit_approval_test_{suffix}",
                scope.principal_id,
                scope.project_id,
                scope.budget_scope_id,
                f"trace_approval_{suffix}",
                f"request_approval_{suffix}",
                scope.policy_version,
                scope.registry_version,
            ),
        )
        audit_pk = int(cur.fetchone()["id"])
        cur.execute(
            """
            UPDATE approval_request
               SET state = 'approved',
                   approver_principal_id = %s,
                   required_role_id = %s,
                   action_summary_artifact_id = %s,
                   decision_audit_event_id = %s,
                   updated_at = now()
             WHERE approval_request_id = %s
            """,
            (scope.principal_id, role_pk, artifact_pk, audit_pk, approval_id),
        )


def test_outbox_enqueue_is_atomic_with_workflow_state_change(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-outbox-atomic:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS count
                  FROM workflow_outbox wo
                  JOIN workflow_event we ON we.id = wo.source_workflow_event_id
                  JOIN workflow_run wr ON wr.id = wo.workflow_run_id
                 WHERE wr.workflow_run_id = %s
                   AND we.metadata->>'runtime_event_type' = 'workflow.queued'
                   AND wo.destination_kind IN ('trace', 'portal_update')
                """,
                (workflow.workflow_id,),
            )
            in_tx_count = int(cur.fetchone()["count"])
        conn.rollback()

    assert in_tx_count >= 2
    with postgres_connection_factory() as conn:
        assert _postgres_repository(conn, postgres_runtime_scope).get_workflow(workflow.workflow_id) is None


def test_outbox_claim_survives_crash_before_delivery(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-outbox-crash:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        conn.commit()

    claim_time = utc_now()
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        claimed = repository.claim_pending_outbox_events(
            batch_size=1,
            owner_id="postgres-outbox-before-crash",
            policy=LeasePolicy(ttl_seconds=1),
            now=claim_time,
        )
        assert len(claimed) == 1
        crashed_event_id = claimed[0][0].outbox_id
        conn.commit()

    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        reclaimed = repository.claim_pending_outbox_events(
            batch_size=10,
            owner_id="postgres-outbox-after-crash",
            policy=LeasePolicy(ttl_seconds=30),
            now=claim_time + timedelta(seconds=2),
        )
        conn.commit()

    assert any(event.outbox_id == crashed_event_id for event, _lease in reclaimed)


def test_outbox_duplicate_append_is_idempotent(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-outbox-duplicate:{uuid4().hex}")
        source_event = repository.list_events(workflow.workflow_id)[0]
        idempotency_key = outbox_idempotency_key("audit", source_event.event_id)
        first = repository.append_outbox_event(
            WorkflowOutboxEvent(
                outbox_id=f"outbox_dup_first_{uuid4().hex[:8]}",
                workflow_id=workflow.workflow_id,
                source_event_ref=source_event.event_id,
                destination_kind="audit",
                idempotency_key=idempotency_key,
            )
        )
        second = repository.append_outbox_event(
            WorkflowOutboxEvent(
                outbox_id=f"outbox_dup_second_{uuid4().hex[:8]}",
                workflow_id=workflow.workflow_id,
                source_event_ref=source_event.event_id,
                destination_kind="audit",
                idempotency_key=idempotency_key,
            )
        )
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS count FROM workflow_outbox WHERE destination_kind = 'audit' AND idempotency_key = %s",
                (idempotency_key,),
            )
            duplicate_count = int(cur.fetchone()["count"])
        conn.commit()

    assert first.outbox_id == second.outbox_id
    assert duplicate_count == 1


def test_outbox_worker_dead_letters_after_repeated_failures(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-outbox-dead-letter:{uuid4().hex}")
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE workflow_outbox
                   SET attempt_count = %s,
                       next_attempt_at = NULL
                 WHERE workflow_run_id = (
                       SELECT id FROM workflow_run WHERE workflow_run_id = %s
                 )
                 RETURNING outbox_id, destination_kind
                """,
                (DEFAULT_OUTBOX_RETRY_POLICY.max_attempts - 1, workflow.workflow_id),
            )
            assert cur.fetchone() is not None
        conn.commit()

    def fail(_event: WorkflowOutboxEvent) -> None:
        raise RuntimeError("fixture-ref:outbox-delivery-failure")

    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        worker = OutboxWorker(
            repository,
            consumers={dest: fail for dest in OUTBOX_DESTINATION_KINDS},
            policy=OutboxWorkerPolicy(owner_id="postgres-outbox-dead-letter", batch_size=1),
        )
        stats = worker.run_once()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS count
                  FROM workflow_outbox
                 WHERE workflow_run_id = (SELECT id FROM workflow_run WHERE workflow_run_id = %s)
                   AND delivery_state = 'dead_lettered'
                """,
                (workflow.workflow_id,),
            )
            dead_lettered_count = int(cur.fetchone()["count"])
        conn.commit()

    assert stats.dead_lettered == 1
    assert dead_lettered_count >= 1


def test_outbox_backlog_summary_is_observable(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-outbox-backlog:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        summary = repository.outbox_backlog_summary()
        conn.commit()

    assert int(summary["total"]) >= 2
    assert int(summary["due"]) >= 2
    assert summary["oldest_enqueued_at"] is not None
    assert int(summary["by_state"]["pending"]) >= 2  # type: ignore[index]
    assert int(summary["by_destination"]["trace"]) >= 1  # type: ignore[index]


def test_cancellation_worker_releases_queued_reservations_immediately(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-cancel-queued:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_queued")
        reservation_id = _insert_budget_reservation(conn, postgres_runtime_scope, workflow.workflow_id)
        cancellation = repository.create_cancellation(
            CancellationRecord(
                cancellation_id=f"cancel_queued_{uuid4().hex[:12]}",
                target=CancellationTarget.WORKFLOW,
                workflow_id=workflow.workflow_id,
                reason_ref=f"fixture-ref:cancellation:{workflow.workflow_id}:queued",
                idempotency_key=f"cancel_queued_key_{uuid4().hex[:12]}",
            )
        )
        worker = CancellationWorker(repository, policy=CancellationWorkerPolicy(batch_size=10), commit=conn.commit, rollback=conn.rollback)
        assert worker.run_once()
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM budget_reservation WHERE reservation_id = %s", (reservation_id,))
            reservation_status = cur.fetchone()["status"]
        step_state = repository.get_step(step.step_id).state
        workflow_state = repository.get_workflow(workflow.workflow_id).state
        cancellation_state = repository.get_cancellation(cancellation.cancellation_id).propagation_state.value

    assert worker.stats.steps_cancelled == 1
    assert worker.stats.reservations_released == 1
    assert step_state == StepState.CANCELLED
    assert workflow_state == WorkflowState.CANCELLED
    assert cancellation_state == "completed"
    assert reservation_status == "released"


def test_running_cancellation_stops_future_steps_and_attempts_active_abort(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-cancel-running:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        future_step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_future")
        delegation, scope = _delegation_for_workflow(workflow)
        adapter = _AbortAfterCancellationAdapter(repository, workflow.workflow_id)

        with pytest.raises(CancellationObserved):
            FixtureSubAgentExecutor(repository, adapter).execute(delegation, parent_scope=scope)  # type: ignore[arg-type]

        worker = CancellationWorker(repository, commit=conn.commit, rollback=conn.rollback)
        worker.run_once()
        future_state = repository.get_step(future_step.step_id).state

    assert adapter.abort_requests == [delegation.to_model_request().request_ref]
    assert future_state == StepState.CANCELLED


def test_cancellation_during_approval_wait_terminalizes_approval(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-cancel-approval:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PENDING_APPROVAL, trace_context=workflow.trace_context.child())
        approval = repository.create_approval_request(
            ApprovalRequest(
                approval_id=f"approval_cancel_{uuid4().hex[:12]}",
                workflow_id=workflow.workflow_id,
                approval_ref=f"fixture-ref:approval:{workflow.workflow_id}",
                requester_ref="fixture-ref:principal:requester",
                policy_ref="fixture-ref:approval-policy:high",
                risk_tier=ApprovalRiskTier.HIGH,
            )
        )
        repository.create_cancellation(
            CancellationRecord(
                cancellation_id=f"cancel_approval_{uuid4().hex[:12]}",
                target=CancellationTarget.WORKFLOW,
                workflow_id=workflow.workflow_id,
                reason_ref=f"fixture-ref:cancellation:{workflow.workflow_id}:approval",
                idempotency_key=f"cancel_approval_key_{uuid4().hex[:12]}",
            )
        )
        worker = CancellationWorker(repository, commit=conn.commit, rollback=conn.rollback)
        worker.run_once()
        with conn.cursor() as cur:
            cur.execute("SELECT state FROM approval_request WHERE approval_request_id = %s", (approval.approval_id,))
            approval_state = cur.fetchone()["state"]
        workflow_state = repository.get_workflow(workflow.workflow_id).state

    assert approval_state == ApprovalStatus.CANCELLED.value
    assert workflow_state == WorkflowState.CANCELLED


def test_cancellation_during_outbox_delivery_loses_no_enqueued_events(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-cancel-outbox:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS count FROM workflow_outbox wo JOIN workflow_run wr ON wr.id = wo.workflow_run_id WHERE wr.workflow_run_id = %s",
                (workflow.workflow_id,),
            )
            before_count = int(cur.fetchone()["count"])
        repository.create_cancellation(
            CancellationRecord(
                cancellation_id=f"cancel_outbox_{uuid4().hex[:12]}",
                target=CancellationTarget.WORKFLOW,
                workflow_id=workflow.workflow_id,
                reason_ref=f"fixture-ref:cancellation:{workflow.workflow_id}:outbox",
                idempotency_key=f"cancel_outbox_key_{uuid4().hex[:12]}",
            )
        )
        worker = CancellationWorker(repository, commit=conn.commit, rollback=conn.rollback)
        worker.run_once()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS count FROM workflow_outbox wo JOIN workflow_run wr ON wr.id = wo.workflow_run_id WHERE wr.workflow_run_id = %s",
                (workflow.workflow_id,),
            )
            after_count = int(cur.fetchone()["count"])

    assert after_count >= before_count
    assert after_count > 0


def test_cancellation_worker_does_not_double_settle(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-cancel-double:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_queued")
        repository.create_cancellation(
            CancellationRecord(
                cancellation_id=f"cancel_double_{uuid4().hex[:12]}",
                target=CancellationTarget.WORKFLOW,
                workflow_id=workflow.workflow_id,
                reason_ref=f"fixture-ref:cancellation:{workflow.workflow_id}:double",
                idempotency_key=f"cancel_double_key_{uuid4().hex[:12]}",
            )
        )
        worker = CancellationWorker(repository, commit=conn.commit, rollback=conn.rollback)
        assert worker.run_once()
        assert not worker.run_once()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS count
                  FROM workflow_event we
                  JOIN workflow_run wr ON wr.id = we.workflow_run_id
                 WHERE wr.workflow_run_id = %s
                   AND we.metadata->>'runtime_event_type' = 'cancellation_completed'
                """,
                (workflow.workflow_id,),
            )
            completed_events = int(cur.fetchone()["count"])

    assert completed_events == 1


class ClassifiedFailure(RuntimeError):
    def __init__(self, failure_class: FailureClass) -> None:
        super().__init__(failure_class.value)
        self.failure_class = failure_class


def _attempt_rows(conn: object, step_id: str) -> list[dict[str, object]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT sa.attempt_number, sa.state, sa.failure_class, sa.metadata
              FROM step_attempt sa
              JOIN workflow_step ws ON ws.id = sa.workflow_step_id
             WHERE ws.workflow_step_id = %s
             ORDER BY sa.attempt_number
            """,
            (step_id,),
        )
        return list(cur.fetchall())


def test_transient_failure_retries_with_persisted_backoff(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-retry:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_retry")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        calls = 0

        def handler(step_arg: WorkflowStep, _trace_context: TraceContext) -> StepExecutionResult:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ConnectionError()
            output_ref = f"fixture-ref:step-output:{step_arg.step_id}"
            repository.complete_idempotency(IdempotencyScope.STEP_EXECUTION, step_arg.idempotency_key, result_ref=output_ref)
            return StepExecutionResult(output_ref=output_ref, event_refs={})

        dispatcher = BoundedDispatcher(
            repository,
            handler,
            policy=DispatcherPolicy(
                owner_id="retry-worker",
                max_steps_per_run=3,
                retry=RetryPolicy(max_attempts=3, base_delay_seconds=0, max_delay_seconds=0, jitter=False),
            ),
        )
        stats = dispatcher.run_until_idle(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,))
        attempts = _attempt_rows(conn, step.step_id)
        persisted = repository.get_step(step.step_id)
        conn.commit()

    assert stats["executed_steps"] == 2
    assert calls == 2
    assert persisted is not None and persisted.state == StepState.COMPLETED and persisted.attempt == 2
    assert [(row["attempt_number"], row["state"]) for row in attempts] == [(1, "failed"), (2, "succeeded")]
    assert attempts[0]["failure_class"] == FailureClass.TOOL_ADAPTER_TRANSIENT.value


def test_terminal_validation_failure_does_not_retry(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-validation:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_validation")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())

        def handler(_step: WorkflowStep, _trace_context: TraceContext) -> StepExecutionResult:
            raise ClassifiedFailure(FailureClass.VALIDATION_FAILURE)

        dispatcher = BoundedDispatcher(
            repository,
            handler,
            policy=DispatcherPolicy(owner_id="validation-worker", max_steps_per_run=2),
        )
        stats = dispatcher.run_until_idle(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,))
        persisted = repository.get_step(step.step_id)
        reviews = repository.list_pending_reviews(workflow.workflow_id)
        attempts = _attempt_rows(conn, step.step_id)
        conn.commit()

    assert stats["executed_steps"] == 1
    assert persisted is not None and persisted.state == StepState.FAILED
    assert reviews == ()
    assert attempts[0]["failure_class"] == FailureClass.VALIDATION_FAILURE.value


def test_retry_exhaustion_routes_to_manual_review(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-exhaust:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_exhaust")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        dispatcher = BoundedDispatcher(
            repository,
            lambda _step, _trace: (_ for _ in ()).throw(ConnectionError()),
            policy=DispatcherPolicy(owner_id="exhaust-worker", max_steps_per_run=2, retry=RetryPolicy(max_attempts=1)),
        )
        dispatcher.run_until_idle(workflow_id=workflow.workflow_id, kinds=(StepKind.PLANNING,))
        persisted = repository.get_step(step.step_id)
        reviews = repository.list_pending_reviews(workflow.workflow_id)
        conn.commit()

    assert persisted is not None and persisted.state == StepState.MANUAL_REVIEW
    assert len(reviews) == 1
    assert reviews[0].reason_ref == "retry_exhausted"


def test_conflicting_idempotency_replay_is_denied(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        key = stable_idempotency_key(IdempotencyScope.STEP_EXECUTION, "fixture-ref:conflict")
        repository.reserve_idempotency(
            IdempotencyRecord(scope=IdempotencyScope.STEP_EXECUTION, key=key, request_ref="fixture-ref:original")
        )
        try:
            repository.reserve_idempotency(
                IdempotencyRecord(scope=IdempotencyScope.STEP_EXECUTION, key=key, request_ref="fixture-ref:conflicting")
            )
        except RepositoryError as exc:
            assert "idempotency conflict" in str(exc)
        else:
            raise AssertionError("conflicting idempotency replay was not denied")
        conn.commit()


def test_stale_worker_write_is_fenced_off(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-fence:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_fence")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        now = utc_now()
        claim = repository.claim_next_step(
            owner_id="old-worker",
            lease_policy=LeasePolicy(ttl_seconds=1),
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.PLANNING,),
            now=now,
        )
        assert claim is not None
        replacement = repository.acquire_lease(
            f"step:{step.step_id}",
            owner_id="new-worker",
            policy=LeasePolicy(ttl_seconds=30),
            now=now + timedelta(seconds=2),
        )
        assert replacement is not None and replacement.fencing_token > claim.lease.fencing_token
        try:
            repository.update_step_state(
                step.step_id,
                StepState.RUNNING,
                trace_context=workflow.trace_context.child(),
                lease=claim.lease,
                now=now + timedelta(seconds=3),
            )
        except RepositoryError as exc:
            assert "fenced" in str(exc) or "stale" in str(exc)
        else:
            raise AssertionError("stale worker write was not fenced off")
        conn.commit()


def test_lease_sweeper_recovers_pre_side_effect_and_escalates_running(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-sweep:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        recover_step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_recover", created_offset_seconds=1)
        escalate_step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_escalate", created_offset_seconds=2)
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        now = utc_now()
        recover_claim = repository.claim_next_step(
            owner_id="sweep-worker-a",
            lease_policy=LeasePolicy(ttl_seconds=1),
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.PLANNING,),
            now=now,
        )
        assert recover_claim is not None and recover_claim.step_id == recover_step.step_id
        running_claim = repository.claim_next_step(
            owner_id="sweep-worker-b",
            lease_policy=LeasePolicy(ttl_seconds=1),
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.PLANNING,),
            now=now,
        )
        assert running_claim is not None and running_claim.step_id == escalate_step.step_id
        repository.update_step_state(
            escalate_step.step_id,
            StepState.RUNNING,
            trace_context=workflow.trace_context.child(),
            lease=running_claim.lease,
            now=now,
        )
        result = LeaseSweeper(repository).sweep_once(now=now + timedelta(seconds=2))
        recovered = repository.get_step(recover_step.step_id)
        escalated = repository.get_step(escalate_step.step_id)
        reviews = repository.list_pending_reviews(workflow.workflow_id)
        conn.commit()

    assert result.expired == 2
    assert result.recovered == 1
    assert result.escalated == 1
    assert recovered is not None and recovered.state == StepState.PENDING
    assert escalated is not None and escalated.state == StepState.MANUAL_REVIEW
    assert len(reviews) == 1 and reviews[0].reason_ref == "stuck_lease"


def test_budget_reaper_detects_crashed_worker_reservation(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    now = utc_now()
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-budget-crash:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_budget_crash")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        claim = repository.claim_next_step(
            owner_id="budget-crashed-worker",
            lease_policy=LeasePolicy(ttl_seconds=1),
            workflow_id=workflow.workflow_id,
            kinds=(StepKind.PLANNING,),
            now=now,
        )
        assert claim is not None and claim.step_id == step.step_id
        reservation_id = _insert_budget_reservation(conn, postgres_runtime_scope, workflow.workflow_id)
        worker = BudgetReaper(
            repository,
            policy=BudgetReaperPolicy(batch_size=10),
            commit=conn.commit,
            rollback=conn.rollback,
        )
        assert worker.run_once(now=now + timedelta(seconds=2))
        assert not worker.run_once(now=now + timedelta(seconds=3))
        with conn.cursor() as cur:
            cur.execute("SELECT status, release_idempotency_key FROM budget_reservation WHERE reservation_id = %s", (reservation_id,))
            reservation = cur.fetchone()
            cur.execute(
                """
                SELECT COUNT(*) AS count
                  FROM workflow_event we
                  JOIN workflow_run wr ON wr.id = we.workflow_run_id
                 WHERE wr.workflow_run_id = %s
                   AND we.metadata->>'runtime_event_type' = 'budget.reservation.reconciled'
                   AND we.metadata->'refs'->>'orphan_reason' = 'expired_lease'
                """,
                (workflow.workflow_id,),
            )
            reconciled_events = int(cur.fetchone()["count"])
            cur.execute(
                """
                SELECT COUNT(*) AS count
                  FROM workflow_outbox wo
                  JOIN workflow_event we ON we.id = wo.source_workflow_event_id
                  JOIN workflow_run wr ON wr.id = wo.workflow_run_id
                 WHERE wr.workflow_run_id = %s
                   AND we.metadata->>'runtime_event_type' = 'budget.reservation.reconciled'
                """,
                (workflow.workflow_id,),
            )
            outbox_events = int(cur.fetchone()["count"])

    assert worker.stats.released == 1
    assert worker.stats.expired_lease_released == 1
    assert reservation["status"] == "released"
    assert reservation["release_idempotency_key"].startswith("budget-reaper:expired_lease:")
    assert reconciled_events == 1
    assert outbox_events >= 1


def test_long_approval_wait_releases_and_reestimates_budget(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    now = utc_now()
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-budget-approval:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        step = _add_step(repository, workflow, step_id=f"{workflow.workflow_id}_approval_budget")
        reservation_id = _insert_budget_reservation(conn, postgres_runtime_scope, workflow.workflow_id)
        repository.transition_workflow(workflow.workflow_id, WorkflowState.PLANNING, trace_context=workflow.trace_context.child())
        claim = repository.claim_next_step(owner_id="budget-approval-worker", lease_policy=LeasePolicy(ttl_seconds=30), workflow_id=workflow.workflow_id)
        assert claim is not None
        repository.update_step_state(step.step_id, StepState.RUNNING, trace_context=workflow.trace_context.child(), lease=claim.lease)
        approval_id = f"approval_budget_{uuid4().hex[:12]}"
        token = stable_approval_resume_token(workflow_id=workflow.workflow_id, step_id=step.step_id, approval_id=approval_id)
        repository.pause_step_for_approval(
            ApprovalRequest(
                approval_id=approval_id,
                workflow_id=workflow.workflow_id,
                step_id=step.step_id,
                approval_ref=f"fixture-ref:approval:{approval_id}",
                requester_ref="fixture-ref:principal:requester",
                policy_ref="fixture-ref:policy:approval",
                risk_tier=ApprovalRiskTier.HIGH,
                requested_at=now - timedelta(hours=2),
                expires_at=now + timedelta(hours=1),
            ),
            lease=claim.lease,
            trace_context=workflow.trace_context.child(),
            resume_token=token,
            now=now - timedelta(hours=2),
        )
        reaper = BudgetReaper(
            repository,
            policy=BudgetReaperPolicy(batch_size=10, approval_wait_ttl_seconds=3600),
            commit=conn.commit,
            rollback=conn.rollback,
        )
        assert reaper.run_once(now=now)
        _mark_approval_approved_for_test(conn, approval_id, workflow.workflow_id, postgres_runtime_scope)
        decision = ApprovalDecision(
            approval_id=approval_id,
            workflow_id=workflow.workflow_id,
            decision=ApprovalStatus.APPROVED,
            decided_by_ref="fixture-ref:principal:approver",
            reason_ref="fixture-ref:approval-decision:approved-after-budget-release",
        )
        assert repository.resume_approval_decision(decision, trace_context=workflow.trace_context.child(), resume_token=token, now=now)
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM budget_reservation WHERE reservation_id = %s", (reservation_id,))
            reservation_status = cur.fetchone()["status"]
            cur.execute(
                """
                SELECT COUNT(*) AS count
                  FROM workflow_event we
                  JOIN workflow_run wr ON wr.id = we.workflow_run_id
                 WHERE wr.workflow_run_id = %s
                   AND we.metadata->>'runtime_event_type' = 'budget.reservation.reestimate_required'
                """,
                (workflow.workflow_id,),
            )
            reestimate_events = int(cur.fetchone()["count"])
        resumed_step = repository.get_step(step.step_id)

    assert reaper.stats.approval_wait_released == 1
    assert reservation_status == "released"
    assert resumed_step is not None and resumed_step.state == StepState.PENDING
    assert reestimate_events == 1


def test_retry_budget_settlement_does_not_double_bill(
    postgres_connection_factory: Callable[[], object],
    postgres_runtime_scope: object,
) -> None:
    with postgres_connection_factory() as conn:
        repository = _postgres_repository(conn, postgres_runtime_scope)
        workflow = _create_workflow(repository, f"fixture-ref:postgres-budget-retry:{uuid4().hex}")
        repository.transition_workflow(workflow.workflow_id, WorkflowState.QUEUED, trace_context=workflow.trace_context.child())
        reservation_id = _insert_budget_reservation(conn, postgres_runtime_scope, workflow.workflow_id)
        with pytest.raises(RepositoryError, match="policy allows"):
            repository.settle_budget_reservation(
                reservation_id,
                actual_amount=0.5,
                actual_input_tokens=3,
                actual_output_tokens=4,
                idempotency_key=f"settle_retry_denied_{uuid4().hex[:8]}",
                retry_attempt=2,
                allow_retry_reuse=False,
            )
        first = repository.settle_budget_reservation(
            reservation_id,
            actual_amount=0.5,
            actual_input_tokens=3,
            actual_output_tokens=4,
            idempotency_key="settle_retry_allowed",
            retry_attempt=2,
            allow_retry_reuse=True,
        )
        replay = repository.settle_budget_reservation(
            reservation_id,
            actual_amount=0.5,
            actual_input_tokens=3,
            actual_output_tokens=4,
            idempotency_key="settle_retry_allowed",
            retry_attempt=2,
            allow_retry_reuse=True,
        )
        with pytest.raises(RepositoryError, match="conflicting"):
            repository.settle_budget_reservation(
                reservation_id,
                actual_amount=0.6,
                actual_input_tokens=3,
                actual_output_tokens=4,
                idempotency_key="settle_retry_conflict",
                retry_attempt=2,
                allow_retry_reuse=True,
            )
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status, actual_amount, settle_idempotency_key
                  FROM budget_reservation
                 WHERE reservation_id = %s
                """,
                (reservation_id,),
            )
            reservation = cur.fetchone()
        conn.commit()

    assert first is True
    assert replay is False
    assert reservation["status"] == "settled"
    assert float(reservation["actual_amount"]) == 0.5
    assert reservation["settle_idempotency_key"] == "settle_retry_allowed"
