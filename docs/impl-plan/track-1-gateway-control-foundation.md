# Track 1 - Gateway and Control Foundation Implementation Plan

## 1. Executive summary

Track 1 turns the Track 0 governance baseline into a non-production gateway and control-plane foundation. It should make model traffic routeable through Bifrost in development, issue and revoke principal-bound virtual keys through the Control API, enforce provider/data-class/budget policy, emit per-request audit/cost/latency telemetry, and prove OpenAI and Anthropic client compatibility through smoke evals.

Track 1 must not enable production model routes, provider credentials, break-glass access, Railway production provisioning, durable workflows, retrieval, MCP tool execution, or semantic cache reuse. Formal Track 0 exit is not approved yet: `docs\governance\track-0-exit-decision.md` records that owner assignment approval and break-glass approval remain blocking. Track 1 can continue non-production implementation and validation, but production enablement remains fail-closed until the Track 0 blockers and Track 1 gates are satisfied.

The plan below incorporates the existing roadmap, current repository state, Track 0 governance artifacts, and two model reviews:

| Reviewer | High-signal contribution | Resolution in this plan |
|---|---|---|
| Claude Opus 4.8 | Reordered the track around missing contracts, DB schema, control plane, then gateway; flagged Track 0 exit blockers. | Adopted. Phase 1.0 resolves missing contracts before persistent implementation. |
| Gemini 3.1 Pro | Emphasized Bifrost deployment, config reload/sync, gateway smoke tests, and admin portal scope risk. | Adopted with corrections: admin portal stays in Track 1 because roadmap locks it, but remains minimal; portal stack stays Vite + React + TanStack, not Next.js. |

## 2. Current-state analysis

### Repository and tooling baseline

| Area | Current state |
|---|---|
| Monorepo | pnpm workspaces with Turborepo; apps under `apps\*`, shared packages under `packages\*`, workers under `workers\*`. |
| Runtime | Node.js `>=22.0.0`, pnpm `>=11.0.0`; root `packageManager` is `pnpm@11.8.0`. |
| Root commands | `lint`, `typecheck`, `test`, `build`, `eval:smoke`, `db:check`, `registry:validate`, `policy:validate`, and local launcher commands exist. |
| Track 0 validation | `docs\governance\track-0-readiness-validation.md` records passing validation commands and negative gate checks. |
| Track 0 exit | `docs\governance\track-0-exit-decision.md` says formal exit is not approved due to pending break-glass approval and owner assignment approval. |

### Existing packages and skeletons

| Surface | Current state | Track 1 implication |
|---|---|---|
| `apps\control-api` | Raw `node:http` `/healthz` and `/readyz` skeleton. Better Auth baseline modules exist, but `server.ts` does not mount auth routes or DB-backed sessions. | Replace or wrap with Fastify/OpenAPI before adding control endpoints. |
| `apps\admin-portal` | Rawk Node HTML skeleton. | Build minimal Vite + React + TanStack operational portal. |
| `apps\tool-broker` | Health skeleton only. | Out of Track 1 except health/observability compatibility; Tool Broker feature work belongs to later tracks. |
| `packages\db` | Conventions and metadata only; no Drizzle schema, migrations, or live DB checks. | Critical path for auth, virtual keys, budgets, costs, audit, gate evidence. |
| `packages\config` | Auth and retrieval env validation exists. | Extend with gateway, Bifrost, DB, Redis, and observability env validation. |
| `packages\registry` | v0.1 schema, disabled model aliases, validator. | Populate non-production provider candidates and generate Bifrost snapshots/config. |
| `packages\policy` | Provider data-class matrix and evaluator exist. | Extend to runtime budget/rate-limit decisions and gateway envelope evaluation. |
| `packages\observability` | Placeholder package only. | Implement OpenTelemetry, audit, cost, and structured logging helpers. |
| `workers\eval-runner` | Fixture-mode eval runner and smoke command exist. | Extend smoke evals to gateway/model compatibility and degraded-mode evidence. |

