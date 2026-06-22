# Railway variable matrix v0.1

This Phase 0.8 artifact translates the Track 0 Railway variable groups into a reviewed, secret-free matrix. `infra\railway\variable-matrix.v0.1.json` is the structured source for tooling; this document is the operator-readable summary.

## Global rules

- No real secrets are stored in this repository. Secret examples use Railway reference variables or `<secret:...>` placeholders only.
- Production provisioning is disabled by default: `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true`.
- Production Railway services, stores, variables, provider routes, and Bifrost ingress require explicit Track 0 production approval before creation or enablement.
- Local Bifrost uses `BIFROST_BASE_URL=http://localhost:43180`; Railway/development Bifrost image configuration must use an approved digest-pinned image and not a mutable tag.
- `development` is owned by the Platform operations owner. `production` remains owned by Platform operations with approval from platform, engineering, and security owners.
- All production route/provider changes must pass registry, policy, and eval gates before variables are changed.

## Group summary

| Group | Owner | Secret examples | Non-secret examples | Production gate |
|---|---|---|---|---|
| Auth | Platform security owner | `BETTER_AUTH_SECRET` | `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, bootstrap controls | Better Auth production origin, admin TOTP, invite-only bootstrap, and smoke tests approved. |
| Database | Database and migration owner | `OPERATIONAL_DATABASE_URL`, `KNOWLEDGE_DATABASE_URL`, migration/read-only URLs | None in v0.1 | Migration policy, least-privilege roles, backup/restore validation, and `db:check`. |
| Redis | Platform operations owner | `REDIS_URL` | `REDIS_QUEUE_NAMESPACE`, `REDIS_RATE_LIMIT_NAMESPACE` | Environment-isolated queues, locks, and rate-limit namespaces. |
| Bifrost/provider | Gateway owner | `BIFROST_ADMIN_TOKEN`, `BIFROST_VIRTUAL_KEY_SEED`, provider placeholders as `DEVGATEWAY_*_API_KEY_PLACEHOLDER` or Railway secret references only; do not expose literal upstream auto-detect names such as `OPENAI_API_KEY` before provider gates pass | `BIFROST_BASE_URL`, host-side evidence `BIFROST_CONFIG_PATH`, host-side runtime `BIFROST_RUNTIME_CONFIG_PATH`, container mount `BIFROST_CONTAINER_CONFIG_PATH=/app/data/config.json`, `BIFROST_ROUTE_CONFIG_VERSION`, `BIFROST_POLICY_VERSION`, break-glass flag; optional live-sync `BIFROST_POLICY_MAX_STALENESS_SECONDS` only when a runtime sync timestamp exists | Generated or validated config from registry and policy snapshots; missing/stale config, policy, registry, provider-key reference, or gate evidence fails startup/readiness closed. |
| GitHub App | SCM integration owner | private key, webhook secret | app ID, installation ID | Scope matrix, webhook validation, and stale-sync default-deny policy pass validation. |
| Object storage | Platform operations owner | S3 access and secret keys | endpoint, bucket, region, path-style flag | Backup/restore and least-privilege bucket access reviewed. |
| Observability | Observability owner | OTLP auth headers | endpoint, service name, resource attributes, sampling, metrics mode | OTel Collector, Prometheus, Grafana, retention, and dashboard ownership reviewed. |
| Eval | Evaluation owner | None in v0.1 | dataset path, gate mode, artifact bucket, provider mode, smoke flag | Matching passing eval gate results exist for production enablement. |
| Durable worker controls | Platform operations owner | None; workers reuse Database, Redis, Object storage, Bifrost/provider, Observability, and Secrets/encryption secret refs | `DURABLE_WORKERS_ENABLED`, worker owner IDs, batch sizes, lease TTLs, idle intervals, approval/budget/artifact TTLs | Durable worker services remain disabled-by-default; each worker profile needs explicit approval, readiness evidence, metrics, and backup/restore coverage before production. |
| Secrets/encryption | Platform security owner | app encryption key, audit correlation salt | credential key version, rotation-required flag | Key versioning, rotation controls, and audit correlation approved. |

## Rotation notes

- Provider keys and break-glass credentials rotate after every break-glass event and suspected exposure.
- Virtual keys rotate by issuing replacement keys, revoking old keys, and auditing active sessions.
- Database, Redis, S3, GitHub App, and OTLP credentials rotate through Railway variables or upstream managed credential lifecycles; durable worker profiles must be restarted or drained after rotation and must fail readiness until refreshed connections are healthy.
- `CREDENTIAL_KEY_VERSION` increments for each encryption-key rollout; encrypted credential records must be re-encrypted before old key retirement.
- Non-secret version variables such as `BIFROST_ROUTE_CONFIG_VERSION` and `BIFROST_POLICY_VERSION` rotate with approved registry/policy snapshots and must be validated before startup. `BIFROST_CONFIG_PATH` changes only with reviewed host evidence and `/app/data/config.json` mount strategy and must match the generated artifact evidence.

## Operator workflow

1. Review the JSON matrix and confirm the group owner for the target environment.
2. For development, set only reviewed placeholders or Railway reference variables.
3. For production, obtain explicit Track 0 production approval before provisioning or setting variables.
4. Run registry, policy, eval, and workspace validation before enabling any production route/provider behavior.
5. Record rotations and production approvals in audit/change-control artifacts.

## Durable worker variable requirements

Durable worker variables are a launch contract, not production enablement. Keep `DURABLE_WORKERS_ENABLED=false` unless a named non-production or production-candidate run explicitly opts in. Production services must not be created from these examples without the production approval gate.

| Worker profile | Required secret/service-reference variables | Required non-secret variables/knobs | Fail-closed rule |
|---|---|---|---|
| All durable worker profiles | `OPERATIONAL_DATABASE_URL`; `REDIS_URL` when leases/queues are used; `APP_ENCRYPTION_KEY_BASE64`; `AUDIT_CORRELATION_SALT`; OTLP headers when observability export is enabled | `PRODUCTION_PROVISIONING_ENABLED=false`, `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true`, `DURABLE_WORKERS_ENABLED=false`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `TRACE_SAMPLE_RATE`, `METRICS_EXPORT_MODE` | Missing Operational Postgres or production gates not set to disabled/approval-required prevents worker launch. |
| `runtime-service` | Same as all profiles; object storage config when handlers write artifacts | `WORKFLOW_WORKER_OWNER_ID`, `WORKFLOW_WORKER_IDLE_SLEEP_SECONDS`, optional `WORKFLOW_WORKER_MAX_STEPS` for one-shot drains | Must not call live providers/tools unless registry, policy, eval, and Bifrost gates pass. |
| `lease-retry-sweeper` | `OPERATIONAL_DATABASE_URL` | `LEASE_SWEEPER_INTERVAL_SECONDS`, lease TTL/heartbeat policy from the approved worker profile | Ambiguous or post-side-effect work escalates to manual review instead of retrying automatically. |
| `cancellation-worker` | `OPERATIONAL_DATABASE_URL` | `CANCELLATION_WORKER_BATCH_SIZE`, `CANCELLATION_WORKER_IDLE_SLEEP_SECONDS` | Partial cancellation must create manual-review evidence and release only safe reservations. |
| `approval-expiry-worker` | `OPERATIONAL_DATABASE_URL` | `APPROVAL_EXPIRY_WORKER_BATCH_SIZE`, `APPROVAL_EXPIRY_WORKER_IDLE_SLEEP_SECONDS`, approved risk-tier TTL policy | Expired approvals deny/resume-fail closed; no default approval is inferred. |
| `outbox-worker` | `OPERATIONAL_DATABASE_URL`; destination credentials only after destination approval | `OUTBOX_WORKER_OWNER_ID`, `OUTBOX_WORKER_BATCH_SIZE`, `OUTBOX_WORKER_LEASE_TTL_SECONDS` | Missing consumer config nacks/retries or dead-letters; it must not silently drop events. |
| `budget-reaper` | `OPERATIONAL_DATABASE_URL` | `BUDGET_REAPER_BATCH_SIZE`, `BUDGET_REAPER_IDLE_SLEEP_SECONDS`, `BUDGET_REAPER_APPROVAL_WAIT_TTL_SECONDS`, `BUDGET_REAPER_ABANDONED_WORKFLOW_SECONDS` | Releases only reconciled orphan reservations and records reason counters/audit evidence. |
| `artifact-lifecycle-worker` | `OPERATIONAL_DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; optional Railway bucket references such as `${{ArtifactsBucket.S3_ENDPOINT}}` | `S3_FORCE_PATH_STYLE`, `ARTIFACT_LIFECYCLE_BATCH_SIZE`, `ARTIFACT_LIFECYCLE_IDLE_SLEEP_SECONDS`, approved retention/legal-hold policy | Metadata/object mismatches quarantine or escalate; signed URLs are never emitted by worker readiness or metrics. |

Object storage config is required anywhere artifact bodies, trace bundles, eval artifacts, or backup exports are touched. `OPERATIONAL_DATABASE_URL` remains the durable source of truth for workflow state, approvals, outbox state, budget reservations, artifact metadata, audit, and worker readiness.
