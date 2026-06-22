from __future__ import annotations

import os
import random
import signal
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import timedelta
from types import FrameType
from typing import Callable, Iterator, Protocol, Sequence
from uuid import uuid4

from .contracts import (
    FailureClass,
    ManualReviewItem,
    RetryDecision,
    RetryPolicy,
    TraceContext,
    WorkflowStep,
    StepKind,
    StepState,
    utc_now,
)
from .dispatcher import StepExecutionResult
from .leases import Lease, LeasePolicy, StepClaim
from .repositories import RuntimeRepository
from .retry import classify_exception, make_retry_decision


CommitFn = Callable[[], None]
RollbackFn = Callable[[], None]
CloseFn = Callable[[], None]
SleepFn = Callable[[float], None]
JitterFn = Callable[[float], float]


class StepHandler(Protocol):
    def __call__(self, step: WorkflowStep, trace_context: TraceContext) -> StepExecutionResult: ...


@dataclass(frozen=True, slots=True)
class RuntimeServicePolicy:
    owner_id: str = "agent-runtime-service"
    lease: LeasePolicy = field(default_factory=LeasePolicy)
    idle_sleep_seconds: float = 1.0
    retry: RetryPolicy = field(default_factory=lambda: RetryPolicy(jitter=True))


@dataclass(slots=True)
class RuntimeServiceStats:
    claimed_steps: int = 0
    completed_steps: int = 0
    failed_steps: int = 0
    idle_polls: int = 0
    recovered_stale_leases: int = 0
    lease_lost_steps: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "claimed_steps": self.claimed_steps,
            "completed_steps": self.completed_steps,
            "failed_steps": self.failed_steps,
            "idle_polls": self.idle_polls,
            "recovered_stale_leases": self.recovered_stale_leases,
            "lease_lost_steps": self.lease_lost_steps,
        }


@dataclass(slots=True)
class RuntimeRepositorySession:
    repository: RuntimeRepository
    commit: CommitFn = lambda: None
    rollback: RollbackFn = lambda: None
    close: CloseFn = lambda: None


class OpaqueReferenceStepHandler:
    def __call__(self, step: WorkflowStep, trace_context: TraceContext) -> StepExecutionResult:
        output_ref = f"runtime-ref:step-output:{step.step_id}"
        return StepExecutionResult(
            output_ref=output_ref,
            event_refs={
                "handler_ref": f"runtime-ref:handler:{step.kind.value}",
                "trace_ref": f"runtime-ref:trace:{trace_context.span_id}",
            },
        )


