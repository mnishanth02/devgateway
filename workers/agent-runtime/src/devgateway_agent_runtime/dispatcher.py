from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

from .contracts import TraceContext, WorkflowStep, StepKind, StepState
from .leases import LeasePolicy, StepClaim
from .repositories import RuntimeRepository


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


@dataclass(frozen=True, slots=True)
class StepExecutionResult:
    output_ref: str
    event_refs: dict[str, str]


StepHandler = Callable[[WorkflowStep, TraceContext], StepExecutionResult]
SleepFn = Callable[[float], None]


class BoundedDispatcher:
    """Claims and executes a bounded number of workflow steps without provider/tool coupling."""

    def __init__(
        self,
        repository: RuntimeRepository,
        handler: StepHandler,
        *,
        policy: DispatcherPolicy | None = None,
        sleep: SleepFn | None = None,
    ) -> None:
        self.repository = repository
        self.handler = handler
        self.policy = policy or DispatcherPolicy()
        self._sleep = sleep or (lambda _seconds: None)

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
            recovered += self.repository.recover_stale_leases()
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
        self.repository.recover_stale_leases()
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
        running = self.repository.update_step_state(
            step.step_id,
            StepState.RUNNING,
            trace_context=step_trace,
            refs={"lease_ref": f"fixture-ref:lease:{lease.lease_id}"},
        )
        try:
            result = self.handler(running, step_trace.child())
            self.repository.complete_step(
                running.step_id,
                output_ref=result.output_ref,
                trace_context=step_trace.child(),
                refs=result.event_refs,
            )
        except Exception:
            self.repository.update_step_state(
                running.step_id,
                StepState.FAILED,
                trace_context=step_trace.child(),
                refs={"error_ref": f"fixture-ref:error:{running.step_id}"},
            )
            raise
        finally:
            self.repository.release_lease(claim.lease.lease_id, owner_id=self.policy.owner_id)