### Governance artifacts Track 1 must implement

| Artifact | Track 1 usage |
|---|---|
| `docs\governance\gateway-policy-enforcement-contract.md` | Request context envelope, Bifrost/platform boundary, denial taxonomy, audit shape, fail-closed behavior. |
| `docs\governance\model-provider-registry.md` | Registry remains the source of truth for aliases, candidates, policy, eval gate state, and Bifrost config provenance. |
| `docs\governance\provider-data-class-policy.md` | Deterministic data-class routing order and typed denial reasons. |
| `docs\governance\gate-result-persistence-contract.md` | Gate-result fields and validator matching rules. |
| `docs\governance\break-glass-design.md` | Pending approval; Track 1 must implement degraded-mode tests but cannot enable production break-glass. |
| `infra\bifrost\deployment-strategy.md` and `infra\bifrost\registry-sync-plan.md` | Bifrost runtime strategy, config generation/validation, freshness and fail-closed rules. |
| `infra\railway\service-matrix.md` and `infra\railway\variable-matrix.md` | Deployment and variable ownership; production stays disabled by default. |

## 3. Scope

### In scope

1. Lock missing Track 1 contracts for virtual keys, budget scope, cost events, and trace context.
2. Add operational Postgres migrations and typed schema ownership in `packages\db`.
3. Wire Control API to Better Auth, Operational Postgres, policy/registry packages, audit, and OpenAPI.
4. Implement non-production virtual key issuance, rotation, revocation, and validation metadata.
5. Implement budget/rate-limit policy decisions and cost/event persistence for gateway traffic.
6. Generate or validate Bifrost route/provider config from registry and policy snapshots.
7. Add local Bifrost service parity and Railway deployment-ready artifacts with pinned image digests.
8. Populate non-production OpenAI and Anthropic provider candidates under registry/policy gates.
9. Implement OpenTelemetry, Prometheus, audit, and cost telemetry surfaces.
10. Build a minimal admin portal for registry, virtual keys, budgets/spend, audit, and gateway health.
11. Add gateway/model smoke evals and IDE client compatibility evidence for supported clients.
12. Add fallback, budget, break-glass degraded-mode, and cache-scope leak tests.

### Out of scope

1. Production model/provider route enablement.
2. Railway production provisioning.
3. Production provider-key onboarding beyond secret-free configuration shape and local placeholders.
4. Durable workflow runtime implementation.
5. Agent orchestration, sub-agent execution, MCP tool policy, sandboxing, or side-effecting tools.
6. Repository retrieval, Knowledge Postgres schema implementation, GraphRAG, or memory service.
7. Semantic cache enablement. Track 1 only implements the cache-scope leak test and keeps cache disabled until it passes.

## 4. Resolved planning decisions

| Decision | Resolution | Rationale |
|---|---|---|
| API framework | Use Fastify 5 with OpenAPI 3.1 generation for Control API and later Tool Broker routes. | Track 0 locked Fastify + OpenAPI; raw Node HTTP skeleton should not grow production routes. |
| API validation style | Use Zod 4 schemas with Fastify type provider and generated OpenAPI/types. | Keeps runtime validation and TypeScript contracts aligned. |
| Operational DB tooling | Use Drizzle ORM and Drizzle Kit in `packages\db`. | Track 0 locked Drizzle ownership for Operational Postgres and Better Auth reconciliation. |
| Better Auth posture | Keep Better Auth OSS, upgrade cautiously to the current `1.6.x` line, and regenerate/reconcile schema. | Current npm registry check reports `better-auth` `1.6.20`; repo currently uses `^1.6.11`. |
| Admin portal stack | Use Vite + React 19 + TanStack Router/Query/Table/Virtual. | Track 0 locked React + TanStack and did not choose Next.js. |
| Bifrost runtime | Use upstream `maximhq/bifrost` image pinned by digest; do not build from TS/Python monorepo. | Matches Bifrost deployment strategy and keeps gateway runtime boundary explicit. |
| Rate-limit storage | Use Redis for short-lived rate limits/locks where supported, with Postgres as durable authority for budgets and audit. | Aligns with Track 0: Redis is not durable source of truth. |
| Config sync mechanism | Start with generated, versioned config files and startup/reload validation; add hot-reload only if Bifrost supports an atomic reload path verified by smoke tests. | Avoids inventing unsupported dynamic behavior while preserving fail-closed freshness. |
| Basic admin portal scope | Keep in Track 1, but limit to operational control views and no polished stakeholder UX. | Roadmap includes basic admin portal; scope risk is controlled by limiting features. |