class RuntimeWorkerService:
    def __init__(
        self,
        repository: RuntimeRepository,
        handler: StepHandler | None = None,
        *,
        policy: RuntimeServicePolicy | None = None,
        commit: CommitFn | None = None,
        rollback: RollbackFn | None = None,
        sleep: SleepFn | None = None,
        retry_jitter: JitterFn | None = None,
    ) -> None:
        self.repository = repository
        self.handler = handler or OpaqueReferenceStepHandler()
        self.policy = policy or RuntimeServicePolicy()
        self.stats = RuntimeServiceStats()
        self._commit = commit or (lambda: None)
        self._rollback = rollback or (lambda: None)
        self._sleep = sleep or time.sleep
        self._retry_jitter = retry_jitter
        self._stop_requested = False

    def request_stop(self) -> None:
        self._stop_requested = True

    @property
    def stop_requested(self) -> bool:
        return self._stop_requested

    def run_once(
        self,
        *,
        workflow_id: str | None = None,
        kinds: Sequence[StepKind] | None = None,
    ) -> bool:
        recovered = self._transactional(lambda: self.repository.recover_stale_leases())
        self.stats.recovered_stale_leases += recovered
        claim = self._transactional(
            lambda: self.repository.claim_next_step(
                owner_id=self.policy.owner_id,
                lease_policy=self.policy.lease,
                workflow_id=workflow_id,
                kinds=kinds,
            )
        )
        if claim is None:
            self.stats.idle_polls += 1
            return False
        self.stats.claimed_steps += 1
        self._execute_claim(claim)
        return True

    def run_until_idle(
        self,
        *,
        max_steps: int = 1,
        max_idle_polls: int = 1,
        workflow_id: str | None = None,
        kinds: Sequence[StepKind] | None = None,
    ) -> RuntimeServiceStats:
        idle_polls = 0
        executed = 0
        while not self._stop_requested and executed < max_steps and idle_polls < max_idle_polls:
            if self.run_once(workflow_id=workflow_id, kinds=kinds):
                executed += 1
                idle_polls = 0
            else:
                idle_polls += 1
        return self.stats

    def run_forever(
        self,
        *,
        workflow_id: str | None = None,
        kinds: Sequence[StepKind] | None = None,
    ) -> RuntimeServiceStats:
        while not self._stop_requested:
            if not self.run_once(workflow_id=workflow_id, kinds=kinds):
                self._sleep(self.policy.idle_sleep_seconds)
        return self.stats

    @contextmanager
    def install_signal_handlers(self) -> Iterator[None]:
        previous: dict[int, signal.Handlers] = {}

        def stop_handler(_signum: int, _frame: FrameType | None) -> None:
            self.request_stop()

        for signum in (signal.SIGINT, signal.SIGTERM):
            try:
                previous[signum] = signal.getsignal(signum)
                signal.signal(signum, stop_handler)
            except (ValueError, OSError, AttributeError):
                continue
        try:
            yield
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)

    def _execute_claim(self, claim: StepClaim) -> None:
        lease = self._heartbeat(claim.lease)
        if lease is None:
            self.stats.lease_lost_steps += 1
            self._release(claim.lease)
            return

        release_lease = True
        try:
            step = self._transactional(lambda: self.repository.get_step(claim.step_id))
            if step is None:
                return
            trace = TraceContext.new(correlation_id=claim.workflow_id).child(
                baggage_refs=(f"runtime-ref:step:{claim.step_id}",)
            )
            running = self._transactional(
                lambda: self.repository.update_step_state(
                    step.step_id,
                    StepState.RUNNING,
                    trace_context=trace,
                    refs={"lease_ref": f"runtime-ref:lease:{lease.lease_id}"},
                    lease=lease,
                )
            )
            try:
                result = self.handler(running, trace.child())
            except BaseException as exc:
                try:
                    self._handle_step_failure(running, exc, lease=lease, trace_context=trace.child())
                except BaseException:
                    release_lease = False
                    raise
                self.stats.failed_steps += 1
                if not isinstance(exc, Exception):
                    raise
                return

            fresh_lease = self._heartbeat(lease)
            if fresh_lease is None:
                self.stats.lease_lost_steps += 1
                return
            self._transactional(
                lambda: self.repository.complete_step(
                    running.step_id,
                    output_ref=result.output_ref,
                    trace_context=trace.child(),
                    refs=result.event_refs,
                    lease=fresh_lease,
                )
            )
            self.stats.completed_steps += 1
        finally:
            if release_lease:
                self._release(lease)

    def _handle_step_failure(
        self,
        step: WorkflowStep,
        exc: BaseException,
        *,
        lease: Lease,
        trace_context: TraceContext,
    ) -> None:
        failure_class = (
            self._failure_class_for(exc)
            if isinstance(exc, Exception)
            else FailureClass.WORKER_CRASH_ACTIVE_LEASE
        )
        reason_ref = f"runtime-ref:error:{step.step_id}:{failure_class.value}"
        decision = make_retry_decision(
            step.workflow_id,
            step.step_id,
            step.attempt,
            failure_class,
            self.policy.retry,
            jitter_fn=self._retry_jitter or (self._default_retry_jitter if self.policy.retry.jitter else None),
            reason_ref=reason_ref,
        )
        has_idempotency = bool(step.idempotency_key)
        retry_requires_idempotency = self.policy.retry.idempotency_required_for_auto_retry

        if decision.eligible and (has_idempotency or not retry_requires_idempotency):
            next_attempt_at = utc_now() + timedelta(seconds=decision.delay_seconds)
            if hasattr(self.repository, "schedule_step_retry"):
                self._transactional(
                    lambda: self.repository.schedule_step_retry(  # type: ignore[attr-defined]
                        decision,
                        next_attempt_at=next_attempt_at,
                        trace_context=trace_context,
                        lease=lease,
                    )
                )
                return
            self._transactional(
                lambda: self.repository.update_step_state(
                    step.step_id,
                    StepState.PENDING,
                    trace_context=trace_context,
                    refs={
                        "retry_decision_ref": f"runtime-ref:retry:{step.step_id}:{step.attempt}",
                        "failure_class": failure_class.value,
                        "next_attempt_at": next_attempt_at.isoformat(),
                    },
                    lease=lease,
                )
            )
            return

        if failure_class == FailureClass.VALIDATION_FAILURE:
            self._record_terminal_failure(step, decision, lease=lease, trace_context=trace_context)
            return

        self._open_manual_review(step, decision, lease=lease, trace_context=trace_context)

    def _record_terminal_failure(
        self,
        step: WorkflowStep,
        decision: RetryDecision,
        *,
        lease: Lease,
        trace_context: TraceContext,
    ) -> None:
        if hasattr(self.repository, "record_step_failure"):
            self._transactional(
                lambda: self.repository.record_step_failure(  # type: ignore[attr-defined]
                    decision,
                    trace_context=trace_context,
                    lease=lease,
                )
            )
            return
        self._transactional(
            lambda: self.repository.update_step_state(
                step.step_id,
                StepState.FAILED,
                trace_context=trace_context,
                refs={"failure_class": decision.failure_class.value, "reason_ref": decision.reason_ref or ""},
                lease=lease,
            )
        )

    def _open_manual_review(
        self,
        step: WorkflowStep,
        decision: RetryDecision,
        *,
        lease: Lease,
        trace_context: TraceContext,
    ) -> None:
        reason = self._manual_review_reason(decision)
        item = ManualReviewItem(
            review_id=f"manual_review_{uuid4().hex}",
            workflow_id=step.workflow_id,
            step_id=step.step_id,
            review_ref=f"runtime-ref:manual-review:{step.workflow_id}:{step.step_id}:{step.attempt}",
            reason_ref=reason,
        )
        if hasattr(self.repository, "open_step_manual_review"):
            self._transactional(
                lambda: self.repository.open_step_manual_review(  # type: ignore[attr-defined]
                    item,
                    decision=decision,
                    trace_context=trace_context,
                    lease=lease,
                )
            )
            return
        self._transactional(
            lambda: self.repository.update_step_state(
                step.step_id,
                StepState.MANUAL_REVIEW,
                trace_context=trace_context,
                refs={"manual_review_reason": reason, "failure_class": decision.failure_class.value},
                lease=lease,
            )
        )
        if hasattr(self.repository, "create_review_item"):
            self._transactional(lambda: self.repository.create_review_item(item))  # type: ignore[attr-defined]

    @staticmethod
    def _failure_class_for(exc: BaseException) -> FailureClass:
        raw = getattr(exc, "failure_class", None)
        if isinstance(raw, FailureClass):
            return raw
        if isinstance(raw, str):
            try:
                return FailureClass(raw)
            except ValueError:
                pass
        before_acceptance = bool(getattr(exc, "before_external_acceptance", False))
        return classify_exception(exc, before_external_acceptance=before_acceptance)

    @staticmethod
    def _manual_review_reason(decision: RetryDecision) -> str:
        if decision.failure_class == FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT:
            return "ambiguous_external_call"
        if decision.failure_class == FailureClass.WORKER_CRASH_ACTIVE_LEASE:
            return "stuck_lease"
        if decision.failure_class in {
            FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
            FailureClass.TOOL_ADAPTER_TRANSIENT,
            FailureClass.PROVIDER_REQUEST_ID_RETURNED_COMMIT_FAILED,
        }:
            return "retry_exhausted"
        return "non_idempotent_side_effect"

    @staticmethod
    def _default_retry_jitter(delay: float) -> float:
        if delay <= 0:
            return 0.0
        return random.uniform(delay * 0.8, delay * 1.2)

    def _heartbeat(self, lease: Lease) -> Lease | None:
        return self._transactional(
            lambda: self.repository.heartbeat_lease(
                lease.lease_id,
                owner_id=self.policy.owner_id,
                policy=self.policy.lease,
            )
        )

    def _release(self, lease: Lease) -> bool:
        return self._transactional(
            lambda: self.repository.release_lease(lease.lease_id, owner_id=self.policy.owner_id)
        )

    def _transactional(self, operation: Callable[[], object]):
        try:
            result = operation()
        except BaseException:
            self._rollback()
            raise
        self._commit()
        return result


