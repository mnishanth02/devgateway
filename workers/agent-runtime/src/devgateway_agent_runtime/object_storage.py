"""Object-storage adapters for artifact bodies.

The runtime stores artifact bytes outside Postgres and persists only opaque
object refs, hashes, sizes, retention, sensitivity, and ACL metadata in the DB.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
import hashlib
import hmac
from typing import Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


class ObjectStorageError(RuntimeError):
    """Base class for object-storage failures."""


class ObjectStorageUnavailable(ObjectStorageError):
    """Raised when a configured provider is unavailable or unsupported."""


class ObjectNotFound(ObjectStorageError):
    """Raised when an object ref does not resolve to stored bytes."""


@dataclass(frozen=True, slots=True)
class ObjectRef:
    """Opaque object reference persisted in metadata stores."""

    bucket: str
    key: str
    version_id: str | None = None
    provider: str = "s3"

    def to_uri(self) -> str:
        suffix = "" if self.version_id is None else f"?versionId={quote(self.version_id)}"
        return f"{self.provider}://{self.bucket}/{quote(self.key, safe='/')}{suffix}"


@dataclass(frozen=True, slots=True)
class ObjectMetadata:
    """Metadata returned from storage without exposing object bodies."""

    ref: ObjectRef
    sha256_hex: str
    size_bytes: int
    content_type: str
    metadata: Mapping[str, str] = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class ObjectStorage(Protocol):
    """S3-compatible object-storage boundary."""

    def put_bytes(
        self,
        key: str,
        body: bytes,
        *,
        content_type: str,
        metadata: Mapping[str, str] | None = None,
    ) -> ObjectMetadata:
        """Write bytes and return verified metadata."""

    def head_object(self, ref: ObjectRef) -> ObjectMetadata:
        """Return object metadata without reading the body."""

    def delete_object(self, ref: ObjectRef) -> None:
        """Delete an object."""

    def create_presigned_get_url(self, ref: ObjectRef, *, expires_in_seconds: int) -> str:
        """Issue a short-lived GET URL for an object."""

    def list_objects(self, *, prefix: str = "") -> tuple[ObjectMetadata, ...]:
        """List object metadata for reconciliation."""


class InMemoryObjectStorage:
    """Deterministic local adapter for tests and offline development."""

    def __init__(self, *, bucket: str = "devgateway-artifacts", provider: str = "memory") -> None:
        self.bucket = bucket
        self.provider = provider
        self._objects: dict[tuple[str, str, str | None], tuple[bytes, ObjectMetadata]] = {}

    def put_bytes(
        self,
        key: str,
        body: bytes,
        *,
        content_type: str,
        metadata: Mapping[str, str] | None = None,
    ) -> ObjectMetadata:
        digest = sha256(body).hexdigest()
        ref = ObjectRef(bucket=self.bucket, key=key, provider=self.provider)
        object_metadata = ObjectMetadata(
            ref=ref,
            sha256_hex=digest,
            size_bytes=len(body),
            content_type=content_type,
            metadata={**(metadata or {}), "sha256": digest},
        )
        self._objects[(ref.bucket, ref.key, ref.version_id)] = (bytes(body), object_metadata)
        verified = self.head_object(ref)
        if verified.sha256_hex != digest or verified.size_bytes != len(body):
            raise ObjectStorageError("object write verification failed")
        return object_metadata

    def head_object(self, ref: ObjectRef) -> ObjectMetadata:
        stored = self._objects.get((ref.bucket, ref.key, ref.version_id))
        if stored is None:
            raise ObjectNotFound(ref.to_uri())
        return stored[1]

    def delete_object(self, ref: ObjectRef) -> None:
        self._objects.pop((ref.bucket, ref.key, ref.version_id), None)

    def create_presigned_get_url(self, ref: ObjectRef, *, expires_in_seconds: int) -> str:
        self.head_object(ref)
        if expires_in_seconds <= 0:
            raise ValueError("expires_in_seconds must be positive")
        return (
            "memory://signed/"
            f"{quote(ref.bucket)}/{quote(ref.key, safe='/')}?"
            f"expires={expires_in_seconds}&signature=deterministic"
        )

    def list_objects(self, *, prefix: str = "") -> tuple[ObjectMetadata, ...]:
        return tuple(
            metadata
            for (_, metadata) in self._objects.values()
            if metadata.ref.key.startswith(prefix)
        )


@dataclass(frozen=True, slots=True)
class S3CompatibleConfig:
    """Configuration shared by MinIO and Railway Object Storage."""

    endpoint_url: str
    region: str
    bucket: str
    access_key_id: str
    secret_access_key: str
    provider: str = "s3"
    force_path_style: bool = True


class S3CompatibleObjectStorage:
    """Small stdlib S3-compatible adapter for MinIO/Railway-compatible APIs."""

    def __init__(self, config: S3CompatibleConfig) -> None:
        if not all(
            [
                config.endpoint_url.strip(),
                config.region.strip(),
                config.bucket.strip(),
                config.access_key_id.strip(),
                config.secret_access_key.strip(),
            ]
        ):
            raise ObjectStorageUnavailable("S3-compatible object storage is not fully configured")
        self.config = config
        self._endpoint = config.endpoint_url.rstrip("/")

    def put_bytes(
        self,
        key: str,
        body: bytes,
        *,
        content_type: str,
        metadata: Mapping[str, str] | None = None,
    ) -> ObjectMetadata:
        digest = sha256(body).hexdigest()
        headers = {
            "content-type": content_type,
            "x-amz-meta-sha256": digest,
            **{f"x-amz-meta-{k.lower()}": v for k, v in (metadata or {}).items()},
        }
        self._request("PUT", key, body=body, headers=headers)
        ref = ObjectRef(bucket=self.config.bucket, key=key, provider=self.config.provider)
        verified = self.head_object(ref)
        if verified.sha256_hex != digest:
            raise ObjectStorageError("object write hash verification failed")
        return verified

    def head_object(self, ref: ObjectRef) -> ObjectMetadata:
        response_headers = self._request("HEAD", ref.key, body=b"", headers={})
        digest = response_headers.get("x-amz-meta-sha256")
        if not digest:
            raise ObjectStorageError("object metadata is missing sha256 verification hash")
        return ObjectMetadata(
            ref=ref,
            sha256_hex=digest,
            size_bytes=int(response_headers.get("content-length", "0")),
            content_type=response_headers.get("content-type", "application/octet-stream"),
            metadata={k: v for k, v in response_headers.items() if k.startswith("x-amz-meta-")},
        )

    def delete_object(self, ref: ObjectRef) -> None:
        self._request("DELETE", ref.key, body=b"", headers={})

    def create_presigned_get_url(self, ref: ObjectRef, *, expires_in_seconds: int) -> str:
        if expires_in_seconds <= 0 or expires_in_seconds > 900:
            raise ValueError("expires_in_seconds must be between 1 and 900")
        self.head_object(ref)
        return self._presign_get(ref.key, expires_in_seconds)

    def list_objects(self, *, prefix: str = "") -> tuple[ObjectMetadata, ...]:
        raise ObjectStorageUnavailable("live object listing is intentionally not used by runtime reconciliation")

    def _request(self, method: str, key: str, *, body: bytes, headers: Mapping[str, str]) -> Mapping[str, str]:
        parsed = urlparse(self._object_url(key))
        payload_hash = sha256(body).hexdigest()
        request_headers = {
            "host": parsed.netloc,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": _amz_now(),
            **{k.lower(): v for k, v in headers.items()},
        }
        request_headers["authorization"] = self._authorization_header(
            method,
            parsed.path,
            "",
            request_headers,
            payload_hash,
        )
        request = Request(self._object_url(key), data=body if method != "HEAD" else None, method=method)
        for name, value in request_headers.items():
            request.add_header(name, value)
        try:
            with urlopen(request, timeout=10) as response:  # noqa: S310 - endpoint is explicit config
                return {k.lower(): v for k, v in response.headers.items()}
        except HTTPError as exc:
            if exc.code == 404:
                raise ObjectNotFound(f"{self.config.bucket}/{key}") from exc
            raise ObjectStorageError(f"S3-compatible request failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise ObjectStorageUnavailable(str(exc.reason)) from exc

    def _object_url(self, key: str) -> str:
        escaped_key = quote(key, safe="/")
        if self.config.force_path_style:
            return f"{self._endpoint}/{quote(self.config.bucket)}/{escaped_key}"
        parsed = urlparse(self._endpoint)
        return f"{parsed.scheme}://{self.config.bucket}.{parsed.netloc}/{escaped_key}"

    def _authorization_header(
        self,
        method: str,
        canonical_uri: str,
        canonical_query: str,
        headers: Mapping[str, str],
        payload_hash: str,
    ) -> str:
        date = headers["x-amz-date"][:8]
        signed_headers = ";".join(sorted(headers))
        canonical_headers = "".join(f"{name}:{headers[name].strip()}\n" for name in sorted(headers))
        canonical_request = "\n".join(
            [method, canonical_uri, canonical_query, canonical_headers, signed_headers, payload_hash]
        )
        credential_scope = f"{date}/{self.config.region}/s3/aws4_request"
        string_to_sign = "\n".join(
            [
                "AWS4-HMAC-SHA256",
                headers["x-amz-date"],
                credential_scope,
                sha256(canonical_request.encode()).hexdigest(),
            ]
        )
        signature = hmac.new(
            _signing_key(self.config.secret_access_key, date, self.config.region),
            string_to_sign.encode(),
            hashlib.sha256,
        ).hexdigest()
        return (
            "AWS4-HMAC-SHA256 "
            f"Credential={self.config.access_key_id}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )

    def _presign_get(self, key: str, expires_in_seconds: int) -> str:
        now = _amz_now()
        date = now[:8]
        parsed = urlparse(self._object_url(key))
        credential_scope = f"{date}/{self.config.region}/s3/aws4_request"
        query = {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": f"{self.config.access_key_id}/{credential_scope}",
            "X-Amz-Date": now,
            "X-Amz-Expires": str(expires_in_seconds),
            "X-Amz-SignedHeaders": "host",
        }
        canonical_query = urlencode(sorted(query.items()), quote_via=quote)
        canonical_request = "\n".join(
            ["GET", parsed.path, canonical_query, f"host:{parsed.netloc}\n", "host", "UNSIGNED-PAYLOAD"]
        )
        string_to_sign = "\n".join(
            ["AWS4-HMAC-SHA256", now, credential_scope, sha256(canonical_request.encode()).hexdigest()]
        )
        signature = hmac.new(
            _signing_key(self.config.secret_access_key, date, self.config.region),
            string_to_sign.encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"{self._object_url(key)}?{canonical_query}&X-Amz-Signature={signature}"


def _amz_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _signing_key(secret: str, date: str, region: str) -> bytes:
    k_date = hmac.new(f"AWS4{secret}".encode(), date.encode(), hashlib.sha256).digest()
    k_region = hmac.new(k_date, region.encode(), hashlib.sha256).digest()
    k_service = hmac.new(k_region, b"s3", hashlib.sha256).digest()
    return hmac.new(k_service, b"aws4_request", hashlib.sha256).digest()
