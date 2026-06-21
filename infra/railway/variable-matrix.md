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
| Secrets/encryption | Platform security owner | app encryption key, audit correlation salt | credential key version, rotation-required flag | Key versioning, rotation controls, and audit correlation approved. |

## Rotation notes

- Provider keys and break-glass credentials rotate after every break-glass event and suspected exposure.
- Virtual keys rotate by issuing replacement keys, revoking old keys, and auditing active sessions.
- Database, Redis, S3, GitHub App, and OTLP credentials rotate through Railway variables or upstream managed credential lifecycles.
- `CREDENTIAL_KEY_VERSION` increments for each encryption-key rollout; encrypted credential records must be re-encrypted before old key retirement.
- Non-secret version variables such as `BIFROST_ROUTE_CONFIG_VERSION` and `BIFROST_POLICY_VERSION` rotate with approved registry/policy snapshots and must be validated before startup. `BIFROST_CONFIG_PATH` changes only with reviewed host evidence and `/app/data/config.json` mount strategy and must match the generated artifact evidence.

## Operator workflow

1. Review the JSON matrix and confirm the group owner for the target environment.
2. For development, set only reviewed placeholders or Railway reference variables.
3. For production, obtain explicit Track 0 production approval before provisioning or setting variables.
4. Run registry, policy, eval, and workspace validation before enabling any production route/provider behavior.
5. Record rotations and production approvals in audit/change-control artifacts.
