"""Pure cancellation-runtime helpers for DevGateway agent runtime.

This module contains only metadata-aware, side-effect-free logic for
evaluating cancellation decisions.  It never inspects raw prompts, context
bodies, or artifact contents — only step state and caller-supplied flags.
"""
from __future__ import annotations

from .contracts import (
    CancellationAction,
    CancellationPropagationState,
    StepState,
)


# ---------------------------------------------------------------------------
# Propagation-state classification sets
# ---------------------------------------------------------------------------

#: Propagation states that mean cancellation has concluded (no further steps
#: should be skipped/cancelled on its behalf).
CANCELLATION_TERMINAL_PROPAGATION_STATES: frozenset[CancellationPropagationState] = frozenset(
    {
        CancellationPropagationState.COMPLETED,
        CancellationPropagationState.PARTIALLY_COMPLETED,
        CancellationPropagationState.PARTIALLY_COMPLETED_MANUAL_REVIEW,
    }
)

#: Propagation states that mean a cancellation is still in-flight (dispatcher
#: must not start new work for this workflow).
CANCELLATION_ACTIVE_PROPAGATION_STATES: frozenset[CancellationPropagationState] = frozenset(
    CancellationPropagationState
) - CANCELLATION_TERMINAL_PROPAGATION_STATES


# ---------------------------------------------------------------------------
# Pure action decision
# ---------------------------------------------------------------------------


def decide_cancellation_action(
    step_state: StepState,
    *,
    safe_interruptible: bool = False,
) -> CancellationAction:
    """Decide how to handle a single step under an active cancellation.

    Rules (metadata-only; does not inspect step content):

    * ``PENDING`` or ``CLAIMED`` steps have not yet produced side-effects and
      are safe to skip → :attr:`~CancellationAction.SKIP`.
    * ``RUNNING`` steps *may* have started producing side-effects:
      - If the caller asserts the step is ``safe_interruptible`` (e.g. a pure
        read or idempotent gate) → :attr:`~CancellationAction.CANCEL`.
      - Otherwise → :attr:`~CancellationAction.MANUAL_REVIEW` so a human can
        verify ambiguous side-effects before proceeding.
    * Steps in any terminal state (COMPLETED, FAILED, SKIPPED, CANCELLED,
      MANUAL_REVIEW, PENDING_APPROVAL) have already settled; nothing to do →
      :attr:`~CancellationAction.NO_ACTION`.

    Args:
        step_state: The current :class:`~contracts.StepState` of the step.
        safe_interruptible: Caller-asserted flag; ``True`` only when the step
            is known to be fully idempotent and has no external side-effects.

    Returns:
        The appropriate :class:`~contracts.CancellationAction`.
    """
    if step_state in (StepState.PENDING, StepState.CLAIMED):
        return CancellationAction.SKIP
    if step_state == StepState.RUNNING:
        return CancellationAction.CANCEL if safe_interruptible else CancellationAction.MANUAL_REVIEW
    return CancellationAction.NO_ACTION


def is_cancellation_active(propagation_state: CancellationPropagationState) -> bool:
    """Return ``True`` if this propagation state means cancellation is still in-flight."""
    return propagation_state in CANCELLATION_ACTIVE_PROPAGATION_STATES