## 5. Current-version baseline

These versions were checked during planning and should be rechecked at implementation time before changing lockfiles.

| Package/runtime | Current checked version | Track 1 recommendation |
|---|---:|---|
| `fastify` | `5.8.5` | Add to `apps\control-api`; use exact or tightly pinned range. |
| `@fastify/swagger` | `9.7.0` | Add for OpenAPI generation. |
| `@fastify/swagger-ui` | `6.0.0` | Add for non-production API docs. |
| `@fastify/type-provider-zod` | `1.0.0` | Add for Zod-backed routes. |
| `zod` | `4.4.3` | Add shared schema validation dependency. |
| `drizzle-orm` | `0.45.2` | Add to `packages\db` and dependent services. |
| `drizzle-kit` | `0.31.10` | Add as `packages\db` dev dependency. |
| `postgres` | `3.4.9` | Use as Drizzle Postgres driver unless `node-postgres` is explicitly needed. |
| `@opentelemetry/sdk-node` | `0.219.0` | Add to `packages\observability`. |
| `@opentelemetry/auto-instrumentations-node` | `0.77.0` | Add for Node service instrumentation. |
| OTLP HTTP exporters | `0.219.0` | Add trace and metric exporters. |
| `@tanstack/react-router` | `1.170.16` | Add to admin portal. |
| `@tanstack/react-query` | `5.101.0` | Add to admin portal. |
| `@tanstack/react-table` | `8.21.3` | Add to admin portal. |
| `@tanstack/react-virtual` | `3.14.3` | Add to admin portal if tables/lists need virtualization. |
| `vite` | `8.0.16` | Add to admin portal. |
| `react` | `19.2.7` | Add to admin portal. |
| `tailwindcss` | `4.3.1` | Optional for portal styling; use if adding Tailwind/shadcn-compatible UI. |
| `better-auth` | `1.6.20` | Upgrade from `^1.6.11` only with schema regeneration and auth smoke tests. |
| `turbo` | `2.9.18` | Consider a separate tooling refresh PR; root currently uses `^2.6.1`. |
| `typescript` | `6.0.3` | Do not upgrade as part of gateway work unless a dedicated compatibility pass is approved; repo currently uses `^5.9.3`. |
| Bifrost Docker | `maximhq/bifrost:v1.5.15` and `v1.5.15-ubi9` | Prefer `v1.5.15-ubi9@sha256:39c757944a55f4a15d27a4851c482084472fb4bc1e2f450f2d0fe2075d0905d2` or approved non-UBI digest. |

Pin hygiene to add in Track 1:

- Replace `quay.io/minio/minio:latest` and `otel/opentelemetry-collector-contrib:latest` in local compose with approved fixed tags and production digests.
- Keep `prom/prometheus:v2.54.1` and `grafana/grafana-oss:11.2.0` pinned, then add digest pinning for production deployment artifacts.
- Use `pnpm` for dependency changes; `npm view` emits warnings in this repo because `.npmrc` contains pnpm-specific keys.

## 6. Implementation workstreams

### Phase 1.0 - Lock missing gateway-control contracts

Goal: remove schema ambiguity before building persistent control-plane behavior.

Deliverables:

1. `docs\governance\virtual-key-model.md`
2. `docs\governance\budget-scope-model.md`
3. `docs\governance\cost-event-contract.md`
4. `docs\governance\trace-context-contract.md`
5. Matching JSON Schema additions under `packages\schemas\schemas\shared` or `packages\schemas\schemas\policy`
6. Type exports in `packages\shared-types` or package-local source files where appropriate

