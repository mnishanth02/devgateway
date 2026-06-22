from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import Enum

from .contracts import isoformat_utc, utc_now


class IdempotencyScope(str, Enum):
    WORKFLOW_CREATION = "workflow_creation"
    STEP_EXECUTION = "step_execution"
    MODEL_CALL = "model_call"
    TOOL_CALL = "tool_call"
    BUDGET_RESERVATION = "budget_reservation"
    COST_EVENT = "cost_event"
    AUDIT_EVENT = "audit_event"
    ARTIFACT_WRITE = "artifact_write"
    # Track 3: durable workflow / approval / outbox scopes
    APPROVAL = "approval"
    OUTBOX = "outbox"
    CANCELLATION = "cancellation"
    RETRY = "retry"
    MANUAL_REVIEW = "manual_review"
    RESERVATION_RELEASE = "reservation_release"
    ARTIFACT_LIFECYCLE = "artifact_lifecycle"
    TEMPLATE_INSTANTIATION = "template_instantiation"


class IdempotencyStatus(str, Enum):
    RESERVED = "reserved"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class IdempotencyRecord:
    scope: IdempotencyScope
    key: str
    workflow_id: str | None = None
    step_id: str | None = None
    request_ref: str | None = None
    result_ref: str | None = None
    status: IdempotencyStatus = IdempotencyStatus.RESERVED
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    @property
    def identity(self) -> tuple[IdempotencyScope, str]:
        return (self.scope, self.key)

    def complete(self, result_ref: str, *, now: datetime | None = None) -> "IdempotencyRecord":
        return replace(self, result_ref=result_ref, status=IdempotencyStatus.COMPLETED, updated_at=now or utc_now())

    def fail(self, result_ref: str, *, now: datetime | None = None) -> "IdempotencyRecord":
        return replace(self, result_ref=result_ref, status=IdempotencyStatus.FAILED, updated_at=now or utc_now())

    def to_dict(self) -> dict[str, object]:
        return {
            "scope": self.scope.value,
            "key": self.key,
            "workflow_id": self.workflow_id,
            "step_id": self.step_id,
            "request_ref": self.request_ref,
            "result_ref": self.result_ref,
            "status": self.status.value,
            "created_at": isoformat_utc(self.created_at),
            "updated_at": isoformat_utc(self.updated_at),
        }


def stable_idempotency_key(scope: IdempotencyScope, opaque_ref: str) -> str:
    digest = hashlib.sha256(f"{scope.value}:{opaque_ref}".encode("utf-8")).hexdigest()[:24]
    return f"{scope.value}:{digest}"
