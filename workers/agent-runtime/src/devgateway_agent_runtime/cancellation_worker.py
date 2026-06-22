from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Mapping, Protocol


class CancellationWorkerRepository(Protocol):
    def propagate_cancellations(self, *, now: datetime | None = None, limit: int = 100) -> Mapping[str, int]: ...


CommitFn = Callable[[], None]
RollbackFn = Callable[[], None]
SleepFn = Callable[[float], None]


@dataclass(frozen=True, slots=True)
class CancellationWorkerPolicy:
    batch_size: int = 100
    idle_sleep_seconds: float = 10.0


@dataclass(slots=True)
class CancellationWorkerStats:
    claimed: int = 0
    completed: int = 0
    partially_completed_manual_review: int = 0
    steps_cancelled: int = 0
    steps_manual_review: int = 0
    approvals_cancelled: int = 0
    delegations_cancelled: int = 0
    tool_calls_cancelled: int = 0
    agent_runs_cancelled: int = 0
    reservations_released: int = 0
    manual_review_escalations: int = 0
    idle_polls: int = 0

    def apply(self, counters: Mapping[str, int]) -> None:
        for key in (
            "claimed",
            "completed",
            "partially_completed_manual_review",
            "steps_cancelled",
            "steps_manual_review",
            "approvals_cancelled",
            "delegations_cancelled",
            "tool_calls_cancelled",
            "agent_runs_cancelled",
            "reservations_released",
            "manual_review_escalations",
        ):
            setattr(self, key, getattr(self, key) + int(counters.get(key, 0)))

    def to_dict(self) -> dict[str, int]:
        return {
            "claimed": self.claimed,
            "completed": self.completed,
            "partially_completed_manual_review": self.partially_completed_manual_review,
            "steps_cancelled": self.steps_cancelled,
            "steps_manual_review": self.steps_manual_review,
            "approvals_cancelled": self.approvals_cancelled,
            "delegations_cancelled": self.delegations_cancelled,
            "tool_calls_cancelled": self.tool_calls_cancelled,
            "agent_runs_cancelled": self.agent_runs_cancelled,
            "reservations_released": self.reservations_released,
            "manual_review_escalations": self.manual_review_escalations,
            "idle_polls": self.idle_polls,
        }


class CancellationWorker:
    """Propagates durable workflow cancellations through queued and in-flight work."""

    def __init__(
        self,
        repository: CancellationWorkerRepository,
        *,
        policy: CancellationWorkerPolicy | None = None,
        commit: CommitFn | None = None,
        rollback: RollbackFn | None = None,
        sleep: SleepFn | None = None,
    ) -> None:
        self.repository = repository
        self.policy = policy or CancellationWorkerPolicy()
        self.stats = CancellationWorkerStats()
        self._commit = commit or (lambda: None)
        self._rollback = rollback or (lambda: None)
        self._sleep = sleep or time.sleep
        self._stop_requested = False

    def request_stop(self) -> None:
        self._stop_requested = True

    def run_once(self, *, now: datetime | None = None) -> bool:
        try:
            counters = self.repository.propagate_cancellations(now=now, limit=self.policy.batch_size)
        except BaseException:
            self._rollback()
            raise
        self._commit()
        self.stats.apply(counters)
        if int(counters.get("claimed", 0)) == 0:
            self.stats.idle_polls += 1
            return False
        return True

    def run_until_idle(self, *, max_batches: int = 16, now: datetime | None = None) -> CancellationWorkerStats:
        batches = 0
        while not self._stop_requested and batches < max_batches and self.run_once(now=now):
            batches += 1
        return self.stats

    def run_forever(self) -> CancellationWorkerStats:
        while not self._stop_requested:
            if not self.run_once():
                self._sleep(self.policy.idle_sleep_seconds)
        return self.stats