Required decisions:

| Contract | Required content |
|---|---|
| Virtual key model | Principal/project binding, fingerprint/hash storage, status, scope constraints, registry/policy version pinning, budget scope ref, expiry, rotation/revocation fields, last-used metadata, audit correlation. |
| Budget scope model | Org/team/project/user/virtual-key inheritance, budget reservation vs actual spend, reset periods, hard vs soft caps, budget denial semantics, rate-limit interaction. |
| Cost event contract | Estimated and actual token/cost fields, currency, provider, model alias, virtual key, budget scope, trace ID, request ID, gateway attempt, fallback attempt, and aggregation targets. |
| Trace context contract | W3C `traceparent` plus DevGateway headers, propagation from Control API to Bifrost to audit/cost/eval records, sampling fields, log correlation. |

Acceptance criteria:

- Gateway request context envelope has all fields required by `gateway-policy-enforcement-contract.md`.
- All four contracts map to concrete DB columns and API schemas.
- Production behavior remains explicitly disabled in schema defaults.

### Phase 1.1 - Implement Operational Postgres schema and migrations

Goal: create durable storage for Track 1 without drifting from Track 0 schema conventions.

Targets:

- `packages\db\package.json`
- `packages\db\drizzle.config.ts`
- `packages\db\src\schema\*.ts`
- `packages\db\migrations\*`
- `packages\db\src\index.ts`
- `apps\control-api\package.json`

Deliverables:

1. Drizzle schema and forward-only migrations for identity/tenancy basics: `org`, `team`, `project`, `principal`, `role`, `permission_grant`.
2. Better Auth tables reconciled into Operational Postgres with documented table naming and migration ownership.
3. Gateway/control tables: `virtual_key`, `budget_policy`, `budget_ledger`, `cost_event`, `request_log`, `audit_event`, `provider_snapshot`, `model_alias_snapshot`, `policy_snapshot`, `break_glass_activation`, `eval_gate_result`.
4. Append-only enforcement for `audit_event` and `eval_gate_result` through DB roles, triggers, or both.
5. `pnpm db:check` upgraded from metadata validation to migration validation against disposable/local Operational Postgres.
6. Seed policy separated into admin bootstrap seed and non-production fixtures.

Implementation notes:

- Operational Postgres is the only Track 1 database. Knowledge Postgres remains untouched.
- Use `BIGINT GENERATED ALWAYS AS IDENTITY` internally and UUIDv7 or prefixed opaque IDs externally.
- Do not run migrations automatically at app boot.
- Provider keys and break-glass secrets store ciphertext plus metadata only; plaintext is never persisted in DB, docs, fixtures, or logs.

Acceptance criteria:

- Migrations apply cleanly to local Operational Postgres.
- `audit_event` and `eval_gate_result` reject update/delete paths in the selected enforcement model.
- Better Auth smoke tests pass against the same schema used by Control API.

### Phase 1.2 - Build Control API foundation

Goal: make `apps\control-api` the source of human/session auth, admin APIs, virtual key lifecycle, registry/policy snapshots, budget controls, and audit events.

Targets:

- `apps\control-api\src\server.ts`
- `apps\control-api\src\routes\*.ts`
- `apps\control-api\src\auth\*.ts`
- `apps\control-api\src\policies\*.ts`
- `apps\control-api\src\openapi\*.ts`
- `packages\config\src\*.ts`
- `packages\observability\src\*.ts`

Deliverables:

1. Fastify server with `/healthz`, `/readyz`, OpenAPI 3.1 document, and non-production Swagger UI.
2. Mounted Better Auth routes under `/api/auth/*`.
3. Postgres-backed Better Auth adapter and Redis or Postgres-backed rate limiting; production memory rate limiting remains denied.
4. Immutable DB-backed `AuthAuditEmitter` replacing the current noop emitter.
5. Admin bootstrap flow with `AUTH_ADMIN_BOOTSTRAP_ENABLED=false` by default, explicit TTL, generic auth errors, and audit events.
6. TOTP/fresh-session enforcement for provider-key read, provider-key rotate, break-glass token mint, and production auth enablement.
7. Virtual key APIs:
   - create scoped key
   - list keys by project/principal
   - rotate key
   - revoke key
   - read key status without exposing secret material
8. Budget/cost APIs:
   - define budget policy
   - inspect current spend by org/team/project/user/virtual key
   - inspect cost event stream by trace/request
9. Registry/policy snapshot APIs:
   - current registry snapshot
   - current policy snapshot
   - generated Bifrost config artifact or validation report
   - snapshot checksum/freshness metadata
10. Typed error response shape for all denied control-plane mutations.

Acceptance criteria:

- `/api/auth/ok` works through the real server.
- OpenAPI document includes auth, virtual key, budget, registry, policy, health, and readiness routes.
- Missing auth, stale policy, revoked key, budget exhaustion, and production-disabled route responses use typed errors.
- No endpoint returns raw provider keys or raw virtual key secrets after initial issuance.

### Phase 1.3 - Implement registry, policy, and Bifrost config sync

Goal: make registry/policy artifacts the mechanical source of Bifrost route configuration.

Targets:

- `packages\registry\src\*.ts`
- `packages\registry\registry\model-aliases.v0.1.json`
- `packages\policy\src\*.ts`
- `packages\policy\policies\provider-data-class-matrix.v0.1.json`
- `infra\bifrost\*.yaml`
- `scripts\*.mjs` where config generation belongs

Deliverables:

1. Populate non-production OpenAI and Anthropic provider candidates for the relevant first-release aliases.
2. Preserve `production_enabled=false` and `production_route_allowed=false` until matching gate evidence and approvals exist.
3. Runtime loader for registry and provider data-class matrix.
4. Bifrost config generator:
   - reads registry snapshot
   - reads provider-policy snapshot
   - validates gate references
   - emits config with registry version, policy version, checksum, freshness deadline, and provider route candidates
5. Bifrost config validator:
   - fails missing or stale registry/policy versions
   - fails route/provider drift
   - fails unsupported denial reason
   - fails production-enabled route without matching gate result
6. Virtual-key metadata export or API shape for Bifrost enforcement.
7. Denial reason mapping for all gateway denial codes:
   - `budget`
   - `rate_limit`
   - `data_class`
   - `provider_lifecycle`
   - `eval_gate`
   - `policy_stale`
   - `route_disabled`
   - `approval_required`

Acceptance criteria:

- `pnpm registry:validate` and `pnpm policy:validate` fail production enablement without gate evidence.
- Generated config cannot reference an alias/provider absent from registry/policy.
- Config generation records checksums and exact versions used by Bifrost.

### Phase 1.4 - Add local and Railway Bifrost deployment readiness

Goal: run Bifrost locally and make the Railway service definition deployable without production enablement.

Targets:

- `docker-compose.local.yml`
- `.env.local.example`
- `infra\bifrost\bifrost.config.example.yaml`
- `infra\bifrost\deployment-strategy.md`
- `infra\bifrost\registry-sync-plan.md`
- `infra\railway\service-matrix.md`
- `infra\railway\variable-matrix.md`
- `scripts\devgateway-dev.mjs`

Deliverables:

1. Add local Bifrost service on port `43180`.
2. Pin Bifrost to approved version/digest, preferably `maximhq/bifrost:v1.5.15-ubi9@sha256:39c757944a55f4a15d27a4851c482084472fb4bc1e2f450f2d0fe2075d0905d2`.
3. Add local health/readiness checks to the launcher.
4. Wire `BIFROST_ROUTE_CONFIG_VERSION`, `BIFROST_POLICY_VERSION`, `BIFROST_CONFIG_PATH`, and provider-key placeholders.
5. Validate Bifrost refuses startup or route selection when config/policy/registry evidence is missing or stale.
6. Document reload behavior:
   - if atomic hot reload is supported, test it
   - if not, use restart-with-readiness promotion for Track 1 and record zero-downtime reload as an operations risk
