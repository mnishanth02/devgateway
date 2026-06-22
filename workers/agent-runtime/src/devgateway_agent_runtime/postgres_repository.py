"""
PostgreSQL-backed RuntimeRepository for DevGateway Agent Runtime.

Design:
- No psycopg/asyncpg imports occur at module import time; the caller injects
  a PEP-249-compatible connection object.
- Rows returned by cursors must support column-name access (dict or dict-row
  factory such as psycopg.rows.dict_row / psycopg2 RealDictCursor).
- All SQL is isolated here; business logic stays in supervisor/dispatcher.
- Each repository method executes SQL within the caller's transaction; this
  module never calls conn.commit() or conn.rollback().
- fencing_token: a new active lease gets MAX(prior fencing_token)+1 for that
  lease_key; heartbeat preserves the token; release sets status='released'.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Sequence
from uuid import uuid4

from .contracts import (
    TERMINAL_WORKFLOW_STATES,
    PAUSED_WORKFLOW_STATES,
    TraceContext,
    Workflow,
    WorkflowEvent,
    WorkflowOutboxEvent,
    WorkflowState,
    WorkflowStep,
    StepKind,
    StepState,
    STEP_TRANSITIONS,
    ApprovalDecision,
    ApprovalRequest,
    ApprovalRiskTier,
    ApprovalStatus,
    ArtifactLifecycleEvent,
    ArtifactLifecycleStage,
    CancellationAction,
    CancellationPropagationState,
    CancellationRecord,
    CancellationTarget,
    FailureClass,
    ManualReviewItem,
    ManualReviewStatus,
    OutboxEventStatus,
    RetryDecision,
    WorkflowTransitionError,
    isoformat_utc,
    utc_now,
)
from .idempotency import IdempotencyRecord, IdempotencyScope, IdempotencyStatus
from .leases import Lease, LeasePolicy, StepClaim
from .memory import RepositoryError
from .approvals import (
    approval_decision_to_step_state,
    approval_decision_to_workflow_state,
    approval_expires_at,
    default_approval_ttl_seconds,
    stable_approval_resume_token,
)

DEFAULT_STATE_CHANGE_OUTBOX_DESTINATIONS: tuple[str, ...] = ("trace", "portal_update")


# ---------------------------------------------------------------------------
# Scope configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RepositoryScope:
    """Internal numeric IDs and defaults required to write to the operational schema.

    The operational schema uses numeric FKs for project/principal/budget; these
    must be resolved by the application bootstrap layer before constructing this scope.
    """

    project_id: int
    principal_id: int
    budget_scope_id: int
    policy_version: str = "v1"
    registry_version: str = "v1"
    data_class: str = "internal"


# ---------------------------------------------------------------------------
# Idempotency status bridge (DB constraint uses different values)
# ---------------------------------------------------------------------------

# workflow_idempotency_key.status CHECK constraint from migration 0001:
# ('pending', 'in_progress', 'succeeded', 'failed', 'expired')
# This constraint was NOT dropped; we must map Python → DB values.

_PY_TO_DB_IDEMPOTENCY_STATUS: dict[IdempotencyStatus, str] = {
    IdempotencyStatus.RESERVED: "pending",
    IdempotencyStatus.COMPLETED: "succeeded",
    IdempotencyStatus.FAILED: "failed",
}

_DB_TO_PY_IDEMPOTENCY_STATUS: dict[str, IdempotencyStatus] = {
    "pending": IdempotencyStatus.RESERVED,
    "in_progress": IdempotencyStatus.RESERVED,  # treat in-progress as still reserved
    "succeeded": IdempotencyStatus.COMPLETED,
    "failed": IdempotencyStatus.FAILED,
    "expired": IdempotencyStatus.FAILED,  # treat expired as failed at the Python layer
}

_PY_TO_DB_IDEMPOTENCY_OPERATION: dict[IdempotencyScope, str] = {
    IdempotencyScope.WORKFLOW_CREATION: "workflow_create",
    IdempotencyScope.STEP_EXECUTION: "step_execute",
    IdempotencyScope.MODEL_CALL: "model_call",
    IdempotencyScope.TOOL_CALL: "tool_call",
    IdempotencyScope.BUDGET_RESERVATION: "budget_reservation",
    IdempotencyScope.COST_EVENT: "cost_event",
    IdempotencyScope.AUDIT_EVENT: "audit_event",
    IdempotencyScope.ARTIFACT_WRITE: "artifact_write",
    IdempotencyScope.APPROVAL: "approval",
    IdempotencyScope.OUTBOX: "outbox",
    IdempotencyScope.CANCELLATION: "cancellation",
    IdempotencyScope.RETRY: "retry",
    IdempotencyScope.MANUAL_REVIEW: "manual_review",
    IdempotencyScope.RESERVATION_RELEASE: "reservation_release",
    IdempotencyScope.ARTIFACT_LIFECYCLE: "artifact_lifecycle",
    IdempotencyScope.TEMPLATE_INSTANTIATION: "template_instantiation",
}
_DB_TO_PY_IDEMPOTENCY_OPERATION = {value: key for key, value in _PY_TO_DB_IDEMPOTENCY_OPERATION.items()}

_PY_STEP_KIND_TO_DB: dict[StepKind, str] = {
    StepKind.PLANNING: "plan",
    StepKind.DELEGATING: "delegate",
    StepKind.RUNNING: "agent",
    StepKind.SYNTHESIZING: "synthesize",
    StepKind.APPROVAL_GATE: "approval_gate",
    StepKind.REVIEW: "review",
}
_DB_STEP_KIND_TO_PY: dict[str, StepKind] = {
    "plan": StepKind.PLANNING,
    "delegate": StepKind.DELEGATING,
    "agent": StepKind.RUNNING,
    "tool": StepKind.RUNNING,
    "synthesize": StepKind.SYNTHESIZING,
    "review": StepKind.REVIEW,
    "artifact": StepKind.RUNNING,
    "approval_gate": StepKind.APPROVAL_GATE,
}

_PY_STEP_STATE_TO_DB: dict[StepState, str] = {
    StepState.PENDING: "created",
    StepState.CLAIMED: "planning",
    StepState.RUNNING: "running",
    StepState.COMPLETED: "completed",
    StepState.FAILED: "failed",
    StepState.SKIPPED: "skipped",
    StepState.PENDING_APPROVAL: "pending_approval",
    StepState.MANUAL_REVIEW: "manual_review",
    StepState.CANCELLED: "cancelled",
}
_DB_STEP_STATE_TO_PY: dict[str, StepState] = {
    "created": StepState.PENDING,
    "planning": StepState.CLAIMED,
    "delegating": StepState.CLAIMED,
    "synthesizing": StepState.CLAIMED,
    "running": StepState.RUNNING,
    "pending_approval": StepState.PENDING_APPROVAL,
    "manual_review": StepState.MANUAL_REVIEW,
    "completed": StepState.COMPLETED,
    "failed": StepState.FAILED,
    "skipped": StepState.SKIPPED,
    "cancel_requested": StepState.CANCELLED,
    "cancelled": StepState.CANCELLED,
    "timed_out": StepState.FAILED,
}

_RUNTIME_EVENT_TYPE_TO_DB: dict[str, str] = {
    "workflow.created": "workflow_created",
    "workflow.completed": "workflow_completed",
    "workflow.failed": "workflow_failed",
    "step.created": "step_created",
    "step.completed": "step_state_changed",
    "step.claimed": "step_state_changed",
    "step.running": "step_state_changed",
    "step.failed": "step_state_changed",
    "step.cancelled": "step_state_changed",
    "step.pending_approval": "step_state_changed",
    "step.manual_review": "step_state_changed",
    "lease.acquired": "lease_acquired",
    "lease.released": "lease_released",
    "budget.reservation.orphaned": "budget_recorded",
    "budget.reservation.reconciled": "budget_recorded",
    "budget.reservation.released": "budget_recorded",
    "budget.reservation.reestimate_required": "budget_recorded",
    "approval.approved.resumed": "approval_approved",
    "approval.denied.resumed": "approval_denied",
    "approval.expired.resumed": "approval_expired",
}

STEP_ATTEMPT_REPLAY_DECISIONS: tuple[str, ...] = (
    "replay",
    "skip",
    "abort",
    "pre_side_effect",
    "idempotent_pre_side_effect",
    "ambiguous_post_side_effect",
    "retry_scheduled",
    "terminal_failure",
    "manual_review",
)

_MANUAL_REVIEW_REASONS = frozenset(
    {
        "non_idempotent_side_effect",
        "stuck_lease_recovery",
        "stuck_lease",
        "ambiguous_external_call",
        "partial_artifact_write",
        "retry_exhausted_non_idempotent",
        "retry_exhausted",
        "worker_crash_non_recoverable",
        "budget_anomaly",
        "policy_ambiguity",
        "cancellation_unresolvable",
    }
)


def idempotency_status_to_db(status: IdempotencyStatus) -> str:
    """Map a Python IdempotencyStatus to its DB column value."""
    db = _PY_TO_DB_IDEMPOTENCY_STATUS.get(status)
    if db is None:
        raise RepositoryError(f"no DB mapping for idempotency status {status!r}")
    return db


def db_to_idempotency_status(db_status: str) -> IdempotencyStatus:
    """Map a DB idempotency status value to the Python IdempotencyStatus enum."""
    py = _DB_TO_PY_IDEMPOTENCY_STATUS.get(db_status)
    if py is None:
        raise RepositoryError(f"unknown DB idempotency status: {db_status!r}")
    return py


def idempotency_scope_to_db(scope: IdempotencyScope) -> str:
    operation = _PY_TO_DB_IDEMPOTENCY_OPERATION.get(scope)
    if operation is None:
        raise RepositoryError(f"no DB operation mapping for idempotency scope {scope!r}")
    return operation


def db_to_idempotency_scope(operation: str) -> IdempotencyScope:
    scope = _DB_TO_PY_IDEMPOTENCY_OPERATION.get(operation)
    if scope is None:
        raise RepositoryError(f"unknown DB idempotency operation: {operation!r}")
    return scope


def step_kind_to_db(kind: StepKind) -> str:
    db_kind = _PY_STEP_KIND_TO_DB.get(kind)
    if db_kind is None:
        raise RepositoryError(f"no DB step_type mapping for step kind {kind!r}")
    return db_kind


def db_to_step_kind(step_type: str) -> StepKind:
    kind = _DB_STEP_KIND_TO_PY.get(step_type)
    if kind is None:
        raise RepositoryError(f"unknown DB step_type: {step_type!r}")
    return kind


def step_state_to_db(state: StepState) -> str:
    db_state = _PY_STEP_STATE_TO_DB.get(state)
    if db_state is None:
        raise RepositoryError(f"no DB state mapping for step state {state!r}")
    return db_state


def db_to_step_state(state: str) -> StepState:
    step_state = _DB_STEP_STATE_TO_PY.get(state)
    if step_state is None:
        raise RepositoryError(f"unknown DB workflow_step state: {state!r}")
    return step_state


def event_type_to_db(event_type: str) -> str:
    if event_type in _RUNTIME_EVENT_TYPE_TO_DB:
        return _RUNTIME_EVENT_TYPE_TO_DB[event_type]
    if event_type.startswith("budget."):
        return "budget_recorded"
    if event_type.startswith("workflow."):
        return "workflow_state_changed"
    if event_type.startswith("step."):
        return "step_state_changed"
    return event_type


def _outbox_destinations_for_event(event: WorkflowEvent) -> tuple[str, ...]:
    destinations: list[str] = list(DEFAULT_STATE_CHANGE_OUTBOX_DESTINATIONS)
    refs = event.refs
    if "audit_ref" in refs:
        destinations.append("audit")
    if "notification_ref" in refs:
        destinations.append("notification")
    if "eval_evidence_ref" in refs:
        destinations.append("eval_evidence")
    return tuple(dict.fromkeys(destinations))


# ---------------------------------------------------------------------------
# Approval state DB bridge
# ---------------------------------------------------------------------------

# DB CHECK constraint: ('pending', 'approved', 'denied', 'expired', 'cancelled', 'superseded')
# Python ApprovalStatus values match the DB values directly.

_APPROVAL_TERMINAL_DB_STATES: frozenset[str] = frozenset(
    {
        ApprovalStatus.APPROVED.value,
        ApprovalStatus.DENIED.value,
        ApprovalStatus.EXPIRED.value,
        ApprovalStatus.CANCELLED.value,
        ApprovalStatus.SUPERSEDED.value,
    }
)

# The APPROVED state requires proof FK columns in the DB (approved_proof_check
# constraint).  Transitioning to 'approved' from the runtime layer is not safe
# because the runtime does not hold the numeric PK lookups for
# approver_principal_id / required_role_id / action_summary_artifact_id /
# decision_audit_event_id.  Those must be set by the control-api layer.
_RUNTIME_RECORDABLE_DECISION_STATES: frozenset[ApprovalStatus] = frozenset(
    {
        ApprovalStatus.DENIED,
        ApprovalStatus.EXPIRED,
        ApprovalStatus.CANCELLED,
        ApprovalStatus.SUPERSEDED,
    }
)


def approval_status_to_db(status: ApprovalStatus) -> str:
    """Map a Python ApprovalStatus to its DB column value."""
    return status.value


def db_to_approval_status(db_state: str) -> ApprovalStatus:
    """Map a DB approval state string to ApprovalStatus."""
    try:
        return ApprovalStatus(db_state)
    except ValueError:
        raise RepositoryError(f"unknown DB approval state: {db_state!r}")


def approval_risk_tier_to_db(tier: ApprovalRiskTier) -> str:
    """Map an ApprovalRiskTier to its DB column value."""
    return tier.value


def db_to_approval_risk_tier(db_tier: str) -> ApprovalRiskTier:
    """Map a DB risk_tier string to ApprovalRiskTier."""
    try:
        return ApprovalRiskTier(db_tier)
    except ValueError:
        raise RepositoryError(f"unknown DB approval risk_tier: {db_tier!r}")


# ---------------------------------------------------------------------------
# Pure row-to-dataclass mapping helpers (no DB access, fully testable)
# ---------------------------------------------------------------------------


def _parse_dt(value: Any) -> datetime:
    """Coerce a DB value to a timezone-aware datetime."""
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    raise RepositoryError(f"cannot parse datetime from {value!r}")


def _parse_meta(row: Mapping[str, Any], key: str) -> dict[str, Any]:
    """Safely parse a JSONB/text metadata column from a row."""
    raw = row.get(key)
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        return json.loads(raw)
    return {}


def _row_val(row: Any, key: str, index: int) -> Any:
    """Access a row by column name if dict-like, else by positional index."""
    try:
        return row[key]
    except (KeyError, TypeError):
        return row[index]


def row_to_workflow(row: Mapping[str, Any]) -> Workflow:
    """Map a workflow_run DB row (with text IDs) to a Workflow dataclass.

    Expected columns (use explicit SELECT lists or JOIN aliases):
        workflow_run_id (text), state, idempotency_key, task_ref,
        trace_id, metadata (JSONB/text with version/span_id/…),
        created_at, updated_at
    """
    meta = _parse_meta(row, "metadata")
    trace_context = TraceContext(
        trace_id=row["trace_id"],
        span_id=meta.get("span_id") or row.get("request_id") or uuid4().hex[:16],
        parent_span_id=meta.get("parent_span_id"),
        correlation_id=meta.get("correlation_id"),
        baggage_refs=tuple(meta.get("baggage_refs", ())),
    )
    return Workflow(
        workflow_id=row["workflow_run_id"],
        state=WorkflowState(row["state"]),
        idempotency_key=row.get("idempotency_key") or "",
        trace_context=trace_context,
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
        version=int(meta.get("version", 0)),
        workflow_ref=row.get("task_ref") or "",
    )


def row_to_step(row: Mapping[str, Any]) -> WorkflowStep:
    """Map a workflow_step DB row (with text workflow_run_id from JOIN) to WorkflowStep.

    Expected columns:
        workflow_step_id (text), workflow_run_id (text — from JOIN with workflow_run),
        step_type, state, task_ref, idempotency_key, ordinal, metadata, created_at, updated_at
    """
    meta = _parse_meta(row, "metadata")
    return WorkflowStep(
        step_id=row["workflow_step_id"],
        workflow_id=row["workflow_run_id"],
        kind=db_to_step_kind(row["step_type"]),
        state=db_to_step_state(row["state"]),
        input_ref=meta.get("input_ref") or row.get("task_ref") or "",
        idempotency_key=row.get("idempotency_key") or "",
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
        attempt=int(row.get("ordinal") or 0),
        output_ref=meta.get("output_ref"),
    )


def row_to_event(row: Mapping[str, Any]) -> WorkflowEvent:
    """Map a workflow_event DB row (with text IDs from JOINs) to WorkflowEvent.

    Expected columns:
        workflow_event_id (text), workflow_run_id (text — from JOIN),
        event_type, state (nullable), trace_id, metadata,
        event_time or created_at,
        workflow_step_id_text (nullable text — from LEFT JOIN with workflow_step)
    """
    meta = _parse_meta(row, "metadata")
    trace_context = TraceContext(
        trace_id=row["trace_id"],
        span_id=meta.get("span_id") or row.get("request_id") or uuid4().hex[:16],
        parent_span_id=meta.get("parent_span_id"),
        correlation_id=meta.get("correlation_id"),
        baggage_refs=tuple(meta.get("baggage_refs", ())),
    )
    state_raw = row.get("state")
    occurred_raw = row.get("event_time") or row.get("created_at")
    return WorkflowEvent(
        event_id=row["workflow_event_id"],
        workflow_id=row["workflow_run_id"],
        event_type=row["event_type"],
        trace_context=trace_context,
        occurred_at=_parse_dt(occurred_raw) if occurred_raw else utc_now(),
        state=WorkflowState(state_raw) if state_raw else None,
        step_id=row.get("workflow_step_id_text"),
        refs=dict(meta.get("refs", {})),
    )


def row_to_lease(row: Mapping[str, Any]) -> Lease:
    """Map a workflow_lease DB row to a Lease dataclass.

    Expected columns:
        workflow_lease_id, lease_key, lease_owner, fencing_token,
        acquired_at, heartbeat_at, expires_at
    """
    return Lease(
        lease_id=row["workflow_lease_id"],
        resource_id=row["lease_key"],
        owner_id=row["lease_owner"],
        fencing_token=int(row["fencing_token"]),
        acquired_at=_parse_dt(row["acquired_at"]),
        heartbeat_at=_parse_dt(row.get("heartbeat_at") or row["acquired_at"]),
        expires_at=_parse_dt(row["expires_at"]),
    )


def row_to_idempotency(row: Mapping[str, Any]) -> IdempotencyRecord:
    """Map a workflow_idempotency_key DB row to IdempotencyRecord.

    Expected columns:
        operation, idempotency_key, status, result_ref (nullable),
        metadata (JSONB/text with request_ref, workflow_id, step_id),
        created_at, updated_at
    """
    meta = _parse_meta(row, "metadata")
    return IdempotencyRecord(
        scope=db_to_idempotency_scope(row["operation"]),
        key=row["idempotency_key"],
        workflow_id=meta.get("workflow_id") or row.get("workflow_run_id_text"),
        step_id=meta.get("step_id") or row.get("workflow_step_id_text"),
        request_ref=meta.get("request_ref"),
        result_ref=row.get("result_ref"),
        status=db_to_idempotency_status(row["status"]),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def row_to_retry_decision(row: Mapping[str, Any]) -> RetryDecision:
    meta = _parse_meta(row, "metadata")
    return RetryDecision(
        workflow_id=row["workflow_run_id_text"],
        step_id=row["workflow_step_id_text"],
        attempt=int(row["attempt_number"]),
        failure_class=FailureClass(row["failure_class"]),
        eligible=bool(meta.get("retry_eligible", False)),
        delay_seconds=float(meta.get("retry_delay_seconds", 0.0)),
        reason_ref=row.get("failure_reason") or meta.get("reason_ref"),
    )


def _manual_review_reason(reason_ref: str | None) -> str:
    if reason_ref in _MANUAL_REVIEW_REASONS:
        return str(reason_ref)
    return "ambiguous_external_call"


def row_to_manual_review_item(row: Mapping[str, Any]) -> ManualReviewItem:
    step_id = row.get("workflow_step_id_text")
    return ManualReviewItem(
        review_id=row["manual_review_item_id"],
        workflow_id=row["workflow_run_id_text"],
        review_ref=f"runtime-ref:manual-review:{row['manual_review_item_id']}",
        status=ManualReviewStatus(row["review_state"]),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
        step_id=step_id,
        reviewer_ref=str(row.get("owner_principal_id")) if row.get("owner_principal_id") is not None else None,
        reason_ref=row.get("reason"),
        artifact_refs=tuple(_parse_meta(row, "side_effect_refs").values())
        if isinstance(row.get("side_effect_refs"), dict)
        else tuple(row.get("side_effect_refs") or ()),
    )


def row_to_cancellation(row: Mapping[str, Any]) -> CancellationRecord:
    """Map a workflow_cancellation DB row to CancellationRecord.

    Expected columns (include JOIN alias ``workflow_run_id_text`` for the text ID):
        workflow_cancellation_id, workflow_run_id_text (text — from JOIN),
        task_ref (nullable), target_refs, propagation_state, created_at, updated_at
    """
    prop_raw: str = row.get("propagation_state") or "requested"
    prop_state = CancellationPropagationState(prop_raw)
    _terminal = frozenset(
        {
            CancellationPropagationState.COMPLETED.value,
            CancellationPropagationState.PARTIALLY_COMPLETED.value,
            CancellationPropagationState.PARTIALLY_COMPLETED_MANUAL_REVIEW.value,
        }
    )
    completed_at = _parse_dt(row["updated_at"]) if prop_raw in _terminal else None
    target_refs = _parse_meta(row, "target_refs")
    target_raw = target_refs.get("target") or CancellationTarget.WORKFLOW.value
    return CancellationRecord(
        cancellation_id=row["workflow_cancellation_id"],
        target=CancellationTarget(target_raw),
        workflow_id=row["workflow_run_id_text"],
        propagation_state=prop_state,
        step_id=target_refs.get("step_id"),
        reason_ref=row.get("task_ref"),
        requested_at=_parse_dt(row["created_at"]),
        completed_at=completed_at,
    )


def cancellation_replay_matches(existing: CancellationRecord, requested: CancellationRecord) -> bool:
    return (
        existing.workflow_id == requested.workflow_id
        and existing.target == requested.target
        and existing.step_id == requested.step_id
        and existing.reason_ref == requested.reason_ref
    )


def row_to_approval_request(row: Mapping[str, Any]) -> ApprovalRequest:
    """Map an approval_request DB row (with JOIN aliases) to ApprovalRequest.

    Expected columns:
        approval_request_id (text), workflow_run_id_text (text — from JOIN),
        task_id, approver_policy_ref, risk_tier, expires_at (nullable),
        approver_policy_metadata (JSONB/text with requester_ref, context_ref),
        created_at,
        workflow_step_id_text (nullable text — from LEFT JOIN with workflow_step)
    """
    meta = _parse_meta(row, "approver_policy_metadata")
    expires_raw = row.get("expires_at")
    return ApprovalRequest(
        approval_id=row["approval_request_id"],
        workflow_id=row["workflow_run_id_text"],
        approval_ref=row.get("task_id") or "",
        requester_ref=meta.get("requester_ref") or "",
        policy_ref=row.get("approver_policy_ref") or "",
        requested_at=_parse_dt(row["created_at"]),
        step_id=row.get("workflow_step_id_text"),
        expires_at=_parse_dt(expires_raw) if expires_raw else None,
        context_ref=meta.get("context_ref"),
        risk_tier=db_to_approval_risk_tier(row.get("risk_tier") or "high"),
    )


def approval_request_replay_matches(existing: ApprovalRequest, requested: ApprovalRequest) -> bool:
    return (
        existing.workflow_id == requested.workflow_id
        and existing.step_id == requested.step_id
        and existing.approval_ref == requested.approval_ref
        and existing.requester_ref == requested.requester_ref
        and existing.policy_ref == requested.policy_ref
        and existing.context_ref == requested.context_ref
        and existing.risk_tier == requested.risk_tier
        and existing.expires_at == requested.expires_at
    )


def row_to_outbox_event(row: Mapping[str, Any]) -> WorkflowOutboxEvent:
    """Map a workflow_outbox DB row (with JOIN aliases) to WorkflowOutboxEvent.

    Expected columns:
        outbox_id, destination_kind, delivery_state, attempt_count,
        next_attempt_at (nullable), last_failure_ref (nullable),
        idempotency_key, payload_artifact_ref (nullable text alias),
        created_at, updated_at,
        workflow_run_id_text (text — from JOIN with workflow_run),
        source_event_id_text (text — from JOIN with workflow_event)
    """
    meta = _parse_meta(row, "metadata")
    next_at_raw = row.get("next_attempt_at")
    delivered_raw = (
        (row.get("updated_at") or row.get("delivered_at"))
        if row.get("delivery_state") == OutboxEventStatus.DELIVERED.value
        else None
    )
    return WorkflowOutboxEvent(
        outbox_id=row["outbox_id"],
        workflow_id=row["workflow_run_id_text"],
        source_event_ref=row["source_event_id_text"],
        destination_kind=row["destination_kind"],
        payload_artifact_ref=row.get("payload_artifact_ref") or meta.get("payload_artifact_ref"),
        delivery_state=OutboxEventStatus(row["delivery_state"]),
        attempt_count=int(row.get("attempt_count") or 0),
        next_attempt_at=_parse_dt(next_at_raw) if next_at_raw else None,
        last_failure_ref=row.get("last_failure_ref"),
        idempotency_key=row["idempotency_key"],
        enqueued_at=_parse_dt(row["created_at"]),
        delivered_at=_parse_dt(delivered_raw) if delivered_raw else None,
    )


def row_to_artifact_lifecycle_event(row: Mapping[str, Any]) -> ArtifactLifecycleEvent:
    """Map an artifact_lifecycle_event DB row to an :class:`ArtifactLifecycleEvent`.

    Expected columns (include JOIN alias ``task_artifact_id_text`` for the text ID):
        artifact_lifecycle_event_id, task_artifact_id_text (text — from JOIN with task_artifact),
        action, state (nullable), storage_ref (nullable), content_hash (nullable),
        retention_policy_ref (nullable), signed_access_eligible (bool),
        signed_access_requires_approval (bool), legal_hold_ref (nullable text),
        redaction_ref (nullable text), expires_at (nullable),
        audit_event_id (nullable), idempotency_key (nullable),
        trace_id (used as workflow_id correlation), created_at

    Storage refs are returned as opaque refs only — no signed URLs are generated.
    """
    expires_raw = row.get("expires_at")
    legal_hold_ref = row.get("legal_hold_ref")
    redaction_ref = row.get("redaction_ref")
    audit_id = row.get("audit_event_id")
    return ArtifactLifecycleEvent(
        lifecycle_id=row["artifact_lifecycle_event_id"],
        artifact_ref=row["task_artifact_id_text"],
        workflow_id=row.get("trace_id") or "",  # trace_id carries workflow correlation
        stage=ArtifactLifecycleStage(row["action"]),
        occurred_at=_parse_dt(row["created_at"]),
        artifact_state=row.get("state"),
        storage_ref=row.get("storage_ref"),  # opaque ref only — caller must not sign
        checksum_sha256=row.get("content_hash"),
        retention_policy=row.get("retention_policy_ref"),
        signed_access_eligibility=bool(row.get("signed_access_eligible", False)),
        legal_hold=bool(legal_hold_ref),
        redacted=bool(redaction_ref),
        deletion_scheduled_at=_parse_dt(expires_raw) if expires_raw else None,
        audit_refs=tuple(str(value) for value in [audit_id] if value is not None),
        idempotency=row.get("idempotency_key"),
    )


def artifact_lifecycle_state_to_db(stage: ArtifactLifecycleStage, explicit_state: str | None = None) -> str:
    if explicit_state:
        return explicit_state
    if stage == ArtifactLifecycleStage.EXPIRY_SET:
        return "expiring"
    if stage == ArtifactLifecycleStage.REDACTED:
        return "redacted"
    if stage == ArtifactLifecycleStage.DELETION_SCHEDULED:
        return "deletion_pending"
    if stage == ArtifactLifecycleStage.DELETED:
        return "deleted"
    if stage == ArtifactLifecycleStage.LEGAL_HOLD_APPLIED:
        return "legal_hold_active"
    return "active"


def build_claim_outbox_query(
    *,
    batch_size: int,
    project_id: int,
    now: datetime,
) -> tuple[str, list[Any]]:
    """Build (sql, params) for the atomic claim-pending-outbox CTE UPDATE.

    Selects ``pending`` / ``failed`` rows whose ``next_attempt_at`` is due,
    marks them ``delivering``, increments ``attempt_count``, and returns them
    with JOIN aliases needed by :func:`row_to_outbox_event` plus ``run_pk``
    for lease acquisition.

    Uses ``FOR UPDATE OF wo SKIP LOCKED`` so concurrent workers process
    different outbox batches safely.
    """
    from .outbox import DEFAULT_OUTBOX_RETRY_POLICY

    max_attempts = DEFAULT_OUTBOX_RETRY_POLICY.max_attempts
    sql = """
