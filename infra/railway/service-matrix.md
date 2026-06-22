# Railway service matrix

This Phase 0.8 artifact turns the Track 0 Railway deployment plan into a reviewed, secret-free service matrix. It is a plan only: it does not perform production provisioning, enable production routes, or create secrets.

## Environment ownership and gates

| Environment | Environment owner | Provisioning/deploy rule | Required gate state |
|---|---|---|---|
| `development` | Platform operations owner | Development services may be provisioned after normal review using Railway-managed references and fixture/sandbox variables. | `PRODUCTION_PROVISIONING_ENABLED=false`; production routes, provider aliases, retrieval, tools, and break-glass remain disabled. |
| `production` | Platform operations owner with Platform lead approval | No provisioning or deploy from this artifact. Production creation requires explicit approval, named owners, reviewed secrets, validated backups, and passing health gates. | `PRODUCTION_PROVISIONING_ENABLED=false` until an approved release intentionally changes it; `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true`. |

## Service owner, build/start/watch/health matrix

All app and worker services keep the full repository as Railway build context. Do not set restrictive service root directories while shared packages are imported.

| Service/store | Service owner | Environment owner | Build command | Start command | Railway watch patterns | Health/readiness expectation |
|---|---|---|---|---|---|---|
| Bifrost gateway | Platform architecture owner | Platform operations owner | Approved upstream image pinned by digest, for example `ghcr.io/maximhq/bifrost@sha256:<approved-bifrost-image-digest>`, or `docker build -f infra\bifrost\Dockerfile .` only for reviewed local fallback | Upstream Bifrost entrypoint with `-app-dir /app/data`; mount generated config as `/app/data/config.json`; local base URL `http://localhost:43180` | `infra\bifrost\**`, `packages\registry\**`, `packages\policy\**`, `packages\observability\**` | `/health` or upstream equivalent; fail closed if mounted config, registry evidence, policy evidence, provider-key references, or gate evidence cannot load or is stale. |
| Control API | Platform architecture owner | Platform operations owner | `pnpm turbo run build --filter=@devgateway/control-api...` | `pnpm --filter @devgateway/control-api start` | `apps\control-api\**`, `packages\config\**`, `packages\db\**`, `packages\schemas\**`, `packages\policy\**`, `packages\observability\**`, root lock/config files | `/healthz` for process/build; `/readyz` checks Operational Postgres, Redis, Bifrost, auth, and policy freshness. |
| Admin portal | Platform architecture owner | Platform operations owner | `pnpm turbo run build --filter=@devgateway/admin-portal...` | `pnpm --filter @devgateway/admin-portal start` | `apps\admin-portal\**`, `packages\shared-types\**`, `packages\config\**`, root lock/config files | `/healthz` or platform static health; verifies Control API URL and Better Auth trusted origin alignment. |
| Tool Broker | Platform architecture owner | Platform operations owner | `pnpm turbo run build --filter=@devgateway/tool-broker...` | `pnpm --filter @devgateway/tool-broker start` | `apps\tool-broker\**`, `workers\tool-integrations\**`, `packages\schemas\**`, `packages\policy\**`, `packages\registry\**`, `packages\observability\**`, root lock/config files | `/healthz` checks MCP endpoint, registry load, approval policy, Redis, and Operational Postgres. |
| Agent/workflow durable workers | Platform architecture owner | Platform operations owner | `python -m compileall workers\agent-runtime\src` and `pnpm --filter @devgateway/agent-runtime test` before any Railway deploy | Approved `@devgateway/agent-runtime` worker profile command only. Current profiles are `runtime-service`, `lease-retry-sweeper`, `cancellation-worker`, `approval-expiry-worker`, `outbox-worker`, `budget-reaper`, and `artifact-lifecycle-worker`; production Railway start commands remain unset until each profile has explicit approval, variables, and readiness evidence. | `workers\agent-runtime\**`, `packages\db\**`, `packages\schemas\**`, `packages\policy\**`, `packages\observability\**`, Python/root lock/config files | Worker heartbeat in Operational Postgres; profile readiness checks Operational Postgres, Redis lease namespace, object storage artifact access, Bifrost fail-closed gate state, and profile-specific backlog/TTL counters before promotion. |
| Retrieval/indexing workers | Platform architecture owner | Platform operations owner | `python -m compileall workers\retrieval-indexer\src` | `python -m devgateway_retrieval_indexer` | `workers\retrieval-indexer\**`, `packages\config\**`, `packages\db\**`, `packages\schemas\**`, `packages\policy\**`, `packages\observability\**`, Python/root lock/config files | Heartbeat plus Knowledge Postgres, pgvector, object storage, Neo4j, ACL metadata, retrieval toggle validity, context budget/compression controls, and embedding/reranker route state checks. |
| Eval runner | Evaluation owner | Platform operations owner | `pnpm turbo run build --filter=@devgateway/eval-runner...` | `pnpm --filter @devgateway/eval-runner eval:smoke` for job mode | `workers\eval-runner\**`, `evals\**`, `packages\schemas\**`, `packages\observability\**`, root lock/config files | Job exits 0 with gate-shaped results; daemon mode exposes `/healthz` and verifies fixture mode, Operational Postgres, and object storage writes. |
| Operational Postgres | Platform operations owner | Platform operations owner | Railway managed | Railway managed | `packages\db\**`, `docs\governance\schema-and-migration-conventions.md` | `pg_isready`, `SELECT 1`, and `pnpm db:check`; production requires backup/restore evidence before migrations. |
| Knowledge Postgres | Platform operations owner | Platform operations owner | Railway managed | Railway managed | `packages\db\**`, `workers\retrieval-indexer\**` | `pg_isready`, `SELECT 1`, and pgvector extension check before retrieval readiness. |
| Redis | Platform operations owner | Platform operations owner | Railway managed | Railway managed | `infra\railway\**` | `PING`; namespace and TTL smoke checks; Redis is not the durable source of truth. |
| Object storage | Platform operations owner | Platform operations owner | Railway bucket/S3 managed | Railway bucket/S3 managed | `infra\railway\**` | S3 `HeadBucket`/`ListBucket`; development write/read/delete smoke test under scoped prefix. |
| Neo4j Community | Platform operations owner | Platform operations owner | `neo4j:community` or approved pinned image | Neo4j container entrypoint with auth and volume variables | `infra\railway\**`, `workers\retrieval-indexer\**` | HTTP/Bolt readiness plus `RETURN 1`; import/export restore fixture before production. |
| OpenTelemetry Collector | Platform operations owner | Platform operations owner | Pinned `otel/opentelemetry-collector-contrib` image | `otelcol-contrib --config=/etc/otelcol/config.yaml` | `packages\observability\**`, `infra\railway\**` | Health extension on `:13133`; OTLP receivers on 4317/4318; exporter path verified. |
| Prometheus | Platform operations owner | Platform operations owner | Pinned `prom/prometheus` image | `prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus` | `packages\observability\**`, `infra\railway\**` | `/-/healthy` and `/-/ready`; scrape targets cover gateway, APIs, workers, and collector. |
| Grafana | Platform operations owner | Platform operations owner | Pinned `grafana/grafana-oss` image | Grafana entrypoint with `GF_*` variables | `packages\observability\**`, `infra\railway\**` | `/api/health`; dashboards load for gateway, workflow, retrieval, eval, cost, and SLO views. |

