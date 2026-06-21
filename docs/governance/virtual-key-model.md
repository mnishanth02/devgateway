# Virtual Key Model

Status: Track 1.0 governance contract  
Scope: virtual-key lifecycle, principal/project binding, storage shape, API mapping, and gateway validation metadata  
Production capability: this document does not enable production routes, provider secrets, break-glass access, Railway provisioning, retrieval, MCP, workflows, semantic cache, or any production virtual key.

## 1. Purpose

Virtual keys are platform-issued gateway ingress credentials. They bind a caller principal to an allowed project and policy context so Bifrost can enforce a synced decision without becoming the source of identity, project membership, or policy truth.

This contract removes schema ambiguity for Phase 1.1 and Phase 1.2. It is intentionally documentation only: production key issuance remains disabled and fail-closed until Track 0 owner assignment approval, Track 0 break-glass approval, and later Track 1 production gates are complete.

## 2. Responsibility boundary

| Capability | Owner | Bifrost responsibility | Must not happen |
|---|---|---|---|
| Key creation | Control API | Accept only synced active key metadata. | Bifrost must not mint durable virtual keys. |
| Principal binding | Control API / platform policy | Validate that request context matches synced `principal_id` and `principal_type`. | Bifrost must not infer or override principal identity. |
| Project binding | Control API / platform policy | Validate that request context matches synced `project_id` and tenant boundary. | Bifrost must not decide project membership or tenant ACLs. |
| Scope constraints | Platform policy | Enforce synced route, data-class, alias, environment, and budget constraints. | Bifrost must not broaden scopes or add local allow defaults. |
| Policy/registry freshness | Platform policy and registry validators | Deny if pinned versions are missing, stale, unverifiable, or incompatible. | Bifrost must not route with unpinned or stale versions. |
| Rotation/revocation | Control API | Stop accepting revoked, expired, superseded, or disabled keys after sync. | Bifrost must not keep a permissive cache of old key state. |

## 3. Key identity and secret storage

Only a generated secret is shown once to the caller at create or rotate time. Raw key material must never be stored in plaintext, logs, audit detail, fixtures, snapshots, or docs.

| Field | Requirement |
|---|---|
| `virtual_key_id` | Public opaque ID, for example `vk_...`, safe for API responses and audit correlation. |
| `key_prefix` | Non-secret display prefix used for operator lookup, for example first 8-12 safe characters after the public prefix. |
| `key_fingerprint` | Stable non-secret fingerprint of the full presented key using an approved one-way hash/HMAC strategy. Used for lookup and audit. |
| `key_hash` | Verification hash of the full presented key. Must use a secret-safe slow hash or keyed HMAC strategy approved before implementation. |
| Raw secret | Returned only once and never persisted. |

If lookup uses a keyed fingerprint, the key material and application HMAC key are secrets supplied through approved environment variables. Missing hashing configuration denies key issuance and validation.

## 4. Required key state

| Field | Requirement |
|---|---|
| `status` | One of `draft`, `active`, `rotating`, `revoked`, `expired`, `disabled`. Production validation accepts only `active`; all other states deny. |
| `principal_id` / `principal_type` | Required platform-resolved actor binding. |
| `project_id` | Required project binding and tenant boundary. |
| `environment` | Required environment such as `development`, `staging`, or `production`; production defaults disabled. |
| `scope_constraints` | Explicit allow constraints for route intent, data classes, model aliases, providers where applicable, and operation classes. Empty production scope denies. |
| `budget_scope_id` | Required reference to the budget scope used for quota and spend checks. |
| `policy_version` | Immutable platform policy version pinned at issuance or last rotation. |
| `registry_version` | Immutable model/provider registry snapshot version pinned at issuance or last rotation. |
| `issued_at` / `expires_at` | Required lifecycle instants. Missing or expired `expires_at` denies production validation. |
| `rotation_of_key_id` / `rotated_to_key_id` | Link old and new keys during rotation. |
| `revoked_at` / `revoked_by_principal_id` / `revocation_reason` | Required when status becomes `revoked`. |
| `last_used_at` / `last_used_request_id` / `last_used_trace_id` | Last-used metadata updated after successful validation or denied validation according to audit policy. |
| `created_audit_event_id` / `revoked_audit_event_id` | Append-only audit correlation for lifecycle changes. |