def postgres_repository_session_from_env(database_url: str | None = None) -> RuntimeRepositorySession:
    url = database_url or os.environ.get("OPERATIONAL_DATABASE_URL")
    if not url:
        raise RuntimeError("OPERATIONAL_DATABASE_URL is required for postgres/service runtime modes")

    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise RuntimeError("postgres/service runtime modes require psycopg to be installed") from exc

    from .postgres_repository import PostgresRuntimeRepository, RepositoryScope

    scope = RepositoryScope(
        project_id=int(os.environ.get("OPERATIONAL_PROJECT_ID", "1")),
        principal_id=int(os.environ.get("OPERATIONAL_PRINCIPAL_ID", "1")),
        budget_scope_id=int(os.environ.get("OPERATIONAL_BUDGET_SCOPE_ID", "1")),
        policy_version=os.environ.get("OPERATIONAL_POLICY_VERSION", "v1"),
        registry_version=os.environ.get("OPERATIONAL_REGISTRY_VERSION", "v1"),
        data_class=os.environ.get("OPERATIONAL_DATA_CLASS", "internal"),
    )
    conn = psycopg.connect(url, row_factory=dict_row)
    return RuntimeRepositorySession(
        repository=PostgresRuntimeRepository(conn, scope),
        commit=conn.commit,
        rollback=conn.rollback,
        close=conn.close,
    )