## Service variable group matrix

| Service/store | Variable groups |
|---|---|
| Bifrost gateway | Bifrost/provider, Redis, Observability, Secrets/encryption |
| Control API | Auth, Database, Redis, Bifrost/provider, GitHub App, Observability, Secrets/encryption |
| Admin portal | Auth, Observability |
| Tool Broker | Auth, Database, Redis, GitHub App, Observability, Secrets/encryption |
| Agent/workflow durable workers | Database, Redis, Object storage, Bifrost/provider, Observability, Eval, Durable worker controls, Secrets/encryption |
| Retrieval/indexing workers | Retrieval controls, Database, Object storage, Bifrost/provider, GitHub App, Observability, Eval, Secrets/encryption |
| Eval runner | Database, Object storage, Bifrost/provider, Observability, Eval |
| Operational Postgres | Database, Secrets/encryption |
| Knowledge Postgres | Database |
| Redis | Redis |
| Object storage | Object storage |
| Neo4j Community | Retrieval controls, Database, Object storage, Observability |
| OpenTelemetry Collector | Observability |
| Prometheus | Observability |
| Grafana | Observability, Auth |

Use `infra\railway\variables.example.env` as the secret-free variable seed. Prefer Railway reference variables such as `${{OperationalPostgres.DATABASE_URL}}`, `${{KnowledgePostgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`, and `${{ArtifactsBucket.S3_ENDPOINT}}` instead of copying generated credentials.

## Health endpoint expectations