## 5. Scope constraints

Virtual-key scopes are deny-by-default constraints, not permissions to bypass platform policy. A request must satisfy both the key constraints and the current synced policy/registry decision.

Required constraint dimensions:

1. `project_id` and tenant/org boundary.
2. `principal_id` and `principal_type`.
3. `environment`.
4. `route_intents`, such as chat, completion, embedding, eval, or policy-defined intent.
5. `data_classes` using the provider data-class policy values.
6. `model_aliases` from the pinned registry snapshot.
7. Optional `provider_ids` only when the policy snapshot explicitly pins provider candidates.
8. `budget_scope_id`.
9. `policy_version` and `registry_version`.
10. `not_before` and `expires_at`.

Missing, empty, unknown, stale, downgraded, or unverifiable production constraints deny with `policy_stale`, `route_disabled`, `data_class`, `budget`, or another stable denial taxonomy code as appropriate.

## 6. Rotation and revocation semantics

Rotation creates a new virtual key row with a new secret, fingerprint, hash, policy pin, registry pin, and expiry. The prior key transitions to `rotating` only for a short overlap window approved by policy; after that it becomes `revoked` or `expired`.

Revocation is immediate and fail-closed. A revoked key must not be accepted by Control API, Bifrost, fallback routes, break-glass paths, local fixtures, or client compatibility shims. Revocation must emit an append-only audit event and sync to Bifrost before any production route could be enabled.

## 7. Gateway request context mapping

Every validated key contributes to the gateway request context envelope in `gateway-policy-enforcement-contract.md`.

| Envelope field | Virtual-key source |
|---|---|
| `principal` | `principal_id`, `principal_type`, and authenticated subject from Control API/platform policy. |
| `virtual_key` | `virtual_key_id`, `key_fingerprint`, `status`, and scope constraints. |
| `project` | `project_id` and tenant/org boundary. |
| `data_class` | Request classification constrained by `scope_constraints.data_classes`. |
| `model_alias` | Requested alias constrained by `scope_constraints.model_aliases`. |
| `route_intent` | Requested route constrained by `scope_constraints.route_intents`. |
| `trace_id` | Trace context contract; key lifecycle events store related trace IDs. |
| `policy_version` | Pinned `policy_version`. |
| `registry_version` | Pinned `registry_version`. |
| `budget_scope` | `budget_scope_id`. |

## 8. DB column mapping

Phase 1.1 should implement the `virtual_key` table in Operational Postgres using the schema conventions.

