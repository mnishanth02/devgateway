# Railway monorepo deploy plan

This Phase 0.8 plan defines how Railway should build and start DevGateway services from the monorepo without production provisioning. It is Railway-first, but all commands preserve portable container, Postgres, Redis, S3, OTLP, Prometheus, and Grafana boundaries.

## Full-repo build strategy

1. Link each Railway app/worker service to the repository root, not a restrictive service root directory.
2. Use service-specific build and start commands so shared packages remain available while unrelated changes do not redeploy every service.
3. Keep root dependency installation deterministic: `corepack enable && pnpm install --frozen-lockfile` for Node services before the service build command.
4. Python worker services keep the repository root as context and compile the worker package path directly until a shared Python workspace lockfile is introduced.
5. Production deploys remain disabled until Track 0 approval. Development deploys must use fixture/sandbox variables by default.

## Filtered build/start commands

| Railway service | Build command | Start command | Notes |
|---|---|---|---|
| Bifrost gateway | Approved upstream image pinned by digest | Upstream Bifrost image default command (`/app/main`) through its entrypoint; mount validated config as `/app/data/config.json` | Pin image digests before production; config sync remains a reviewed artifact. |
| Control API | `pnpm turbo run build --filter=@devgateway/control-api...` | `pnpm --filter @devgateway/control-api start` | Package must provide `build`, `start`, and `health` scripts before deployment. |
| Admin portal | `pnpm turbo run build --filter=@devgateway/admin-portal...` | `pnpm --filter @devgateway/admin-portal start` | Package must provide web build/start scripts before deployment. |
| Tool Broker | `pnpm turbo run build --filter=@devgateway/tool-broker...` | `pnpm --filter @devgateway/tool-broker start` | MCP endpoint cannot enable production tools without policy/eval gates. |
| Tool integration worker package | `pnpm turbo run build --filter=@devgateway/tool-integrations...` | Invoked by Tool Broker or a dedicated worker if split later | Keep watch patterns aligned if promoted to a separate Railway service. |
| Agent/workflow workers | `python -m compileall workers\agent-runtime\src` | `python -m devgateway_agent_runtime` | Add an explicit worker entrypoint and health sidecar before deployment. |
| Retrieval/indexing workers | `python -m compileall workers\retrieval-indexer\src` | `python -m devgateway_retrieval_indexer` | Add explicit queue consumer entrypoint before deployment. |
| Eval runner | `pnpm turbo run build --filter=@devgateway/eval-runner...` | `pnpm --filter @devgateway/eval-runner eval:smoke` | Runs as an on-demand job by default; provider mode stays `fixture`. |
| OpenTelemetry Collector | Pinned collector image | `otelcol-contrib --config=/etc/otelcol/config.yaml` | Config source must be reviewed before production. |
| Prometheus | Pinned Prometheus image | `prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus` | Requires retention/storage decision before production. |
| Grafana | Pinned Grafana OSS image | Grafana entrypoint with `GF_*` variables | Dashboards and datasource config should be exportable. |

## Watch pattern policy

| Service | Include patterns | Exclude/avoid redeploy triggers |
|---|---|---|
| Bifrost gateway | `infra\bifrost\**`, `packages\registry\**`, `packages\policy\**`, `packages\observability\**` | Admin portal and unrelated worker-only changes. |
| Control API | `apps\control-api\**`, `packages\config\**`, `packages\db\**`, `packages\schemas\**`, `packages\policy\**`, `packages\observability\**`, root lock/config files | Eval fixture-only changes unless API schema changes. |
| Admin portal | `apps\admin-portal\**`, `packages\shared-types\**`, `packages\config\**`, root lock/config files | Worker-only and DB migration-only changes. |
| Tool Broker | `apps\tool-broker\**`, `workers\tool-integrations\**`, `packages\schemas\**`, `packages\policy\**`, `packages\registry\**`, `packages\observability\**`, root lock/config files | Admin portal and retrieval-index data changes. |
| Agent/workflow workers | `workers\agent-runtime\**`, `packages\db\**`, `packages\schemas\**`, `packages\policy\**`, `packages\observability\**`, Python/root lock/config files | Portal-only changes. |
| Retrieval/indexing workers | `workers\retrieval-indexer\**`, `packages\db\**`, `packages\schemas\**`, `packages\policy\**`, `packages\observability\**`, Python/root lock/config files | Portal-only changes and eval dataset-only changes unless gate schemas change. |
| Eval runner | `workers\eval-runner\**`, `evals\**`, `packages\schemas\**`, `packages\observability\**`, root lock/config files | Portal-only changes. |
| Observability services | `packages\observability\**`, `infra\railway\**` | Application code changes that do not change emitted metrics/traces. |

Root lock/config files are `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, and `tsconfig.base.json`.

## Migration execution policy

- Migrations are not part of app `start` commands and must not run implicitly on boot.
- Development may run migrations through a reviewed one-shot Railway job after `pnpm db:check` passes and the target database is confirmed.
- Production requires explicit approval, backup/restore evidence, a dry-run/plan output, named operator, maintenance window decision, and rollback/forward-fix plan.
- Use separate Railway variables for app URLs and `DATABASE_MIGRATION_URL`; the migration role is not exposed to web, portal, broker, or worker runtime services.
- Prefer expand/migrate/contract changes and keep old app versions compatible until all services are healthy.

## Health and deploy gates

Minimum pre-deploy checks for a development service are:

1. `pnpm workspace:validate`
2. `pnpm typecheck` or the service-specific equivalent once available
3. Service build command
4. Store/protocol health checks for dependencies
5. Service `/healthz` and `/readyz`, or documented upstream equivalent

Production deploys additionally require Track 0 approval, named owners, reviewed secrets, backup/restore validation, observability availability, and disabled-by-default production routes/tools/retrieval/provider aliases.