WITH expired_delivering AS (
    UPDATE workflow_outbox wo
       SET delivery_state = CASE
               WHEN wo.attempt_count >= %s THEN 'dead_lettered'
               ELSE 'failed'
           END,
           next_attempt_at = CASE
               WHEN wo.attempt_count >= %s THEN NULL
               ELSE %s
           END,
           updated_at = %s
     WHERE wo.delivery_state = 'delivering'
       AND wo.project_id = %s
       AND NOT EXISTS (
           SELECT 1
             FROM workflow_lease wl
            WHERE wl.lease_key = ('outbox:' || wo.outbox_id)
              AND wl.status = 'active'
              AND wl.expires_at > %s
       )
    RETURNING wo.id
),
exhausted_failed AS (
    UPDATE workflow_outbox wo
       SET delivery_state = 'dead_lettered',
           next_attempt_at = NULL,
           updated_at = %s
     WHERE wo.delivery_state = 'failed'
       AND wo.project_id = %s
       AND wo.attempt_count >= %s
    RETURNING wo.id
),
locked AS (
    SELECT wo.id              AS outbox_pk,
           wo.outbox_id,
           wo.destination_kind,
           wo.attempt_count,
           wo.next_attempt_at,
           wo.last_failure_ref,
           wo.idempotency_key,
           ta.task_artifact_id AS payload_artifact_ref,
           wo.created_at,
           wo.updated_at,
           wr.id              AS run_pk,
           wr.workflow_run_id AS workflow_run_id_text,
           we.workflow_event_id AS source_event_id_text
      FROM workflow_outbox wo
      JOIN workflow_run wr ON wr.id = wo.workflow_run_id
      JOIN workflow_event we ON we.id = wo.source_workflow_event_id
      LEFT JOIN task_artifact ta ON ta.id = wo.payload_artifact_id
     WHERE wo.delivery_state IN ('pending', 'failed')
       AND wo.project_id = %s
       AND (wo.next_attempt_at IS NULL OR wo.next_attempt_at <= %s)
      AND (wo.delivery_state = 'pending' OR wo.attempt_count < %s)
     ORDER BY wo.created_at, wo.id
     LIMIT %s
     FOR UPDATE OF wo SKIP LOCKED
)
,
updated AS (
    UPDATE workflow_outbox wo2
       SET delivery_state = 'delivering',
           attempt_count  = wo2.attempt_count + 1,
           updated_at     = %s
      FROM locked
     WHERE wo2.id = locked.outbox_pk
     RETURNING
        wo2.outbox_id,
        wo2.destination_kind,
        wo2.delivery_state,
        wo2.attempt_count,
        wo2.next_attempt_at,
        wo2.last_failure_ref,
        wo2.idempotency_key,
        wo2.payload_artifact_id,
        wo2.created_at,
        wo2.updated_at,
        locked.workflow_run_id_text,
        locked.source_event_id_text,
        locked.run_pk
)
SELECT
    updated.outbox_id,
    updated.destination_kind,
    updated.delivery_state,
    updated.attempt_count,
    updated.next_attempt_at,
    updated.last_failure_ref,
    updated.idempotency_key,
    ta.task_artifact_id AS payload_artifact_ref,
    updated.created_at,
    updated.updated_at,
    updated.workflow_run_id_text,
    updated.source_event_id_text,
    updated.run_pk
FROM updated
LEFT JOIN task_artifact ta ON ta.id = updated.payload_artifact_id
""".strip()
    params: list[Any] = [
        max_attempts, max_attempts, now, now, project_id, now,
        now, project_id, max_attempts,
        project_id, now, max_attempts, batch_size, now,
    ]
    return sql, params


# ---------------------------------------------------------------------------
# SQL generation helpers (module-level for testability)
# ---------------------------------------------------------------------------


def build_claim_step_query(
    *,
    workflow_id: str | None,
    kinds: Sequence[StepKind] | None,
    project_id: int,
    now: datetime,
    terminal_states: Sequence[str],
) -> tuple[str, list[Any]]:
    """Build (sql, params) for the atomic claim-next-step CTE UPDATE.

    The SQL uses %s placeholders and contains FOR UPDATE OF ws SKIP LOCKED to
    safely claim exactly one PENDING step under concurrent workers.

    Returns (sql, params).  The caller should cursor.execute(sql, params) and
    cursor.fetchone() — a None result means no step was available.
    """
    conditions: list[str] = ["ws.state = %s", "wr.project_id = %s", "ws.project_id = %s"]
    params: list[Any] = [step_state_to_db(StepState.PENDING), project_id, project_id]

    if workflow_id is not None:
        conditions.append("wr.workflow_run_id = %s")
        params.append(workflow_id)

    placeholders = ",".join(["%s"] * len(terminal_states))
    conditions.append(f"wr.state NOT IN ({placeholders})")
    params.extend(terminal_states)
    conditions.append("(ws.next_attempt_at IS NULL OR ws.next_attempt_at <= %s)")
    params.append(now)
    conditions.append(
        """
        NOT EXISTS (
            SELECT 1
              FROM workflow_cancellation wc
             WHERE wc.workflow_run_id = wr.id
               AND wc.project_id = wr.project_id
               AND wc.propagation_state NOT IN (
                   'completed', 'partially_completed',
                   'partially_completed_manual_review'
               )
               AND (
                   wc.target_refs->>'target' = 'workflow'
                   OR wc.target_refs->>'step_id' = ws.workflow_step_id
               )
        )
        """
    )

    if kinds:
        kinds_values = [step_kind_to_db(k) for k in kinds]
        conditions.append("ws.step_type = ANY(%s)")
        params.append(kinds_values)

    where_clause = " AND ".join(conditions)

    sql = f"""
WITH locked_step AS (
    SELECT ws.id          AS step_pk,
           ws.workflow_step_id,
           wr.id          AS run_pk,
           wr.workflow_run_id AS workflow_run_id,
           ws.trace_id    AS step_trace_id
    FROM workflow_step ws
    JOIN workflow_run wr ON ws.workflow_run_id = wr.id
    WHERE {where_clause}
    ORDER BY ws.created_at, ws.id
    LIMIT 1
    FOR UPDATE OF ws SKIP LOCKED
)
UPDATE workflow_step ws2
   SET state    = %s,
       updated_at = %s,
       ordinal  = ws2.ordinal + 1
  FROM locked_step
 WHERE ws2.id = locked_step.step_pk
RETURNING
    ws2.workflow_step_id,
    locked_step.workflow_run_id,
    locked_step.run_pk,
    locked_step.step_pk,
    locked_step.step_trace_id,
    ws2.step_type,
    ws2.task_ref,
    ws2.idempotency_key,
    ws2.metadata,
    ws2.ordinal,
    ws2.created_at,
    ws2.updated_at
