"""
Pure retry classification, backoff calculation, and decision utilities.

All functions are deterministic unless a *jitter_fn* is explicitly injected.
No live DB, provider, or framework imports are used at module-import time.
"""
from __future__ import annotations

import math
from typing import Callable

from .contracts import FailureClass, RetryBackoffType, RetryDecision, RetryPolicy


# ---------------------------------------------------------------------------
# Exception → FailureClass classification
# ---------------------------------------------------------------------------

# Ordered from most-specific to most-general so that MRO resolution via
# isinstance() is correct.  TimeoutError is intentionally excluded here:
# a timeout is retry-safe only when the caller can prove the external request
# was not accepted.  Without that proof, it is ambiguous and must go to manual
# review rather than risk duplicate side effects.
# IMPORTANT: only the exception *type* is examined – message / payload
# values are never read, preventing accidental leakage of sensitive data.
_EXCEPTION_FAILURE_CLASS_MAP: tuple[tuple[type[BaseException], FailureClass], ...] = (
    (ConnectionError, FailureClass.TOOL_ADAPTER_TRANSIENT),
    (OSError, FailureClass.TOOL_ADAPTER_TRANSIENT),
)

# Failure classes that must never be auto-retried; they always route to
# manual review because their side-effect status is unknown or unsafe.
NON_RETRYABLE_FAILURE_CLASSES: frozenset[FailureClass] = frozenset(
    {
        FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT,
        FailureClass.WORKER_CRASH_ACTIVE_LEASE,
    }
)


def classify_exception(
    exc: BaseException,
    *,
    before_external_acceptance: bool = False,
) -> FailureClass:
    """Classify *exc* into a :class:`~contracts.FailureClass` without inspecting raw payloads.

    Only the exception type (MRO) and caller-supplied acceptance context are
    examined.  Unknown exception types, and ambiguous timeouts that may have
    occurred after external request acceptance, default to
    :attr:`~contracts.FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT` so that
    unfamiliar errors always route to manual review rather than being silently
    retried.
    """
    if isinstance(exc, TimeoutError):
        return (
            FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT
            if before_external_acceptance
            else FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT
        )
    for exc_type, failure_class in _EXCEPTION_FAILURE_CLASS_MAP:
        if isinstance(exc, exc_type):
            return failure_class
    return FailureClass.NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT


# ---------------------------------------------------------------------------
# Backoff calculation
# ---------------------------------------------------------------------------


def calculate_backoff(
    policy: RetryPolicy,
    attempt: int,
    *,
    jitter_fn: Callable[[float], float] | None = None,
) -> float:
    """Return the retry delay in seconds for a failed *attempt*.

    Args:
        policy:    The :class:`~contracts.RetryPolicy` describing the nested
                   backoff policy and delay limits.
        attempt:   1-based failed attempt index (1 = first attempt, 2 = second).
        jitter_fn: Optional callable ``(raw_delay: float) -> float`` that
                   applies jitter.  Must be deterministic in tests (e.g.
                   ``lambda d: d * 1.5``).  When *None* no jitter is applied,
                   giving reproducible results regardless of ``policy.jitter``.
                   For production use, pass ``random.uniform`` or equivalent.

    Returns:
        Delay in seconds, clamped to ``[0, policy.backoff_policy.max_delay_seconds]``.
    """
    backoff = policy.backoff_policy
    base = backoff.initial_delay_seconds
    n = max(attempt, 1)

    if backoff.backoff_type == RetryBackoffType.FIXED:
        delay = base
    elif backoff.backoff_type == RetryBackoffType.LINEAR:
        delay = base * n
    elif backoff.backoff_type in (
        RetryBackoffType.EXPONENTIAL,
        RetryBackoffType.EXPONENTIAL_WITH_JITTER,
    ):
        delay = base * math.pow(backoff.multiplier, n - 1)
    else:
        delay = base

    if jitter_fn is not None:
        delay = jitter_fn(delay)

    return min(max(delay, 0.0), backoff.max_delay_seconds)


# ---------------------------------------------------------------------------
# Retry decision
# ---------------------------------------------------------------------------


def make_retry_decision(
    workflow_id: str,
    step_id: str,
    attempt: int,
    failure_class: FailureClass,
    policy: RetryPolicy,
    *,
    jitter_fn: Callable[[float], float] | None = None,
    reason_ref: str | None = None,
) -> RetryDecision:
    """Produce a :class:`~contracts.RetryDecision` after a step failure.

    A step is eligible for retry when **all** conditions hold:

    - *failure_class* has a retryable entry in ``policy.failure_class_policies``
    - *failure_class* is **not** in :data:`NON_RETRYABLE_FAILURE_CLASSES`
    - *attempt* ``< policy.max_attempts`` (more attempts remain)

    If any condition fails the decision is *ineligible* (``eligible=False``,
    ``delay_seconds=0``) and the caller should route the step to manual review
    or mark it as permanently failed.

    Args:
        workflow_id:   Workflow that owns the failed step.
        step_id:       ID of the failed step.
        attempt:       1-based failed attempt index (mirrors
                       :attr:`~contracts.WorkflowStep.attempt`).
        failure_class: Why the step failed.
        policy:        The retry policy governing eligibility and backoff.
        jitter_fn:     Optional deterministic jitter function; forwarded to
                       :func:`calculate_backoff`.
        reason_ref:    Opaque ref describing the failure reason (stored but
                       never inspected by this module).
    """
    class_policy = next(
        (item for item in policy.failure_class_policies if item.failure_class == failure_class),
        None,
    )
    is_eligible_class = (
        class_policy is not None
        and class_policy.retryable
        and failure_class not in NON_RETRYABLE_FAILURE_CLASSES
    )
    has_attempts_remaining = attempt < policy.max_attempts
    eligible = is_eligible_class and has_attempts_remaining

    delay = calculate_backoff(policy, attempt, jitter_fn=jitter_fn) if eligible else 0.0

    return RetryDecision(
        workflow_id=workflow_id,
        step_id=step_id,
        attempt=attempt,
        failure_class=failure_class,
        eligible=eligible,
        delay_seconds=delay,
        reason_ref=reason_ref,
    )
