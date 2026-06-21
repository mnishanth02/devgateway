# Track 2 validation evidence

Status: Phase 2.1 through Phase 2.10 evidence snapshot  
Scope: non-production contract, database, Control API, workflow runtime, fixture execution, budget-accounting, read-only Tool Broker, skill registry, task trace UI, fixture evals, and final review evidence only. This document does not enable production model routes, provider keys, write tools, retrieval, memory, or production skills.

## Phase 2.1 contract and schema lock

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Agent orchestration schemas | `packages\schemas\schemas\agent\*.schema.json` | Implemented | Covers agent definitions/runs, delegations, sub-agent results, workflow state/events, task artifacts, tool calls, and skill definitions. |
| Schema catalog | `packages\schemas\schemas\index.v0.1.json`, `packages\schemas\src\index.ts` | Implemented | Agent schemas are cataloged and resolvable by the schema package validator. |
| Shared Track 2 contracts | `packages\shared-types\src\agent-workflow.ts` | Implemented | Adds workflow, delegation, artifact, tool, skill, idempotency, and metadata-safety contract types. |
| Shared gateway/control extensions | `packages\shared-types\src\gateway-control.ts` and shared JSON schemas | Implemented | Adds workflow/delegation/tool-class budget scopes, Track 2 route intents, trace components, denial reasons, and cost aggregation refs. |

## Phase 2.2 database and migration foundation

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Drizzle operational schema | `packages\db\src\schema\operational.ts` | Implemented | Adds Track 2 workflow, agent, delegation, result, step, attempt, event, lease, idempotency, artifact, tool, and skill tables. |
| Migration | `packages\db\migrations\0001_abandoned_talos.sql`, `packages\db\migrations\meta\0001_snapshot.json`, `packages\db\migrations\meta\_journal.json` | Implemented | Includes Track 2 tables and budget/cost extensions. The migration commit is `6558db5 Add Track 2 database migration`. |
| DB invariant checks | `packages\db\src\check.ts` | Implemented | Adds offline checks for workflow event append-only shape, idempotency uniqueness, Track 2 budget scopes, and metadata-only artifact storage. |
| Non-production fixtures | `packages\db\src\seeds\non-production-fixtures.ts` | Implemented | Adds refs-only Track 2 fixture catalog metadata; production and secret/provider-key flags remain disabled. |

## Phase 2.3 Control API task/workflow surface

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Task routes | `apps\control-api\src\routes\tasks.ts` | Implemented | Adds non-production task create/read/cancel-request endpoints with auth-first handling, critical scope fields, idempotency, and metadata-only responses. |
| Artifact route | `apps\control-api\src\routes\artifacts.ts` | Implemented | Adds task artifact metadata listing; responses exclude object bodies, signed URLs, raw prompts, context bodies, provider keys, and secrets. |
| Workflow routes | `apps\control-api\src\routes\workflows.ts` | Implemented | Adds workflow read and cursor-paginated event endpoints. |
| Agent run route | `apps\control-api\src\routes\agent-runs.ts` | Implemented | Adds sanitized agent-run metadata endpoint for trace inspection. |
| Skill route | `apps\control-api\src\routes\skills.ts` | Implemented | Adds non-production skill listing with filter support and policy/rollout refs only. |
| Shared in-memory store | `apps\control-api\src\routes\agent-workflow-store.ts` | Implemented | Provides injectable non-production store and fixture state for route tests and local preview. |
| Server/OpenAPI mounting | `apps\control-api\src\server.ts`, `apps\control-api\src\openapi\document.ts` | Implemented | Mounts Track 2 routes only outside production and advertises them in the non-production OpenAPI document. |
| Route/server tests | `apps\control-api\src\routes\control-routes.test.ts`, `apps\control-api\src\server.test.ts` | Implemented | Covers task lifecycle, artifact sanitization, workflow event pagination, agent-run/skill reads, fail-closed auth/production behavior, and OpenAPI paths. |

