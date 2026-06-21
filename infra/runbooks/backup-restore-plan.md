# Backup and restore plan

Status: Track 0 operations artifact  
Scope: Operational Postgres, Knowledge Postgres, object storage, Neo4j Community volume, retention, archive, partition candidates, and restore validation  
Production capability: this plan does not provision production resources, create backups, create buckets, attach volumes, or mutate production data.

## Release gate

Restore validation is mandatory before the first production release. Production provisioning and production traffic remain blocked until each store below has:

1. a reviewed backup mechanism;
2. an owner and escalation path;
3. documented retention and archive expectations;
4. a successful restore validation in a non-production environment;
5. immutable audit evidence of the restore test; and
6. a rollback decision record if validation fails.

## Ownership

| Store | Primary owner | Approval / review |
|---|---|---|
| Operational Postgres | Platform operations owner | Platform security owner, platform architecture owner |
| Knowledge Postgres | Platform operations owner | Platform security owner, evaluation owner |
| Object storage | Platform operations owner | Platform security owner |
| Neo4j Community volume | Platform operations owner | Platform security owner, evaluation owner |
| Restore validation evidence | Platform operations owner | Platform security owner |

## Operational Postgres checklist

Operational Postgres stores Better Auth, tenant policy, workflow state, audit events, budgets, cost events, eval gate records, and release-blocking decisions.

### Backup design checklist

- [ ] Identify Railway managed backup capability or approved logical dump approach for Operational Postgres.
- [ ] Record backup cadence, retention, encryption posture, and restore target environment.
- [ ] Include schema, roles/privileges, extensions, migrations, and immutable audit controls in restore scope.
- [ ] Store backup credentials only in Railway secrets or approved operator-managed secret storage.
- [ ] Ensure runtime roles cannot update/delete immutable audit records after restore.
- [ ] Ensure backup jobs emit status metrics and immutable audit events.

### Restore validation checklist

- [ ] Restore the latest non-production backup into an isolated validation database.
- [ ] Run migration/schema compatibility checks such as `pnpm db:check` when available.
- [ ] Verify Better Auth tables, policy tables, workflow tables, eval gate tables, cost tables, and audit tables are present.
- [ ] Verify sample immutable audit rows retain `trace_id` / `request_id` correlation and cannot be updated or deleted by runtime roles.
- [ ] Verify gate-result records still block production enablement when missing or failed.
- [ ] Record restore start/end time, backup identifier, validation database, commands used, owner, outcome, and evidence link in immutable audit.
- [ ] Destroy or quarantine the validation database according to the approved data handling rule.

## Knowledge Postgres checklist

Knowledge Postgres stores sources, documents, chunks, vector/full-text metadata, pgvector data, and ACL-bearing retrieval metadata.

### Backup design checklist

- [ ] Identify Railway managed backup capability or approved logical dump approach for Knowledge Postgres.
- [ ] Confirm pgvector and full-text index extension requirements and operator-run extension policy.
- [ ] Include `project_id`, `acl_scope_hash`, source reference, and `index_version` metadata in restore validation.
- [ ] Define whether large embeddings require separate archive/export handling.
- [ ] Ensure backup status contributes to retrieval/SLO dashboards.

### Restore validation checklist

- [ ] Restore the latest non-production backup into an isolated validation database.
- [ ] Validate required extensions and indexes are present or can be recreated from migrations.
- [ ] Query representative source, document, chunk, embedding, symbol, and metadata rows.
- [ ] Verify ACL metadata is intact and stale/missing permission cases still default-deny.
- [ ] Run a retrieval fixture against restored data and confirm the fixture does not bypass ACLs.
- [ ] Record restore evidence and retrieval fixture outcome in immutable audit.

## Object storage checklist

Object storage contains artifacts, source snapshots, generated docs, trace bundles, eval artifacts, and backup exports when approved.

### Backup design checklist

- [ ] Classify buckets by artifact type, sensitivity, retention, and archive requirement.
- [ ] Define object versioning or snapshot/export strategy before production.
- [ ] Define lifecycle rules for hot retention, archive transition, and deletion eligibility.
- [ ] Ensure bucket credentials are scoped and stored only as Railway secrets.
- [ ] Ensure object keys include safe project/artifact/version structure without secrets.
- [ ] Ensure audit events link artifact writes, deletes, retention changes, and restore tests.

### Restore validation checklist

