"""
Pure outbox-lifecycle helpers for the DevGateway agent runtime.

No live DB, provider, or framework imports are used at module-import time.
Metadata-only, side-effect-free. Never inspects raw payload content.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from typing import Callable

from .contracts import OutboxEventStatus, RetryBackoffType, RetryPolicy, utc_now
from .retry import calculate_backoff


# ---------------------------------------------------------------------------
# Delivery state sets
# ---------------------------------------------------------------------------

#: Terminal delivery states; once reached the outbox row will not be retried.
OUTBOX_TERMINAL_STATES: frozenset[OutboxEventStatus] = frozenset(
    {
        OutboxEventStatus.DELIVERED,
        OutboxEventStatus.DEAD_LETTERED,
    }
)

#: Active (non-terminal) delivery states; further attempts are possible.
OUTBOX_ACTIVE_STATES: frozenset[OutboxEventStatus] = (
    frozenset(OutboxEventStatus) - OUTBOX_TERMINAL_STATES
)

OUTBOX_DESTINATION_KINDS: frozenset[str] = frozenset(
    {
        "trace",
        "audit",
        "notification",
        "eval_evidence",
        "portal_update",
        "webhook_ref",
    }
)

# Default retry policy applied when nacking an outbox event without an explicit policy.
# Exponential backoff: 5 s base, doubles each attempt, capped at 300 s, max 10 attempts.
DEFAULT_OUTBOX_RETRY_POLICY: RetryPolicy = RetryPolicy(
    max_attempts=10,
    backoff_type=RetryBackoffType.EXPONENTIAL,
    base_delay_seconds=5.0,
    max_delay_seconds=300.0,
)


def is_outbox_terminal(state: OutboxEventStatus) -> bool:
    """Return ``True`` if *state* is a terminal delivery state (no further attempts)."""
    return state in OUTBOX_TERMINAL_STATES


def is_outbox_active(state: OutboxEventStatus) -> bool:
    """Return ``True`` if *state* is an active (non-terminal) delivery state."""
    return state in OUTBOX_ACTIVE_STATES


# ---------------------------------------------------------------------------
# Backoff / next-attempt helper
# ---------------------------------------------------------------------------


def outbox_next_attempt_at(
    attempt_count: int,
    policy: RetryPolicy | None = None,
    *,
    now: datetime | None = None,
    jitter_fn: Callable[[float], float] | None = None,
) -> datetime:
    """Return the datetime at which the next delivery attempt should be made.

    Args:
        attempt_count: The 1-based attempt index that just failed (forwarded
                       to :func:`~retry.calculate_backoff`).
        policy:        The :class:`~contracts.RetryPolicy` governing backoff;
                       defaults to :data:`DEFAULT_OUTBOX_RETRY_POLICY`.
        now:           Reference time; defaults to :func:`~contracts.utc_now`.
        jitter_fn:     Optional deterministic jitter function forwarded to
                       :func:`~retry.calculate_backoff`.
    """
    timestamp = now or utc_now()
    effective = policy if policy is not None else DEFAULT_OUTBOX_RETRY_POLICY
    delay = calculate_backoff(effective, attempt_count, jitter_fn=jitter_fn)
    return timestamp + timedelta(seconds=delay)


# ---------------------------------------------------------------------------
# Idempotency key helper
# ---------------------------------------------------------------------------


def outbox_idempotency_key(destination_kind: str, source_event_ref: str) -> str:
    """Derive a stable idempotency key from *destination_kind* and *source_event_ref*.

    Uses only opaque refs — never raw payload values — so the key is safe to
    store in audit logs and DB columns without leaking sensitive data.

    Returns a hex-encoded SHA-256 digest prefixed with ``"outbox:"`` to make
    the purpose obvious in logs and debug output.
    """
    raw = f"{destination_kind}|{source_event_ref}".encode()
    digest = hashlib.sha256(raw).hexdigest()
    return f"outbox:{digest}"


def assert_outbox_destination_kind(destination_kind: str) -> None:
    """Raise ValueError if *destination_kind* is not accepted by the DB contract."""
    if destination_kind not in OUTBOX_DESTINATION_KINDS:
        raise ValueError(f"unknown outbox destination_kind: {destination_kind!r}")