## Phase 2.4 workflow runtime skeleton

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Runtime contracts | `workers\agent-runtime\src\devgateway_agent_runtime\contracts.py` | Implemented | Defines fixture-safe workflow, step, trace, event, and state-transition contracts. |
| Repository boundary | `workers\agent-runtime\src\devgateway_agent_runtime\repositories.py`, `workers\agent-runtime\src\devgateway_agent_runtime\memory.py` | Implemented | Keeps runtime business logic behind repository interfaces and provides an in-memory fixture repository. |
| Idempotency and leases | `workers\agent-runtime\src\devgateway_agent_runtime\idempotency.py`, `workers\agent-runtime\src\devgateway_agent_runtime\leases.py` | Implemented | Models idempotency records, replay behavior, lease acquire/heartbeat/release, and stale-lease recovery. |
| Dispatcher | `workers\agent-runtime\src\devgateway_agent_runtime\dispatcher.py` | Implemented | Claims bounded pending steps, applies polling/backoff policy, heartbeats leases, and records opaque refs. |
| Fixture workflow runner | `workers\agent-runtime\src\devgateway_agent_runtime\fixtures.py` | Implemented | Runs a fixture-only workflow through queued, planning, delegating, running, synthesizing, and completed states without live providers, tools, Bifrost, Tool Broker, or external DB. |
| CLI smoke | `workers\agent-runtime\src\devgateway_agent_runtime\cli.py`, `workers\agent-runtime\src\devgateway_agent_runtime\__main__.py` | Implemented | Emits JSON fixture-smoke output and returns success only when the workflow reaches completed state. |
| Package scripts and tests | `workers\agent-runtime\package.json`, `workers\agent-runtime\tests\runtime_test.py` | Implemented | Adds pnpm/turbo-compatible scripts and unittest coverage for transitions, idempotency replay, leases, dispatcher bounds, opaque refs, and CLI JSON smoke. |

## Phase 2.5 supervisor and sub-agent execution

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Governed fixture model adapter | `workers\agent-runtime\src\devgateway_agent_runtime\model_adapter.py` | Implemented | Enforces fixture-only posture, allowed non-production aliases, policy/registry pins, trace context, budget refs, output schema refs, and idempotent model calls. |
| Result validation | `workers\agent-runtime\src\devgateway_agent_runtime\validation.py` | Implemented | Validates structured child output against declared primitive schema requirements and returns evidence refs without raw child values in failures. |
| Sub-agent executor | `workers\agent-runtime\src\devgateway_agent_runtime\executor.py` | Implemented | Rechecks inherited/narrowed scope, invokes the fixture model adapter, blocks widened scope before model calls, and records opaque artifact/cost/audit refs. |
| Supervisor planner/synthesis | `workers\agent-runtime\src\devgateway_agent_runtime\supervisor.py` | Implemented | Builds two scoped fixture delegations using distinct non-production aliases, reserves budget refs before execution, synthesizes provenance/cost/artifact/caveat metadata, and blocks synthesis when child validation fails. |
| Execution contracts and CLI | `workers\agent-runtime\src\devgateway_agent_runtime\contracts.py`, `workers\agent-runtime\src\devgateway_agent_runtime\cli.py` | Implemented | Adds delegation/model/result/synthesis contracts and `--fixture execution` CLI smoke mode. |
| Execution tests | `workers\agent-runtime\tests\runtime_test.py` | Implemented | Covers alias governance, scope narrowing/widening denial, validation-before-synthesis, invalid child output blocking, tainted-output caveats, opaque refs, and guarded no-live-dependency execution. |

## Phase 2.6 budget reservation and settlement

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Budget reservation routes | `apps\control-api\src\routes\budgets.ts` | Implemented | Adds non-production `POST /api/budget-reservations`, settle, and release routes with auth-first handling and production fail-closed behavior. |
| In-memory budget lifecycle store | `apps\control-api\src\routes\budgets.ts` | Implemented | Supports reserve, settle, release, idempotent replay, hard-cap denial before execution, and spend/reservation-state inspection. |
| Workflow/delegation/tool-class accounting | `apps\control-api\src\routes\budgets.ts`, `packages\observability\src\cost.ts` | Implemented | Tracks workflow_run_id, delegation_id, tool_class, model alias, trace, request, and policy pins through reservation and cost aggregation metadata. |
| Cost lifecycle formatting | `packages\observability\src\cost.ts` | Implemented | Adds budget lifecycle helper for reservation, settlement, and release cost events using existing cost-event contract shapes. |
| Budget/cost tests | `apps\control-api\src\routes\control-routes.test.ts`, `packages\observability\src\index.test.ts` | Implemented | Covers reserve/settle/release idempotency, hard-cap denial, invalid release of settled reservations, production fail-closed routes, aggregation refs, lifecycle formatting, and secret-field rejection. |

