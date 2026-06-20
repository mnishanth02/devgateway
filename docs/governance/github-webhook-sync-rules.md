# GitHub Webhook Sync Rules

Status: Track 0.6 governance artifact  
Scope: GitHub App webhook validation, permission-sync freshness, stale-sync default-deny behavior, ACL metadata, and audit posture  
Production capability: this document does not add, approve, or describe production webhook endpoint behavior.

## 1. Purpose

GitHub is the first-release SCM and source-of-truth permission graph for repository-aware retrieval. These rules lock the validation and failure posture before any production endpoint exists: signed webhook input may update permission snapshots only through an idempotent sync pipeline, and any unverifiable or stale permission state defaults to deny.

## 2. Webhook validation rules

Future GitHub App webhook ingestion must satisfy all rules below before a payload can affect permission state:

1. Require the raw request body, `X-Hub-Signature-256`, `X-GitHub-Delivery`, `X-GitHub-Event`, installation identity, and repository identity where the event is repository-scoped.
2. Verify `X-Hub-Signature-256` with the configured webhook secret using HMAC-SHA-256 and constant-time comparison. Missing signatures, SHA-1-only signatures, invalid signatures, body reserialization, or unrecognized algorithms are rejected.
3. Build a replay/idempotency key from installation ID, delivery ID, event name, and payload digest. Duplicate keys return the previously recorded outcome or no-op and never reapply side effects.
4. Persist webhook receipt, validation decision, idempotency key, payload digest, and delivery metadata before scheduling sync work.
5. Reject unknown event/action combinations unless an explicit governance rule maps them to a safe no-op reconciliation path.

Validation failures fail closed, emit audit events, and must not create a permissive fallback or production allow path.

## 3. Event ordering and idempotent sync

Permission sync is snapshot-oriented. Webhooks are triggers to reconcile GitHub state; they are not the final authority when ordering is ambiguous.

- Sync runs are scoped by installation, organization, repository, ref where applicable, and project.
- Each run records `sync_run_id`, source delivery metadata, replay/idempotency key, started time, completed time, outcome, previous index version, produced index version, and source snapshot reference.
- Per-scope cursors record the newest applied GitHub event timestamp or comparable monotonic source reference. Older or duplicate events cannot overwrite a newer snapshot.
- Ordering gaps, missing source references, force-push/ref ambiguity, or payloads that cannot prove they are newer schedule a full reconciliation and set or keep a stale-sync marker until reconciliation succeeds.
- Sync writes are transactional: permission grants, CODEOWNER-derived rules, ACL scope hashes, index versions, and stale-marker transitions commit together or not at all.

## 4. Stale-sync marker semantics

A stale-sync marker is an explicit fail-closed state for a permission scope. It may be scoped to an installation, organization, repository, ref, project, or narrower ACL scope.

Required marker fields:

| Field | Requirement |
|---|---|
| `stale_marker_id` | Stable opaque marker identifier. |
| `project_id` | Project/tenant boundary affected by the stale state. |
| `scope_ref` | Installation/org/repository/ref/ACL scope affected. |
| `reason` | Stable reason such as `sync_lag_exceeded`, `webhook_validation_failed`, `ordering_gap`, `sync_failed`, `dead_letter_pending`, `snapshot_unverifiable`, or `manual_security_hold`. |
| `marked_at` | `TIMESTAMPTZ` when the marker became active. |
| `last_successful_sync_run_id` | Most recent successful sync evidence, if any. |
| `blocking_delivery_id` | Delivery or event that triggered the marker, if any. |
| `cleared_at` | Null while active; set only after successful reconciliation. |
| `cleared_by_sync_run_id` | Sync run that produced the verified fresh snapshot. |

An active marker denies repo-aware retrieval for its scope. Markers are cleared only by a successful sync or full reconciliation that writes a new verifiable permission snapshot and index version. Manual clearing without fresh sync evidence is not allowed.

## 5. Stale-sync default-deny rules

Repo-aware retrieval must deny by default when any condition below is true:

1. No successful permission sync exists for the requested project/repository/ref scope.
2. Permission sync lag is greater than the configured SLO.
3. A stale-sync marker is active for the requested scope or an ancestor scope.
4. The permission snapshot, ACL scope hash, source reference, or index version is missing, unverifiable, or incompatible with the retrieval index.
5. Event ordering is ambiguous and a full reconciliation has not completed.
6. A webhook or sync failure is pending retry or dead-letter handling for the requested scope.
7. The caller uses a shared anonymous team key for repository retrieval.
8. Platform roles would grant access beyond GitHub restrictions for private repository content.

