"""Artifact body persistence and reconciliation helpers."""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Mapping

from .artifact_lifecycle import verify_checksum_sha256
from .object_storage import ObjectMetadata, ObjectNotFound, ObjectRef, ObjectStorage


@dataclass(frozen=True, slots=True)
class StoredArtifactMetadata:
    """Postgres-safe artifact metadata; never contains object bytes."""

    artifact_id: str
    object_ref: ObjectRef
    sha256_hex: str
    size_bytes: int
    media_type: str
    retention_policy_ref: str
    sensitivity_label: str
    acl_scopes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PersistedArtifactMetadata:
    """Projection of artifact rows needed for object reconciliation."""

    artifact_id: str
    object_ref: ObjectRef
    sha256_hex: str
    state: str = "active"


@dataclass(frozen=True, slots=True)
class ArtifactReconciliationAction:
    """A deterministic action proposed by orphan reconciliation."""

    kind: str
    artifact_id: str
    object_ref: ObjectRef
    reason: str


def artifact_object_key(project_id: str, artifact_id: str) -> str:
    """Return a stable, secret-free object key for artifact bytes."""
    safe_project = _safe_path_segment(project_id)
    safe_artifact = _safe_path_segment(artifact_id)
    return f"projects/{safe_project}/artifacts/{safe_artifact}/body"


def store_artifact_body(
    storage: ObjectStorage,
    *,
    project_id: str,
    artifact_id: str,
    body: bytes,
    media_type: str,
    retention_policy_ref: str,
    sensitivity_label: str,
    acl_scopes: tuple[str, ...],
    metadata: Mapping[str, str] | None = None,
) -> StoredArtifactMetadata:
    """Store artifact bytes in object storage and return metadata only.

    The body is hashed before write, written once, and verified through object
    metadata after write. Callers persist the returned metadata in Postgres.
    """

    expected_sha256 = sha256(body).hexdigest()
    object_metadata = storage.put_bytes(
        artifact_object_key(project_id, artifact_id),
        body,
        content_type=media_type,
        metadata={
            "artifact-id": artifact_id,
            "project-id": project_id,
            "retention-policy-ref": retention_policy_ref,
            "sensitivity-label": sensitivity_label,
            "acl-scopes": ",".join(acl_scopes),
            **(metadata or {}),
        },
    )
    verify_object_metadata_hash(object_metadata, expected_sha256)
    return StoredArtifactMetadata(
        artifact_id=artifact_id,
        object_ref=object_metadata.ref,
        sha256_hex=object_metadata.sha256_hex,
        size_bytes=object_metadata.size_bytes,
        media_type=media_type,
        retention_policy_ref=retention_policy_ref,
        sensitivity_label=sensitivity_label,
        acl_scopes=acl_scopes,
    )


def verify_object_metadata_hash(object_metadata: ObjectMetadata, expected_sha256: str) -> None:
    """Verify object metadata hash without reading object bytes."""
    verify_checksum_sha256(expected_sha256, object_metadata.sha256_hex)


def verify_stored_artifact_hash(storage: ObjectStorage, metadata: PersistedArtifactMetadata) -> None:
    """Verify a persisted object ref before signed access is issued."""
    object_metadata = storage.head_object(metadata.object_ref)
    verify_object_metadata_hash(object_metadata, metadata.sha256_hex)


def reconcile_artifact_objects(
    storage: ObjectStorage,
    persisted: tuple[PersistedArtifactMetadata, ...],
    *,
    object_prefix: str,
) -> tuple[ArtifactReconciliationAction, ...]:
    """Detect object/metadata split-brain cases.

    Returns actions for:
    - object-write-succeeded / DB-commit-failed (object exists, no metadata);
    - DB metadata / object missing (metadata points at absent object);
    - metadata/object hash mismatch.
    """

    persisted_by_key = {item.object_ref.key: item for item in persisted}
    actions: list[ArtifactReconciliationAction] = []

    for object_metadata in storage.list_objects(prefix=object_prefix):
        persisted_metadata = persisted_by_key.get(object_metadata.ref.key)
        artifact_id = object_metadata.metadata.get("artifact-id", object_metadata.ref.key)
        if persisted_metadata is None:
            actions.append(
                ArtifactReconciliationAction(
                    kind="object_without_db_metadata",
                    artifact_id=artifact_id,
                    object_ref=object_metadata.ref,
                    reason="object write succeeded but DB metadata commit is absent",
                )
            )
            continue
        try:
            verify_object_metadata_hash(object_metadata, persisted_metadata.sha256_hex)
        except ValueError:
            actions.append(
                ArtifactReconciliationAction(
                    kind="hash_mismatch",
                    artifact_id=persisted_metadata.artifact_id,
                    object_ref=object_metadata.ref,
                    reason="object metadata hash differs from persisted artifact metadata",
                )
            )

    object_keys = {metadata.ref.key for metadata in storage.list_objects(prefix=object_prefix)}
    for persisted_metadata in persisted:
        if persisted_metadata.object_ref.key in object_keys:
            continue
        try:
            storage.head_object(persisted_metadata.object_ref)
        except ObjectNotFound:
            actions.append(
                ArtifactReconciliationAction(
                    kind="db_metadata_without_object",
                    artifact_id=persisted_metadata.artifact_id,
                    object_ref=persisted_metadata.object_ref,
                    reason="DB metadata points at an object that is missing",
                )
            )
    return tuple(actions)


def _safe_path_segment(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "-" for ch in value.strip())
    if not safe or safe in {".", ".."}:
        raise ValueError("artifact object key segment must be non-empty and must not traverse paths")
    return safe
