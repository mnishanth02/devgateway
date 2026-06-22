from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from uuid import uuid4

from .contracts import isoformat_utc, utc_now


@dataclass(frozen=True, slots=True)
class LeasePolicy:
    ttl_seconds: float = 30.0
    heartbeat_seconds: float = 10.0

    def expires_at(self, now: datetime | None = None) -> datetime:
        return (now or utc_now()) + timedelta(seconds=self.ttl_seconds)


@dataclass(frozen=True, slots=True)
class Lease:
    resource_id: str
    owner_id: str
    expires_at: datetime
    lease_id: str = field(default_factory=lambda: uuid4().hex)
    acquired_at: datetime = field(default_factory=utc_now)
    heartbeat_at: datetime = field(default_factory=utc_now)
    # Monotonically increasing fencing token; incremented by the repository on each
    # new acquisition of the same resource. Defaults to 0 for backward compat with
    # in-memory fixture repository which does not yet track the counter.
    fencing_token: int = 0

    def is_expired(self, now: datetime | None = None) -> bool:
        return (now or utc_now()) >= self.expires_at

    def heartbeat(self, policy: LeasePolicy, *, now: datetime | None = None) -> "Lease":
        timestamp = now or utc_now()
        # fencing_token is preserved on heartbeat; it only advances on new acquisition.
        return replace(self, heartbeat_at=timestamp, expires_at=policy.expires_at(timestamp))

    def to_dict(self) -> dict[str, object]:
        return {
            "lease_id": self.lease_id,
            "resource_id": self.resource_id,
            "owner_id": self.owner_id,
            "acquired_at": isoformat_utc(self.acquired_at),
            "heartbeat_at": isoformat_utc(self.heartbeat_at),
            "expires_at": isoformat_utc(self.expires_at),
            "fencing_token": self.fencing_token,
        }


@dataclass(frozen=True, slots=True)
class StepClaim:
    step_id: str
    workflow_id: str
    lease: Lease

    def to_dict(self) -> dict[str, object]:
        return {"step_id": self.step_id, "workflow_id": self.workflow_id, "lease": self.lease.to_dict()}