## Phase 2.7 read-only Tool Broker

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Read-only tool adapters | `workers\tool-integrations\src\index.ts` | Implemented | Adds typed read-only adapter contracts and fixture adapters for repository metadata, approved docs lookup, and eval artifact reads/lists. |
| Tool integration package validation | `workers\tool-integrations\package.json`, `workers\tool-integrations\src\index.test.ts` | Implemented | Adds package scripts and tests for allow, malformed args, unknown tools, write-tool exclusion, and sanitized opaque refs. |
| Tool Broker HTTP routes | `apps\tool-broker\src\server.ts` | Implemented | Adds `/api/tools`, `/api/tools/call`, `/mcp`, `/mcp/sse`, and `/mcp/messages` while preserving `/healthz` and `/readyz`. |
| Deterministic tool policy | `apps\tool-broker\src\server.ts` | Implemented | Denies missing policy context, write/side-effect IDs, untrusted model approval claims, unknown tools, malformed args, restricted data classes, and disallowed roles before adapter execution. |
| Sanitized broker audit | `apps\tool-broker\src\server.ts` | Implemented | Persists in-memory metadata-only tool call records with trace/request/policy refs, artifact refs, result metadata, and denial reasons; raw content, provider keys, tokens, and signed URLs are excluded. |
| Tool Broker tests | `apps\tool-broker\src\server.test.ts` | Implemented | Covers health/readiness, discovery, read-only call allow, missing context denial, write denial, approval-bypass denial, malformed args, MCP list/call, SSE, and sanitized audit persistence. |

## Phase 2.8 skill registry skeleton

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Static skill registry | `packages\registry\registry\skills.v0.1.json` | Implemented | Adds production-disabled registry posture with draft and eval-ready Track 2 skill records. |
| Skill registry contracts/validation | `packages\registry\src\skill-registry.ts` | Implemented | Validates lifecycle, model aliases, read-only tool refs, schema refs, eval suite refs, rollout policy, production gate requirements, and content-safety boundaries. |
| Registry validation integration | `packages\registry\src\validate-registry.ts`, `packages\registry\src\index.ts` | Implemented | `registry:validate` now validates model/provider registry plus skill registry and negative fixtures. |
| Control API skill listing | `apps\control-api\src\routes\skills.ts` | Implemented | Default `/api/skills` now returns bundled registry-backed non-production skills and fails closed for missing/stale registry snapshots. |
| Skill tests | `packages\registry\src\skill-registry.test.ts`, `apps\control-api\src\routes\control-routes.test.ts` | Implemented | Covers bundled skill validation, production-skill gate denial, unknown model alias denial, write-tool denial, raw content/secret rejection, registry-backed API listing/filtering, stale fail-closed behavior, and production fail-closed behavior. |

## Phase 2.9 task trace UI and observability

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Trace Control API client | `apps\admin-portal\src\features\control-api-client.ts` | Implemented | Fetches Track 2 task, artifacts, workflow, workflow events, agent run, and skills endpoints through Control API only. |
| Trace view model | `apps\admin-portal\src\features\operational-views.ts`, `apps\admin-portal\src\features\operations-snapshot-query.ts` | Implemented | Adds sanitized task trace, workflow, delegation tree, event timeline, cost, artifact, tool, and skill panels while preserving Track 1 views. |
| Trace route/UI | `apps\admin-portal\src\app\router.tsx`, `apps\admin-portal\src\app\routes\task-trace-view.tsx`, `apps\admin-portal\src\app\routes\authenticated-admin-layout.tsx`, `apps\admin-portal\src\app\routes\operations-home.tsx`, `apps\admin-portal\src\styles\portal.css` | Implemented | Adds `/trace` route, navigation, home entry point, fail-closed endpoint ledger, timeline rails, workflow/delegation/cost/artifact/tool/skill panels, and industrial trace-lab styling. |
| Portal trace tests | `apps\admin-portal\src\features\control-api-client.test.ts`, `apps\admin-portal\src\features\operational-views.test.ts`, `apps\admin-portal\src\app\router.test.tsx` | Implemented | Covers trace endpoint fetching, view-model sanitization, fail-closed issue states, route rendering, navigation current state, local preview, and no raw prompt/body/signed URL/provider key/token/secret rendering. |