7. Keep `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true`.

Acceptance criteria:

- Local profile can start dependencies plus Bifrost.
- Bifrost health passes only with valid non-production config.
- Missing policy/registry version causes fail-closed startup or readiness failure.

### Phase 1.5 - Implement observability, audit, and cost telemetry

Goal: make every gateway/control decision observable, attributable, and auditable.

Targets:

- `packages\observability\src\index.ts`
- `packages\observability\src\otel.ts`
- `packages\observability\src\audit.ts`
- `packages\observability\src\cost.ts`
- `infra\local\otel-collector.yaml`
- `infra\local\prometheus.yml`
- `infra\railway\observability-topology.md`

Deliverables:

1. Node OpenTelemetry SDK initialization helper.
2. OTLP HTTP trace and metric exporters.
3. Resource attributes: service name, environment, version, deployment, project where safe.
4. Structured audit event helper with gateway-contract fields.
5. Cost event helper that writes estimated and actual usage/cost.
6. Fastify request tracing middleware.
7. Drizzle/Postgres instrumentation or explicit spans around database operations.
8. Gateway metrics dimensions:
   - provider
   - model alias
   - virtual key
   - project
   - route intent
   - decision reason
   - fallback attempt
   - latency
   - cost estimate
9. Prometheus scrape target updates and Grafana dashboard plan for Track 1.

Acceptance criteria:

- A single local gateway request can be followed from incoming request to Bifrost decision to provider attempt to audit/cost records.
- Cost, latency, provider, model alias, and virtual key are visible per request.
- Audit sink unavailable causes fail-closed production behavior; non-production behavior is explicit and logged.

### Phase 1.6 - Build minimal admin portal

Goal: provide a safe operational UI for first-release admins without bypassing the Control API.

Targets:

- `apps\admin-portal\package.json`
- `apps\admin-portal\src\*`
- `packages\shared-types\src\*`
- `packages\config\src\*`

Deliverables:

1. Vite + React + TanStack Router app.
2. TanStack Query client against generated Control API types.
3. Authenticated admin layout using Better Auth session.
4. Views:
   - gateway health/readiness
   - model aliases/provider candidates and gate state
   - virtual keys and rotation/revocation actions
   - budgets and spend/cost events
   - audit events and denial reasons
   - break-glass status as pending/disabled unless approved
5. No direct DB, provider-key, or Bifrost-admin access from the portal.
6. TOTP/fresh-session guard on sensitive admin actions.

Acceptance criteria:

- Portal can show registry, key, budget, cost, audit, and gateway health data through Control API only.
- Portal build/typecheck/test fit Turborepo package-task conventions.
- Production portal remains gated by Better Auth secure origins, TOTP, and audit.

### Phase 1.7 - Add gateway/model smoke evals and client compatibility

Goal: prove the Track 1 gateway path works for supported clients and fails safely for denied cases.

Targets:

- `workers\eval-runner`
- `evals\datasets\gateway-model-smoke.v0.1.json`
- `evals\fixtures\gateway-model-smoke\*.json`
- `evals\datasets\cost-latency.v0.1.json`
- `evals\fixtures\cost-latency\*.json`
- `docs\governance\auth-smoke-test-plan.md`
- new Track 1 validation evidence under `docs\governance`

Deliverables:

1. Gateway/model smoke cases:
   - auth required
   - revoked/invalid virtual key denied
   - OpenAI `/v1/models`
   - OpenAI `/v1/chat/completions`
   - OpenAI SSE streaming shape
   - Anthropic `/v1/messages`
   - Anthropic SSE event shape
   - Anthropic `count_tokens` behavior
   - usage and cost attribution
   - error shape
   - fallback route
