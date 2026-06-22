"""Pure approval-lifecycle helpers for DevGateway agent runtime.

Metadata-only, side-effect-free. Never inspects raw prompts, context
bodies, artifact contents, or model outputs — only state enums and
caller-supplied flags.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta

from .contracts import (
    ApprovalRiskTier,
    ApprovalStatus,
    StepKind,
    StepState,
    WorkflowState,
    utc_now,
)


# ---------------------------------------------------------------------------
# Approval state classification sets
# ---------------------------------------------------------------------------

#: Terminal approval states; the decision will not change once reached.
APPROVAL_TERMINAL_STATES: frozenset[ApprovalStatus] = frozenset(
    {
        ApprovalStatus.APPROVED,
        ApprovalStatus.DENIED,
        ApprovalStatus.EXPIRED,
        ApprovalStatus.CANCELLED,
        ApprovalStatus.SUPERSEDED,
    }
)

#: Active (non-terminal) approval states; the request is still awaiting a decision.
APPROVAL_ACTIVE_STATES: frozenset[ApprovalStatus] = (
    frozenset(ApprovalStatus) - APPROVAL_TERMINAL_STATES
)

DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER: dict[ApprovalRiskTier | str, int] = {
    ApprovalRiskTier.LOW: 72 * 60 * 60,
    ApprovalRiskTier.MEDIUM: 24 * 60 * 60,
    ApprovalRiskTier.HIGH: 4 * 60 * 60,
    ApprovalRiskTier.CRITICAL: 4 * 60 * 60,
    "internal-default": 24 * 60 * 60,
}


def is_approval_terminal(state: ApprovalStatus) -> bool:
    """Return ``True`` if *state* is a terminal approval state (decision is final)."""
    return state in APPROVAL_TERMINAL_STATES


def is_approval_active(state: ApprovalStatus) -> bool:
    """Return ``True`` if *state* is an active (non-terminal) approval state."""
    return state in APPROVAL_ACTIVE_STATES


def default_approval_ttl_seconds(risk_tier: ApprovalRiskTier | str | None) -> int:
    """Return the default approval TTL seconds for a risk tier."""
    if isinstance(risk_tier, str):
        try:
            risk_tier = ApprovalRiskTier(risk_tier)
        except ValueError:
            return DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER["internal-default"]
    if risk_tier is None:
        return DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER["internal-default"]
    return DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER[risk_tier]


def approval_expires_at(risk_tier: ApprovalRiskTier | str | None, *, now: datetime | None = None) -> datetime:
    """Return the fail-closed expiry timestamp for a newly-created approval."""
    timestamp = now or utc_now()
    return timestamp + timedelta(seconds=default_approval_ttl_seconds(risk_tier))


def stable_approval_resume_token(*, workflow_id: str, step_id: str | None, approval_id: str) -> str:
    """Create an opaque, deterministic token tying one approval to one paused step."""
    material = json.dumps(
        {"workflow_id": workflow_id, "step_id": step_id, "approval_id": approval_id},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return "approval_resume_" + hashlib.sha256(material).hexdigest()[:32]


# ---------------------------------------------------------------------------
# Approval decision → workflow state mapping
# ---------------------------------------------------------------------------

_APPROVAL_DECISION_TO_WORKFLOW_STATE: dict[ApprovalStatus, WorkflowState] = {
    # Approved → workflow resumes from PENDING_APPROVAL
    ApprovalStatus.APPROVED: WorkflowState.RUNNING,
    # Denied by reviewer → workflow cancelled (not a failure, an explicit reject)
    ApprovalStatus.DENIED: WorkflowState.CANCELLED,
    # Cancelled by requester or system → workflow cancelled
    ApprovalStatus.CANCELLED: WorkflowState.CANCELLED,
    # Deadline elapsed without decision → workflow timed out (failed)
    ApprovalStatus.EXPIRED: WorkflowState.FAILED,
    # Superseded by a newer approval request → treat as failure / timed-out
    ApprovalStatus.SUPERSEDED: WorkflowState.FAILED,
}


def approval_decision_to_workflow_state(decision: ApprovalStatus) -> WorkflowState:
    """Map a terminal approval decision to the corresponding workflow state.

    Mapping:

    * ``APPROVED``   → :attr:`~contracts.WorkflowState.RUNNING` (resume)
    * ``DENIED``     → :attr:`~contracts.WorkflowState.CANCELLED` (rejected)
    * ``CANCELLED``  → :attr:`~contracts.WorkflowState.CANCELLED` (withdrawn)
    * ``EXPIRED``    → :attr:`~contracts.WorkflowState.FAILED` (timed-out)
    * ``SUPERSEDED`` → :attr:`~contracts.WorkflowState.FAILED` (invalidated)

    Raises :class:`ValueError` when *decision* is not a terminal approval state.
    """
    result = _APPROVAL_DECISION_TO_WORKFLOW_STATE.get(decision)
    if result is None:
        raise ValueError(
            f"approval_decision_to_workflow_state requires a terminal approval state; "
            f"got {decision!r} which is active/non-terminal."
        )
    return result


def approval_decision_to_step_state(decision: ApprovalStatus) -> StepState:
    """Map a terminal approval decision to the paused step's deterministic state."""
    if decision is ApprovalStatus.APPROVED:
        return StepState.PENDING
    if decision in (ApprovalStatus.DENIED, ApprovalStatus.CANCELLED):
        return StepState.CANCELLED
    if decision in (ApprovalStatus.EXPIRED, ApprovalStatus.SUPERSEDED):
        return StepState.FAILED
    raise ValueError(
        f"approval_decision_to_step_state requires a terminal approval state; got {decision!r}."
    )


# ---------------------------------------------------------------------------
# Pause-for-approval gate decision
# ---------------------------------------------------------------------------


def should_pause_for_approval(
    step_kind: StepKind,
    risk_tier: ApprovalRiskTier,
    *,
    policy_required: bool,
) -> bool:
    """Return ``True`` when a step must pause for an approval gate before proceeding.

    Decision is made solely on step metadata — kind, risk classification, and
    policy configuration.  No prompt content, context bodies, or model output
    is inspected here.

    Rules (evaluated in priority order):

    1. ``APPROVAL_GATE`` step kind **always** pauses regardless of tier or policy.
    2. ``policy_required=True`` pauses regardless of tier.
    3. ``HIGH`` or ``CRITICAL`` risk tier pauses.
    4. ``LOW`` or ``MEDIUM`` without ``policy_required`` → no pause.

    Args:
        step_kind: The :class:`~contracts.StepKind` of the step about to execute.
        risk_tier: The :class:`~contracts.ApprovalRiskTier` declared for the step.
        policy_required: Caller-supplied flag set to ``True`` when the governing
            policy explicitly mandates human approval for this step/request.

    Returns:
        ``True`` if the step should transition to
        :attr:`~contracts.StepState.PENDING_APPROVAL`, ``False`` otherwise.
    """
    if step_kind is StepKind.APPROVAL_GATE:
        return True
    if policy_required:
        return True
    return risk_tier in (ApprovalRiskTier.HIGH, ApprovalRiskTier.CRITICAL)