- [ ] Copy or restore a representative non-production artifact set into an isolated validation bucket/prefix.
- [ ] Verify checksums, content type, object metadata, and access policy.
- [ ] Verify eval artifact links and trace bundle links resolve after restore.
- [ ] Verify unauthorized credentials cannot read restored objects.
- [ ] Record validation bucket/prefix, object count, checksum sample, owner, and outcome in immutable audit.
- [ ] Remove validation objects or quarantine them according to retention policy.

## Neo4j Community volume checklist

Neo4j Community stores graph traversal data derived from ACL-bearing knowledge/indexing pipelines.

### Backup design checklist

- [ ] Select export/import or volume snapshot approach supported by the Railway service design.
- [ ] Record graph schema/index definitions, import commands, and compatibility with the selected Neo4j version.
- [ ] Treat Knowledge Postgres as the source of truth for ACL-bearing metadata unless a later ADR states otherwise.
- [ ] Ensure graph exports do not include secrets or raw private payloads beyond approved derived metadata.
- [ ] Emit backup and import/export status metrics for the retrieval dashboard.

### Restore validation checklist

- [ ] Restore a representative export or volume snapshot into an isolated Neo4j validation service.
- [ ] Verify graph indexes/constraints and representative node/edge counts.
- [ ] Verify graph entities preserve `project_id`, `acl_scope_hash`, source reference, and `index_version` where represented.
- [ ] Run a graph traversal fixture and confirm ACL-bound graph materialization still default-denies stale/missing permissions.
- [ ] Cross-check restored graph counts with Knowledge Postgres source metadata.
- [ ] Record restore evidence and fixture outcome in immutable audit.

## Retention, archive, and partition candidates

High-volume append-only tables must be reviewed before production. Archive workflows must preserve immutable audit semantics: archive/export may copy records to approved storage, but source audit records must not be updated or deleted by runtime roles.

| Candidate | Store | Initial retention / archive decision to make before production | Partition candidate | Audit immutability tie |
|---|---|---|---|---|
| `audit_event` | Operational Postgres | Longest retention; archive/export only through approved compliance path. | Time-based partitions by `created_at` plus optional project-safe indexes. | Append-only; runtime roles insert only, no update/delete; archive must not rewrite event content. |
| `request_log` | Operational Postgres | Shorter hot retention with aggregate/archive strategy for operational analysis. | Time-based partitions by `created_at`; indexes on safe `project_id`, `route_id`, `trace_id`. | Request logs reference immutable audit events for decisions; sensitive payloads excluded. |
| `workflow_event` | Operational Postgres | Hot retention for active operations, archive completed histories by workflow age. | Time-based or workflow-run partitions after write-rate review. | Workflow state changes with security impact require immutable audit links. |
| `cost_event` | Operational Postgres | Retain hot cost records for budget enforcement; archive aggregates and raw events per finance/security policy. | Time-based partitions by `created_at`; indexes on provider/model/route/project. | Cost events for production actions must correlate to audit and trace IDs. |
| `eval_run` | Operational Postgres + object storage artifacts | Retain gate-result metadata needed for production enablement; archive large artifacts to object storage. | Time-based partitions by `created_at` and/or dataset/gate indexes. | Gate records that enabled production are immutable evidence and must not be pruned without approved replacement evidence. |
| `trace_ref` | Operational Postgres / observability backend | Keep references long enough to link audit and incident evidence; large trace payloads live outside Postgres. | Time-based partitions if persisted at high volume. | Trace references must preserve audit correlation. |
| `metric` | Operational Postgres if persisted, otherwise Prometheus | Prefer Prometheus for high-volume metrics; persist only required rollups. | Time-based partitions only if table is implemented. | Metrics are supporting evidence, not a replacement for immutable audit. |

## Restore evidence template

| Field | Required value |
|---|---|
| Store | Operational Postgres, Knowledge Postgres, object storage, or Neo4j Community. |
| Backup identifier | Provider backup ID, export object URI, snapshot ID, or equivalent non-secret reference. |
| Validation target | Non-production database/service/bucket/prefix. |
| Data class | Safe classification used for validation data. |
| Commands/checks | Command names and versions, with secrets redacted. |
| Start/end time | `TIMESTAMPTZ` values. |
| Owner | Accountable owner role or named owner. |
| Outcome | Passed, failed, or blocked. |
| Audit event ID | Immutable audit event or planned audit event reference. |
| Follow-up | Required remediation before production. |

## Non-enablement statement

This plan defines backup and restore readiness only. It does not create Railway databases, buckets, services, volumes, snapshots, credentials, or production backups, and it does not approve production deployment.
