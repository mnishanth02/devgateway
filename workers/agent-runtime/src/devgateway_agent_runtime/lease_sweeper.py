from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class LeaseSweepResult:
    expired: int = 0
    recovered: int = 0
    escalated: int = 0


class _SweepRepository(Protocol):
    def sweep_expired_step_leases(self, *, now: datetime | None = None) -> dict[str, int]: ...


class LeaseSweeper:
    """Reclaims expired pre-side-effect leases and escalates ambiguous work."""

    def __init__(self, repository: _SweepRepository) -> None:
        self.repository = repository

    def sweep_once(self, *, now: datetime | None = None) -> LeaseSweepResult:
        result = self.repository.sweep_expired_step_leases(now=now)
        return LeaseSweepResult(
            expired=int(result.get("expired", 0)),
            recovered=int(result.get("recovered", 0)),
            escalated=int(result.get("escalated", 0)),
        )