## Phase 2.10 evals, validation evidence, and exit review

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Track 2 fixture eval smoke | `scripts\eval-smoke.mjs`, `workers\eval-runner\src\devgateway_eval_runner\cli.py`, `evals\datasets\agent-workflow.v0.1.json`, `evals\datasets\tool-safety.v0.1.json`, `evals\datasets\prompt-injection-tainted-context.v0.1.json` | Implemented | Root `pnpm eval:smoke` now includes Track 2 fixture suites while remaining fixture-only and no-live-call. |
| Final validation | Command matrix below | Complete | Targeted package checks plus root `pnpm typecheck` and `pnpm test` passed after model-review remediation. |
| Browser validation | `files\track2-trace-ui-final.png` in the session artifacts | Complete | Local browser opened `/trace` through a fresh portal/API pair, confirmed trace UI rendered, fail-closed auth ledger appeared, and no forbidden raw prompt/provider-key/signed-url/token/secret strings appeared. |
| Tool Broker HTTP/MCP smoke | Local `http://127.0.0.1:43102` | Complete | Verified read-only discovery, direct read-only tool call with trusted headers, MCP `tools/list`, and MCP `tools/call`. |
| Model and adversarial review | GPT-5.5, Claude Opus 4.8, Gemini 3.1 Pro, and adversarial security review agents | Complete | Findings were triaged and high-confidence issues remediated before the final validation rerun. |

## Model-review remediation log

| Finding | Source | Resolution |
|---|---|---|
| Virtual-key route schemas rejected Track 2 route intents and budget scope types. | Gemini 3.1 Pro, GPT-5.5 | `apps\control-api\src\routes\virtual-keys.ts` now uses shared `routeIntents` and `budgetScopeTypes`; Control API tests cover Track 2 values. |
| `workflow_lease` did not enforce one active lease per key and `budget_reservation` was not durable. | Gemini 3.1 Pro, adversarial review | Added `budget_reservation` schema and migration `0002_rainy_white_tiger.sql`; added active-only partial unique index for workflow leases and offline DB checks. |
| Track 2 read endpoints authenticated but did not scope reads by principal/project. | Claude Opus 4.8 | Added Track 2 read visibility checks for tasks, workflows, workflow events, task artifacts, and agent runs; tests cover cross-principal denial. |
| Supervisor persisted workflow replay was not idempotent. | Claude Opus 4.8, GPT-5.5 | Runtime supervisor now reuses existing persisted contexts on replay; tests cover replay. |
| Delegation contracts lacked timeout/context widening checks. | Claude Opus 4.8 | Added timeout/context bounds to delegation contracts and executor validation; tests cover context and timeout widening rejection. |
| Tool Broker trusted untrusted JSON-RPC/body policy context, missed stringified approval bypass and mutation verbs. | Gemini 3.1 Pro, GPT-5.5, adversarial review | Tool calls now require trusted header context; broker detects stringified approval bypass claims and broader mutation verbs before adapter execution; tests cover denials. |
| Budget settlement could exceed reserved amount or replay with conflicting bodies. | GPT-5.5, adversarial review | Settlement now rejects actual amount/tokens over reservation and compares settlement/release replay bodies; tests cover lifecycle idempotency. |
| Validation-failed sub-agent model calls lacked cost refs; optional output fields were under-validated. | GPT-5.5, Claude Opus 4.8 | Runtime validation checks optional fields when present and records cost refs for validation-failed model calls; tests updated. |
| Portal trace UI highlighted `denied` but not `deny`. | Claude Opus 4.8 | Trace UI treats `deny` and `denied` as danger; router tests cover denial chip behavior. |
| Control API fixture span IDs were not schema-shaped hex spans. | GPT-5.5 | Fixture trace context refs now derive 16-character lowercase hex span IDs. |

## Validation commands