The denial reason is `policy_stale` for missing, stale, or unverifiable sync state. ACL-negative decisions use a typed denial and still fail closed. Silent allow fallback is forbidden.

## 6. ACL checks before prompt assembly

Retrieval-time ACL filtering is not sufficient. The platform must repeat ACL checks immediately before prompt assembly using the current permission snapshot.

The pre-prompt check must verify:

- principal GitHub account link and platform principal binding;
- project boundary and repository/ref scope;
- GitHub permission grant and CODEOWNER-derived constraints where applicable;
- `acl_scope_hash` equality between retrieved rows and the current permission snapshot;
- `index_version` equality or an explicit compatible reindex rule;
- absence of active stale-sync markers;
- sync lag within SLO at check time.

If this check is missing, stale, unverifiable, negative, or mismatched with retrieved rows, prompt assembly denies and emits an audit event. Prompt assembly must not substitute redaction, truncation, or model-side instructions for missing ACL proof.

## 7. Required ACL and index metadata

Every chunk, entity, relation, memory item, and context pack stores ACL scope and index version. Knowledge, graph, memory, and context-pack rows include the fields below.

| Domain | Required fields |
|---|---|
| Knowledge rows, including source, document, chunk, embedding, symbol, endpoint, and decision metadata | `project_id`, `acl_scope_hash`, source reference such as `source_ref`, `repository_ref`, `document_ref`, or commit/path/ref reference, and `index_version`. |
| Graph rows, including entity and relation metadata | `project_id`, `acl_scope_hash`, source reference, and `index_version`. |
| Memory rows, including working, episodic, semantic, decision, and correction memory | `project_id`, `acl_scope_hash`, source reference, and `index_version`. |
| Context-pack rows and artifacts | `project_id`, `acl_scope_hash`, source reference, and `index_version`. |

Rows missing required metadata are ineligible for retrieval, cache reuse, context packing, or prompt assembly. Reindexing must produce a new `index_version` whenever ACL scope derivation changes.

## 8. Failure, retry, and dead-letter posture

- Transient sync failures retry with bounded backoff and retain or set the stale-sync marker while retrying.
- Permanent validation failures, unsupported event shapes, repeated transient failures, or payloads requiring operator review move to a dead-letter queue with delivery ID, idempotency key, reason, and scope.
- Dead-letter presence for a scope is a stale marker and causes default-deny for repo-aware retrieval until resolved by a successful reconciliation.
- Partial sync results are not published as fresh. If a sync cannot prove completeness, it fails and leaves stale state active.
- Audit sink unavailability for security-relevant validation, stale-marker, or retrieval-denial events fails closed for production-bound behavior.

## 9. Audit events

Audit events are immutable and request-correlated. Required event types include:

- `github_webhook_received`;
- `github_webhook_rejected`;
- `github_webhook_duplicate_ignored`;
- `github_permission_sync_started`;
- `github_permission_sync_succeeded`;
- `github_permission_sync_failed`;
- `github_permission_sync_stale_marked`;
- `github_permission_sync_stale_cleared`;
- `github_permission_sync_dead_lettered`;
- `repo_retrieval_denied_stale_sync`;
- `repo_retrieval_acl_rechecked_before_prompt`;
- `prompt_assembly_denied_acl_or_stale_sync`.

Events include actor/system principal where known, project, installation, repository/ref scope, delivery ID, event name/action, idempotency key, payload digest, sync run ID, stale-marker ID, previous and produced index versions, `acl_scope_hash`, source reference, sync lag, SLO, decision, denial reason, and trace/correlation ID where available.

## 10. Required validation checklist

- Webhook payloads are signed with `X-Hub-Signature-256` and processed idempotently.
- Replay/idempotency keys prevent duplicate side effects.
- Event ordering gaps cannot overwrite newer permission snapshots.
- Sync failures, retries, and dead letters keep stale markers active.
- Permission sync lag greater than SLO denies repo-aware retrieval.
- ACL checks repeat immediately before prompt assembly.
- Every chunk/entity/relation/memory/context-pack artifact stores ACL scope and index version.
- Knowledge, graph, memory, and context-pack rows include `project_id`, `acl_scope_hash`, source reference, and `index_version`.
- Default behavior is fail-closed/default-deny with no silent allow fallback.
- This artifact remains governance-only and does not define production webhook endpoint behavior.
