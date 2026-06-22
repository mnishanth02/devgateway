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
from dataclasses import dataclass
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
    OutboxEventStatus,
    WorkflowTransitionError,
    isoformat_utc,
    utc_now,
)
from .idempotency import IdempotencyRecord, IdempotencyScope, IdempotencyStatus
from .leases import Lease, LeasePolicy, StepClaim
from .memory import RepositoryError


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
}


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
    if event_type.startswith("workflow."):
        return "workflow_state_changed"
    if event_type.startswith("step."):
        return "step_state_changed"
    return event_type


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
    ) -> None:
        """INSERT a single workflow_event row, allocating the next sequence number."""
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

        return row_to_step(updated_row)

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
            # The number of expired leases is the rowcount of the first CTE
            # (psycopg rowcount reports the outer UPDATE); use a follow-up count.
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
            return row_to_idempotency(existing_row), False

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