| Command | Result | Notes |
|---|---|---|
| `pnpm --filter @devgateway/schemas check` | Pass | Validated 24 JSON schema files and catalog refs. |
| `pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --allowImportingTsExtensions packages/shared-types/src/index.ts` | Pass | Targeted shared contract typecheck. |
| `pnpm --filter @devgateway/db typecheck` | Pass | Validated Drizzle schema/check/fixture TypeScript. |
| `pnpm --filter @devgateway/db exec drizzle-kit check` | Pass | Drizzle schema/migration consistency check. |
| `pnpm --filter @devgateway/db db:check:offline` | Pass | Offline structural DB checks, migration ordering, seed secret boundary, active-lease uniqueness, durable budget reservations, and Track 2 invariants. |
| `pnpm --filter @devgateway/db db:check:database` | Not run | No disposable `DATABASE_MIGRATION_URL` or `DATABASE_CHECK_URL` was configured in this environment. |
| `pnpm --filter @devgateway/control-api typecheck` | Pass | Validated Track 2 route modules, server mounting, OpenAPI conversion types, and review fixes. |
| `pnpm --filter @devgateway/control-api test` | Pass | Ran 51 Control API tests including Track 2 route-surface, read ACLs, budget lifecycle, virtual-key Track 2 contracts, and server/OpenAPI coverage. |
| `pnpm --filter @devgateway/observability typecheck` | Pass | Validated budget lifecycle cost helper types. |
| `pnpm --filter @devgateway/observability test` | Pass | Ran 26 observability tests including workflow/delegation/tool-class aggregation and budget lifecycle formatting. |
| `pnpm --filter @devgateway/tool-integrations typecheck` | Pass | Validated read-only tool adapter contracts and registry types. |
| `pnpm --filter @devgateway/tool-integrations test` | Pass | Ran 5 adapter tests for read-only allow, malformed args, unknown tool, write exclusion, and sanitization. |
| `pnpm --filter @devgateway/tool-broker typecheck` | Pass | Validated Tool Broker route/policy/MCP/audit helpers. |
| `pnpm --filter @devgateway/tool-broker test` | Pass | Ran 13 Tool Broker tests covering HTTP, MCP, trusted policy context, mutation/approval-bypass denial, and audit behavior. |
| `pnpm --filter @devgateway/registry typecheck` | Pass | Validated model/provider and skill registry TypeScript contracts. |
| `pnpm --filter @devgateway/registry registry:validate` | Pass | Validated bundled model/provider registry, skill registry, and negative fixtures. |
| `pnpm --filter @devgateway/registry test` | Pass | Ran 5 skill registry tests for lifecycle/ref/content-safety validation. |
| `pnpm --filter @devgateway/admin-portal typecheck` | Pass | Validated Track 2 trace view model and `/trace` route TypeScript. |
| `pnpm --filter @devgateway/admin-portal test` | Pass | Ran admin portal node tests plus 27 Vitest tests including trace endpoint, sanitization, route rendering, denial highlighting, and local preview coverage. |
| `python -m compileall -q workers\agent-runtime\src workers\agent-runtime\tests` | Pass | Compiled runtime source and tests. |
| `pnpm --filter @devgateway/agent-runtime typecheck` | Pass | Runs runtime compile validation through package script. |
| `pnpm --filter @devgateway/agent-runtime test` | Pass | Ran 22 stdlib unittest cases for the runtime and execution skeleton, including review-fix regressions. |
| `pnpm --filter @devgateway/agent-runtime transit` | Pass | Ran fixture-only runtime CLI smoke through the package script. |
| `PYTHONPATH=workers\agent-runtime\src python -m devgateway_agent_runtime --mode fixture --format json` | Pass | Emitted JSON with workflow state `completed`, fixture mode, no live external calls, idempotency scopes, and zero open leases. |
| `PYTHONPATH=workers\agent-runtime\src python -m devgateway_agent_runtime --mode fixture --fixture execution --format json` | Pass | Emitted JSON with completed workflow, two child delegations across distinct fixture aliases, validated child results, synthesis metadata, and no live external calls. |
| `pnpm workspace:validate` | Pass | Root tooling, eval layout, and schema checks passed. |
| `pnpm eval:smoke` | Pass | Track 0/1 and Track 2 fixture suites passed with no live provider calls. |
| `pnpm typecheck` | Pass | Root typecheck completed across all packages. |
| `pnpm test` | Pass | Root test suite completed across all packages. |
| `git --no-pager diff --check` | Pass | Whitespace check passed; Git reported only line-ending warnings. |

## Remaining blockers

| Blocker | Impact |
|---|---|
| No disposable database URL configured | Database-backed migration application evidence is still pending. |
| Track 0 owner/break-glass approvals remain unresolved | Formal Track 2 exit cannot pass. |
| Track 1 production routes and production-enabled model aliases remain unavailable | Formal Track 2 two-production-alias delegation gate cannot pass. |