2. Provider data-policy cases through the gateway path.
3. Budget exhaustion and rate-limit denial cases.
4. Cache-scope leak test before any semantic cache enablement.
5. Break-glass degraded-mode cases from `docs\governance\break-glass-design.md`:
   - Bifrost unavailable creates/links pending request and fails closed
   - TTL expiry denies access
   - missing approval denies provider access
   - restricted data remains denied unless explicitly approved
   - repo retrieval cache remains blocked
   - side-effecting tools remain blocked
   - provider-key use emits immutable audit events
   - post-use provider-key rotation evidence is required
   - emergency route is disabled after recovery
6. Manual client smoke evidence for:
   - Continue
   - Cline
   - Kilo Code
   - Aider
   - Claude Code
   - Roo Code lineage where support is verified

Acceptance criteria:

- `pnpm eval:smoke` includes Track 1 gateway cases in fixture/local mode.
- Supported IDE clients pass their documented smoke tests.
- Unsupported or partial clients have explicit compatibility notes rather than silent assumptions.
- Fallback, budget, break-glass degraded mode, and cache-scope leak tests have recorded results.

## 7. Dependency order

Implementation should follow this dependency order:

1. Phase 1.0 contract lock
2. Phase 1.1 DB schema/migrations
3. Phase 1.2 Control API foundation
4. Phase 1.3 registry/policy/config sync
5. Phase 1.4 Bifrost local/Railway readiness
6. Phase 1.5 observability/cost/audit
7. Phase 1.6 minimal admin portal
8. Phase 1.7 smoke evals/client/degraded-mode validation

Parallel-safe work:

- Admin portal shell can begin after OpenAPI shape stabilizes.
- Observability package skeleton can begin once trace-context contract is locked.
- Bifrost compose/service edits can begin while DB work proceeds, but route enablement must wait for registry/policy/config validation.
- Eval fixture expansion can begin once the gateway request/response contracts are locked.

## 8. Validation command matrix

Track 1 implementation should preserve the root command pattern and add package tasks instead of root task logic.

| Command | Track 1 expectation |
|---|---|
| `pnpm workspace:validate` | Validate root tooling, schema catalog, eval layout, and generated OpenAPI/type artifacts. |
| `pnpm lint` | Run package lint tasks once lint tooling exists. |
| `pnpm typecheck` | Type-check Control API, admin portal, registry, policy, DB, observability, and shared types. |
| `pnpm test` | Run unit and contract tests for auth, policy, registry, DB, config, observability, and API routes. |
| `pnpm build` | Build/package app artifacts or run no-emit builds for skeleton packages according to Turborepo outputs. |
| `pnpm db:check` | Apply/validate Drizzle migrations against local/disposable Operational Postgres. |
| `pnpm registry:validate` | Validate registry schema, snapshots, provider candidates, and gate requirements. |
| `pnpm policy:validate` | Validate provider policy, denial taxonomy, data-class matrix, and production gate failures. |
| `pnpm eval:smoke` | Execute gateway/model smoke, cost-latency, fallback, budget, and safety fixtures. |
| `pnpm local:dev all` | Start dependencies, app services, Bifrost, and observability in development profile. |
| `pnpm local:status` | Show readiness for Control API, portal, Bifrost, DB, Redis, OTel, Prometheus, and Grafana. |

## 9. Track 1 exit criteria

Track 1 exits only when these conditions are met:

1. Formal Track 0 blockers are resolved or explicitly still marked as production blockers:
   - owner assignment approval
   - break-glass approval
