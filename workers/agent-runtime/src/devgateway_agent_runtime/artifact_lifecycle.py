"""Pure artifact-lifecycle helpers for DevGateway agent runtime.

Metadata-only, side-effect-free. Never reads object bodies, emits signed URLs,
or inspects raw artifact content — only lifecycle stage enums and caller-supplied
boolean flags.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .contracts import ArtifactLifecycleStage
from .object_storage import ObjectRef, ObjectStorage


# ---------------------------------------------------------------------------
# Lifecycle stage classification sets
# ---------------------------------------------------------------------------

#: Terminal artifact lifecycle stages; the artifact has reached a final disposition.
ARTIFACT_LIFECYCLE_TERMINAL_STAGES: frozenset[ArtifactLifecycleStage] = frozenset(
    {
        ArtifactLifecycleStage.DELETED,
        ArtifactLifecycleStage.REDACTED,
    }
)

#: Active (non-terminal) artifact lifecycle stages.
ARTIFACT_LIFECYCLE_ACTIVE_STAGES: frozenset[ArtifactLifecycleStage] = (
    frozenset(ArtifactLifecycleStage) - ARTIFACT_LIFECYCLE_TERMINAL_STAGES
)


def is_lifecycle_terminal(stage: ArtifactLifecycleStage) -> bool:
    """Return ``True`` if *stage* is a terminal artifact lifecycle stage."""
    return stage in ARTIFACT_LIFECYCLE_TERMINAL_STAGES


def is_lifecycle_active(stage: ArtifactLifecycleStage) -> bool:
    """Return ``True`` if *stage* is an active (non-terminal) artifact lifecycle stage."""
    return stage in ARTIFACT_LIFECYCLE_ACTIVE_STAGES


# ---------------------------------------------------------------------------
# Legal hold deletion guard
# ---------------------------------------------------------------------------


class LegalHoldViolation(ValueError):
    """Raised when a deletion action is attempted while a legal hold is active."""


#: Stages that constitute deletion actions; blocked when legal_hold is True.
_DELETION_STAGES: frozenset[ArtifactLifecycleStage] = frozenset(
    {
        ArtifactLifecycleStage.DELETION_SCHEDULED,
        ArtifactLifecycleStage.DELETED,
    }
)


def guard_legal_hold_deletion(
    stage: ArtifactLifecycleStage,
    *,
    legal_hold: bool,
) -> None:
    """Raise :class:`LegalHoldViolation` if a deletion stage is requested with an active hold.

    Decision is made purely on the *stage* enum value and the caller-supplied
    *legal_hold* flag.  No artifact content or storage calls are made.

    Args:
        stage: The lifecycle stage being requested.
        legal_hold: ``True`` when the artifact has an active legal hold.

    Raises:
        LegalHoldViolation: When *stage* is a deletion stage and *legal_hold* is ``True``.
    """
    if legal_hold and stage in _DELETION_STAGES:
        raise LegalHoldViolation(
            f"deletion action {stage.value!r} is blocked: legal hold is active. "
            "Release the legal hold before scheduling or executing deletion."
        )


# ---------------------------------------------------------------------------
# Signed-access eligibility guard
# ---------------------------------------------------------------------------


class SignedAccessViolation(ValueError):
    """Raised when signed-access conditions are not met."""


def guard_signed_access(
    stage: ArtifactLifecycleStage,
    *,
    signed_access_eligibility: bool,
    requires_approval: bool = True,
) -> None:
    """Guard signed-access lifecycle events.

    Signed access grant is only permissible when:

    1. The artifact is marked eligible (``signed_access_eligibility=True``).
    2. Approval is required (``requires_approval=True``, the safe default).

    This guard **never emits a signed URL**; it only validates that the
    lifecycle event is safe to persist.  URL generation must happen at a
    separate, higher-privilege layer.

    Args:
        stage: The lifecycle stage being requested.
        signed_access_eligibility: ``True`` when the artifact is eligible for signed access.
        requires_approval: Must be ``True``; bypassing approval is not permitted
            from the runtime layer (default ``True`` enforces safe-by-default).

    Raises:
        SignedAccessViolation: When *stage* is ``SIGNED_ACCESS_GRANTED`` and
            eligibility is ``False``, or when *requires_approval* is ``False``.
    """
    if stage is not ArtifactLifecycleStage.SIGNED_ACCESS_GRANTED:
        return  # Guard only applies to SIGNED_ACCESS_GRANTED actions
    if not signed_access_eligibility:
        raise SignedAccessViolation(
            "signed access cannot be granted: artifact is not marked eligible "
            "(signed_access_eligibility=False)."
        )
    if not requires_approval:
        raise SignedAccessViolation(
            "signed access cannot be granted without approval: "
            "requires_approval must be True — bypassing approval is not permitted "
            "from the runtime layer."
        )


def guard_artifact_displayable(
    *,
    stage: ArtifactLifecycleStage,
    artifact_state: str | None = None,
    redacted: bool = False,
    deleted: bool = False,
    expires_at: datetime | None = None,
    now: datetime | None = None,
) -> None:
    """Raise when an artifact body/preview must not be displayed or signed."""
    current_time = now or datetime.now(timezone.utc)
    if _is_expired(expires_at, current_time):
        raise SignedAccessViolation("artifact is expired and cannot be displayed or signed.")
    if redacted or deleted or stage in ARTIFACT_LIFECYCLE_TERMINAL_STAGES:
        raise SignedAccessViolation("artifact is redacted or deleted and cannot be displayed or signed.")
    if artifact_state in {"expired", "redacted", "deleted"}:
        raise SignedAccessViolation("artifact lifecycle state is not displayable.")


# ---------------------------------------------------------------------------
# Checksum verifier (string comparison only — no file/object body access)
# ---------------------------------------------------------------------------


class ChecksumMismatch(ValueError):
    """Raised when expected and actual SHA-256 hex digests do not match."""


def verify_checksum_sha256(expected: str, actual: str) -> None:
    """Compare an expected SHA-256 hex digest string against an actual one.

    This is a **pure string comparison** — no file reading, no object storage
    calls, no hashing performed here.  Both arguments must be pre-computed hex
    digest strings (lowercase or uppercase; normalised internally).

    Args:
        expected: The SHA-256 hex digest expected for the artifact.
        actual: The SHA-256 hex digest actually computed/received.

    Raises:
        ChecksumMismatch: When the normalised digests are not equal.
    """
    if expected.strip().lower() != actual.strip().lower():
        raise ChecksumMismatch(
            "checksum mismatch: the supplied sha256 digest does not match the expected value."
        )


def verify_object_checksum_sha256(
    storage: ObjectStorage,
    object_ref: ObjectRef,
    expected_sha256: str,
) -> None:
    """Verify object metadata hash before signed access without reading the body."""
    metadata = storage.head_object(object_ref)
    verify_checksum_sha256(expected_sha256, metadata.sha256_hex)


def _is_expired(expires_at: datetime | None, now: datetime) -> bool:
    if expires_at is None:
        return False
    normalized_expires_at = expires_at
    if normalized_expires_at.tzinfo is None:
        normalized_expires_at = normalized_expires_at.replace(tzinfo=timezone.utc)
    normalized_now = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    return normalized_expires_at <= normalized_now
