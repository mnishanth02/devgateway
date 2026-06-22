from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable, Sequence
from uuid import uuid4

from .contracts import (
    CancellationAction,
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
from .leases import LeasePolicy, StepClaim
from .repositories import RuntimeRepository
from .retry import classify_exception, make_retry_decision


@dataclass(frozen=True, slots=True)
class PollingBackoffPolicy:
    max_idle_polls: int = 3
    initial_delay_seconds: float = 0.05
    max_delay_seconds: float = 1.0
    multiplier: float = 2.0

    def delay_for_idle_poll(self, idle_poll_count: int) -> float:
        if idle_poll_count <= 0:
            return 0.0
        return min(self.max_delay_seconds, self.initial_delay_seconds * (self.multiplier ** (idle_poll_count - 1)))


@dataclass(frozen=True, slots=True)
class DispatcherPolicy:
    owner_id: str = "fixture-dispatcher"
    max_steps_per_run: int = 16
    lease: LeasePolicy = field(default_factory=LeasePolicy)
    polling: PollingBackoffPolicy = field(default_factory=PollingBackoffPolicy)
    retry: RetryPolicy = field(default_factory=lambda: RetryPolicy(jitter=True))


@dataclass(frozen=True, slots=True)
class StepExecutionResult:
    output_ref: str
    event_refs: dict[str, str]


StepHandler = Callable[[WorkflowStep, TraceContext], StepExecutionResult]
SleepFn = Callable[[float], None]
JitterFn = Callable[[float], float]


class BoundedDispatcher:
    """Claims and executes a bounded number of workflow steps without provider/tool coupling."""

    def __init__(
        self,
        repository: RuntimeRepository,
        handler: StepHandler,
        *,
        policy: DispatcherPolicy | None = None,
        sleep: SleepFn | None = None,
        retry_jitter: JitterFn | None = None,
    ) -> None:
        self.repository = repository
        self.handler = handler
        self.policy = policy or DispatcherPolicy()
        self._sleep = sleep or (lambda _seconds: None)
        self._retry_jitter = retry_jitter

    def run_until_idle(
        self,
        *,
        workflow_id: str | None = None,
        kinds: Sequence[StepKind] | None = None,
        trace_context: TraceContext | None = None,
    ) -> dict[str, int]:
        executed = 0
        idle_polls = 0
        recovered = 0
        while executed < self.policy.max_steps_per_run and idle_polls < self.policy.polling.max_idle_polls:
            recovered += self._recover_stale_leases()
            if workflow_id is not None:
                self._workflow_has_active_cancellation(workflow_id)
            claim = self.repository.claim_next_step(
                owner_id=self.policy.owner_id,
                lease_policy=self.policy.lease,
                workflow_id=workflow_id,
                kinds=kinds,
            )
            if claim is None:
                idle_polls += 1
                self._sleep(self.policy.polling.delay_for_idle_poll(idle_polls))
                continue
            self._execute_claim(claim, trace_context=trace_context)
            executed += 1
            idle_polls = 0
        return {"executed_steps": executed, "idle_polls": idle_polls, "recovered_stale_leases": recovered}

    def dispatch_one(
        self,
        *,
        workflow_id: str | None = None,
        kinds: Sequence[StepKind] | None = None,
        trace_context: TraceContext | None = None,
    ) -> bool:
        self._recover_stale_leases()
        if workflow_id is not None:
            self._workflow_has_active_cancellation(workflow_id)
        claim = self.repository.claim_next_step(
            owner_id=self.policy.owner_id,
            lease_policy=self.policy.lease,
            workflow_id=workflow_id,
            kinds=kinds,
        )
        if claim is None:
            return False
        self._execute_claim(claim, trace_context=trace_context)
        return True

    def _workflow_has_active_cancellation(self, workflow_id: str) -> bool:
        if not hasattr(self.repository, "has_active_cancellation"):
            return False
        return bool(self.repository.has_active_cancellation(workflow_id))  # type: ignore[attr-defined]

    def _recover_stale_leases(self) -> int:
        if hasattr(self.repository, "sweep_expired_step_leases"):
            result = self.repository.sweep_expired_step_leases()  # type: ignore[attr-defined]
            return int(result.get("expired", 0))
        return self.repository.recover_stale_leases()

    def _execute_claim(self, claim: StepClaim, *, trace_context: TraceContext | None) -> None:
        lease = self.repository.heartbeat_lease(
            claim.lease.lease_id,
            owner_id=self.policy.owner_id,
            policy=self.policy.lease,
        )
        if lease is None:
            return
        step = self.repository.get_step(claim.step_id)
        if step is None:
            self.repository.release_lease(claim.lease.lease_id, owner_id=self.policy.owner_id)
            return
        step_trace = (trace_context or TraceContext.new(correlation_id=claim.workflow_id)).child(
            baggage_refs=(f"fixture-ref:step:{step.step_id}",)
        )

        # --- Cancellation checkpoint -------------------------------------------
        # Check before transitioning to RUNNING so we never start a handler under
        # an active cancellation.  We use duck-typing (hasattr) to keep
        # InMemoryRuntimeRepository fully unchanged.
        if hasattr(self.repository, "has_active_cancellation") and hasattr(
            self.repository, "cancel_step"
        ):
            try:
                if self.repository.has_active_cancellation(claim.workflow_id, step.step_id):  # type: ignore[union-attr]
                    self.repository.cancel_step(  # type: ignore[union-attr]
                        step.step_id,
                        lease=lease,
                        safe_interruptible=False,
                        trace_context=step_trace.child(),
                    )
                    self.repository.release_lease(
                        claim.lease.lease_id, owner_id=self.policy.owner_id
                    )
                    return
            except Exception:
                self.repository.release_lease(claim.lease.lease_id, owner_id=self.policy.owner_id)
                raise
        # -----------------------------------------------------------------------

        running = self.repository.update_step_state(
            step.step_id,
            StepState.RUNNING,
            trace_context=step_trace,
            refs={"lease_ref": f"fixture-ref:lease:{lease.lease_id}"},
            lease=lease,
        )
        try:
            result = self.handler(running, step_trace.child())
            if hasattr(self.repository, "has_active_cancellation") and hasattr(self.repository, "cancel_step"):
                if self.repository.has_active_cancellation(claim.workflow_id, running.step_id):  # type: ignore[union-attr]
                    self.repository.cancel_step(  # type: ignore[union-attr]
                        running.step_id,
                        lease=lease,
                        safe_interruptible=False,
                        trace_context=step_trace.child(),
                    )
                    return
            self.repository.complete_step(
                running.step_id,
                output_ref=result.output_ref,
                trace_context=step_trace.child(),
                refs=result.event_refs,
                lease=lease,
            )
        except Exception as exc:
            self._handle_step_failure(running, exc, lease=lease, trace_context=step_trace.child())
        finally:
            self.repository.release_lease(claim.lease.lease_id, owner_id=self.policy.owner_id)

    def _handle_step_failure(
        self,
        step: WorkflowStep,
        exc: BaseException,
        *,
        lease,
        trace_context: TraceContext,
    ) -> None:
        failure_class = self._failure_class_for(exc)
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
                self.repository.schedule_step_retry(  # type: ignore[attr-defined]
                    decision,
                    next_attempt_at=next_attempt_at,
                    trace_context=trace_context,
                    lease=lease,
                )
                return
            self.repository.update_step_state(
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
        lease,
        trace_context: TraceContext,
    ) -> None:
        if hasattr(self.repository, "record_step_failure"):
            self.repository.record_step_failure(  # type: ignore[attr-defined]
                decision,
                trace_context=trace_context,
                lease=lease,
            )
            return
        self.repository.update_step_state(
            step.step_id,
            StepState.FAILED,
            trace_context=trace_context,
            refs={"failure_class": decision.failure_class.value, "reason_ref": decision.reason_ref or ""},
            lease=lease,
        )

    def _open_manual_review(
        self,
        step: WorkflowStep,
        decision: RetryDecision,
        *,
        lease,
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
            self.repository.open_step_manual_review(  # type: ignore[attr-defined]
                item,
                decision=decision,
                trace_context=trace_context,
                lease=lease,
            )
            return
        self.repository.update_step_state(
            step.step_id,
            StepState.MANUAL_REVIEW,
            trace_context=trace_context,
            refs={"manual_review_reason": reason, "failure_class": decision.failure_class.value},
            lease=lease,
        )
        if hasattr(self.repository, "create_review_item"):
            self.repository.create_review_item(item)  # type: ignore[attr-defined]

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