""".strip()

    params.extend([step_state_to_db(StepState.CLAIMED), now])
    return sql, params


# ---------------------------------------------------------------------------
# PostgresRuntimeRepository
# ---------------------------------------------------------------------------


_IDEMPOTENCY_EXPIRY_DAYS = 90  # default TTL for idempotency records


class PostgresRuntimeRepository:
    """Postgres-backed implementation of RuntimeRepository.

    Inject a PEP-249 connection whose cursor rows support column-name access
    (e.g., psycopg row_factory=dict_row, psycopg2 RealDictCursor).  The caller
    owns transaction commit/rollback; this class only executes SQL.
    """

    def __init__(self, conn: Any, scope: RepositoryScope) -> None:
        self._conn = conn
        self._scope = scope

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _cursor(self) -> Any:  # returns context-manager cursor
        return self._conn.cursor()

    def _lookup_run_pk(self, cur: Any, workflow_id: str) -> int:
        cur.execute(
            "SELECT id FROM workflow_run WHERE workflow_run_id = %s AND project_id = %s",
            (workflow_id, self._scope.project_id),
        )
        row = cur.fetchone()
        if row is None:
            raise RepositoryError(f"unknown workflow: {workflow_id}")
        return int(row["id"] if isinstance(row, dict) else row[0])

    def _lookup_step_pk(self, cur: Any, step_id: str) -> int:
        cur.execute(
            """
            SELECT ws.id
              FROM workflow_step ws
              JOIN workflow_run wr ON ws.workflow_run_id = wr.id
             WHERE ws.workflow_step_id = %s
               AND ws.project_id = %s
               AND wr.project_id = %s
            """,
            (step_id, self._scope.project_id, self._scope.project_id),
        )
        row = cur.fetchone()
        if row is None:
            raise RepositoryError(f"unknown step: {step_id}")
        return int(row["id"] if isinstance(row, dict) else row[0])

    def _lookup_artifact_pk(self, cur: Any, artifact_ref: str | None) -> int | None:
        if artifact_ref is None:
            return None
        cur.execute(
            "SELECT id FROM task_artifact WHERE task_artifact_id = %s AND project_id = %s",
            (artifact_ref, self._scope.project_id),
        )
        row = cur.fetchone()
        if row is None:
            raise RepositoryError(f"unknown task artifact for outbox payload: {artifact_ref}")
        return int(row["id"] if isinstance(row, dict) else row[0])

    def _lookup_event_pk(self, cur: Any, event_id: str) -> int:
        cur.execute(
            "SELECT id FROM workflow_event WHERE workflow_event_id = %s AND project_id = %s",
            (event_id, self._scope.project_id),
        )
        row = cur.fetchone()
        if row is None:
            raise RepositoryError(f"unknown workflow event: {event_id}")
        return int(row["id"] if isinstance(row, dict) else row[0])

    def _next_seq(self, cur: Any, run_pk: int) -> int:
        """Allocate the next monotonic event sequence number for a workflow run.

        The workflow_run row is locked first so concurrent event appenders for
        one workflow serialize before computing MAX(sequence_number)+1.
        """
        cur.execute(
            "SELECT id FROM workflow_run WHERE id = %s AND project_id = %s FOR UPDATE",
            (run_pk, self._scope.project_id),
        )
        if cur.fetchone() is None:
            raise RepositoryError(f"unknown workflow primary key for event append: {run_pk}")
        cur.execute(
            "SELECT COALESCE(MAX(sequence_number), 0) + 1 "
            "FROM workflow_event WHERE workflow_run_id = %s",
            (run_pk,),
        )
        row = cur.fetchone()
        if row is None:
            return 1
        val = row[0] if not isinstance(row, dict) else next(iter(row.values()))
        return int(val) if val is not None else 1

    def _insert_event(
        self,
        cur: Any,
        run_pk: int,
        event: WorkflowEvent,
        *,
        step_pk: int | None = None,
    ) -> int | None:
        """INSERT a workflow_event row and enqueue delivery records in the same transaction."""
        s = self._scope
        seq = self._next_seq(cur, run_pk)
        meta: dict[str, Any] = {
            "refs": dict(event.refs),
            "runtime_event_type": event.event_type,
            "span_id": event.trace_context.span_id,
            "parent_span_id": event.trace_context.parent_span_id,
            "correlation_id": event.trace_context.correlation_id,
            "baggage_refs": list(event.trace_context.baggage_refs),
        }
        cur.execute(
            """
            INSERT INTO workflow_event (
                workflow_event_id, workflow_run_id, workflow_step_id,
                project_id, principal_id, budget_scope_id,
                sequence_number, event_type, state,
                data_class, policy_version, registry_version,
                trace_id, request_id, metadata,
                event_time, created_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s
            )
            RETURNING id
            """,
            (
                event.event_id, run_pk, step_pk,
                s.project_id, s.principal_id, s.budget_scope_id,
                seq, event_type_to_db(event.event_type),
                event.state.value if event.state else None,
                s.data_class, s.policy_version, s.registry_version,
                event.trace_context.trace_id, event.trace_context.span_id,
                json.dumps(meta),
                event.occurred_at, event.occurred_at,
            ),
        )
        row = cur.fetchone()
        if row is None:
            return None
        event_pk = int(row["id"] if isinstance(row, dict) else row[0])
        self._enqueue_outbox_for_event(cur, run_pk=run_pk, source_event_pk=event_pk, event=event)
        return event_pk

    def _insert_step_attempt(
        self,
        cur: Any,
        *,
        run_pk: int,
        step_pk: int,
        step_id: str,
        step_row: Mapping[str, Any],
        lease: Lease,
        attempt_number: int,
        now: datetime,
    ) -> None:
        s = self._scope
        meta = {
            "workflow_step_id": step_id,
            "input_ref": step_row.get("task_ref"),
            "step_idempotency_key": step_row.get("idempotency_key"),
            "workflow_step_metadata": _parse_meta(step_row, "metadata"),
        }
        attempt_idempotency_key = (
            f"{step_row.get('idempotency_key')}:attempt:{attempt_number}"
            if step_row.get("idempotency_key")
            else None
        )
        cur.execute(
            """
            INSERT INTO step_attempt (
                step_attempt_id, workflow_run_id, workflow_step_id,
                task_ref, project_id, principal_id, budget_scope_id,
                attempt_number, data_class, policy_version, registry_version,
                trace_id, request_id, idempotency_key, state,
                lease_owner, lease_expires_at, heartbeat_at,
                fencing_token, replay_decision, metadata, created_at, updated_at
            ) VALUES (
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, 'queued',
                %s, %s, %s,
                %s, 'pre_side_effect', %s::jsonb, %s, %s
            )
            ON CONFLICT DO NOTHING
            """,
            (
                f"attempt_{step_id}_{attempt_number}_{lease.fencing_token}",
                run_pk,
                step_pk,
                step_row.get("task_ref") or step_id,
                s.project_id,
                s.principal_id,
                s.budget_scope_id,
                attempt_number,
                s.data_class,
                s.policy_version,
                s.registry_version,
                step_row.get("step_trace_id") or uuid4().hex,
                uuid4().hex[:16],
                attempt_idempotency_key,
                lease.owner_id,
                lease.expires_at,
                now,
                lease.fencing_token,
                json.dumps(meta),
                now,
                now,
            ),
        )

    def _mark_step_attempt_running(
        self,
        cur: Any,
        *,
        step_pk: int,
        lease: Lease,
        now: datetime,
    ) -> None:
        cur.execute(
            """
            UPDATE step_attempt
               SET state = 'running',
                   started_at = COALESCE(started_at, %s),
                   heartbeat_at = %s,
                   replay_decision = 'ambiguous_post_side_effect',
                   updated_at = %s
             WHERE workflow_step_id = %s
               AND project_id = %s
               AND lease_owner = %s
               AND fencing_token = %s
               AND state = 'queued'
            """,
            (
                now,
                now,
                now,
                step_pk,
                self._scope.project_id,
                lease.owner_id,
                lease.fencing_token,
            ),
        )

    def _complete_step_attempt(
        self,
        cur: Any,
        *,
        step_pk: int,
        lease: Lease,
        output_ref: str,
        now: datetime,
    ) -> None:
        cur.execute(
            """
            UPDATE step_attempt
               SET state = 'succeeded',
                   completed_at = %s,
                   artifact_refs = artifact_refs || %s::jsonb,
                   metadata = metadata || %s::jsonb,
                   updated_at = %s
             WHERE workflow_step_id = %s
               AND project_id = %s
               AND lease_owner = %s
               AND fencing_token = %s
               AND state IN ('queued', 'running')
            """,
            (
                now,
                json.dumps([output_ref]),
                json.dumps({"output_ref": output_ref}),
                now,
                step_pk,
                self._scope.project_id,
                lease.owner_id,
                lease.fencing_token,
            ),
        )

    def _fail_step_attempt(
        self,
        cur: Any,
        *,
        step_pk: int,
        lease: Lease,
        failure_class: FailureClass,
        reason_ref: str | None,
        now: datetime,
        next_attempt_at: datetime | None = None,
        retry_eligible: bool = False,
        retry_delay_seconds: float = 0.0,
        replay_decision: str | None = None,
    ) -> int | None:
        metadata = {
            "reason_ref": reason_ref,
            "next_attempt_at": isoformat_utc(next_attempt_at) if next_attempt_at else None,
            "retry_eligible": retry_eligible,
            "retry_delay_seconds": retry_delay_seconds,
        }
        cur.execute(
            """
            UPDATE step_attempt
               SET state = 'failed',
                   completed_at = %s,
                   failure_reason = %s,
                   failure_class = %s,
                   replay_decision = COALESCE(%s, replay_decision),
                   metadata = metadata || %s::jsonb,
                   updated_at = %s
             WHERE workflow_step_id = %s
               AND project_id = %s
               AND lease_owner = %s
               AND fencing_token = %s
               AND state IN ('queued', 'running')
             RETURNING id
            """,
            (
                now,
                reason_ref,
                failure_class.value,
                replay_decision,
                json.dumps(metadata),
                now,
                step_pk,
                self._scope.project_id,
                lease.owner_id,
                lease.fencing_token,
            ),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return int(row["id"] if isinstance(row, dict) else row[0])

    def _latest_step_attempt_pk(self, cur: Any, *, step_pk: int) -> int | None:
        cur.execute(
            """
            SELECT id
              FROM step_attempt
             WHERE workflow_step_id = %s
               AND project_id = %s
             ORDER BY attempt_number DESC, id DESC
             LIMIT 1
            """,
            (step_pk, self._scope.project_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return int(row["id"] if isinstance(row, dict) else row[0])

    def _insert_manual_review_locked(
        self,
        cur: Any,
        *,
        run_pk: int,
        workflow_id: str,
        step_pk: int | None,
        step_id: str | None,
        attempt_pk: int | None,
        item: ManualReviewItem,
        reason: str,
        trace_context: TraceContext,
        now: datetime,
        evidence: Mapping[str, Any] | None = None,
    ) -> None:
        idempotency_key = "manual_review:" + hashlib.sha256(
            f"{workflow_id}:{step_id}:{attempt_pk}:{reason}".encode("utf-8")
        ).hexdigest()[:24]
        cur.execute(
            """
            INSERT INTO manual_review_item (
                manual_review_item_id, reason, workflow_run_id, workflow_step_id,
                step_attempt_id, owner_principal_id, blocking_state, review_state,
                safe_actions, side_effect_refs, resolution_ref, idempotency_key,
                trace_id, request_id, project_id, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, 'blocking_step', %s,
                %s::jsonb, %s::jsonb, NULL, %s,
                %s, %s, %s, %s, %s
            )
            ON CONFLICT (idempotency_key) DO NOTHING
            """,
            (
                item.review_id,
                reason,
                run_pk,
                step_pk,
                attempt_pk,
                self._scope.principal_id,
                item.status.value,
                json.dumps([{"ref_id": f"runtime-ref:step:{step_id}", "ref_type": "step", "scope_ref": workflow_id}]),
                json.dumps([evidence or {}]),
                idempotency_key,
                trace_context.trace_id,
                trace_context.span_id,
                self._scope.project_id,
                now,
                now,
            ),
        )

    def _release_lease_locked(self, cur: Any, *, lease: Lease, now: datetime) -> None:
        cur.execute(
            """
            UPDATE workflow_lease
               SET status = 'released',
                   released_at = %s,
                   updated_at = %s
             WHERE workflow_lease_id = %s
               AND lease_key = %s
               AND lease_owner = %s
               AND fencing_token = %s
               AND project_id = %s
               AND status = 'active'
            """,
            (
                now,
                now,
                lease.lease_id,
                lease.resource_id,
                lease.owner_id,
                lease.fencing_token,
                self._scope.project_id,
            ),
        )

    def _enqueue_trace_outbox(
        self,
        cur: Any,
        *,
        run_pk: int,
        source_event_pk: int | None,
        source_event_id: str,
        trace_context: TraceContext,
        now: datetime,
    ) -> None:
        self._enqueue_outbox_event(
            cur,
            run_pk=run_pk,
            source_event_pk=source_event_pk,
            source_event_id=source_event_id,
            destination_kind="trace",
            trace_context=trace_context,
            now=now,
        )

    def _enqueue_outbox_for_event(
        self,
        cur: Any,
        *,
        run_pk: int,
        source_event_pk: int | None,
        event: WorkflowEvent,
    ) -> None:
        if source_event_pk is None:
            return
        for destination_kind in _outbox_destinations_for_event(event):
            self._enqueue_outbox_event(
                cur,
                run_pk=run_pk,
                source_event_pk=source_event_pk,
                source_event_id=event.event_id,
                destination_kind=destination_kind,
                trace_context=event.trace_context,
                now=event.occurred_at,
            )

    def _enqueue_outbox_event(
        self,
        cur: Any,
        *,
        run_pk: int,
        source_event_pk: int | None,
        source_event_id: str,
        destination_kind: str,
        trace_context: TraceContext,
        now: datetime,
    ) -> None:
        from .outbox import assert_outbox_destination_kind, outbox_idempotency_key

        if source_event_pk is None:
            return
        assert_outbox_destination_kind(destination_kind)
        idempotency_key = outbox_idempotency_key(destination_kind, source_event_id)
        digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:24]
        cur.execute(
            """
            INSERT INTO workflow_outbox (
                outbox_id, workflow_run_id, source_workflow_event_id,
                destination_kind, delivery_state, attempt_count,
                next_attempt_at, last_failure_ref, idempotency_key,
                trace_id, request_id, project_id, policy_version,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s,
                %s, 'pending', 0,
                NULL, NULL, %s,
                %s, %s, %s, %s,
                %s, %s
            )
            ON CONFLICT (destination_kind, source_workflow_event_id, idempotency_key)
            DO NOTHING
            """,
            (
                f"outbox_{digest}",
                run_pk,
                source_event_pk,
                destination_kind,
                idempotency_key,
                trace_context.trace_id,
                trace_context.span_id,
                self._scope.project_id,
                self._scope.policy_version,
                now,
                now,
            ),
        )

    def _make_event(
        self,
        workflow_id: str,
        event_type: str,
        trace_context: TraceContext,
        *,
        state: WorkflowState | None = None,
        step_id: str | None = None,
        refs: Mapping[str, str] | None = None,
        now: datetime | None = None,
    ) -> WorkflowEvent:
        return WorkflowEvent(
            event_id=f"evt_{uuid4().hex}",
            workflow_id=workflow_id,
            event_type=event_type,
            trace_context=trace_context,
            occurred_at=now or utc_now(),
            state=state,
            step_id=step_id,
            refs=dict(refs or {}),
        )

    def _resolve_lease_context(
        self, cur: Any, resource_id: str
    ) -> tuple[int, int | None]:
        """Return (run_pk, step_pk | None) for a resource_id.

        Supports:
          "step:{step_id}"     → look up step → get workflow_run FK
          "workflow:{wf_id}"   → look up workflow
        Other formats raise RepositoryError.
        """
        if resource_id.startswith("step:"):
            step_id = resource_id[len("step:"):]
            cur.execute(
                """
                SELECT ws.id AS step_pk, ws.workflow_run_id AS run_pk
                FROM workflow_step ws
                JOIN workflow_run wr ON ws.workflow_run_id = wr.id
                WHERE ws.workflow_step_id = %s
                  AND ws.project_id = %s
                  AND wr.project_id = %s
                """,
                (step_id, self._scope.project_id, self._scope.project_id),
            )
            row = cur.fetchone()
            if row is None:
                raise RepositoryError(
                    f"no step found for lease resource_id {resource_id!r}"
                )
            return int(row["run_pk"]), int(row["step_pk"])

        if resource_id.startswith("workflow:"):
            wf_id = resource_id[len("workflow:"):]
            run_pk = self._lookup_run_pk(cur, wf_id)
            return run_pk, None

        raise RepositoryError(
            f"PostgresRuntimeRepository requires resource_id prefixed with "
            f"'step:' or 'workflow:'; got {resource_id!r}"
        )

    # ------------------------------------------------------------------
    # WorkflowRepository
    # ------------------------------------------------------------------

    def create_workflow(self, workflow: Workflow) -> Workflow:
        s = self._scope
        with self._cursor() as cur:
            # Idempotent guard: raise if already present
            cur.execute(
                "SELECT id FROM workflow_run WHERE workflow_run_id = %s AND project_id = %s",
                (workflow.workflow_id, s.project_id),
            )
            if cur.fetchone() is not None:
                raise RepositoryError(
                    f"workflow already exists: {workflow.workflow_id}"
                )

            meta: dict[str, Any] = {
                "version": workflow.version,
                "span_id": workflow.trace_context.span_id,
                "parent_span_id": workflow.trace_context.parent_span_id,
                "correlation_id": workflow.trace_context.correlation_id,
                "baggage_refs": list(workflow.trace_context.baggage_refs),
            }
            cur.execute(
                """
                INSERT INTO workflow_run (
                    workflow_run_id, workflow_name, task_ref,
                    project_id, principal_id, budget_scope_id,
                    data_class, policy_version, registry_version,
                    trace_id, request_id, idempotency_key, state,
                    metadata, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s
                )
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
                """,
                (
                    workflow.workflow_id, workflow.workflow_id, workflow.workflow_ref,
                    s.project_id, s.principal_id, s.budget_scope_id,
                    s.data_class, s.policy_version, s.registry_version,
                    workflow.trace_context.trace_id, workflow.trace_context.span_id,
                    workflow.idempotency_key, workflow.state.value,
                    json.dumps(meta), workflow.created_at, workflow.created_at,
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise RepositoryError(
                    f"INSERT workflow_run returned no row for {workflow.workflow_id}"
                )
            run_pk = int(row["id"] if isinstance(row, dict) else row[0])

            event = self._make_event(
                workflow.workflow_id, "workflow.created", workflow.trace_context,
                state=workflow.state,
                refs={"workflow_ref": workflow.workflow_ref},
                now=workflow.created_at,
            )
            self._insert_event(cur, run_pk, event)

        return workflow

    def get_workflow(self, workflow_id: str) -> Workflow | None:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT workflow_run_id, state, idempotency_key, task_ref,
                       trace_id, request_id, metadata, created_at, updated_at
                FROM workflow_run
                WHERE workflow_run_id = %s
                  AND project_id = %s
                """,
                (workflow_id, self._scope.project_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return row_to_workflow(row)

    def transition_workflow(
        self,
        workflow_id: str,
        target: WorkflowState,
        *,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        now: datetime | None = None,
    ) -> Workflow:
        timestamp = now or utc_now()
        with self._cursor() as cur:
            # Validate current state before UPDATE
            cur.execute(
                """
                SELECT id, state, metadata
                  FROM workflow_run
                 WHERE workflow_run_id = %s
                   AND project_id = %s
                 FOR UPDATE
                """,
                (workflow_id, self._scope.project_id),
            )
            row = cur.fetchone()
            if row is None:
                raise RepositoryError(f"unknown workflow: {workflow_id}")
            run_pk = int(row["id"] if isinstance(row, dict) else row[0])
            meta = _parse_meta(row, "metadata")
            current_state = WorkflowState(row["state"] if isinstance(row, dict) else row[1])

            # Validate transition (reuse dataclass logic)
            dummy = Workflow(
                workflow_id=workflow_id,
                state=current_state,
                idempotency_key="",
                trace_context=trace_context,
                version=int(meta.get("version", 0)),
            )
            transitioned = dummy.transition_to(target, now=timestamp)
            new_version = transitioned.version

            updated_meta = {
                **meta,
                "version": new_version,
                "span_id": trace_context.span_id,
                "parent_span_id": trace_context.parent_span_id,
                "correlation_id": trace_context.correlation_id,
                "baggage_refs": list(trace_context.baggage_refs),
            }
            cur.execute(
                """
                UPDATE workflow_run
                   SET state = %s,
                       updated_at = %s,
                       metadata = %s::jsonb
                 WHERE workflow_run_id = %s
                   AND project_id = %s
                   AND state = %s
                RETURNING workflow_run_id, state, idempotency_key, task_ref,
                          trace_id, request_id, metadata, created_at, updated_at
                """,
                (
                    target.value, timestamp,
                    json.dumps(updated_meta),
                    workflow_id, self._scope.project_id, current_state.value,
                ),
            )
            updated_row = cur.fetchone()
            if updated_row is None:
                raise RepositoryError(
                    f"UPDATE workflow_run returned no row for {workflow_id}"
                )

            event = self._make_event(
                workflow_id, f"workflow.{target.value}", trace_context,
                state=target,
                refs=refs,
                now=timestamp,
            )
            self._insert_event(cur, run_pk, event)

        return row_to_workflow(updated_row)

    def append_event(self, event: WorkflowEvent) -> WorkflowEvent:
        with self._cursor() as cur:
            run_pk = self._lookup_run_pk(cur, event.workflow_id)
            step_pk: int | None = None
            if event.step_id:
                try:
                    step_pk = self._lookup_step_pk(cur, event.step_id)
                except RepositoryError:
                    pass  # step_id is informational; don't fail if missing
            self._insert_event(cur, run_pk, event, step_pk=step_pk)
        return event

    def list_events(self, workflow_id: str) -> tuple[WorkflowEvent, ...]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT we.workflow_event_id,
                       wr.workflow_run_id,
                       we.event_type,
                       we.state,
                       we.trace_id,
                       we.request_id,
                       we.metadata,
                       we.event_time,
                       ws.workflow_step_id AS workflow_step_id_text
                  FROM workflow_event we
                  JOIN workflow_run wr ON we.workflow_run_id = wr.id
                  LEFT JOIN workflow_step ws ON we.workflow_step_id = ws.id
                 WHERE wr.workflow_run_id = %s
                  AND wr.project_id = %s
                 ORDER BY we.sequence_number
                """,
                (workflow_id, self._scope.project_id),
            )
            rows = cur.fetchall()
        return tuple(row_to_event(r) for r in rows)

    # ------------------------------------------------------------------
    # StepRepository
    # ------------------------------------------------------------------

    def add_step(
        self, step: WorkflowStep, *, trace_context: TraceContext
    ) -> WorkflowStep:
        s = self._scope
        with self._cursor() as cur:
            run_pk = self._lookup_run_pk(cur, step.workflow_id)

            # Validate workflow is not terminal
            cur.execute(
                "SELECT state FROM workflow_run WHERE id = %s AND project_id = %s",
                (run_pk, self._scope.project_id),
            )
            wf_row = cur.fetchone()
            if wf_row is None:
                raise RepositoryError(f"unknown workflow pk: {run_pk}")
            wf_state = WorkflowState(
                wf_row["state"] if isinstance(wf_row, dict) else wf_row[0]
            )
            if wf_state in TERMINAL_WORKFLOW_STATES:
                raise RepositoryError(
                    f"cannot add step to terminal workflow: {step.workflow_id}"
                )

            # Guard duplicate step
            cur.execute(
                "SELECT id FROM workflow_step WHERE workflow_step_id = %s AND project_id = %s",
                (step.step_id, self._scope.project_id),
            )
            if cur.fetchone() is not None:
                raise RepositoryError(f"step already exists: {step.step_id}")

            meta: dict[str, Any] = {
                "input_ref": step.input_ref,
                "output_ref": step.output_ref,
                "span_id": trace_context.span_id,
                "parent_span_id": trace_context.parent_span_id,
                "correlation_id": trace_context.correlation_id,
                "baggage_refs": list(trace_context.baggage_refs),
            }
            cur.execute(
                """
                INSERT INTO workflow_step (
                    workflow_step_id, workflow_run_id, step_key, step_type,
                    task_ref, project_id, principal_id, budget_scope_id,
                    data_class, policy_version, registry_version,
                    trace_id, request_id, idempotency_key, state,
                    ordinal, metadata, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s
                )
                RETURNING id
                """,
                (
                    step.step_id, run_pk, step.step_id, step_kind_to_db(step.kind),
                    step.input_ref, s.project_id, s.principal_id, s.budget_scope_id,
                    s.data_class, s.policy_version, s.registry_version,
                    trace_context.trace_id, trace_context.span_id,
                    step.idempotency_key, step_state_to_db(step.state),
                    step.attempt,
                    json.dumps(meta), step.created_at, step.created_at,
                ),
            )
            step_row = cur.fetchone()
            if step_row is None:
                raise RepositoryError(
                    f"INSERT workflow_step returned no row for {step.step_id}"
                )
            step_pk = int(step_row["id"] if isinstance(step_row, dict) else step_row[0])

            event = self._make_event(
                step.workflow_id, "step.created", trace_context,
                state=wf_state,
                step_id=step.step_id,
                refs={
                    "input_ref": step.input_ref,
                    "step_kind_ref": f"runtime-ref:step-kind:{step.kind.value}",
                },
                now=step.created_at,
            )
            self._insert_event(cur, run_pk, event, step_pk=step_pk)

        return step

    def get_step(self, step_id: str) -> WorkflowStep | None:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ws.workflow_step_id,
                       wr.workflow_run_id,
                       ws.step_type, ws.state, ws.task_ref,
                       ws.idempotency_key, ws.ordinal, ws.metadata,
                       ws.created_at, ws.updated_at
                  FROM workflow_step ws
                  JOIN workflow_run wr ON ws.workflow_run_id = wr.id
                 WHERE ws.workflow_step_id = %s
                   AND ws.project_id = %s
                   AND wr.project_id = %s
                """,
                (step_id, self._scope.project_id, self._scope.project_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return row_to_step(row)

    def list_steps(self, workflow_id: str) -> tuple[WorkflowStep, ...]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ws.workflow_step_id,
                       wr.workflow_run_id,
                       ws.step_type, ws.state, ws.task_ref,
                       ws.idempotency_key, ws.ordinal, ws.metadata,
                       ws.created_at, ws.updated_at
                  FROM workflow_step ws
                  JOIN workflow_run wr ON ws.workflow_run_id = wr.id
                 WHERE wr.workflow_run_id = %s
                   AND wr.project_id = %s
                   AND ws.project_id = %s
                 ORDER BY ws.created_at, ws.id
                """,
                (workflow_id, self._scope.project_id, self._scope.project_id),
            )
            rows = cur.fetchall()
        return tuple(row_to_step(r) for r in rows)

    def update_step_state(
        self,
        step_id: str,
        target: StepState,
        *,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        lease: Lease | None = None,
        now: datetime | None = None,
    ) -> WorkflowStep:
        timestamp = now or utc_now()
        if lease is None:
            raise RepositoryError("Postgres step state updates require an active lease for fencing")
        with self._cursor() as cur:
            # Validate transition via dataclass logic
            cur.execute(
                """
                SELECT ws.id, ws.state, ws.metadata,
                       wr.id AS run_pk, wr.workflow_run_id, wr.state AS wf_state
                  FROM workflow_step ws
                  JOIN workflow_run wr ON ws.workflow_run_id = wr.id
                 WHERE ws.workflow_step_id = %s
                   AND ws.project_id = %s
                   AND wr.project_id = %s
                """,
                (step_id, self._scope.project_id, self._scope.project_id),
            )
            ctx_row = cur.fetchone()
            if ctx_row is None:
                raise RepositoryError(f"unknown step: {step_id}")
            step_pk = int(ctx_row["id"] if isinstance(ctx_row, dict) else ctx_row[0])
            current_step_state = db_to_step_state(ctx_row["state"] if isinstance(ctx_row, dict) else ctx_row[1])
            if target != current_step_state and target not in STEP_TRANSITIONS[current_step_state]:
                raise WorkflowTransitionError(
                    f"cannot transition step from {current_step_state.value} to {target.value}"
                )
            run_pk = int(
                ctx_row["run_pk"] if isinstance(ctx_row, dict) else ctx_row[3]
            )
            workflow_id = (
                ctx_row["workflow_run_id"]
                if isinstance(ctx_row, dict)
                else ctx_row[4]
            )
            wf_state = WorkflowState(
                ctx_row["wf_state"] if isinstance(ctx_row, dict) else ctx_row[5]
            )

            cur.execute(
                """
                WITH updated AS (
                    UPDATE workflow_step
                       SET state = %s, updated_at = %s
                     WHERE workflow_step_id = %s
                      AND project_id = %s
                      AND workflow_run_id = %s
                      AND EXISTS (
                        SELECT 1
                          FROM workflow_lease wl
                         WHERE wl.workflow_step_id = workflow_step.id
                           AND wl.workflow_run_id = %s
                           AND wl.project_id = %s
                           AND wl.workflow_lease_id = %s
                           AND wl.lease_owner = %s
                           AND wl.fencing_token = %s
                           AND wl.status = 'active'
                           AND wl.expires_at > %s
                      )
                    RETURNING workflow_step_id, state, step_type, task_ref,
                              idempotency_key, ordinal, metadata,
                              created_at, updated_at
                )
                SELECT updated.*, wr.workflow_run_id
                  FROM updated
                  JOIN workflow_run wr ON wr.id = %s AND wr.project_id = %s
                """,
                (
                    step_state_to_db(target), timestamp, step_id,
                    self._scope.project_id, run_pk, run_pk, self._scope.project_id,
                    lease.lease_id, lease.owner_id, lease.fencing_token, timestamp,
                    run_pk, self._scope.project_id,
                ),
            )
            updated_row = cur.fetchone()
            if updated_row is None:
                raise RepositoryError(
                    f"UPDATE workflow_step returned no row for {step_id}; lease may be stale or fenced"
                )
            if target == StepState.RUNNING:
                self._mark_step_attempt_running(
                    cur,
                    step_pk=step_pk,
                    lease=lease,
                    now=timestamp,
                )

            event = self._make_event(
                workflow_id, f"step.{target.value}", trace_context,
                state=wf_state,
                step_id=step_id,
                refs=refs,
                now=timestamp,
            )
            self._insert_event(cur, run_pk, event, step_pk=step_pk)

        return row_to_step(updated_row)

    def complete_step(
        self,
        step_id: str,
        *,
        output_ref: str,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        lease: Lease | None = None,
        now: datetime | None = None,
    ) -> WorkflowStep:
        timestamp = now or utc_now()
        if lease is None:
            raise RepositoryError("Postgres step completion requires an active lease for fencing")
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ws.id, ws.state, ws.metadata,
                       wr.id AS run_pk, wr.workflow_run_id, wr.state AS wf_state
                  FROM workflow_step ws
                  JOIN workflow_run wr ON ws.workflow_run_id = wr.id
                 WHERE ws.workflow_step_id = %s
                   AND ws.project_id = %s
                   AND wr.project_id = %s
                """,
                (step_id, self._scope.project_id, self._scope.project_id),
            )
            ctx_row = cur.fetchone()
            if ctx_row is None:
                raise RepositoryError(f"unknown step: {step_id}")
            step_pk = int(ctx_row["id"] if isinstance(ctx_row, dict) else ctx_row[0])
            current_step_state = db_to_step_state(ctx_row["state"] if isinstance(ctx_row, dict) else ctx_row[1])
            if StepState.COMPLETED != current_step_state and StepState.COMPLETED not in STEP_TRANSITIONS[current_step_state]:
                raise WorkflowTransitionError(
                    f"cannot transition step from {current_step_state.value} to {StepState.COMPLETED.value}"
                )
            existing_meta = _parse_meta(ctx_row, "metadata")
            run_pk = int(
                ctx_row["run_pk"] if isinstance(ctx_row, dict) else ctx_row[3]
            )
            workflow_id = (
                ctx_row["workflow_run_id"]
                if isinstance(ctx_row, dict)
                else ctx_row[4]
            )
            wf_state = WorkflowState(
                ctx_row["wf_state"] if isinstance(ctx_row, dict) else ctx_row[5]
            )

            new_meta = {**existing_meta, "output_ref": output_ref}
            cur.execute(
                """
                WITH updated AS (
                    UPDATE workflow_step
                       SET state = %s,
                           updated_at = %s,
                           metadata = %s::jsonb
                     WHERE workflow_step_id = %s
                      AND project_id = %s
                      AND workflow_run_id = %s
                      AND EXISTS (
                        SELECT 1
                          FROM workflow_lease wl
                         WHERE wl.workflow_step_id = workflow_step.id
                           AND wl.workflow_run_id = %s
                           AND wl.project_id = %s
                           AND wl.workflow_lease_id = %s
                           AND wl.lease_owner = %s
                           AND wl.fencing_token = %s
                           AND wl.status = 'active'
                           AND wl.expires_at > %s
                      )
                    RETURNING workflow_step_id, state, step_type, task_ref,
                             idempotency_key, ordinal, metadata,
                             created_at, updated_at
                )
                SELECT updated.*, wr.workflow_run_id
                  FROM updated
                  JOIN workflow_run wr ON wr.id = %s AND wr.project_id = %s
                """,
                (
                    step_state_to_db(StepState.COMPLETED), timestamp,
                    json.dumps(new_meta), step_id,
                    self._scope.project_id, run_pk, run_pk, self._scope.project_id,
                    lease.lease_id, lease.owner_id, lease.fencing_token, timestamp,
                    run_pk, self._scope.project_id,
                ),
            )
            updated_row = cur.fetchone()
            if updated_row is None:
                raise RepositoryError(
                    f"complete_step UPDATE returned no row for {step_id}"
                )

            merged_refs: dict[str, str] = {"output_ref": output_ref}
            if refs:
                merged_refs.update(refs)
            event = self._make_event(
                workflow_id, "step.completed", trace_context,
                state=wf_state,
                step_id=step_id,
                refs=merged_refs,
                now=timestamp,
            )
            self._insert_event(cur, run_pk, event, step_pk=step_pk)
            self._complete_step_attempt(
                cur,
                step_pk=step_pk,
                lease=lease,
                output_ref=output_ref,
                now=timestamp,
            )
            self._release_lease_locked(cur, lease=lease, now=timestamp)

        return row_to_step(updated_row)

    def schedule_step_retry(
        self,
        decision: RetryDecision,
        *,
        next_attempt_at: datetime,
        trace_context: TraceContext,
        lease: Lease,
        now: datetime | None = None,
    ) -> WorkflowStep:
        timestamp = now or utc_now()
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ws.id, wr.id AS run_pk, wr.workflow_run_id, wr.state AS wf_state
                  FROM workflow_step ws
                  JOIN workflow_run wr ON ws.workflow_run_id = wr.id
                 WHERE ws.workflow_step_id = %s
                   AND ws.project_id = %s
                   AND wr.project_id = %s
                """,
                (decision.step_id, self._scope.project_id, self._scope.project_id),
            )
            ctx_row = cur.fetchone()
            if ctx_row is None:
                raise RepositoryError(f"unknown step: {decision.step_id}")
            step_pk = int(ctx_row["id"] if isinstance(ctx_row, dict) else ctx_row[0])
            run_pk = int(ctx_row["run_pk"] if isinstance(ctx_row, dict) else ctx_row[1])
            workflow_id = ctx_row["workflow_run_id"] if isinstance(ctx_row, dict) else ctx_row[2]
            wf_state = WorkflowState(ctx_row["wf_state"] if isinstance(ctx_row, dict) else ctx_row[3])

            cur.execute(
                """
                WITH updated AS (
                    UPDATE workflow_step
                       SET state = %s,
                           next_attempt_at = %s,
                           failure_class = %s,
                           failure_reason = %s,
                           updated_at = %s,
                           metadata = metadata || %s::jsonb
                     WHERE workflow_step_id = %s
                       AND project_id = %s
                       AND workflow_run_id = %s
                       AND EXISTS (
                         SELECT 1
                           FROM workflow_lease wl
                          WHERE wl.workflow_step_id = workflow_step.id
                            AND wl.workflow_run_id = %s
                            AND wl.project_id = %s
                            AND wl.workflow_lease_id = %s
                            AND wl.lease_owner = %s
                            AND wl.fencing_token = %s
                            AND wl.status = 'active'
                            AND wl.expires_at > %s
                       )
                    RETURNING workflow_step_id, state, step_type, task_ref,
                              idempotency_key, ordinal, metadata,
                              created_at, updated_at
                )
                SELECT updated.*, wr.workflow_run_id
                  FROM updated
                  JOIN workflow_run wr ON wr.id = %s AND wr.project_id = %s
                """,
                (
                    step_state_to_db(StepState.PENDING),
                    next_attempt_at,
                    decision.failure_class.value,
                    decision.reason_ref,
                    timestamp,
                    json.dumps(
                        {
                            "retry": decision.to_dict(),
                            "next_attempt_at": isoformat_utc(next_attempt_at),
                        }
                    ),
                    decision.step_id,
                    self._scope.project_id,
                    run_pk,
                    run_pk,
                    self._scope.project_id,
                    lease.lease_id,
                    lease.owner_id,
                    lease.fencing_token,
                    timestamp,
                    run_pk,
                    self._scope.project_id,
                ),
            )
            updated_row = cur.fetchone()
            if updated_row is None:
                raise RepositoryError(
                    f"retry schedule fenced off for {decision.step_id}; lease may be stale"
                )
            self._fail_step_attempt(
                cur,
                step_pk=step_pk,
                lease=lease,
                failure_class=decision.failure_class,
                reason_ref=decision.reason_ref,
                now=timestamp,
                next_attempt_at=next_attempt_at,
                retry_eligible=True,
                retry_delay_seconds=decision.delay_seconds,
                replay_decision="retry_scheduled",
            )
            event = self._make_event(
                workflow_id,
                "retry_scheduled",
                trace_context,
                state=wf_state,
                step_id=decision.step_id,
                refs={
                    "failure_class": decision.failure_class.value,
                    "next_attempt_at": isoformat_utc(next_attempt_at),
                    "attempt": str(decision.attempt),
                },
                now=timestamp,
            )
            event_pk = self._insert_event(cur, run_pk, event, step_pk=step_pk)
            self._enqueue_trace_outbox(
                cur,
                run_pk=run_pk,
                source_event_pk=event_pk,
                source_event_id=event.event_id,
                trace_context=trace_context,
                now=timestamp,
            )
        return row_to_step(updated_row)

    def record_step_failure(
        self,
        decision: RetryDecision,
        *,
        trace_context: TraceContext,
        lease: Lease,
        now: datetime | None = None,
    ) -> WorkflowStep:
        timestamp = now or utc_now()
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ws.id, wr.id AS run_pk, wr.workflow_run_id, wr.state AS wf_state
                  FROM workflow_step ws
                  JOIN workflow_run wr ON ws.workflow_run_id = wr.id
                 WHERE ws.workflow_step_id = %s
                   AND ws.project_id = %s
                   AND wr.project_id = %s
                """,
                (decision.step_id, self._scope.project_id, self._scope.project_id),
            )
            ctx_row = cur.fetchone()
            if ctx_row is None:
                raise RepositoryError(f"unknown step: {decision.step_id}")
            step_pk = int(ctx_row["id"] if isinstance(ctx_row, dict) else ctx_row[0])
            run_pk = int(ctx_row["run_pk"] if isinstance(ctx_row, dict) else ctx_row[1])
            workflow_id = ctx_row["workflow_run_id"] if isinstance(ctx_row, dict) else ctx_row[2]
            wf_state = WorkflowState(ctx_row["wf_state"] if isinstance(ctx_row, dict) else ctx_row[3])
            cur.execute(
                """
                WITH updated AS (
                    UPDATE workflow_step
                       SET state = %s,
                           failure_class = %s,
                           failure_reason = %s,
                           updated_at = %s
                     WHERE workflow_step_id = %s
                       AND project_id = %s
                       AND workflow_run_id = %s
                       AND EXISTS (
                         SELECT 1 FROM workflow_lease wl
                          WHERE wl.workflow_step_id = workflow_step.id
                            AND wl.workflow_run_id = %s
                            AND wl.project_id = %s
                            AND wl.workflow_lease_id = %s
                            AND wl.lease_owner = %s
                            AND wl.fencing_token = %s
                            AND wl.status = 'active'
                            AND wl.expires_at > %s
                       )
                    RETURNING workflow_step_id, state, step_type, task_ref,
                              idempotency_key, ordinal, metadata,
                              created_at, updated_at
                )
                SELECT updated.*, wr.workflow_run_id
                  FROM updated
                  JOIN workflow_run wr ON wr.id = %s AND wr.project_id = %s
                """,
                (
                    step_state_to_db(StepState.FAILED),
                    decision.failure_class.value,
                    decision.reason_ref,
                    timestamp,
                    decision.step_id,
                    self._scope.project_id,
                    run_pk,
                    run_pk,
                    self._scope.project_id,
                    lease.lease_id,
                    lease.owner_id,
                    lease.fencing_token,
                    timestamp,
                    run_pk,
                    self._scope.project_id,
                ),
            )
            updated_row = cur.fetchone()
            if updated_row is None:
                raise RepositoryError(
                    f"step failure fenced off for {decision.step_id}; lease may be stale"
                )
            self._fail_step_attempt(
                cur,
                step_pk=step_pk,
                lease=lease,
                failure_class=decision.failure_class,
                reason_ref=decision.reason_ref,
                now=timestamp,
                retry_eligible=False,
                retry_delay_seconds=0.0,
                replay_decision="terminal_failure",
            )
            event = self._make_event(
                workflow_id,
                "step.failed",
                trace_context,
                state=wf_state,
                step_id=decision.step_id,
                refs={"failure_class": decision.failure_class.value},
                now=timestamp,
            )
            event_pk = self._insert_event(cur, run_pk, event, step_pk=step_pk)
            self._enqueue_trace_outbox(
                cur,
                run_pk=run_pk,
                source_event_pk=event_pk,
                source_event_id=event.event_id,
                trace_context=trace_context,
                now=timestamp,
            )
        return row_to_step(updated_row)

    def open_step_manual_review(
        self,
        item: ManualReviewItem,
        *,
        decision: RetryDecision,
        trace_context: TraceContext,
        lease: Lease,
        now: datetime | None = None,
    ) -> ManualReviewItem:
        timestamp = now or utc_now()
        reason = _manual_review_reason(item.reason_ref)
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ws.id, wr.id AS run_pk, wr.workflow_run_id, wr.state AS wf_state
                  FROM workflow_step ws
                  JOIN workflow_run wr ON ws.workflow_run_id = wr.id
                 WHERE ws.workflow_step_id = %s
                   AND ws.project_id = %s
                   AND wr.project_id = %s
                """,
                (decision.step_id, self._scope.project_id, self._scope.project_id),
            )
            ctx_row = cur.fetchone()
            if ctx_row is None:
                raise RepositoryError(f"unknown step: {decision.step_id}")
            step_pk = int(ctx_row["id"] if isinstance(ctx_row, dict) else ctx_row[0])
            run_pk = int(ctx_row["run_pk"] if isinstance(ctx_row, dict) else ctx_row[1])
            workflow_id = ctx_row["workflow_run_id"] if isinstance(ctx_row, dict) else ctx_row[2]
            wf_state = WorkflowState(ctx_row["wf_state"] if isinstance(ctx_row, dict) else ctx_row[3])
            cur.execute(
                """
                UPDATE workflow_step
                   SET state = %s,
                       failure_class = %s,
                       failure_reason = %s,
                       updated_at = %s,
                       metadata = metadata || %s::jsonb
                 WHERE workflow_step_id = %s
                   AND project_id = %s
                   AND workflow_run_id = %s
                   AND EXISTS (
                     SELECT 1 FROM workflow_lease wl
                      WHERE wl.workflow_step_id = workflow_step.id
                        AND wl.workflow_run_id = %s
                        AND wl.project_id = %s
                        AND wl.workflow_lease_id = %s
                        AND wl.lease_owner = %s
                        AND wl.fencing_token = %s
                        AND wl.status = 'active'
                        AND wl.expires_at > %s
                   )
                RETURNING id
                """,
                (
                    step_state_to_db(StepState.MANUAL_REVIEW),
                    decision.failure_class.value,
                    decision.reason_ref,
                    timestamp,
                    json.dumps({"manual_review_reason": reason, "retry": decision.to_dict()}),
                    decision.step_id,
                    self._scope.project_id,
                    run_pk,
                    run_pk,
                    self._scope.project_id,
                    lease.lease_id,
                    lease.owner_id,
                    lease.fencing_token,
                    timestamp,
                ),
            )
            if cur.fetchone() is None:
                raise RepositoryError(
                    f"manual review fenced off for {decision.step_id}; lease may be stale"
                )
            attempt_pk = self._fail_step_attempt(
                cur,
                step_pk=step_pk,
                lease=lease,
                failure_class=decision.failure_class,
                reason_ref=decision.reason_ref,
                now=timestamp,
                retry_eligible=False,
                retry_delay_seconds=0.0,
                replay_decision="manual_review",
            ) or self._latest_step_attempt_pk(cur, step_pk=step_pk)
            self._insert_manual_review_locked(
                cur,
                run_pk=run_pk,
                workflow_id=workflow_id,
                step_pk=step_pk,
                step_id=decision.step_id,
                attempt_pk=attempt_pk,
                item=item,
                reason=reason,
                trace_context=trace_context,
                now=timestamp,
                evidence={"failure_class": decision.failure_class.value, "reason_ref": decision.reason_ref},
            )
            cur.execute(
                """
                UPDATE workflow_run
                   SET manual_review_status = 'pending',
                       updated_at = %s
                 WHERE id = %s
                   AND project_id = %s
                """,
                (timestamp, run_pk, self._scope.project_id),
            )
            event = self._make_event(
                workflow_id,
                "manual_review_opened",
                trace_context,
                state=wf_state,
                step_id=decision.step_id,
                refs={"manual_review_reason": reason, "failure_class": decision.failure_class.value},
                now=timestamp,
            )
            event_pk = self._insert_event(cur, run_pk, event, step_pk=step_pk)
            self._enqueue_trace_outbox(
                cur,
                run_pk=run_pk,
                source_event_pk=event_pk,
                source_event_id=event.event_id,
                trace_context=trace_context,
                now=timestamp,
            )
        return item

    def claim_next_step(
        self,
        *,
        owner_id: str,
        lease_policy: LeasePolicy,
        workflow_id: str | None = None,
        kinds: Sequence[StepKind] | None = None,
        now: datetime | None = None,
    ) -> StepClaim | None:
        timestamp = now or utc_now()
        terminal_states = [s.value for s in TERMINAL_WORKFLOW_STATES | PAUSED_WORKFLOW_STATES]
        sql, params = build_claim_step_query(
            workflow_id=workflow_id,
            kinds=kinds,
            project_id=self._scope.project_id,
            now=timestamp,
            terminal_states=terminal_states,
        )

        with self._cursor() as cur:
            cur.execute(sql, params)
            step_row = cur.fetchone()
            if step_row is None:
                return None

            # Extract context from CTE RETURNING
            step_id_text = (
                step_row["workflow_step_id"]
                if isinstance(step_row, dict)
                else step_row[0]
            )
            wf_id_text = (
                step_row["workflow_run_id"]
                if isinstance(step_row, dict)
                else step_row[1]
            )
            run_pk = int(
                step_row["run_pk"] if isinstance(step_row, dict) else step_row[2]
            )
            step_pk = int(
                step_row["step_pk"] if isinstance(step_row, dict) else step_row[3]
            )
            step_trace_id = (
                step_row["step_trace_id"]
                if isinstance(step_row, dict)
                else step_row[4]
            )

            # Acquire lease with fencing_token = MAX(prior) + 1 for this lease_key
            lease_id = uuid4().hex
            resource_id = f"step:{step_id_text}"
            expires_at = lease_policy.expires_at(timestamp)
            token_hash = hashlib.sha256(lease_id.encode()).hexdigest()

            cur.execute(
                """
                UPDATE workflow_lease
                   SET status = 'expired',
                       updated_at = %s
                 WHERE lease_key = %s
                   AND status = 'active'
                   AND expires_at <= %s
                """,
                (timestamp, resource_id, timestamp),
            )

            cur.execute(
                """
                INSERT INTO workflow_lease (
                    workflow_lease_id, workflow_run_id, workflow_step_id,
                    project_id, lease_key, lease_owner, lease_token_hash,
                    fencing_token, status,
                    trace_id, request_id,
                    expires_at, acquired_at, heartbeat_at,
                    metadata, created_at, updated_at
                )
                SELECT %s, %s, %s,
                       %s, %s, %s, %s,
                       COALESCE(MAX(fencing_token), 0) + 1,
                       'active',
                       %s, %s,
                       %s, %s, %s,
                       '{}', %s, %s
                  FROM workflow_lease
                 WHERE lease_key = %s
                ON CONFLICT DO NOTHING
                RETURNING workflow_lease_id, lease_key, lease_owner,
                          fencing_token, acquired_at, heartbeat_at, expires_at
                """,
                (
                    lease_id, run_pk, step_pk,
                    self._scope.project_id, resource_id, owner_id, token_hash,
                    step_trace_id or uuid4().hex, uuid4().hex[:16],
                    expires_at, timestamp, timestamp,
                    timestamp, timestamp,
                    resource_id,
                ),
            )
            lease_row = cur.fetchone()
            if lease_row is None:
                cur.execute(
                    "UPDATE workflow_step SET state = %s, updated_at = %s WHERE id = %s",
                    (step_state_to_db(StepState.PENDING), timestamp, step_pk),
                )
                return None
            lease = row_to_lease(lease_row)
            attempt_number = int(
                step_row["ordinal"] if isinstance(step_row, dict) else step_row[9]
            )
            self._insert_step_attempt(
                cur,
                run_pk=run_pk,
                step_pk=step_pk,
                step_id=step_id_text,
                step_row={
                    "task_ref": step_row["task_ref"] if isinstance(step_row, dict) else step_row[6],
                    "metadata": step_row["metadata"] if isinstance(step_row, dict) else step_row[8],
                    "step_trace_id": step_trace_id,
                    "idempotency_key": step_row["idempotency_key"] if isinstance(step_row, dict) else step_row[7],
                },
                lease=lease,
                attempt_number=attempt_number,
                now=timestamp,
            )

            # Record claim event
            child_trace = TraceContext(
                trace_id=step_trace_id or uuid4().hex,
                span_id=uuid4().hex[:16],
                parent_span_id=None,
            )
            event = self._make_event(
                wf_id_text, "step.claimed", child_trace,
                step_id=step_id_text,
                refs={"lease_ref": f"runtime-ref:lease:{lease_id}"},
                now=timestamp,
            )
            self._insert_event(cur, run_pk, event, step_pk=step_pk)

        return StepClaim(
            step_id=step_id_text,
            workflow_id=wf_id_text,
            lease=lease,
        )

    # ------------------------------------------------------------------
    # LeaseRepository
    # ------------------------------------------------------------------

    def acquire_lease(
        self,
        resource_id: str,
        *,
        owner_id: str,
        policy: LeasePolicy,
        now: datetime | None = None,
    ) -> Lease | None:
        timestamp = now or utc_now()
        expires_at = policy.expires_at(timestamp)

        with self._cursor() as cur:
            run_pk, step_pk = self._resolve_lease_context(cur, resource_id)

            cur.execute(
                """
                UPDATE workflow_lease
                   SET status = 'expired',
                       updated_at = %s
                 WHERE lease_key = %s
                   AND status = 'active'
                   AND expires_at <= %s
                   AND project_id = %s
                """,
                (timestamp, resource_id, timestamp, self._scope.project_id),
            )

            # Check for an existing active non-expired lease
            cur.execute(
                """
                SELECT id FROM workflow_lease
                 WHERE lease_key = %s
                   AND status = 'active'
                   AND expires_at > %s
                   AND project_id = %s
                 LIMIT 1
                """,
                (resource_id, timestamp, self._scope.project_id),
            )
            if cur.fetchone() is not None:
                return None  # Another owner holds an active lease

            lease_id = uuid4().hex
            token_hash = hashlib.sha256(lease_id.encode()).hexdigest()

            cur.execute(
                """
                INSERT INTO workflow_lease (
                    workflow_lease_id, workflow_run_id, workflow_step_id,
                    project_id, lease_key, lease_owner, lease_token_hash,
                    fencing_token, status,
                    trace_id, request_id,
                    expires_at, acquired_at, heartbeat_at,
                    metadata, created_at, updated_at
                )
                SELECT %s, %s, %s,
                       %s, %s, %s, %s,
                       COALESCE(MAX(fencing_token), 0) + 1,
                       'active',
                       %s, %s,
                       %s, %s, %s,
                       '{}', %s, %s
                  FROM workflow_lease
                 WHERE lease_key = %s
                ON CONFLICT DO NOTHING
                RETURNING workflow_lease_id, lease_key, lease_owner,
                          fencing_token, acquired_at, heartbeat_at, expires_at
                """,
                (
                    lease_id, run_pk, step_pk,
                    self._scope.project_id, resource_id, owner_id, token_hash,
                    uuid4().hex, uuid4().hex[:16],
                    expires_at, timestamp, timestamp,
                    timestamp, timestamp,
                    resource_id,
                ),
            )
            lease_row = cur.fetchone()
            if lease_row is None:
                return None
            return row_to_lease(lease_row)

    def heartbeat_lease(
        self,
        lease_id: str,
        *,
        owner_id: str,
        policy: LeasePolicy,
        now: datetime | None = None,
    ) -> Lease | None:
        timestamp = now or utc_now()
        new_expires = policy.expires_at(timestamp)

        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE workflow_lease
                   SET heartbeat_at = %s,
                       expires_at   = %s,
                       updated_at   = %s
                 WHERE workflow_lease_id = %s
                   AND lease_owner = %s
                   AND project_id = %s
                   AND status = 'active'
                   AND expires_at > %s
                RETURNING workflow_lease_id, lease_key, lease_owner,
                          fencing_token, acquired_at, heartbeat_at, expires_at
                """,
                (
                    timestamp, new_expires, timestamp,
                    lease_id, owner_id, self._scope.project_id, timestamp,
                ),
            )
            row = cur.fetchone()

        if row is None:
            return None
        return row_to_lease(row)

    def release_lease(self, lease_id: str, *, owner_id: str) -> bool:
        timestamp = utc_now()
        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE workflow_lease
                   SET status = 'released',
                       released_at = %s,
                       updated_at = %s
                 WHERE workflow_lease_id = %s
                   AND lease_owner = %s
                   AND project_id = %s
                   AND status = 'active'
                RETURNING id
                """,
                (timestamp, timestamp, lease_id, owner_id, self._scope.project_id),
            )
            row = cur.fetchone()
        return row is not None

    def sweep_expired_step_leases(self, *, now: datetime | None = None) -> dict[str, int]:
        timestamp = now or utc_now()
        recovered = 0
        escalated = 0
        expired = 0
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT wl.id AS lease_pk, wl.workflow_lease_id, wl.lease_key, wl.lease_owner,
                       wl.fencing_token, wl.expires_at, wl.heartbeat_at, wl.acquired_at,
                       ws.id AS step_pk, ws.workflow_step_id, ws.state AS step_state,
                       wr.id AS run_pk, wr.workflow_run_id, wr.state AS wf_state,
                       sa.id AS attempt_pk, sa.state AS attempt_state,
                       sa.replay_decision, sa.attempt_number
                  FROM workflow_lease wl
                  JOIN workflow_step ws ON ws.id = wl.workflow_step_id
                  JOIN workflow_run wr ON wr.id = wl.workflow_run_id
                  LEFT JOIN LATERAL (
                      SELECT id, state, replay_decision, attempt_number
                        FROM step_attempt
                       WHERE workflow_step_id = ws.id
                         AND project_id = wl.project_id
                       ORDER BY attempt_number DESC, id DESC
                       LIMIT 1
                  ) sa ON true
                 WHERE wl.status = 'active'
                   AND wl.expires_at < %s
                   AND wl.project_id = %s
                 ORDER BY wl.expires_at, wl.id
                 FOR UPDATE OF wl, ws SKIP LOCKED
                """,
                (timestamp, self._scope.project_id),
            )
            rows = cur.fetchall()
            for row in rows:
                expired += 1
                lease_id = row["workflow_lease_id"]
                owner = row["lease_owner"]
                token = int(row["fencing_token"])
                step_pk = int(row["step_pk"])
                step_id = row["workflow_step_id"]
                run_pk = int(row["run_pk"])
                workflow_id = row["workflow_run_id"]
                step_state = db_to_step_state(row["step_state"])
                attempt_state = row.get("attempt_state")
                replay_decision = row.get("replay_decision")
                can_reclaim = step_state == StepState.CLAIMED and (
                    attempt_state in (None, "queued")
                    or replay_decision in ("pre_side_effect", "idempotent_pre_side_effect")
                )
                decision = "reclaim" if can_reclaim else "manual_review"
                evidence = {
                    "lease_owner": owner,
                    "fencing_token": token,
                    "expires_at": isoformat_utc(_parse_dt(row["expires_at"])),
                    "last_heartbeat_at": isoformat_utc(_parse_dt(row.get("heartbeat_at") or row["acquired_at"])),
                    "decision": decision,
                    "step_state": step_state.value,
                    "attempt_state": attempt_state,
                    "replay_decision": replay_decision,
                }
                sweep_ref = f"runtime-ref:lease-sweep:{lease_id}:{decision}"
                cur.execute(
                    """
                    UPDATE workflow_lease
                       SET status = 'expired',
                           recovery_reason = %s,
                           sweep_evidence_ref = %s,
                           metadata = metadata || %s::jsonb,
                           updated_at = %s
                     WHERE id = %s
                       AND status = 'active'
                    """,
                    (
                        "stuck_lease_recovery" if can_reclaim else "stuck_lease",
                        sweep_ref,
                        json.dumps({"lease_sweep": evidence}),
                        timestamp,
                        row["lease_pk"],
                    ),
                )
                trace_context = TraceContext(
                    trace_id=uuid4().hex,
                    span_id=uuid4().hex[:16],
                    correlation_id=workflow_id,
                    baggage_refs=(sweep_ref,),
                )
                if can_reclaim:
                    cur.execute(
                        """
                        UPDATE workflow_step
                           SET state = %s,
                               next_attempt_at = NULL,
                               updated_at = %s,
                               metadata = metadata || %s::jsonb
                         WHERE id = %s
                           AND project_id = %s
                        """,
                        (
                            step_state_to_db(StepState.PENDING),
                            timestamp,
                            json.dumps({"lease_sweep": evidence}),
                            step_pk,
                            self._scope.project_id,
                        ),
                    )
                    event_type = "retry_scheduled"
                    refs = {"lease_sweep_ref": sweep_ref, "decision": decision}
                    recovered += 1
                else:
                    cur.execute(
                        """
                        UPDATE workflow_step
                           SET state = %s,
                               failure_class = %s,
                               failure_reason = %s,
                               updated_at = %s,
                               metadata = metadata || %s::jsonb
                         WHERE id = %s
                           AND project_id = %s
                        """,
                        (
                            step_state_to_db(StepState.MANUAL_REVIEW),
                            FailureClass.WORKER_CRASH_ACTIVE_LEASE.value,
                            sweep_ref,
                            timestamp,
                            json.dumps({"lease_sweep": evidence}),
                            step_pk,
                            self._scope.project_id,
                        ),
                    )
                    item = ManualReviewItem(
                        review_id=f"manual_review_{uuid4().hex}",
                        workflow_id=workflow_id,
                        step_id=step_id,
                        review_ref=f"runtime-ref:manual-review:{workflow_id}:{step_id}:stuck-lease",
                        reason_ref="stuck_lease",
                    )
                    self._insert_manual_review_locked(
                        cur,
                        run_pk=run_pk,
                        workflow_id=workflow_id,
                        step_pk=step_pk,
                        step_id=step_id,
                        attempt_pk=row.get("attempt_pk"),
                        item=item,
                        reason="stuck_lease",
                        trace_context=trace_context,
                        now=timestamp,
                        evidence=evidence,
                    )
                    event_type = "manual_review_opened"
                    refs = {"lease_sweep_ref": sweep_ref, "decision": decision}
                    escalated += 1
                event = self._make_event(
                    workflow_id,
                    event_type,
                    trace_context,
                    step_id=step_id,
                    refs=refs,
                    now=timestamp,
                )
                event_pk = self._insert_event(cur, run_pk, event, step_pk=step_pk)
                self._enqueue_trace_outbox(
                    cur,
                    run_pk=run_pk,
                    source_event_pk=event_pk,
                    source_event_id=event.event_id,
                    trace_context=trace_context,
                    now=timestamp,
                )
        return {"expired": expired, "recovered": recovered, "escalated": escalated}

    def recover_stale_leases(self, *, now: datetime | None = None) -> int:
        timestamp = now or utc_now()
        with self._cursor() as cur:
            cur.execute(
                """
                WITH expired AS (
                    UPDATE workflow_lease
                       SET status = 'expired', updated_at = %s
                     WHERE status = 'active'
                       AND expires_at < %s
                       AND project_id = %s
                    RETURNING id, workflow_step_id
                )
                UPDATE workflow_step
                   SET state = CASE
                          WHEN workflow_step.state = %s THEN %s
                          WHEN workflow_step.state = %s THEN %s
                          ELSE workflow_step.state
                      END,
                      failure_class = CASE
                          WHEN workflow_step.state = %s THEN %s
                          ELSE workflow_step.failure_class
                      END,
                      metadata = CASE
                          WHEN workflow_step.state = %s THEN
                            workflow_step.metadata || jsonb_build_object(
                              'manual_review_reason', 'worker_crash_active_lease',
                              'lease_recovery_ref', expired.id::text
                            )
                          ELSE workflow_step.metadata
                      END,
                      updated_at = %s
                  FROM expired
                 WHERE workflow_step.id = expired.workflow_step_id
                   AND workflow_step.project_id = %s
                   AND workflow_step.state IN (%s, %s)
                """,
                (
                   timestamp, timestamp, self._scope.project_id,
                   step_state_to_db(StepState.CLAIMED), step_state_to_db(StepState.PENDING),
                   step_state_to_db(StepState.RUNNING), step_state_to_db(StepState.MANUAL_REVIEW),
                   step_state_to_db(StepState.RUNNING), FailureClass.WORKER_CRASH_ACTIVE_LEASE.value,
                   step_state_to_db(StepState.RUNNING),
                   timestamp, self._scope.project_id,
                   step_state_to_db(StepState.CLAIMED), step_state_to_db(StepState.RUNNING),
                ),
            )
            cur.execute(
                """
                SELECT COUNT(*) FROM workflow_lease
                 WHERE status = 'expired'
                   AND updated_at = %s
                   AND project_id = %s
                """,
                (timestamp, self._scope.project_id),
            )
            row = cur.fetchone()
            count_val = row[0] if row and not isinstance(row, dict) else (
                next(iter(row.values())) if row else 0
            )
        return int(count_val)

    # ------------------------------------------------------------------
    # IdempotencyRepository
    # ------------------------------------------------------------------

    def reserve_idempotency(
        self, record: IdempotencyRecord
    ) -> tuple[IdempotencyRecord, bool]:
        s = self._scope
        operation = idempotency_scope_to_db(record.scope)
        db_status = idempotency_status_to_db(record.status)
        expires_at = record.created_at + timedelta(days=_IDEMPOTENCY_EXPIRY_DAYS)

        meta: dict[str, Any] = {
            "request_ref": record.request_ref,
            "workflow_id": record.workflow_id,
            "step_id": record.step_id,
        }

        with self._cursor() as cur:
            # Use INSERT … ON CONFLICT DO NOTHING; then inspect RETURNING
            cur.execute(
                """
                INSERT INTO workflow_idempotency_key (
                    workflow_idempotency_key_id,
                    project_id, principal_id,
                    operation, idempotency_key,
                    status, result_ref,
                    trace_id, request_id,
                    expires_at, metadata,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (project_id, operation, idempotency_key) DO NOTHING
                RETURNING workflow_idempotency_key_id
                """,
                (
                    uuid4().hex,
                    s.project_id, s.principal_id,
                    operation, record.key,
                    db_status, record.result_ref,
                    uuid4().hex, uuid4().hex[:16],
                    expires_at, json.dumps(meta),
                    record.created_at, record.created_at,
                ),
            )
            inserted = cur.fetchone()
            if inserted is not None:
                return record, True

            # Conflict: fetch the existing row
            cur.execute(
                """
                SELECT operation, idempotency_key, status, result_ref,
                       metadata, created_at, updated_at
                  FROM workflow_idempotency_key
                 WHERE project_id = %s
                   AND operation = %s
                   AND idempotency_key = %s
                """,
                (s.project_id, operation, record.key),
            )
            existing_row = cur.fetchone()
            if existing_row is None:
                raise RepositoryError(
                    f"idempotency race: cannot fetch existing record "
                    f"for {record.scope.value}:{record.key}"
                )
            existing = row_to_idempotency(existing_row)
            conflicts = [
                record.request_ref is not None and existing.request_ref != record.request_ref,
                record.workflow_id is not None and existing.workflow_id != record.workflow_id,
                record.step_id is not None and existing.step_id != record.step_id,
            ]
            if any(conflicts):
                raise RepositoryError(
                    f"idempotency conflict for {record.scope.value}:{record.key}"
                )
            return existing, False

    def get_idempotency(
        self, scope: IdempotencyScope, key: str
    ) -> IdempotencyRecord | None:
        s = self._scope
        operation = idempotency_scope_to_db(scope)
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT operation, idempotency_key, status, result_ref,
                       metadata, created_at, updated_at
                  FROM workflow_idempotency_key
                 WHERE project_id = %s
                   AND operation = %s
                   AND idempotency_key = %s
                """,
                (s.project_id, operation, key),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return row_to_idempotency(row)

    def complete_idempotency(
        self,
        scope: IdempotencyScope,
        key: str,
        *,
        result_ref: str,
        now: datetime | None = None,
    ) -> IdempotencyRecord:
        s = self._scope
        timestamp = now or utc_now()
        operation = idempotency_scope_to_db(scope)
        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE workflow_idempotency_key
                   SET status = %s,
                       result_ref = %s,
                       updated_at = %s
                 WHERE project_id = %s
                   AND operation = %s
                   AND idempotency_key = %s
                   AND status IN ('pending', 'in_progress')
                RETURNING operation, idempotency_key, status, result_ref,
                          metadata, created_at, updated_at
                """,
                (
                    idempotency_status_to_db(IdempotencyStatus.COMPLETED),
                    result_ref, timestamp,
                    s.project_id, operation, key,
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise RepositoryError(
                    f"missing or already-terminal idempotency record: "
                    f"{scope.value}:{key}"
                )
        return row_to_idempotency(row)

    # ------------------------------------------------------------------
    # RetryRepository
    # ------------------------------------------------------------------

    def record_retry_decision(self, decision: RetryDecision) -> RetryDecision:
        timestamp = utc_now()
        with self._cursor() as cur:
            step_pk = self._lookup_step_pk(cur, decision.step_id)
            cur.execute(
                """
                UPDATE step_attempt
                   SET failure_class = %s,
                       failure_reason = %s,
                       metadata = metadata || %s::jsonb,
                       updated_at = %s
                 WHERE workflow_step_id = %s
                   AND project_id = %s
                   AND attempt_number = %s
                """,
                (
                    decision.failure_class.value,
                    decision.reason_ref,
                    json.dumps(
                        {
                            "retry_eligible": decision.eligible,
                            "retry_delay_seconds": decision.delay_seconds,
                        }
                    ),
                    timestamp,
                    step_pk,
                    self._scope.project_id,
                    decision.attempt,
                ),
            )
        return decision

    def get_retry_decisions(self, step_id: str) -> tuple[RetryDecision, ...]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT sa.attempt_number, sa.failure_class, sa.failure_reason, sa.metadata,
                       wr.workflow_run_id AS workflow_run_id_text,
                       ws.workflow_step_id AS workflow_step_id_text
                  FROM step_attempt sa
                  JOIN workflow_step ws ON ws.id = sa.workflow_step_id
                  JOIN workflow_run wr ON wr.id = sa.workflow_run_id
                 WHERE ws.workflow_step_id = %s
                   AND sa.project_id = %s
                   AND ws.project_id = %s
                   AND wr.project_id = %s
                   AND sa.failure_class IS NOT NULL
                 ORDER BY sa.attempt_number, sa.id
                """,
                (step_id, self._scope.project_id, self._scope.project_id, self._scope.project_id),
            )
            rows = cur.fetchall()
        return tuple(row_to_retry_decision(row) for row in rows)

    # ------------------------------------------------------------------
    # CancellationRepository
    # ------------------------------------------------------------------

    def create_cancellation(self, record: CancellationRecord) -> CancellationRecord:
        s = self._scope
        reason = record.reason_ref or f"cancellation:{record.cancellation_id}"
        prop_state = record.propagation_state.value if record.propagation_state else "requested"
        target_refs = {"target": record.target.value, "workflow_id": record.workflow_id, "step_id": record.step_id}
        with self._cursor() as cur:
            run_pk = self._lookup_run_pk(cur, record.workflow_id)
            cur.execute(
                """
                INSERT INTO workflow_cancellation (
                    workflow_cancellation_id, workflow_run_id, task_ref,
                    requester_principal_id, reason, propagation_state, target_refs,
                    idempotency_key,
                    trace_id, request_id, project_id, production_enabled,
                    created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, false, %s, %s)
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING workflow_cancellation_id
                """,
                (
                    record.cancellation_id, run_pk, record.reason_ref,
                    s.principal_id, reason, prop_state,
                    json.dumps(target_refs),
                    record.idempotency_key or record.cancellation_id,
                    uuid4().hex, uuid4().hex[:16],
                    s.project_id,
                    record.requested_at, record.requested_at,
                ),
            )
            row = cur.fetchone()
            if row is None:
                existing = self.get_cancellation(record.cancellation_id)
                if existing is not None and cancellation_replay_matches(existing, record):
                    return existing
                cur.execute(
                    """
                    SELECT wc.workflow_cancellation_id, wc.task_ref, wc.target_refs, wc.propagation_state,
                           wc.created_at, wc.updated_at,
                           wr.workflow_run_id AS workflow_run_id_text
                      FROM workflow_cancellation wc
                      JOIN workflow_run wr ON wr.id = wc.workflow_run_id
                     WHERE wc.idempotency_key = %s
                       AND wc.project_id = %s
                       AND wr.project_id = %s
                    """,
                    (
                        record.idempotency_key or record.cancellation_id,
                        self._scope.project_id,
                        self._scope.project_id,
                    ),
                )
                existing_row = cur.fetchone()
                if existing_row is None:
                    raise RepositoryError(
                        f"INSERT workflow_cancellation returned no row for {record.cancellation_id}"
                    )
                existing_by_key = row_to_cancellation(existing_row)
                if not cancellation_replay_matches(existing_by_key, record):
                    raise RepositoryError(
                        f"workflow_cancellation idempotency conflict for {record.cancellation_id}"
                    )
                return existing_by_key
        return record

    def get_cancellation(self, cancellation_id: str) -> CancellationRecord | None:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT wc.workflow_cancellation_id, wc.task_ref, wc.target_refs, wc.propagation_state,
                       wc.created_at, wc.updated_at,
                       wr.workflow_run_id AS workflow_run_id_text
                  FROM workflow_cancellation wc
                  JOIN workflow_run wr ON wr.id = wc.workflow_run_id
                 WHERE wc.workflow_cancellation_id = %s
                   AND wc.project_id = %s
                   AND wr.project_id = %s
                """,
                (cancellation_id, self._scope.project_id, self._scope.project_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return row_to_cancellation(row)

    def complete_cancellation(
        self,
        cancellation_id: str,
        *,
        now: datetime | None = None,
    ) -> CancellationRecord:
        timestamp = now or utc_now()
        with self._cursor() as cur:
            cur.execute(
                """
                WITH updated AS (
                    UPDATE workflow_cancellation
                       SET propagation_state = 'completed',
                           updated_at = %s
                     WHERE workflow_cancellation_id = %s
                       AND project_id = %s
                       AND propagation_state NOT IN (
                           'completed', 'partially_completed',
                           'partially_completed_manual_review'
                       )
                    RETURNING workflow_cancellation_id, workflow_run_id,
                              task_ref, target_refs, propagation_state, created_at, updated_at
                )
                SELECT updated.workflow_cancellation_id,
                       updated.task_ref, updated.target_refs, updated.propagation_state,
                       updated.created_at, updated.updated_at,
                       wr.workflow_run_id AS workflow_run_id_text
                  FROM updated
                  JOIN workflow_run wr ON wr.id = updated.workflow_run_id
                   AND wr.project_id = %s
                """,
                (timestamp, cancellation_id, self._scope.project_id, self._scope.project_id),
            )
            row = cur.fetchone()
        if row is None:
            raise RepositoryError(
                f"cancellation not found or already terminal: {cancellation_id}"
            )
        return row_to_cancellation(row)

    def has_active_cancellation(self, workflow_id: str, step_id: str | None = None) -> bool:
        """Return True if the workflow has a non-terminal cancellation request."""
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                      FROM workflow_cancellation wc
                      JOIN workflow_run wr ON wr.id = wc.workflow_run_id
                     WHERE wr.workflow_run_id = %s
                       AND wc.propagation_state NOT IN (
                           'completed', 'partially_completed',
                           'partially_completed_manual_review'
                       )
                       AND (
                           wc.target_refs->>'target' = 'workflow'
                           OR (%s IS NOT NULL AND wc.target_refs->>'step_id' = %s)
                       )
                       AND wc.project_id = %s
                ) AS has_active
                """,
                (workflow_id, step_id, step_id, self._scope.project_id),
            )
            row = cur.fetchone()
        if row is None:
            return False
        val = row["has_active"] if isinstance(row, dict) else row[0]
        return bool(val)

    def cancel_step(
        self,
        step_id: str,
        *,
        lease: "Lease",
        safe_interruptible: bool = False,
        trace_context: TraceContext,
        now: datetime | None = None,
    ) -> CancellationAction:
        """Apply cancellation to a claimed/running step with lease fencing.

        Reuses ``update_step_state`` for atomic fenced updates so that the
        exact same SQL predicates are applied consistently.
        """
        from .cancellation import decide_cancellation_action

        step = self.get_step(step_id)
        if step is None:
            raise RepositoryError(f"unknown step: {step_id}")

        action = decide_cancellation_action(step.state, safe_interruptible=safe_interruptible)
        if action == CancellationAction.NO_ACTION:
            return action

        target_state = (
            StepState.MANUAL_REVIEW
            if action == CancellationAction.MANUAL_REVIEW
            else StepState.CANCELLED
        )
        self.update_step_state(
            step_id,
            target_state,
            trace_context=trace_context,
            refs={"cancellation_action": action.value},
            lease=lease,
            now=now,
        )
        return action

    def propagate_cancellations(self, *, now: datetime | None = None, limit: int = 100) -> dict[str, int]:
        """Propagate active workflow cancellations inside one repository transaction.

        This helper is intentionally metadata/ref-only.  It terminalizes queued
        work, releases still-reserved budget reservations, preserves completed
        work, and opens manual review for ambiguous in-flight side effects.
        """
        timestamp = now or utc_now()
        stats = {
            "claimed": 0,
            "completed": 0,
            "partially_completed_manual_review": 0,
            "steps_cancelled": 0,
            "steps_manual_review": 0,
            "approvals_cancelled": 0,
            "delegations_cancelled": 0,
            "tool_calls_cancelled": 0,
            "agent_runs_cancelled": 0,
            "reservations_released": 0,
            "manual_review_escalations": 0,
        }
        active_states = (
            "requested",
            "propagating",
            "pending_manual_review",
            "unwinding",
            "releasing_reservations",
        )
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT wc.id AS cancellation_pk, wc.workflow_cancellation_id,
                       wc.target_refs, wc.trace_id, wc.request_id,
                       wr.id AS run_pk, wr.workflow_run_id, wr.state AS workflow_state
                  FROM workflow_cancellation wc
                  JOIN workflow_run wr ON wr.id = wc.workflow_run_id
                 WHERE wc.project_id = %s
                   AND wr.project_id = %s
                   AND wc.propagation_state = ANY(%s)
                 ORDER BY wc.created_at, wc.id
                 LIMIT %s
                 FOR UPDATE OF wc, wr SKIP LOCKED
                """,
                (self._scope.project_id, self._scope.project_id, list(active_states), limit),
            )
            rows = cur.fetchall()
            stats["claimed"] = len(rows)
            for row in rows:
                cancellation_pk = int(row["cancellation_pk"] if isinstance(row, dict) else row[0])
                cancellation_id = row["workflow_cancellation_id"] if isinstance(row, dict) else row[1]
                target_refs = _parse_meta(row, "target_refs") if isinstance(row, dict) else (row[2] or {})
                trace_id = row["trace_id"] if isinstance(row, dict) else row[3]
                request_id = row["request_id"] if isinstance(row, dict) else row[4]
                run_pk = int(row["run_pk"] if isinstance(row, dict) else row[5])
                workflow_id = row["workflow_run_id"] if isinstance(row, dict) else row[6]
                workflow_state = WorkflowState(row["workflow_state"] if isinstance(row, dict) else row[7])
                target_step_id = target_refs.get("step_id") if isinstance(target_refs, dict) else None
                trace_context = TraceContext(
                    trace_id=trace_id or uuid4().hex,
                    span_id=(request_id or uuid4().hex[:16])[:16],
                    correlation_id=workflow_id,
                )

                cur.execute(
                    """
                    UPDATE workflow_cancellation
                       SET propagation_state = 'propagating',
                           updated_at = %s
                     WHERE id = %s
                       AND project_id = %s
                       AND propagation_state <> 'propagating'
                    """,
                    (timestamp, cancellation_pk, self._scope.project_id),
                )
                observed_event = self._make_event(
                    workflow_id,
                    "cancellation_observed",
                    trace_context,
                    state=workflow_state,
                    refs={"cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}"},
                    now=timestamp,
                )
                self._insert_event(cur, run_pk, observed_event)

                target_filter = ""
                target_params: list[Any] = []
                if target_step_id:
                    target_filter = " AND workflow_step_id = %s"
                    target_params.append(target_step_id)

                cancelled_step_ids = self._cancel_pending_steps_locked(
                    cur,
                    run_pk=run_pk,
                    target_filter=target_filter,
                    target_params=target_params,
                    cancellation_id=cancellation_id,
                    now=timestamp,
                )
                stats["steps_cancelled"] += len(cancelled_step_ids)
                safe_running_step_ids = self._cancel_safe_running_steps_locked(
                    cur,
                    run_pk=run_pk,
                    target_filter=target_filter,
                    target_params=target_params,
                    cancellation_id=cancellation_id,
                    now=timestamp,
                )
                stats["steps_cancelled"] += len(safe_running_step_ids)
                cancelled_step_pks = [pk for pk, _step_id in (*cancelled_step_ids, *safe_running_step_ids)]
                if cancelled_step_pks:
                    cur.execute(
                        """
                        UPDATE step_attempt
                           SET state = 'cancelled',
                               completed_at = COALESCE(completed_at, %s),
                               replay_decision = COALESCE(replay_decision, 'abort'),
                               metadata = metadata || %s::jsonb,
                               updated_at = %s
                         WHERE workflow_run_id = %s
                           AND project_id = %s
                           AND workflow_step_id = ANY(%s)
                           AND state IN ('queued', 'running', 'cancel_requested')
                        """,
                        (
                            timestamp,
                            json.dumps({"cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}"}),
                            timestamp,
                            run_pk,
                            self._scope.project_id,
                            cancelled_step_pks,
                        ),
                    )

                manual_reviews = self._escalate_ambiguous_running_steps_locked(
                    cur,
                    run_pk=run_pk,
                    workflow_id=workflow_id,
                    target_filter=target_filter,
                    target_params=target_params,
                    cancellation_id=cancellation_id,
                    trace_context=trace_context,
                    now=timestamp,
                )
                stats["steps_manual_review"] += manual_reviews
                stats["manual_review_escalations"] += manual_reviews

                approvals_cancelled = self._cancel_pending_approvals_locked(
                    cur,
                    run_pk=run_pk,
                    target_step_id=target_step_id,
                    cancellation_id=cancellation_id,
                    now=timestamp,
                )
                stats["approvals_cancelled"] += approvals_cancelled
                stats["delegations_cancelled"] += self._cancel_pending_delegations_locked(cur, run_pk=run_pk, now=timestamp)
                stats["tool_calls_cancelled"] += self._cancel_pending_tool_calls_locked(cur, run_pk=run_pk, now=timestamp)
                stats["agent_runs_cancelled"] += self._cancel_pending_agent_runs_locked(cur, run_pk=run_pk, now=timestamp)
                stats["reservations_released"] += self._release_unused_reservations_locked(
                    cur,
                    run_pk=run_pk,
                    cancellation_id=cancellation_id,
                    now=timestamp,
                )

                terminal_state = (
                    CancellationPropagationState.PARTIALLY_COMPLETED_MANUAL_REVIEW
                    if manual_reviews > 0
                    else CancellationPropagationState.COMPLETED
                )
                workflow_target = WorkflowState.MANUAL_REVIEW if manual_reviews > 0 else WorkflowState.CANCELLED
                if workflow_state not in TERMINAL_WORKFLOW_STATES:
                    cur.execute(
                        """
                        UPDATE workflow_run
                           SET state = %s,
                               cancellation_ref = %s,
                               manual_review_status = CASE WHEN %s THEN 'pending' ELSE manual_review_status END,
                               completed_at = CASE WHEN %s THEN completed_at ELSE COALESCE(completed_at, %s) END,
                               updated_at = %s
                         WHERE id = %s
                           AND project_id = %s
                           AND state NOT IN ('succeeded', 'completed', 'failed', 'cancelled', 'timed_out', 'denied')
                        """,
                        (
                            workflow_target.value,
                            f"runtime-ref:cancellation:{cancellation_id}",
                            manual_reviews > 0,
                            manual_reviews > 0,
                            timestamp,
                            timestamp,
                            run_pk,
                            self._scope.project_id,
                        ),
                    )

                cur.execute(
                    """
                    UPDATE workflow_cancellation
                       SET propagation_state = %s,
                           terminal_ref = %s,
                           budget_release_ref = CASE WHEN %s THEN %s ELSE budget_release_ref END,
                           manual_review_ref = CASE WHEN %s THEN %s ELSE manual_review_ref END,
                           updated_at = %s
                     WHERE id = %s
                       AND project_id = %s
                    """,
                    (
                        terminal_state.value,
                        f"runtime-ref:cancellation-terminal:{cancellation_id}:{workflow_target.value}",
                        stats["reservations_released"] > 0,
                        f"runtime-ref:budget-release:cancellation:{cancellation_id}",
                        manual_reviews > 0,
                        f"runtime-ref:manual-review:cancellation:{cancellation_id}",
                        timestamp,
                        cancellation_pk,
                        self._scope.project_id,
                    ),
                )
                completed_event = self._make_event(
                    workflow_id,
                    "cancellation_completed",
                    trace_context.child(),
                    state=workflow_target,
                    refs={
                        "cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}",
                        "terminal_ref": f"runtime-ref:cancellation-terminal:{cancellation_id}:{workflow_target.value}",
                    },
                    now=timestamp,
                )
                self._insert_event(cur, run_pk, completed_event)
                if manual_reviews > 0:
                    stats["partially_completed_manual_review"] += 1
                else:
                    stats["completed"] += 1
        return stats

    def _cancel_pending_steps_locked(
        self,
        cur: Any,
        *,
        run_pk: int,
        target_filter: str,
        target_params: Sequence[Any],
        cancellation_id: str,
        now: datetime,
    ) -> list[tuple[int, str]]:
        cur.execute(
            f"""
            UPDATE workflow_step
               SET state = 'cancelled',
                   completed_at = COALESCE(completed_at, %s),
                   metadata = metadata || %s::jsonb,
                   updated_at = %s
             WHERE workflow_run_id = %s
               AND project_id = %s
               AND state IN ('created', 'planning', 'delegating', 'synthesizing', 'pending_approval')
               {target_filter}
             RETURNING id, workflow_step_id
            """,
            (
                now,
                json.dumps({"cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}", "action": "skip"}),
                now,
                run_pk,
                self._scope.project_id,
                *target_params,
            ),
        )
        return [(int(row["id"] if isinstance(row, dict) else row[0]), row["workflow_step_id"] if isinstance(row, dict) else row[1]) for row in cur.fetchall()]

    def _cancel_safe_running_steps_locked(
        self,
        cur: Any,
        *,
        run_pk: int,
        target_filter: str,
        target_params: Sequence[Any],
        cancellation_id: str,
        now: datetime,
    ) -> list[tuple[int, str]]:
        cur.execute(
            f"""
            UPDATE workflow_step
               SET state = 'cancelled',
                   completed_at = COALESCE(completed_at, %s),
                   metadata = metadata || %s::jsonb,
                   updated_at = %s
             WHERE workflow_run_id = %s
               AND project_id = %s
               AND state = 'running'
               AND lower(COALESCE(metadata->>'safe_interruptible', 'false')) IN ('true', '1', 'yes')
               {target_filter}
             RETURNING id, workflow_step_id
            """,
            (
                now,
                json.dumps({"cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}", "action": "abort"}),
                now,
                run_pk,
                self._scope.project_id,
                *target_params,
            ),
        )
        return [(int(row["id"] if isinstance(row, dict) else row[0]), row["workflow_step_id"] if isinstance(row, dict) else row[1]) for row in cur.fetchall()]

    def _escalate_ambiguous_running_steps_locked(
        self,
        cur: Any,
        *,
        run_pk: int,
        workflow_id: str,
        target_filter: str,
        target_params: Sequence[Any],
        cancellation_id: str,
        trace_context: TraceContext,
        now: datetime,
    ) -> int:
        cur.execute(
            f"""
            SELECT id, workflow_step_id
              FROM workflow_step
             WHERE workflow_run_id = %s
               AND project_id = %s
               AND state = 'running'
               AND lower(COALESCE(metadata->>'safe_interruptible', 'false')) NOT IN ('true', '1', 'yes')
               {target_filter}
             FOR UPDATE
            """,
            (run_pk, self._scope.project_id, *target_params),
        )
        rows = cur.fetchall()
        for row in rows:
            step_pk = int(row["id"] if isinstance(row, dict) else row[0])
            step_id = row["workflow_step_id"] if isinstance(row, dict) else row[1]
            attempt_pk = self._latest_step_attempt_pk(cur, step_pk=step_pk)
            cur.execute(
                """
                UPDATE workflow_step
                   SET state = 'manual_review',
                       failure_class = %s,
                       failure_reason = %s,
                       metadata = metadata || %s::jsonb,
                       updated_at = %s
                 WHERE id = %s
                   AND project_id = %s
                """,
                (
                    FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT.value,
                    f"runtime-ref:cancellation-ambiguous:{cancellation_id}:{step_id}",
                    json.dumps({"cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}"}),
                    now,
                    step_pk,
                    self._scope.project_id,
                ),
            )
            cur.execute(
                """
                UPDATE step_attempt
                   SET state = 'cancel_requested',
                       failure_class = %s,
                       failure_reason = %s,
                       replay_decision = COALESCE(replay_decision, 'abort'),
                       metadata = metadata || %s::jsonb,
                       updated_at = %s
                 WHERE id = %s
                   AND project_id = %s
                   AND state IN ('queued', 'running', 'cancel_requested')
                """,
                (
                    FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT.value,
                    f"runtime-ref:cancellation-ambiguous:{cancellation_id}:{step_id}",
                    json.dumps({"cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}"}),
                    now,
                    attempt_pk,
                    self._scope.project_id,
                ),
            )
            self._insert_manual_review_locked(
                cur,
                run_pk=run_pk,
                workflow_id=workflow_id,
                step_pk=step_pk,
                step_id=step_id,
                attempt_pk=attempt_pk,
                item=ManualReviewItem(
                    review_id=f"manual_review_{uuid4().hex}",
                    workflow_id=workflow_id,
                    step_id=step_id,
                    review_ref=f"runtime-ref:manual-review:cancellation:{cancellation_id}:{step_id}",
                    reason_ref="cancellation_unresolvable",
                ),
                reason="cancellation_unresolvable",
                trace_context=trace_context.child(),
                now=now,
                evidence={"cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}", "step_id": step_id},
            )
        return len(rows)

    def _cancel_pending_approvals_locked(
        self,
        cur: Any,
        *,
        run_pk: int,
        target_step_id: str | None,
        cancellation_id: str,
        now: datetime,
    ) -> int:
        step_filter = ""
        params: list[Any] = [now, json.dumps({"cancellation_ref": f"runtime-ref:cancellation:{cancellation_id}"}), now, run_pk, self._scope.project_id]
        if target_step_id:
            step_filter = " AND workflow_step_id = (SELECT id FROM workflow_step WHERE workflow_step_id = %s AND project_id = %s)"
            params.extend([target_step_id, self._scope.project_id])
        cur.execute(
            f"""
            UPDATE approval_request
               SET state = 'cancelled',
                   decision_metadata = decision_metadata || %s::jsonb,
                   updated_at = %s
             WHERE workflow_run_id = %s
               AND project_id = %s
               AND state = 'pending'
               {step_filter}
            """,
            params[1:],
        )
        return int(cur.rowcount or 0)

    def _cancel_pending_delegations_locked(self, cur: Any, *, run_pk: int, now: datetime) -> int:
        cur.execute(
            """
            UPDATE delegation
               SET state = 'cancelled',
                   completed_at = COALESCE(completed_at, %s),
                   updated_at = %s
             WHERE workflow_run_id = %s
               AND project_id = %s
               AND state IN ('draft', 'queued', 'dispatched')
            """,
            (now, now, run_pk, self._scope.project_id),
        )
        return int(cur.rowcount or 0)

    def _cancel_pending_tool_calls_locked(self, cur: Any, *, run_pk: int, now: datetime) -> int:
        cur.execute(
            """
            UPDATE tool_call
               SET state = 'cancelled',
                   completed_at = COALESCE(completed_at, %s),
                   updated_at = %s
             WHERE workflow_run_id = %s
               AND project_id = %s
               AND state IN ('queued', 'denied')
            """,
            (now, now, run_pk, self._scope.project_id),
        )
        return int(cur.rowcount or 0)

    def _cancel_pending_agent_runs_locked(self, cur: Any, *, run_pk: int, now: datetime) -> int:
        cur.execute(
            """
            UPDATE agent_run
               SET state = 'cancelled',
                   completed_at = COALESCE(completed_at, %s),
                   updated_at = %s
             WHERE workflow_run_id = %s
               AND project_id = %s
               AND state IN ('queued', 'leased')
            """,
            (now, now, run_pk, self._scope.project_id),
        )
        return int(cur.rowcount or 0)

    def _release_unused_reservations_locked(
        self,
        cur: Any,
        *,
        run_pk: int,
        cancellation_id: str,
        now: datetime,
    ) -> int:
        cur.execute(
            """
            UPDATE budget_reservation
               SET status = 'released',
                   released_at = COALESCE(released_at, %s),
                   release_idempotency_key = COALESCE(
                       release_idempotency_key,
                       'cancellation:' || reservation_id
                   ),
                   updated_at = %s
             WHERE workflow_run_id = %s
               AND status = 'reserved'
               AND production_enabled = false
            """,
            (now, now, run_pk),
        )
        return int(cur.rowcount or 0)

    # ------------------------------------------------------------------
    # BudgetReservationRepository
    # ------------------------------------------------------------------

    def reap_orphaned_budget_reservations(
        self,
        *,
        now: datetime | None = None,
        limit: int = 100,
        approval_wait_ttl_seconds: float = 14_400.0,
        abandoned_workflow_seconds: float = 86_400.0,
        workflow_id: str | None = None,
    ) -> dict[str, int]:
        """Detect and release orphaned reserved budget rows exactly once."""
        timestamp = now or utc_now()
        stats = {
            "inspected": 0,
            "orphaned": 0,
            "reconciled": 0,
            "released": 0,
            "approval_wait_released": 0,
            "expired_lease_released": 0,
            "abandoned_workflow_released": 0,
            "terminal_workflow_released": 0,
        }
        terminal_states = tuple(state.value for state in TERMINAL_WORKFLOW_STATES)
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT br.id AS reservation_pk,
                       br.reservation_id,
                       br.workflow_run_id AS run_pk,
                       wr.workflow_run_id,
                       wr.state AS workflow_state,
                       wr.trace_id,
                       wr.request_id,
                       CASE
                         WHEN wr.state = ANY(%s) THEN 'terminal_workflow'
                         WHEN EXISTS (
                              SELECT 1
                                FROM approval_request ar
                               WHERE ar.workflow_run_id = wr.id
                                 AND ar.project_id = wr.project_id
                                 AND ar.state = 'pending'
                                 AND ar.created_at <= %s - (%s * interval '1 second')
                         ) THEN 'approval_wait_ttl_expired'
                         WHEN EXISTS (
                              SELECT 1
                                FROM workflow_lease wl
                               WHERE wl.workflow_run_id = wr.id
                                 AND wl.project_id = wr.project_id
                                 AND wl.status = 'active'
                                 AND wl.expires_at <= %s
                         ) THEN 'expired_lease'
                         WHEN wr.updated_at <= %s - (%s * interval '1 second')
                              AND NOT EXISTS (
                                  SELECT 1
                                    FROM workflow_lease wl
                                   WHERE wl.workflow_run_id = wr.id
                                     AND wl.project_id = wr.project_id
                                     AND wl.status = 'active'
                                     AND wl.expires_at > %s
                              ) THEN 'abandoned_workflow'
                         ELSE NULL
                       END AS orphan_reason
                  FROM budget_reservation br
                  JOIN workflow_run wr ON wr.id = br.workflow_run_id
                 WHERE wr.project_id = %s
                   AND br.status = 'reserved'
                   AND br.production_enabled = false
                   AND (%s::text IS NULL OR wr.workflow_run_id = %s)
                 ORDER BY br.reserved_at, br.id
                 LIMIT %s
                 FOR UPDATE OF br, wr SKIP LOCKED
                """,
                (
                    list(terminal_states),
                    timestamp,
                    approval_wait_ttl_seconds,
                    timestamp,
                    timestamp,
                    abandoned_workflow_seconds,
                    timestamp,
                    self._scope.project_id,
                    workflow_id,
                    workflow_id,
                    limit,
                ),
            )
            rows = tuple(cur.fetchall())
            stats["inspected"] = len(rows)
            for row in rows:
                reason = row["orphan_reason"] if isinstance(row, dict) else row[7]
                if reason is None:
                    continue
                stats["orphaned"] += 1
                reservation_pk = int(row["reservation_pk"] if isinstance(row, dict) else row[0])
                reservation_id = row["reservation_id"] if isinstance(row, dict) else row[1]
                run_pk = int(row["run_pk"] if isinstance(row, dict) else row[2])
                workflow_id = row["workflow_run_id"] if isinstance(row, dict) else row[3]
                workflow_state = WorkflowState(row["workflow_state"] if isinstance(row, dict) else row[4])
                trace_id = (row["trace_id"] if isinstance(row, dict) else row[5]) or uuid4().hex
                request_id = (row["request_id"] if isinstance(row, dict) else row[6]) or uuid4().hex[:16]
                release_key = f"budget-reaper:{reason}:{reservation_id}"
                cur.execute(
                    """
                    UPDATE budget_reservation
                       SET status = 'released',
                           released_at = COALESCE(released_at, %s),
                           release_idempotency_key = COALESCE(release_idempotency_key, %s),
                           updated_at = %s
                     WHERE id = %s
                       AND status = 'reserved'
                       AND production_enabled = false
                     RETURNING id
                    """,
                    (timestamp, release_key, timestamp, reservation_pk),
                )
                if cur.fetchone() is None:
                    continue
                stats["released"] += 1
                stats["reconciled"] += 1
                if reason == "approval_wait_ttl_expired":
                    stats["approval_wait_released"] += 1
                elif reason == "expired_lease":
                    stats["expired_lease_released"] += 1
                elif reason == "abandoned_workflow":
                    stats["abandoned_workflow_released"] += 1
                elif reason == "terminal_workflow":
                    stats["terminal_workflow_released"] += 1
                trace_context = TraceContext(
                    trace_id=trace_id,
                    span_id=str(request_id)[:16],
                    correlation_id=workflow_id,
                )
                event = self._make_event(
                    workflow_id,
                    "budget.reservation.reconciled",
                    trace_context,
                    state=workflow_state,
                    refs={
                        "budget_reservation_id": str(reservation_id),
                        "budget_reservation_state": "reconciled",
                        "orphan_reason": str(reason),
                        "release_idempotency_key": release_key,
                        "audit_ref": f"runtime-ref:audit:budget-reaper:{reservation_id}",
                    },
                    now=timestamp,
                )
                self._insert_event(cur, run_pk, event)
        return stats

    def settle_budget_reservation(
        self,
        reservation_id: str,
        *,
        actual_amount: float,
        actual_input_tokens: int | None = None,
        actual_output_tokens: int | None = None,
        idempotency_key: str,
        allow_retry_reuse: bool = False,
        retry_attempt: int = 1,
        now: datetime | None = None,
    ) -> bool:
        """Settle a held reservation once; same-body replay is a no-op."""
        if retry_attempt > 1 and not allow_retry_reuse:
            raise RepositoryError("retry settlement may reuse a reservation only when policy allows")
        timestamp = now or utc_now()
        actual_total_tokens = (
            (actual_input_tokens or 0) + (actual_output_tokens or 0)
            if actual_input_tokens is not None or actual_output_tokens is not None
            else None
        )
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT br.id, br.status, br.settle_idempotency_key, br.actual_amount,
                       br.actual_input_tokens, br.actual_output_tokens
                  FROM budget_reservation br
                  JOIN workflow_run wr ON wr.id = br.workflow_run_id
                 WHERE br.reservation_id = %s
                   AND wr.project_id = %s
                   AND br.production_enabled = false
                 FOR UPDATE
                """,
                (reservation_id, self._scope.project_id),
            )
            row = cur.fetchone()
            if row is None:
                raise RepositoryError(f"unknown budget reservation: {reservation_id}")
            status = row["status"] if isinstance(row, dict) else row[1]
            existing_key = row["settle_idempotency_key"] if isinstance(row, dict) else row[2]
            if status == "settled":
                existing_amount = float(row["actual_amount"] if isinstance(row, dict) else row[3])
                existing_input = row["actual_input_tokens"] if isinstance(row, dict) else row[4]
                existing_output = row["actual_output_tokens"] if isinstance(row, dict) else row[5]
                if (
                    existing_key == idempotency_key
                    and existing_amount == float(actual_amount)
                    and existing_input == actual_input_tokens
                    and existing_output == actual_output_tokens
                ):
                    return False
                raise RepositoryError("conflicting budget settlement replay rejected")
            if status != "reserved":
                raise RepositoryError(f"cannot settle budget reservation {reservation_id} because it is {status}")
            cur.execute(
                """
                UPDATE budget_reservation
                   SET status = 'settled',
                       actual_amount = %s,
                       actual_input_tokens = %s,
                       actual_output_tokens = %s,
                       actual_total_tokens = %s,
                       settle_idempotency_key = %s,
                       settled_at = %s,
                       updated_at = %s
                 WHERE id = %s
                   AND status = 'reserved'
                 RETURNING id
                """,
                (
                    actual_amount,
                    actual_input_tokens,
                    actual_output_tokens,
                    actual_total_tokens,
                    idempotency_key,
                    timestamp,
                    timestamp,
                    int(row["id"] if isinstance(row, dict) else row[0]),
                ),
            )
            if cur.fetchone() is None:
                raise RepositoryError("budget settlement was fenced by another writer")
        return True

    # ------------------------------------------------------------------
    # ApprovalRepository
    # ------------------------------------------------------------------

    def _expire_pending_approvals(
        self,
        cur: Any,
        *,
        timestamp: datetime,
        workflow_id: str | None = None,
    ) -> None:
        params: list[Any] = [timestamp, timestamp, self._scope.project_id, self._scope.project_id]
        workflow_filter = ""
        if workflow_id is not None:
            workflow_filter = " AND wr.workflow_run_id = %s"
            params.append(workflow_id)
        cur.execute(
            f"""
            WITH expired AS (
                UPDATE approval_request ar
                   SET state = 'expired',
                       updated_at = %s
                  FROM workflow_run wr
                 WHERE wr.id = ar.workflow_run_id
                   AND ar.state = 'pending'
                   AND ar.expires_at IS NOT NULL
                   AND ar.expires_at <= %s
                   AND ar.project_id = %s
                   AND wr.project_id = %s
                   {workflow_filter}
                 RETURNING
                   ar.approval_request_id,
                   ar.workflow_run_id,
                   ar.project_id,
                   ar.requester_principal_id,
                   COALESCE(ar.budget_scope_id, wr.budget_scope_id) AS budget_scope_id,
                   ar.policy_version,
                   COALESCE(ar.registry_version, wr.registry_version) AS registry_version,
                   wr.data_class,
                   wr.trace_id,
                   wr.request_id,
                   ar.updated_at
            ),
            numbered AS (
                SELECT
                  expired.*,
                  COALESCE((
                    SELECT MAX(sequence_number)
                      FROM workflow_event we
                     WHERE we.workflow_run_id = expired.workflow_run_id
                  ), 0) + ROW_NUMBER() OVER (
                    PARTITION BY expired.workflow_run_id
                    ORDER BY expired.approval_request_id
                  ) AS next_sequence
                FROM expired
            )
            INSERT INTO workflow_event (
                workflow_event_id, workflow_run_id, project_id, principal_id,
                budget_scope_id, sequence_number, event_type, state,
                data_class, policy_version, registry_version,
                trace_id, request_id, metadata, event_time, created_at
            )
            SELECT
                'workflow_event_' || approval_request_id || '_expired',
                workflow_run_id, project_id, requester_principal_id,
                budget_scope_id, next_sequence, 'approval_expired', NULL,
                data_class, policy_version, registry_version,
                trace_id, request_id,
                jsonb_build_object(
                  'refs', jsonb_build_object('approval_request_id', approval_request_id),
                  'runtime_event_type', 'approval.expired'
                ),
                updated_at, updated_at
              FROM numbered
            ON CONFLICT DO NOTHING
            """,
            tuple(params),
        )

    def create_approval_request(self, request: ApprovalRequest) -> ApprovalRequest:
        """Persist an approval_request row.

        Text refs (requester_ref, context_ref) are stored in
        ``approver_policy_metadata`` JSONB since the DB schema only exposes
        bigint FKs for principal/role lookups.  The ``production_enabled``
        column is always false (enforced by DB CHECK constraint).
        """
        if request.expires_at is None:
            request = replace(
                request,
                expires_at=approval_expires_at(request.risk_tier, now=request.requested_at),
            )
        s = self._scope
        meta: dict[str, Any] = {
            "requester_ref": request.requester_ref,
            "context_ref": request.context_ref,
        }
        with self._cursor() as cur:
            run_pk = self._lookup_run_pk(cur, request.workflow_id)
            step_pk: int | None = None
            if request.step_id:
                try:
                    step_pk = self._lookup_step_pk(cur, request.step_id)
                except RepositoryError:
                    pass  # step_id is informational; missing step is allowed

            cur.execute(
                """
                INSERT INTO approval_request (
                    approval_request_id, workflow_run_id, task_id,
                    workflow_step_id, requester_principal_id,
                    approver_policy_ref, approver_policy_metadata,
                    risk_tier, state,
                    decision_metadata,
                    expires_at, trace_id, request_id,
                    policy_version, registry_version,
                    budget_scope_id, project_id,
                    idempotency_key, production_enabled,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, %s,
                    %s, %s,
                    %s, %s::jsonb,
                    %s, 'pending',
                    '{}'::jsonb,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s,
                    %s, false,
                    %s, %s
                )
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                (
                    request.approval_id, run_pk, request.approval_ref,
                    step_pk, s.principal_id,
                    request.policy_ref, json.dumps(meta),
                    approval_risk_tier_to_db(request.risk_tier),
                    request.expires_at, uuid4().hex, uuid4().hex[:16],
                    s.policy_version, s.registry_version,
                    s.budget_scope_id, s.project_id,
                    request.approval_id,
                    request.requested_at, request.requested_at,
                ),
            )
            row = cur.fetchone()
            if row is None:
                existing = self.get_approval_request(request.approval_id)
                if existing is not None and approval_request_replay_matches(existing, request):
                    return existing
                cur.execute(
                    """
                    SELECT ar.approval_request_id,
                           ar.task_id,
                           ar.approver_policy_ref,
                           ar.approver_policy_metadata,
                           ar.risk_tier,
                           ar.expires_at,
                           ar.created_at,
                           wr.workflow_run_id AS workflow_run_id_text,
                           ws.workflow_step_id AS workflow_step_id_text
                      FROM approval_request ar
                      JOIN workflow_run wr ON wr.id = ar.workflow_run_id
                      LEFT JOIN workflow_step ws ON ws.id = ar.workflow_step_id
                     WHERE ar.idempotency_key = %s
                       AND ar.project_id = %s
                       AND wr.project_id = %s
                    """,
                    (request.approval_id, self._scope.project_id, self._scope.project_id),
                )
                existing_row = cur.fetchone()
                if existing_row is None:
                    raise RepositoryError(f"approval_request idempotency conflict for {request.approval_id}")
                existing_by_key = row_to_approval_request(existing_row)
                if not approval_request_replay_matches(existing_by_key, request):
                    raise RepositoryError(f"approval_request idempotency conflict for {request.approval_id}")
                return existing_by_key
        return request

    def get_approval_request(self, approval_id: str) -> ApprovalRequest | None:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ar.approval_request_id,
                       ar.task_id,
                       ar.approver_policy_ref,
                       ar.approver_policy_metadata,
                       ar.risk_tier,
                       ar.expires_at,
                       ar.created_at,
                       wr.workflow_run_id AS workflow_run_id_text,
                       ws.workflow_step_id AS workflow_step_id_text
                  FROM approval_request ar
                  JOIN workflow_run wr ON wr.id = ar.workflow_run_id
                  LEFT JOIN workflow_step ws ON ws.id = ar.workflow_step_id
                 WHERE ar.approval_request_id = %s
                   AND ar.project_id = %s
                   AND wr.project_id = %s
                """,
                (approval_id, self._scope.project_id, self._scope.project_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return row_to_approval_request(row)

    def record_approval_decision(self, decision: ApprovalDecision) -> ApprovalDecision:
        """Record a terminal approval decision (deny/expire/cancel/supersede).

        The APPROVED state requires DB proof FK columns
        (approver_principal_id, required_role_id, action_summary_artifact_id,
        decision_audit_event_id) that the runtime does not have; those must be
        set by the control-api layer.  Calling this method with
        ``decision.decision == ApprovalStatus.APPROVED`` raises
        :class:`~memory.RepositoryError`.

        For all other terminal states the method UPDATE-s the row atomically,
        merging decision audit metadata into ``decision_metadata``.
        """
        if decision.decision not in _RUNTIME_RECORDABLE_DECISION_STATES:
            raise RepositoryError(
                f"runtime cannot record approval decision {decision.decision.value!r}: "
                f"approved decisions require proof FK columns and must be set by the "
                f"control-api layer. Recordable states: "
                f"{sorted(s.value for s in _RUNTIME_RECORDABLE_DECISION_STATES)}"
            )

        decision_meta: dict[str, Any] = {
            "decided_by_ref": decision.decided_by_ref,
            "decided_at": isoformat_utc(decision.decided_at),
            "reason_ref": decision.reason_ref,
            "evidence_refs": list(decision.evidence_refs),
        }
        timestamp = decision.decided_at
        target_state = approval_status_to_db(decision.decision)

        with self._cursor() as cur:
            if decision.decision is not ApprovalStatus.EXPIRED:
                self._expire_pending_approvals(cur, timestamp=timestamp)
            cur.execute(
                """
                UPDATE approval_request
                   SET state = %s,
                       decision_metadata = decision_metadata || %s::jsonb,
                       updated_at = %s
                 WHERE approval_request_id = %s
                   AND project_id = %s
                   AND state = 'pending'
                  AND EXISTS (
                    SELECT 1
                      FROM workflow_run wr
                     WHERE wr.id = approval_request.workflow_run_id
                       AND wr.workflow_run_id = %s
                       AND wr.project_id = %s
                  )
                  AND (
                    %s = 'expired'
                    OR expires_at IS NULL
                    OR expires_at > %s
                  )
                RETURNING approval_request_id
                """,
                (
                   target_state,
                   json.dumps(decision_meta),
                   timestamp,
                   decision.approval_id,
                   self._scope.project_id,
                   decision.workflow_id,
                   self._scope.project_id,
                   target_state,
                   timestamp,
                ),
            )
            row = cur.fetchone()
        if row is None:
            raise RepositoryError(
                f"approval_request not found or not in pending state: "
                f"{decision.approval_id}"
            )
        return decision

    def list_pending_approvals(self, workflow_id: str) -> tuple[ApprovalRequest, ...]:
        timestamp = utc_now()
        with self._cursor() as cur:
            self._expire_pending_approvals(cur, timestamp=timestamp, workflow_id=workflow_id)
            cur.execute(
                """
                SELECT ar.approval_request_id,
                       ar.task_id,
                       ar.approver_policy_ref,
                       ar.approver_policy_metadata,
                       ar.risk_tier,
                       ar.expires_at,
                       ar.created_at,
                       wr.workflow_run_id AS workflow_run_id_text,
                       ws.workflow_step_id AS workflow_step_id_text
                  FROM approval_request ar
                  JOIN workflow_run wr ON wr.id = ar.workflow_run_id
                  LEFT JOIN workflow_step ws ON ws.id = ar.workflow_step_id
                 WHERE wr.workflow_run_id = %s
                   AND ar.state = 'pending'
                   AND (ar.expires_at IS NULL OR ar.expires_at > %s)
                   AND ar.project_id = %s
                   AND wr.project_id = %s
                 ORDER BY ar.created_at, ar.id
                """,
                (workflow_id, timestamp, self._scope.project_id, self._scope.project_id),
            )
            rows = cur.fetchall()
        return tuple(row_to_approval_request(r) for r in rows)

    def has_active_approval(self, workflow_id: str) -> bool:
        """Return True if the workflow has any pending (non-terminal) approval request."""
        timestamp = utc_now()
        with self._cursor() as cur:
            self._expire_pending_approvals(cur, timestamp=timestamp, workflow_id=workflow_id)
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                      FROM approval_request ar
                      JOIN workflow_run wr ON wr.id = ar.workflow_run_id
                     WHERE wr.workflow_run_id = %s
                       AND ar.state = 'pending'
                       AND (ar.expires_at IS NULL OR ar.expires_at > %s)
                       AND ar.project_id = %s
                       AND wr.project_id = %s
                ) AS has_active
                """,
                (workflow_id, timestamp, self._scope.project_id, self._scope.project_id),
            )
            row = cur.fetchone()
        if row is None:
            return False
        val = row["has_active"] if isinstance(row, dict) else row[0]
        return bool(val)

    def pause_step_for_approval(
        self,
        request: ApprovalRequest,
        *,
        lease: Lease,
        trace_context: TraceContext,
        resume_token: str | None = None,
        now: datetime | None = None,
    ) -> ApprovalRequest:
        timestamp = now or utc_now()
        token = resume_token or stable_approval_resume_token(
            workflow_id=request.workflow_id,
            step_id=request.step_id,
            approval_id=request.approval_id,
        )
        approval = self.create_approval_request(
            replace(
                request,
                expires_at=request.expires_at or approval_expires_at(request.risk_tier, now=timestamp),
                context_ref=request.context_ref or f"runtime-ref:{token}",
            )
        )
        if approval.step_id is None:
            raise RepositoryError("approval pause requires a workflow step id")

        paused_step = self.update_step_state(
            approval.step_id,
            StepState.PENDING_APPROVAL,
            trace_context=trace_context.child(),
            refs={
                "approval_request_id": approval.approval_id,
                "approval_resume_token": token,
            },
            lease=lease,
            now=timestamp,
        )

        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE workflow_step
                   SET metadata = metadata || %s::jsonb,
                       updated_at = %s
                 WHERE workflow_step_id = %s
                   AND project_id = %s
                """,
                (
                    json.dumps(
                        {
                            "approval_request_id": approval.approval_id,
                            "approval_resume_token": token,
                            "approval_pause_state": paused_step.state.value,
                            "approval_paused_at": isoformat_utc(timestamp),
                        }
                    ),
                    timestamp,
                    approval.step_id,
                    self._scope.project_id,
                ),
            )

        workflow = self.get_workflow(approval.workflow_id)
        if workflow is not None and workflow.state != WorkflowState.PENDING_APPROVAL:
            self.transition_workflow(
                approval.workflow_id,
                WorkflowState.PENDING_APPROVAL,
                trace_context=trace_context.child(),
                refs={"approval_request_id": approval.approval_id, "approval_resume_token": token},
                now=timestamp,
            )
        self.release_lease(lease.lease_id, owner_id=lease.owner_id)
        return approval

    def resume_approval_decision(
        self,
        decision: ApprovalDecision,
        *,
        trace_context: TraceContext,
        resume_token: str | None = None,
        now: datetime | None = None,
    ) -> bool:
        timestamp = now or utc_now()
        workflow_target = approval_decision_to_workflow_state(decision.decision)
        step_target = approval_decision_to_step_state(decision.decision)
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ar.state,
                       ar.expires_at,
                       ar.workflow_step_id,
                       wr.id AS run_pk,
                       wr.workflow_run_id,
                       wr.state AS workflow_state,
                       ws.workflow_step_id AS step_id_text,
                       ws.state AS step_state,
                       ws.metadata AS step_metadata
                  FROM approval_request ar
                  JOIN workflow_run wr ON wr.id = ar.workflow_run_id
                  LEFT JOIN workflow_step ws ON ws.id = ar.workflow_step_id
                 WHERE ar.approval_request_id = %s
                   AND ar.project_id = %s
                   AND wr.workflow_run_id = %s
                   AND wr.project_id = %s
                """,
                (decision.approval_id, self._scope.project_id, decision.workflow_id, self._scope.project_id),
            )
            row = cur.fetchone()
            if row is None:
                return False
            approval_state = db_to_approval_status(row["state"])
            if approval_state != decision.decision:
                return False
            expires_at = _parse_dt(row["expires_at"]) if row.get("expires_at") else None
            if decision.decision is ApprovalStatus.APPROVED and expires_at is not None and expires_at <= timestamp:
                return False
            step_id = row.get("step_id_text")
            if not step_id or row.get("step_state") != step_state_to_db(StepState.PENDING_APPROVAL):
                return False
            metadata = _parse_meta(row, "step_metadata")
            if metadata.get("approval_resumed_at") is not None:
                return False
            if resume_token is not None and metadata.get("approval_resume_token") != resume_token:
                return False
            expected_token = resume_token or metadata.get("approval_resume_token")
            new_metadata = {
                **metadata,
                "approval_resumed_at": isoformat_utc(timestamp),
                "approval_resume_decision": decision.decision.value,
                "approval_resume_decision_ref": decision.reason_ref,
            }
            if expected_token is not None:
                new_metadata["approval_resume_token"] = expected_token

            cur.execute(
                """
                UPDATE workflow_step
                   SET state = %s,
                       metadata = %s::jsonb,
                       updated_at = %s
                 WHERE workflow_step_id = %s
                   AND project_id = %s
                   AND state = %s
                   AND NOT (metadata ? 'approval_resumed_at')
                 RETURNING id
                """,
                (
                    step_state_to_db(step_target),
                    json.dumps(new_metadata),
                    timestamp,
                    step_id,
                    self._scope.project_id,
                    step_state_to_db(StepState.PENDING_APPROVAL),
                ),
            )
            updated_step = cur.fetchone()
            if updated_step is None:
                return False

            if decision.decision is ApprovalStatus.APPROVED:
                cur.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1
                          FROM budget_reservation br
                         WHERE br.workflow_run_id = %s
                           AND br.status = 'reserved'
                           AND br.production_enabled = false
                    ) AS has_held_reservation
                    """,
                    (int(row["run_pk"]),),
                )
                held_row = cur.fetchone()
                has_held = bool(held_row["has_held_reservation"] if isinstance(held_row, dict) else held_row[0])
                if not has_held:
                    reestimate_event = self._make_event(
                        decision.workflow_id,
                        "budget.reservation.reestimate_required",
                        trace_context.child(),
                        state=WorkflowState.RUNNING,
                        step_id=step_id,
                        refs={
                            "approval_request_id": decision.approval_id,
                            "budget_reservation_state": "held_required",
                            "reestimate_reason": "approval_wait_reservation_released",
                            "audit_ref": f"runtime-ref:audit:budget-reestimate:{decision.approval_id}",
                        },
                        now=timestamp,
                    )
                    self._insert_event(cur, int(row["run_pk"]), reestimate_event)

            current_workflow_state = WorkflowState(row["workflow_state"])
            if current_workflow_state != workflow_target:
                transitioned = Workflow(
                    workflow_id=row["workflow_run_id"],
                    state=current_workflow_state,
                    idempotency_key="",
                    trace_context=trace_context,
                ).transition_to(workflow_target, now=timestamp)
                cur.execute(
                    """
                    UPDATE workflow_run
                       SET state = %s,
                           updated_at = %s,
                           metadata = metadata || %s::jsonb
                     WHERE id = %s
                       AND project_id = %s
                    """,
                    (
                        transitioned.state.value,
                        timestamp,
                        json.dumps(
                            {
                                "approval_resume_decision": decision.decision.value,
                                "approval_request_id": decision.approval_id,
                            }
                        ),
                        int(row["run_pk"]),
                        self._scope.project_id,
                    ),
                )
            event = self._make_event(
                decision.workflow_id,
                f"approval.{decision.decision.value}.resumed",
                trace_context.child(),
                state=workflow_target,
                step_id=step_id,
                refs={"approval_request_id": decision.approval_id},
                now=timestamp,
            )
            self._insert_event(cur, int(row["run_pk"]), event)
        return True

    def expire_due_approvals(self, *, now: datetime | None = None, limit: int = 100) -> int:
        timestamp = now or utc_now()
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ar.approval_request_id,
                       wr.workflow_run_id,
                       ar.risk_tier
                  FROM approval_request ar
                  JOIN workflow_run wr ON wr.id = ar.workflow_run_id
                 WHERE ar.state = 'pending'
                   AND ar.project_id = %s
                   AND wr.project_id = %s
                   AND COALESCE(
                         ar.expires_at,
                         ar.created_at + make_interval(secs => CASE ar.risk_tier
                           WHEN 'low' THEN %s
                           WHEN 'medium' THEN %s
                           WHEN 'high' THEN %s
                           WHEN 'critical' THEN %s
                           ELSE %s
                         END)
                       ) <= %s
                 ORDER BY COALESCE(ar.expires_at, ar.created_at), ar.id
                 LIMIT %s
                """,
                (
                    self._scope.project_id,
                    self._scope.project_id,
                    default_approval_ttl_seconds(ApprovalRiskTier.LOW),
                    default_approval_ttl_seconds(ApprovalRiskTier.MEDIUM),
                    default_approval_ttl_seconds(ApprovalRiskTier.HIGH),
                    default_approval_ttl_seconds(ApprovalRiskTier.CRITICAL),
                    default_approval_ttl_seconds(None),
                    timestamp,
                    limit,
                ),
            )
            due_rows = tuple(cur.fetchall())

        expired = 0
        for row in due_rows:
            decision = ApprovalDecision(
                approval_id=row["approval_request_id"],
                workflow_id=row["workflow_run_id"],
                decision=ApprovalStatus.EXPIRED,
                decided_by_ref="runtime-ref:approval-expiry-worker",
                decided_at=timestamp,
                reason_ref=f"runtime-ref:approval-expired:{row['approval_request_id']}",
            )
            try:
                self.record_approval_decision(decision)
            except RepositoryError:
                continue
            self.resume_approval_decision(decision, trace_context=TraceContext.new(correlation_id=row["workflow_run_id"]), now=timestamp)
            self.reap_orphaned_budget_reservations(
                now=timestamp,
                limit=limit,
                workflow_id=row["workflow_run_id"],
            )
            expired += 1
        return expired

    # ------------------------------------------------------------------
    # ManualReviewRepository
    # ------------------------------------------------------------------

    def create_review_item(self, item: ManualReviewItem) -> ManualReviewItem:
        timestamp = item.created_at
        reason = _manual_review_reason(item.reason_ref)
        with self._cursor() as cur:
            run_pk = self._lookup_run_pk(cur, item.workflow_id)
            step_pk = self._lookup_step_pk(cur, item.step_id) if item.step_id else None
            attempt_pk = self._latest_step_attempt_pk(cur, step_pk=step_pk) if step_pk else None
            self._insert_manual_review_locked(
                cur,
                run_pk=run_pk,
                workflow_id=item.workflow_id,
                step_pk=step_pk,
                step_id=item.step_id,
                attempt_pk=attempt_pk,
                item=item,
                reason=reason,
                trace_context=TraceContext.new(correlation_id=item.workflow_id),
                now=timestamp,
                evidence={"reason": reason},
            )
        return item

    def get_review_item(self, review_id: str) -> ManualReviewItem | None:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT mri.manual_review_item_id, mri.reason, mri.review_state,
                       mri.owner_principal_id, mri.side_effect_refs,
                       mri.created_at, mri.updated_at,
                       wr.workflow_run_id AS workflow_run_id_text,
                       ws.workflow_step_id AS workflow_step_id_text
                  FROM manual_review_item mri
                  JOIN workflow_run wr ON wr.id = mri.workflow_run_id
                  LEFT JOIN workflow_step ws ON ws.id = mri.workflow_step_id
                 WHERE mri.manual_review_item_id = %s
                   AND mri.project_id = %s
                   AND wr.project_id = %s
                """,
                (review_id, self._scope.project_id, self._scope.project_id),
            )
            row = cur.fetchone()
        return None if row is None else row_to_manual_review_item(row)

    def update_review_item(self, item: ManualReviewItem) -> ManualReviewItem:
        timestamp = item.updated_at
        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE manual_review_item
                   SET review_state = %s,
                       updated_at = %s
                 WHERE manual_review_item_id = %s
                   AND project_id = %s
                RETURNING manual_review_item_id
                """,
                (item.status.value, timestamp, item.review_id, self._scope.project_id),
            )
            if cur.fetchone() is None:
                raise RepositoryError(f"unknown manual review item: {item.review_id}")
        return item

    def list_pending_reviews(self, workflow_id: str) -> tuple[ManualReviewItem, ...]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT mri.manual_review_item_id, mri.reason, mri.review_state,
                       mri.owner_principal_id, mri.side_effect_refs,
                       mri.created_at, mri.updated_at,
                       wr.workflow_run_id AS workflow_run_id_text,
                       ws.workflow_step_id AS workflow_step_id_text
                  FROM manual_review_item mri
                  JOIN workflow_run wr ON wr.id = mri.workflow_run_id
                  LEFT JOIN workflow_step ws ON ws.id = mri.workflow_step_id
                 WHERE wr.workflow_run_id = %s
                   AND mri.project_id = %s
                   AND wr.project_id = %s
                   AND mri.review_state = 'open'
                 ORDER BY mri.created_at, mri.id
                """,
                (workflow_id, self._scope.project_id, self._scope.project_id),
            )
            rows = cur.fetchall()
        return tuple(row_to_manual_review_item(row) for row in rows)

    # ------------------------------------------------------------------
    # OutboxRepository
    # ------------------------------------------------------------------

    def append_outbox_event(self, event: WorkflowOutboxEvent) -> WorkflowOutboxEvent:
        """Insert a pending outbox row, respecting the unique idempotency constraint.

        On a duplicate (destination_kind + source_workflow_event_id + idempotency_key
        conflict), fetches and returns the existing row instead of raising.
        """
        from .outbox import assert_outbox_destination_kind

        assert_outbox_destination_kind(event.destination_kind)
        s = self._scope
        with self._cursor() as cur:
            run_pk = self._lookup_run_pk(cur, event.workflow_id)
            event_pk = self._lookup_event_pk(cur, event.source_event_ref)
            payload_artifact_pk = self._lookup_artifact_pk(cur, event.payload_artifact_ref)

            cur.execute(
                """
                INSERT INTO workflow_outbox (
                    outbox_id, workflow_run_id, source_workflow_event_id,
                    destination_kind, delivery_state, attempt_count,
                    next_attempt_at, last_failure_ref, idempotency_key,
                    payload_artifact_id,
                    trace_id, request_id, project_id, policy_version,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, %s,
                    %s, 'pending', 0,
                    NULL, NULL, %s,
                    %s,
                    %s, %s, %s, %s,
                    %s, %s
                )
                ON CONFLICT (destination_kind, source_workflow_event_id, idempotency_key)
                DO NOTHING
                RETURNING outbox_id
                """,
                (
                    event.outbox_id, run_pk, event_pk,
                    event.destination_kind, event.idempotency_key,
                    payload_artifact_pk,
                    uuid4().hex, uuid4().hex[:16], s.project_id, s.policy_version,
                    event.enqueued_at, event.enqueued_at,
                ),
            )
            inserted = cur.fetchone()
            if inserted is not None:
                return event

            # Conflict: return existing mapped event
            cur.execute(
                """
                SELECT wo.outbox_id, wo.destination_kind, wo.delivery_state,
                       wo.attempt_count, wo.next_attempt_at, wo.last_failure_ref,
                       wo.idempotency_key, ta.task_artifact_id AS payload_artifact_ref,
                       wo.created_at, wo.updated_at,
                       wr.workflow_run_id AS workflow_run_id_text,
                       we.workflow_event_id AS source_event_id_text
                  FROM workflow_outbox wo
                  JOIN workflow_run wr ON wr.id = wo.workflow_run_id
                  JOIN workflow_event we ON we.id = wo.source_workflow_event_id
                  LEFT JOIN task_artifact ta ON ta.id = wo.payload_artifact_id
                 WHERE wo.destination_kind = %s
                   AND wo.source_workflow_event_id = %s
                   AND wo.idempotency_key = %s
                   AND wo.workflow_run_id = %s
                   AND wo.project_id = %s
                   AND wr.project_id = %s
                   AND we.project_id = %s
                """,
                (
                   event.destination_kind, event_pk, event.idempotency_key, run_pk,
                   self._scope.project_id, self._scope.project_id, self._scope.project_id,
                ),
            )
            existing = cur.fetchone()
            if existing is None:
                raise RepositoryError(
                    f"outbox idempotency race: cannot fetch existing row for "
                    f"{event.destination_kind}:{event.source_event_ref}:{event.idempotency_key}"
                )
            return row_to_outbox_event(existing)

    def claim_pending_outbox_events(
        self,
        *,
        batch_size: int,
        owner_id: str,
        policy: "LeasePolicy",
        now: datetime | None = None,
    ) -> list[tuple[WorkflowOutboxEvent, "Lease"]]:
        """Claim a batch of pending/failed-due outbox rows for delivery.

        Selects rows FOR UPDATE SKIP LOCKED, marks them ``delivering``,
        increments ``attempt_count``, acquires a ``workflow_lease`` per row
        with ``lease_key = "outbox:{outbox_id}"``, and returns (event, lease)
        pairs.  Rows for which lease acquisition fails are skipped silently.
        """
        timestamp = now or utc_now()
        sql, params = build_claim_outbox_query(batch_size=batch_size, project_id=self._scope.project_id, now=timestamp)

        results: list[tuple[WorkflowOutboxEvent, "Lease"]] = []
        with self._cursor() as cur:
            cur.execute(sql, params)
            claimed_rows = cur.fetchall()

            for row in claimed_rows:
                outbox_id = row["outbox_id"] if isinstance(row, dict) else row[0]
                run_pk_val = row["run_pk"] if isinstance(row, dict) else row[-1]
                run_pk = int(run_pk_val)

                event = row_to_outbox_event(row)
                resource_id = f"outbox:{outbox_id}"
                expires_at = policy.expires_at(timestamp)
                lease_id = uuid4().hex
                token_hash = hashlib.sha256(lease_id.encode()).hexdigest()

                # Expire any stale leases for this resource key first
                cur.execute(
                    """
                    UPDATE workflow_lease
                       SET status = 'expired', updated_at = %s
                     WHERE lease_key = %s
                       AND project_id = %s
                       AND status = 'active'
                       AND expires_at <= %s
                    """,
                    (timestamp, resource_id, self._scope.project_id, timestamp),
                )

                cur.execute(
                    """
                    INSERT INTO workflow_lease (
                        workflow_lease_id, workflow_run_id, workflow_step_id,
                        project_id, lease_key, lease_owner, lease_token_hash,
                        fencing_token, status,
                        trace_id, request_id,
                        expires_at, acquired_at, heartbeat_at,
                        metadata, created_at, updated_at
                    )
                    SELECT %s, %s, NULL,
                           %s, %s, %s, %s,
                           COALESCE(MAX(fencing_token), 0) + 1,
                           'active',
                           %s, %s,
                           %s, %s, %s,
                           '{}', %s, %s
                      FROM workflow_lease
                     WHERE lease_key = %s
                       AND project_id = %s
                    ON CONFLICT DO NOTHING
                    RETURNING workflow_lease_id, lease_key, lease_owner,
                              fencing_token, acquired_at, heartbeat_at, expires_at
                    """,
                    (
                        lease_id, run_pk,
                        self._scope.project_id, resource_id, owner_id, token_hash,
                        uuid4().hex, uuid4().hex[:16],
                        expires_at, timestamp, timestamp,
                        timestamp, timestamp,
                        resource_id, self._scope.project_id,
                    ),
                )
                lease_row = cur.fetchone()
                if lease_row is None:
                    cur.execute(
                        """
                        UPDATE workflow_outbox
                           SET delivery_state = 'failed',
                               next_attempt_at = %s,
                               updated_at = %s
                         WHERE outbox_id = %s
                           AND project_id = %s
                           AND delivery_state = 'delivering'
                        """,
                        (timestamp, timestamp, outbox_id, self._scope.project_id),
                    )
                    continue  # another owner holds the lease; skip
                results.append((event, row_to_lease(lease_row)))

        return results

    def ack_outbox_event(self, outbox_id: str, *, lease: Lease) -> bool:
        """Mark an outbox event delivered if it is in the ``delivering`` state and
        the caller owns the active lease (fencing guard).

        Returns ``True`` if the row was updated; ``False`` if the row was not
        in ``delivering`` state or the lease check failed.
        """
        expected_resource_id = f"outbox:{outbox_id}"
        if lease.resource_id != expected_resource_id:
            return False
        timestamp = utc_now()
        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE workflow_outbox
                   SET delivery_state = 'delivered',
                       updated_at     = %s
                 WHERE outbox_id = %s
                   AND project_id = %s
                   AND delivery_state = 'delivering'
                   AND EXISTS (
                       SELECT 1 FROM workflow_lease wl
                        WHERE wl.workflow_lease_id = %s
                          AND wl.lease_key  = ('outbox:' || workflow_outbox.outbox_id)
                          AND wl.lease_key  = %s
                          AND wl.project_id = %s
                          AND wl.lease_owner = %s
                          AND wl.fencing_token = %s
                          AND wl.status = 'active'
                          AND wl.expires_at > %s
                   )
                RETURNING outbox_id
                """,
                (
                    timestamp, outbox_id, self._scope.project_id,
                    lease.lease_id, expected_resource_id, self._scope.project_id,
                    lease.owner_id, lease.fencing_token, timestamp,
                ),
            )
            updated = cur.fetchone()
            if updated is None:
                return False

            cur.execute(
                """
                UPDATE workflow_lease
                   SET status      = 'released',
                       released_at = %s,
                       updated_at  = %s
                 WHERE workflow_lease_id = %s
                   AND lease_key   = %s
                   AND lease_owner = %s
                   AND project_id   = %s
                   AND status      = 'active'
                """,
                (timestamp, timestamp, lease.lease_id, expected_resource_id, lease.owner_id, self._scope.project_id),
            )
        return True

    def outbox_backlog_summary(self, *, now: datetime | None = None) -> dict[str, object]:
        timestamp = now or utc_now()
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT destination_kind,
                       delivery_state,
                       COUNT(*) AS count,
                       SUM(
                         CASE
                           WHEN delivery_state IN ('pending', 'failed')
                            AND (next_attempt_at IS NULL OR next_attempt_at <= %s)
                           THEN 1 ELSE 0
                         END
                       ) AS due_count,
                       MIN(created_at) AS oldest_enqueued_at
                  FROM workflow_outbox
                 WHERE project_id = %s
                   AND delivery_state <> 'delivered'
                 GROUP BY destination_kind, delivery_state
                """,
                (timestamp, self._scope.project_id),
            )
            rows = cur.fetchall()

        by_state: dict[str, int] = {}
        by_destination: dict[str, int] = {}
        due = 0
        total = 0
        oldest: datetime | None = None
        for row in rows:
            destination = str(row["destination_kind"] if isinstance(row, dict) else row[0])
            state = str(row["delivery_state"] if isinstance(row, dict) else row[1])
            count = int(row["count"] if isinstance(row, dict) else row[2])
            due_count = int((row["due_count"] if isinstance(row, dict) else row[3]) or 0)
            oldest_value = row["oldest_enqueued_at"] if isinstance(row, dict) else row[4]
            by_state[state] = by_state.get(state, 0) + count
            by_destination[destination] = by_destination.get(destination, 0) + count
            due += due_count
            total += count
            parsed_oldest = _parse_dt(oldest_value) if oldest_value else None
            if parsed_oldest is not None and (oldest is None or parsed_oldest < oldest):
                oldest = parsed_oldest

        return {
            "total": total,
            "due": due,
            "by_state": by_state,
            "by_destination": by_destination,
            "oldest_enqueued_at": isoformat_utc(oldest) if oldest else None,
        }

    def nack_outbox_event(self, outbox_id: str, *, lease: Lease) -> bool:
        """Mark an outbox event failed, schedule its next retry, and release the lease.

        The next attempt time is computed from the current ``attempt_count``
        using :data:`~outbox.DEFAULT_OUTBOX_RETRY_POLICY` (exponential backoff).
        Raw failure messages are never stored; callers should set
        ``last_failure_ref`` on the dataclass if needed.

        Returns ``True`` if the row was updated; ``False`` otherwise.
        """
        from .outbox import DEFAULT_OUTBOX_RETRY_POLICY, outbox_next_attempt_at

        expected_resource_id = f"outbox:{outbox_id}"
        if lease.resource_id != expected_resource_id:
            return False
        timestamp = utc_now()
        with self._cursor() as cur:
            # Read current attempt_count to compute the next backoff delay.
            cur.execute(
                "SELECT attempt_count FROM workflow_outbox "
                "WHERE outbox_id = %s AND project_id = %s AND delivery_state = 'delivering'",
                (outbox_id, self._scope.project_id),
            )
            count_row = cur.fetchone()
            if count_row is None:
                return False  # not in delivering state

            attempt = int(
                count_row["attempt_count"]
                if isinstance(count_row, dict)
                else count_row[0]
            )
            exhausted = attempt >= DEFAULT_OUTBOX_RETRY_POLICY.max_attempts
            next_at = None if exhausted else outbox_next_attempt_at(attempt, DEFAULT_OUTBOX_RETRY_POLICY, now=timestamp)
            next_state = "dead_lettered" if exhausted else "failed"

            cur.execute(
                """
                UPDATE workflow_outbox
                   SET delivery_state  = %s,
                       next_attempt_at = %s,
                       updated_at      = %s
                 WHERE outbox_id = %s
                   AND project_id = %s
                   AND delivery_state = 'delivering'
                   AND EXISTS (
                       SELECT 1 FROM workflow_lease wl
                        WHERE wl.workflow_lease_id = %s
                          AND wl.lease_key  = ('outbox:' || workflow_outbox.outbox_id)
                          AND wl.lease_key  = %s
                          AND wl.project_id = %s
                          AND wl.lease_owner = %s
                          AND wl.fencing_token = %s
                          AND wl.status = 'active'
                          AND wl.expires_at > %s
                   )
                RETURNING outbox_id
                """,
                (
                    next_state, next_at, timestamp, outbox_id, self._scope.project_id,
                    lease.lease_id, expected_resource_id, self._scope.project_id,
                    lease.owner_id, lease.fencing_token, timestamp,
                ),
            )
            updated = cur.fetchone()
            if updated is None:
                return False

            cur.execute(
                """
                UPDATE workflow_lease
                   SET status      = 'released',
                       released_at = %s,
                       updated_at  = %s
                 WHERE workflow_lease_id = %s
                   AND lease_key   = %s
                   AND lease_owner = %s
                   AND project_id   = %s
                   AND status      = 'active'
                """,
                (timestamp, timestamp, lease.lease_id, expected_resource_id, lease.owner_id, self._scope.project_id),
            )
        return True

    # ------------------------------------------------------------------
    # ArtifactLifecycleRepository
    # ------------------------------------------------------------------

    def append_artifact_lifecycle_event(
        self, event: ArtifactLifecycleEvent
    ) -> ArtifactLifecycleEvent:
        """Insert an artifact_lifecycle_event row.

        Before inserting, enforces runtime guards:
        - Legal hold deletion guard: raises if deletion is attempted while hold is active.
        - Signed access eligibility guard: raises if signed access grant is unsafe.

        Uses ``task_artifact_id`` FK looked up by ``event.artifact_ref`` text ID.
        Never stores raw content bodies or signed URLs.
        """
        from .artifact_lifecycle import guard_legal_hold_deletion, guard_signed_access

        guard_legal_hold_deletion(event.stage, legal_hold=event.legal_hold)
        guard_signed_access(
            event.stage,
            signed_access_eligibility=event.signed_access_eligibility,
            requires_approval=True,  # always enforce approval requirement
        )

        s = self._scope
        with self._cursor() as cur:
            # Look up the numeric task_artifact PK
            artifact_pk = self._lookup_artifact_pk(cur, event.artifact_ref)
            if artifact_pk is None:
                raise RepositoryError(
                    f"unknown task artifact for lifecycle event: {event.artifact_ref}"
                )
            cur.execute(
                "SELECT id FROM task_artifact WHERE id = %s AND project_id = %s FOR UPDATE",
                (artifact_pk, self._scope.project_id),
            )

            cur.execute(
                """
                SELECT action, state, legal_hold_ref, redaction_ref
                  FROM artifact_lifecycle_event
                 WHERE task_artifact_id = %s
                   AND project_id = %s
                 ORDER BY created_at, id
                """,
                (artifact_pk, self._scope.project_id),
            )
            lifecycle_rows = cur.fetchall()
            persisted_legal_hold = False
            terminal_action: str | None = None
            terminal_state: str | None = None
            for lifecycle_row in lifecycle_rows:
                action = lifecycle_row["action"] if isinstance(lifecycle_row, dict) else lifecycle_row[0]
                state = lifecycle_row["state"] if isinstance(lifecycle_row, dict) else lifecycle_row[1]
                legal_hold_ref = lifecycle_row["legal_hold_ref"] if isinstance(lifecycle_row, dict) else lifecycle_row[2]
                if action == "legal_hold_released":
                    persisted_legal_hold = False
                elif action == "legal_hold_applied" or legal_hold_ref is not None:
                    persisted_legal_hold = True
                if action in {"deleted", "redacted"} or state in {"deleted", "redacted"}:
                    terminal_action = action
                    terminal_state = state
            if terminal_action is not None or terminal_state is not None:
                raise RepositoryError(
                    f"artifact lifecycle is terminal ({terminal_action or terminal_state}); cannot append {event.stage.value}"
                )

            hash_algorithm = "sha256" if event.checksum_sha256 else None
            legal_hold_ref = (
                event.policy_ref or f"runtime-ref:legal-hold:{event.lifecycle_id}"
                if event.legal_hold
                else None
            )
            redaction_ref = (
                event.policy_ref or f"runtime-ref:redaction:{event.lifecycle_id}"
                if event.redacted or event.stage == ArtifactLifecycleStage.REDACTED
                else None
            )
            deletion_ref = (
                event.policy_ref or f"runtime-ref:deletion:{event.lifecycle_id}"
                if event.stage in {ArtifactLifecycleStage.DELETION_SCHEDULED, ArtifactLifecycleStage.DELETED}
                else None
            )

            guard_legal_hold_deletion(event.stage, legal_hold=event.legal_hold or persisted_legal_hold)

            cur.execute(
                """
                INSERT INTO artifact_lifecycle_event (
                    artifact_lifecycle_event_id, task_artifact_id,
                    action, state,
                    storage_ref, content_hash, hash_algorithm,
                    retention_policy_ref, legal_hold_ref, redaction_ref, deletion_ref,
                    signed_access_eligible, signed_access_requires_approval,
                    signed_access_max_duration_seconds,
                    expires_at,
                    audit_event_id, idempotency_key,
                    trace_id, request_id,
                    project_id, production_enabled,
                    created_at
                ) VALUES (
                    %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s,
                    NULL,
                    %s,
                    %s, %s,
                    %s, %s,
                    %s, false,
                    %s
                )
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING artifact_lifecycle_event_id
                """,
                (
                    event.lifecycle_id, artifact_pk,
                    event.stage.value, artifact_lifecycle_state_to_db(event.stage, event.artifact_state),
                    event.storage_ref, event.checksum_sha256, hash_algorithm,
                    event.retention_policy, legal_hold_ref, redaction_ref, deletion_ref,
                    event.signed_access_eligibility, True,  # requires_approval always true
                    event.deletion_scheduled_at,
                    None,
                    event.idempotency,
                    event.workflow_id, uuid4().hex[:16],
                    s.project_id,
                    event.occurred_at,
                ),
            )
            row = cur.fetchone()
            if row is None:
                existing_events = self.list_artifact_lifecycle_events(event.artifact_ref)
                for existing_event in existing_events:
                    if existing_event.idempotency == event.idempotency:
                        return existing_event
                raise RepositoryError(f"artifact_lifecycle_event idempotency conflict for {event.lifecycle_id}")

        return event

    def list_artifact_lifecycle_events(
        self, artifact_ref: str
    ) -> tuple[ArtifactLifecycleEvent, ...]:
        """Return all lifecycle events for *artifact_ref*, ordered by ``created_at``.

        Rows are mapped without raw content bodies or signed URLs.
        """
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT ale.artifact_lifecycle_event_id,
                       ta.task_artifact_id          AS task_artifact_id_text,
                       ale.action,
                       ale.state,
                       ale.storage_ref,
                       ale.content_hash,
                       ale.retention_policy_ref,
                       ale.signed_access_eligible,
                       ale.signed_access_requires_approval,
                       ale.legal_hold_ref,
                       ale.redaction_ref,
                       ale.expires_at,
                       ale.audit_event_id,
                       ale.idempotency_key,
                       ale.trace_id,
                       ale.created_at
                  FROM artifact_lifecycle_event ale
                  JOIN task_artifact ta ON ta.id = ale.task_artifact_id
                 WHERE ta.task_artifact_id = %s
                 ORDER BY ale.created_at, ale.artifact_lifecycle_event_id
                """,
                (artifact_ref,),
            )
            rows = cur.fetchall()
        return tuple(row_to_artifact_lifecycle_event(r) for r in rows)