- App services expose liveness at `/healthz` and readiness at `/readyz` unless an upstream image has a different documented equivalent.
- Worker services must publish a heartbeat in Operational Postgres; long-running workers should expose an HTTP sidecar `/healthz` and profile readiness before production.
- Durable worker readiness is profile-specific and fail-closed: `runtime-service` checks step claim/heartbeat capability, `lease-retry-sweeper` checks expired-lease scan and retry escalation counters, `cancellation-worker` checks cancellation propagation backlog, `approval-expiry-worker` checks approval TTL backlog, `outbox-worker` checks claim/ack/nack/dead-letter backlog, `budget-reaper` checks orphaned-reservation counters, and `artifact-lifecycle-worker` checks metadata/object-storage reconciliation without exposing signed URLs.
- Store checks are protocol-native and must be exercised by dependent service readiness checks.
- Bifrost readiness must prove the host evidence path, mounted `/app/data/config.json`, `BIFROST_ROUTE_CONFIG_VERSION`, `BIFROST_POLICY_VERSION`, registry checksum, policy checksum, and provider-key references before ingress promotion.
- Observability services must be self-checking before they are used as production gates: OTel `:13133`, Prometheus `/-/healthy` and `/-/ready`, Grafana `/api/health`.

## Durable worker profile operations

These profiles are development/release-candidate operations only until production approval is recorded. Do not create production Railway services or start commands from this matrix alone.

| Worker profile | Required stores/vars | Readiness signal | Metrics/backlog signal | Production blocker |
|---|---|---|---|---|
| `runtime-service` | `OPERATIONAL_DATABASE_URL`, `REDIS_URL`, object storage config, Bifrost disabled-route evidence | Claims and heartbeats one durable step without live providers; stops safely on lost lease. | `claimed_steps`, `completed_steps`, `failed_steps`, `idle_polls`, `recovered_stale_leases`, `lease_lost_steps`. | Side-effect handlers, production model/tool routes, and profile start command approval. |
| `lease-retry-sweeper` | `OPERATIONAL_DATABASE_URL`, lease TTL/heartbeat knobs | Scans expired leases and distinguishes pre-side-effect recovery from manual-review escalation. | `expired`, `recovered`, `escalated`, max lease age. | Alert thresholds and manual-review ownership. |
| `cancellation-worker` | `OPERATIONAL_DATABASE_URL`, cancellation batch/idle knobs | Propagates queued/running cancellations through steps, approvals, delegations, tool calls, agent runs, and reservations. | claimed/completed cancellations, manual-review escalations, released reservations. | Executor cancellation evidence and escalation runbook sign-off. |
| `approval-expiry-worker` | `OPERATIONAL_DATABASE_URL`, approval expiry batch/idle knobs | Expires overdue approvals by TTL and records fail-closed workflow state. | expired approval count, idle polls, oldest pending approval age. | Risk-tier TTL approval and operator queue review. |
| `outbox-worker` | `OPERATIONAL_DATABASE_URL`, outbox owner/batch/lease knobs, destination-specific safe consumers | Claims pending events and proves ack/nack/dead-letter fencing. | claimed, delivered, retried, dead-lettered, failed-fenced, destination backlog. | Real destination consumers and replay policy approval. |
| `budget-reaper` | `OPERATIONAL_DATABASE_URL`, budget reaper TTL/batch knobs | Releases orphaned reservations for expired approvals, expired leases, abandoned workflows, and terminal workflows. | inspected, orphaned, reconciled, released, release reason counters. | Budget owner approval and cost/audit reconciliation. |
| `artifact-lifecycle-worker` | `OPERATIONAL_DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, lifecycle batch/idle knobs | Reconciles metadata/object refs, retention, legal hold, redaction/deletion, and checksum state without reading object bodies or emitting signed URLs. | lifecycle events processed, object-missing/object-orphan counts, deletion/redaction/legal-hold counters. | Backup/restore proof, retention approval, and signed-access guard review. |

## Migration execution policy

- Never run schema migrations automatically at web or worker process boot.
- Development migrations run from a reviewed one-shot Railway job or local Railway-run context using `DATABASE_MIGRATION_URL` after `pnpm db:check` succeeds.
- Production migrations are explicit-approval gated and require backup/restore evidence, a dry-run or plan output, reviewed expand/migrate/contract sequencing, and a single-flight migration job.
- Post-migration checks are `pnpm db:check`, affected service readiness, and native store probes.
