"""Pure approval-lifecycle helpers for DevGateway agent runtime.

Metadata-only, side-effect-free. Never inspects raw prompts, context
bodies, artifact contents, or model outputs — only state enums and
caller-supplied flags.
"""
from __future__ import annotations

from .contracts import (
    ApprovalRiskTier,
    ApprovalStatus,
    StepKind,
    WorkflowState,
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


def is_approval_terminal(state: ApprovalStatus) -> bool:
    """Return ``True`` if *state* is a terminal approval state (decision is final)."""
    return state in APPROVAL_TERMINAL_STATES


def is_approval_active(state: ApprovalStatus) -> bool:
    """Return ``True`` if *state* is an active (non-terminal) approval state."""
    return state in APPROVAL_ACTIVE_STATES


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
