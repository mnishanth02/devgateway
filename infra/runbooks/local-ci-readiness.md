# Local and CI readiness command conventions

Phase 0.2 defines command expectations only; it does not provision production.

## Local development matrix

| Command | Local purpose | Required before |
|---|---|---|
| `pnpm local:setup` | First-clone bootstrap: install pnpm dependencies, create `.env.local` from `.env.local.example` when missing, and run workspace validation. | Local development. |
| `pnpm local:dev deps` | Start local dependency containers under the `devgateway-local` Compose project. | App hot reload. |
| `pnpm local:dev backend` | Start dependency containers and backend host hot reload for Control API and Tool Broker. | Backend development. |
| `pnpm local:dev frontend` | Start dependency containers and Admin Portal host hot reload. | Frontend development. |
| `pnpm local:dev all` | Start dependency containers plus backend and frontend hot reload profiles. | Full local development. |
| `pnpm local:stop [profile]` | Stop tracked DevGateway local processes and, for `deps`/`all`, dependency containers. | Switching profiles or cleanup. |
| `pnpm local:status` | Print tracked ports, host process state, and Docker Compose status. | Local troubleshooting. |
| `pnpm local:reset --yes` | Remove DevGateway local containers and volumes after explicit confirmation. | Destructive local reset only. |
| `pnpm workspace:validate` | Validate root workspace tooling and locked schema catalog wiring. | Pull request. |
| `pnpm lint` | Check formatting/lint rules once tooling exists. | Pull request. |
| `pnpm typecheck` | Validate TypeScript service/package contracts. | Pull request. |
| `pnpm test` | Run unit and contract tests. | Pull request. |
| `pnpm build` | Build deployable app/package artifacts. | Railway deployment. |
| `pnpm eval:smoke` | Run fixture-mode eval smoke checks. | Registry/provider route changes. |
| `pnpm db:check` | Validate migration/schema compatibility. | DB-dependent service deployment. |
| `pnpm registry:validate` | Validate model/provider registry and production route gates. | Bifrost/provider changes. |
| `pnpm policy:validate` | Validate data-class matrix, denial taxonomy, and gate references. | Policy or gateway changes. |

## CI/readiness order

CI should run a single readiness lane in this order:

1. `pnpm workspace:validate`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`
6. `pnpm db:check`
7. `pnpm registry:validate`
8. `pnpm policy:validate`
9. `pnpm eval:smoke`

`workspace:validate` runs the root tooling validator and the schema catalog sanity check so the readiness lane cannot pass without validating the Phase 0.2 contracts. `registry:validate` and `policy:validate` must pass before any production route or provider alias is enabled. `eval:smoke` runs in fixture/provider-fixture mode until live-provider eval approval exists.

## One-command local bootstrap behavior

Local setup uses `scripts/devgateway-dev.mjs` as the single entrypoint. App hot reload runs on the host using package-level `dev` scripts. Dependency services run in `docker-compose.local.yml` so local databases, Redis, object storage, graph storage, and observability can be started in one step without containerizing every source edit.

The launcher owns only DevGateway local state:

- Runtime metadata is stored in `.devgateway/runtime.json`, which must not be committed.
- `.env.local` is generated once from `.env.local.example` and is never overwritten by the launcher.
- The Docker Compose project name is `devgateway-local`.
- A repeated run may stop a port owner only when that process matches previously recorded DevGateway runtime metadata.
- Unknown port owners are never killed automatically; the launcher fails closed with a conflict message.

### Local port block

| Component | Host port |
|---|---:|
| Control API | 43100 |
| Admin Portal | 43101 |
| Tool Broker | 43102 |
| Bifrost placeholder URL | 43180 |
| Operational Postgres | 45432 |
| Knowledge Postgres | 45433 |
| Redis | 46379 |
| MinIO API | 49000 |
| MinIO Console | 49001 |
| Neo4j HTTP | 47474 |
| Neo4j Bolt | 47687 |
| OTel gRPC | 44317 |
| OTel HTTP | 44318 |
| OTel health | 43133 |
| Prometheus | 49090 |
| Grafana | 43030 |

## CI environment conventions

- Use `.env.example` and `infra/railway/variables.example.env` as the variable contract.
- CI secrets must be injected by the CI platform or Railway, never committed.
- Better Auth secret, database URLs, Redis URL, provider keys, GitHub App private key/webhook secret, object storage keys, OTel headers, encryption key, and audit salt are secret-classified.
- Production provisioning is gated by `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true`.
- CI may validate production configuration shape, but must not create production Railway services or stores.