2. All Track 1 production routes remain disabled unless a later explicit production release changes the gate.
3. Bifrost runs locally from an approved pinned image and validates generated registry/policy config before accepting traffic.
4. Control API exposes authenticated, typed, audited APIs for virtual keys, budgets, registry, policy, health, and readiness.
5. Operational Postgres migrations exist and pass `db:check`; audit and gate evidence tables are immutable by DB enforcement.
6. Registry and policy validators fail closed for production route enablement without matching passing gate evidence.
7. Provider/data-class policy is enforced for OpenAI and Anthropic non-production routes.
8. OpenAI-compatible and Anthropic-compatible endpoint smoke tests pass where supported.
9. Continue, Cline, Kilo Code, Aider, and Claude Code smoke tests pass where supported and are documented.
10. Cost, latency, provider, model alias, virtual key, trace ID, policy version, registry version, and decision reason are visible per request.
11. Fallback, budget, and break-glass degraded-mode tests pass or remain explicitly blocking.
12. Cache-scope leak test passes before semantic cache enablement.
13. Admin portal can manage/inspect keys, budgets, registry, audit, and gateway health through Control API only.
14. No production provider keys, provider routes, Railway production services, MCP tools, retrieval paths, or workflow paths are enabled by Track 1.

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Track 0 formal exit remains blocked | Production enablement cannot proceed | Treat Track 1 as non-production implementation; keep production gates disabled and visible. |
| DB/Better Auth reconciliation takes longer than expected | Blocks auth, keys, budgets, audit | Start Drizzle/Better Auth migration work immediately after Phase 1.0; keep migrations small and reviewed. |
| Bifrost config drift from registry | Wrong provider route or policy bypass | Generate/validate Bifrost config from signed/checksummed registry and policy snapshots. |
| Bifrost lacks atomic hot reload | Route updates may require restart | Validate support early; if absent, document restart-with-readiness promotion and keep zero-downtime reload as a future operations task. |
| Policy logic moves into Bifrost | Violates service boundary | Add tests that Bifrost denies missing platform envelope and cannot infer project/tool/approval policy. |
| Better Auth defaults drift across versions | Auth schema/security mismatch | Pin version, regenerate schema, run auth smoke tests, and keep secrets/origins/rate-limit checks strict. |
| Admin portal scope grows | Delays gateway foundation | Limit portal to operational Track 1 views; defer stakeholder UX and advanced dashboards. |
| Observability is added too late | Exit criteria cannot be proven | Implement trace/cost/audit helpers before route smoke tests, not after. |
| Semantic cache leaks across scope | Data exposure | Keep semantic cache disabled until cache-scope leak test passes. |
| `latest` container tags remain | Non-reproducible local/prod behavior | Pin Bifrost, MinIO, OTel Collector, Prometheus, and Grafana by tag/digest. |

## 11. Model-review disagreements resolved

1. Admin portal remains in Track 1 because the roadmap includes it. The scope is intentionally minimal and operational.
2. The portal uses Vite + React + TanStack, not Next.js, because Track 0 locked React + TanStack and explicitly deferred other portal choices.
3. Better Auth latest version is treated as the live npm registry result from this planning pass (`1.6.20`), not the model-suggested `1.10.x`.
4. Bifrost deployment is not first in the implementation order. It depends on contracts, DB schema, and registry/policy config generation.
5. Registry is not rebuilt from scratch. Track 1 extends the existing v0.1 registry with candidates, snapshots, config generation, and route validation.
6. Hot reload is a validation item, not an assumed design. Track 1 must test what the upstream Bifrost runtime actually supports.

## 12. Planning review log

Reviewed inputs:

- Existing codebase and Track 0 artifacts in this repository.
- `docs\04-technology-roadmap-operations.md` Track 1 roadmap.
- `docs\governance\track-0-exit-decision.md`.
- `docs\governance\gateway-policy-enforcement-contract.md`.
- `docs\governance\model-provider-registry.md`.
- `docs\governance\provider-data-class-policy.md`.
- `docs\governance\gate-result-persistence-contract.md`.
- `docs\governance\break-glass-design.md`.
- `infra\bifrost\deployment-strategy.md`.
- `infra\bifrost\registry-sync-plan.md`.
- `infra\railway\service-matrix.md`.
- `infra\railway\variable-matrix.md`.
- Opus 4.8 planning review.
- Gemini 3.1 Pro planning review.
- npm registry version checks for the recommended TypeScript/React/Fastify/Drizzle/OTel stack.
- Docker Hub tag check for `maximhq/bifrost`.