| Column | Type / constraint | Notes |
|---|---|---|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Internal only. |
| `virtual_key_id` | `TEXT NOT NULL UNIQUE` | Public opaque ID. |
| `key_prefix` | `TEXT NOT NULL` | Non-secret display prefix. |
| `key_fingerprint` | `TEXT NOT NULL UNIQUE` | Non-secret lookup/audit fingerprint. |
| `key_hash` | `TEXT NOT NULL` | Secret verification hash; never exposed. |
| `principal_id` | `BIGINT NOT NULL REFERENCES principal(id) ON DELETE RESTRICT` | Bound principal. |
| `principal_type` | `TEXT NOT NULL` | Must match platform principal taxonomy. |
| `project_id` | `BIGINT NOT NULL REFERENCES project(id) ON DELETE RESTRICT` | Bound project. |
| `budget_scope_id` | `BIGINT NOT NULL REFERENCES budget_scope(id) ON DELETE RESTRICT` | Budget/quota owner. |
| `environment` | `TEXT NOT NULL` | Production rows default disabled until gates pass. |
| `status` | `TEXT NOT NULL CHECK (...)` | `draft`, `active`, `rotating`, `revoked`, `expired`, `disabled`. |
| `scope_constraints` | `JSONB NOT NULL` | Flexible constraint payload; core FKs stay relational. |
| `policy_version` | `TEXT NOT NULL` | Immutable policy snapshot pin. |
| `registry_version` | `TEXT NOT NULL` | Immutable registry snapshot pin. |
| `production_enabled` | `BOOLEAN NOT NULL DEFAULT false CHECK (production_enabled = false)` | Track 1.0/1.1 default; later migrations must explicitly change this contract. |
| `issued_at` | `TIMESTAMPTZ NOT NULL` | Creation/rotation issuance time. |
| `not_before` | `TIMESTAMPTZ` | Optional future activation time. |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Required expiry. |
| `rotation_of_key_id` | `BIGINT REFERENCES virtual_key(id) ON DELETE SET NULL` | New key points to old key. |
| `rotated_to_key_id` | `BIGINT REFERENCES virtual_key(id) ON DELETE SET NULL` | Old key points to new key. |
| `revoked_at` | `TIMESTAMPTZ` | Required for revoked status. |
| `revoked_by_principal_id` | `BIGINT REFERENCES principal(id) ON DELETE RESTRICT` | Revoker. |
| `revocation_reason` | `TEXT` | Stable internal reason. |
| `last_used_at` | `TIMESTAMPTZ` | Operational metadata. |
| `last_used_request_id` | `TEXT` | Request correlation. |
| `last_used_trace_id` | `TEXT` | Trace correlation. |
| `created_audit_event_id` | `BIGINT REFERENCES audit_event(id) ON DELETE RESTRICT` | Lifecycle audit. |
| `revoked_audit_event_id` | `BIGINT REFERENCES audit_event(id) ON DELETE RESTRICT` | Revocation audit. |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL` | Standard operational timestamps. |

Required indexes: `key_fingerprint`, `(principal_id, project_id, status)`, `(project_id, status)`, `budget_scope_id`, `expires_at`, `policy_version`, and `registry_version`.

## 9. API schema mapping

Phase 1.2 Control API schemas must expose public IDs only.

| API object / route | Required fields |
|---|---|
| `POST /api/virtual-keys` request | `principal_id`, `project_id`, `budget_scope_id`, `environment`, `scope_constraints`, `policy_version`, `registry_version`, `expires_at`, `idempotency_key`. |
| `POST /api/virtual-keys` response | `virtual_key_id`, one-time `secret`, `key_prefix`, `status`, `expires_at`, `policy_version`, `registry_version`, `created_audit_event_id`. |
| `GET /api/virtual-keys` response item | `virtual_key_id`, `key_prefix`, `principal_id`, `project_id`, `budget_scope_id`, `environment`, `status`, `scope_constraints`, `expires_at`, `last_used_at`, `last_used_request_id`, `last_used_trace_id`, `policy_version`, `registry_version`. |
| `POST /api/virtual-keys/{virtual_key_id}/rotate` response | New `virtual_key_id`, one-time `secret`, old key status, overlap expiry, audit event IDs. |
| `POST /api/virtual-keys/{virtual_key_id}/revoke` request | `revocation_reason`, optional `request_id` and trace context. |
| `POST /api/virtual-keys/{virtual_key_id}/revoke` response | `virtual_key_id`, `status=revoked`, `revoked_at`, `revoked_audit_event_id`. |

API validation must reject raw provider secrets, production enablement flags, break-glass escalation, retrieval/MCP/workflow scopes, semantic-cache scopes, and unknown scope dimensions.

## 10. Production-disabled and fail-closed defaults

- `production_enabled` defaults to `false` and remains constrained false for Phase 1.0 documentation and Phase 1.1 implementation.
- Missing key metadata, missing budget scope, missing audit sink, stale policy/registry pins, expired keys, revoked keys, disabled keys, unknown scopes, and sync failures deny.
- Track 0 owner assignment and break-glass approval blockers remain release-blocking.
- This contract does not authorize provider credentials, production model routes, break-glass access, Railway production provisioning, retrieval, MCP, workflows, or semantic cache.

