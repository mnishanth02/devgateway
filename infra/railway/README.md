# Railway conventions for Phase 0.2

Track 0 keeps Railway first without provisioning production. Configuration is represented as reviewed files and secret-free examples before any dashboard mutation.

## Environments

| Environment | Purpose | Provisioning gate |
|---|---|---|
| `development` | Local and Railway development services. | Allowed after normal review. |
| `production` | First-release production services. | Disabled until explicit Track 0 approval. |

Set `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true` in every example and initial Railway environment.

## Variable groups and classification

| Group | Examples | Classification |
|---|---|---|
| Auth | `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_TRUSTED_ORIGINS` | URL/origins public or internal; secret is secret. |
| Database | `OPERATIONAL_DATABASE_URL`, `KNOWLEDGE_DATABASE_URL`, migration/read-only URLs | Secret. |
| Redis | `REDIS_URL`, queue/rate-limit namespaces | URL secret; namespaces internal. |
| Bifrost/provider | `BIFROST_*`, provider API keys, break-glass flags | Tokens/API keys secret; route versions internal. |
| GitHub App | app ID, installation ID, private key, webhook secret | IDs internal; private key/webhook secret secret. |
| Object storage | S3 endpoint, bucket, region, access key, secret key | Endpoint/bucket internal; keys secret. |
| Observability | OTel endpoint, headers, service name, sampling, metrics mode | Endpoint internal; headers secret. |
| Eval | dataset path, gate mode, artifact bucket, provider mode | Internal. |
| Encryption | app encryption key, credential key version, audit salt | Key/salt secret; version internal. |

Use `variables.example.env` as the Railway variable matrix seed. Prefer Railway reference variables for managed stores (for example `${{OperationalPostgres.DATABASE_URL}}`) and avoid copying generated secrets into source control.

## Service command plan

Railway services that import shared packages should keep full repository context and use filtered commands. Do not set restrictive root directories until package boundaries are finalized.

| Service | Build/start convention | Health/readiness |
|---|---|---|
| Bifrost gateway | Upstream Docker/Go runtime plus generated config. | `/health` or upstream equivalent before ingress. |
| Control API | `pnpm --filter <control-api> build` / service start command. | API health endpoint plus `pnpm db:check`. |
| Admin portal | `pnpm --filter <admin-portal> build` / web start command. | Static/web health plus auth origin checks. |
| Workers/eval | Filtered package build, worker start command, fixture mode by default. | Queue/database connectivity and `pnpm eval:smoke`. |

## CI/readiness command plan

Readiness gates align to root commands and should run in this order:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `pnpm db:check`
6. `pnpm registry:validate`
7. `pnpm policy:validate`
8. `pnpm eval:smoke`

Production deploys remain blocked unless all commands pass and the production gate variables are intentionally changed during an approved release.
