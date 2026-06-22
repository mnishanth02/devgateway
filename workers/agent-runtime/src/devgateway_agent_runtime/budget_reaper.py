from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Mapping, Protocol


class BudgetReaperRepository(Protocol):
    def reap_orphaned_budget_reservations(
        self,
        *,
        now: datetime | None = None,
        limit: int = 100,
        approval_wait_ttl_seconds: float = 14_400.0,
        abandoned_workflow_seconds: float = 86_400.0,
    ) -> Mapping[str, int]: ...


CommitFn = Callable[[], None]
RollbackFn = Callable[[], None]
SleepFn = Callable[[float], None]


@dataclass(frozen=True, slots=True)
class BudgetReaperPolicy:
    batch_size: int = 100
    idle_sleep_seconds: float = 30.0
    approval_wait_ttl_seconds: float = 14_400.0
    abandoned_workflow_seconds: float = 86_400.0


@dataclass(slots=True)
class BudgetReaperStats:
    inspected: int = 0
    orphaned: int = 0
    reconciled: int = 0
    released: int = 0
    approval_wait_released: int = 0
    expired_lease_released: int = 0
    abandoned_workflow_released: int = 0
    terminal_workflow_released: int = 0
    idle_polls: int = 0

    def apply(self, counters: Mapping[str, int]) -> None:
        for key in (
            "inspected",
            "orphaned",
            "reconciled",
            "released",
            "approval_wait_released",
            "expired_lease_released",
            "abandoned_workflow_released",
            "terminal_workflow_released",
        ):
            setattr(self, key, getattr(self, key) + int(counters.get(key, 0)))

    def to_dict(self) -> dict[str, int]:
        return {
            "inspected": self.inspected,
            "orphaned": self.orphaned,
            "reconciled": self.reconciled,
            "released": self.released,
            "approval_wait_released": self.approval_wait_released,
            "expired_lease_released": self.expired_lease_released,
            "abandoned_workflow_released": self.abandoned_workflow_released,
            "terminal_workflow_released": self.terminal_workflow_released,
            "idle_polls": self.idle_polls,
        }


class BudgetReaper:
    """Reconciles orphaned reserved budget rows without double-releasing them."""

    def __init__(
        self,
        repository: BudgetReaperRepository,
        *,
        policy: BudgetReaperPolicy | None = None,
        commit: CommitFn | None = None,
        rollback: RollbackFn | None = None,
        sleep: SleepFn | None = None,
    ) -> None:
        self.repository = repository
        self.policy = policy or BudgetReaperPolicy()
        self.stats = BudgetReaperStats()
        self._commit = commit or (lambda: None)
        self._rollback = rollback or (lambda: None)
        self._sleep = sleep or time.sleep
        self._stop_requested = False

    def request_stop(self) -> None:
        self._stop_requested = True

    def run_once(self, *, now: datetime | None = None) -> bool:
        try:
            counters = self.repository.reap_orphaned_budget_reservations(
                now=now,
                limit=self.policy.batch_size,
                approval_wait_ttl_seconds=self.policy.approval_wait_ttl_seconds,
                abandoned_workflow_seconds=self.policy.abandoned_workflow_seconds,
            )
        except BaseException:
            self._rollback()
            raise
        self._commit()
        self.stats.apply(counters)
        if int(counters.get("released", 0)) == 0:
            self.stats.idle_polls += 1
            return False
        return True

    def run_until_idle(self, *, max_batches: int = 16, now: datetime | None = None) -> BudgetReaperStats:
        batches = 0
        while not self._stop_requested and batches < max_batches and self.run_once(now=now):
            batches += 1
        return self.stats

    def run_forever(self) -> BudgetReaperStats:
        while not self._stop_requested:
            if not self.run_once():
                self._sleep(self.policy.idle_sleep_seconds)
        return self.stats
