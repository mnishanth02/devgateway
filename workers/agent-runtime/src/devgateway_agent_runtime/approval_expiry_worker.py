from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol


class ApprovalExpiryRepository(Protocol):
    def expire_due_approvals(self, *, now: datetime | None = None, limit: int = 100) -> int: ...


CommitFn = Callable[[], None]
RollbackFn = Callable[[], None]
SleepFn = Callable[[float], None]


@dataclass(frozen=True, slots=True)
class ApprovalExpiryWorkerPolicy:
    batch_size: int = 100
    idle_sleep_seconds: float = 30.0


@dataclass(slots=True)
class ApprovalExpiryWorkerStats:
    expired_approvals: int = 0
    idle_polls: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "expired_approvals": self.expired_approvals,
            "idle_polls": self.idle_polls,
        }


class ApprovalExpiryWorker:
    """Expires approval requests past risk-tier TTL and applies fail-closed policy."""

    def __init__(
        self,
        repository: ApprovalExpiryRepository,
        *,
        policy: ApprovalExpiryWorkerPolicy | None = None,
        commit: CommitFn | None = None,
        rollback: RollbackFn | None = None,
        sleep: SleepFn | None = None,
    ) -> None:
        self.repository = repository
        self.policy = policy or ApprovalExpiryWorkerPolicy()
        self.stats = ApprovalExpiryWorkerStats()
        self._commit = commit or (lambda: None)
        self._rollback = rollback or (lambda: None)
        self._sleep = sleep or time.sleep
        self._stop_requested = False

    def request_stop(self) -> None:
        self._stop_requested = True

    def run_once(self, *, now: datetime | None = None) -> bool:
        try:
            expired = self.repository.expire_due_approvals(now=now, limit=self.policy.batch_size)
        except BaseException:
            self._rollback()
            raise
        self._commit()
        if expired == 0:
            self.stats.idle_polls += 1
            return False
        self.stats.expired_approvals += expired
        return True

    def run_until_idle(self, *, max_batches: int = 16, now: datetime | None = None) -> ApprovalExpiryWorkerStats:
        batches = 0
        while not self._stop_requested and batches < max_batches and self.run_once(now=now):
            batches += 1
        return self.stats

    def run_forever(self) -> ApprovalExpiryWorkerStats:
        while not self._stop_requested:
            if not self.run_once():
                self._sleep(self.policy.idle_sleep_seconds)
        return self.stats
