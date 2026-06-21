# Track 2 - Agent Orchestration Foundation Implementation Plan

## 1. Executive summary

Track 2 builds the first agent orchestration foundation on top of the Track 0 governance baseline and the Track 1 gateway/control foundation. It should introduce persisted agent tasks, supervisor/sub-agent delegation, validated result synthesis, read-only tool execution through the Tool Broker, skill metadata, task trace visibility, and per-delegation budget reservation/settlement.

Track 2 may proceed as non-production implementation work, but its formal exit is intentionally strict: the parent agent must delegate to at least two **production-enabled model aliases** through the governed Bifrost path. Because Track 0 formal exit is not approved and Track 1 production routes are still disabled, this exit gate cannot pass until the required production gates, owners, break-glass approvals, eval evidence, provider policy, and registry state are all satisfied.

The plan incorporates repository analysis and independent model reviews from Claude Opus 4.8, GPT-5.5, and Gemini 3.1 Pro. The reviews agreed that the roadmap bullets are directionally correct but insufficient without schema contracts, database state, idempotency, trace propagation, artifact handling, budget race controls, read-only tool policy, and explicit Track 2/Track 3 durability boundaries.

## 2. Confirmed planning decisions

| Decision | Resolution | Impact |
|---|---|---|
| Track 2 delegation exit gate | Require delegation to at least two production-enabled model aliases. | Track 2 implementation can be developed in fixture/local/non-production mode, but formal Track 2 exit stays blocked until production aliases are gated and enabled. |
| Track 2 vs Track 3 durability boundary | Track 2 includes persisted state machine, idempotency, basic leases, and restart smoke. Track 3 adds robust retries, cancellation, approvals, and event outbox. | Prevents duplicate model/tool calls early without pulling the full durable workflow feature set into Track 2. |
| Track 0 blockers | Pending owner and break-glass approvals are production blockers only. | Non-production Track 2 implementation can start; production enablement remains fail-closed. |
| Plan artifact | `docs\impl-plan\track-2-agent-orchestration-foundation.md`. | Matches existing Track 0 and Track 1 implementation plan location. |

## 2.1 Implementation progress

Status: Phase 2.1 and Phase 2.2 are implemented in non-production foundation mode. Formal Track 2 exit remains blocked until later phases complete and the production-alias gate can be satisfied.

| Phase | Status | Evidence |
|---|---|---|
| Phase 2.1 - Contract and schema lock | Complete | Added agent/workflow/delegation/tool/skill JSON schemas, schema catalog refs, shared Track 2 TypeScript contracts, and shared budget/cost/trace/denial contract alignment. |
| Phase 2.2 - Database and migration foundation | Complete | Added Drizzle operational tables/migration for workflow, agent, delegation, tool, artifact, skill, idempotency, and leases; extended budget/cost contracts; added non-production fixture metadata and offline DB invariant checks. |
| Phase 2.3 - Control API task/workflow surface | Complete | Added non-production task, artifact, workflow, agent-run, and skill route modules; mounted them outside production; added OpenAPI exposure and targeted route/server tests. |
| Phase 2.4 - Workflow runtime skeleton | Complete | Added fixture-only Python workflow runtime contracts, in-memory repository, dispatcher, leases, idempotency, CLI smoke, and tests. |
| Phase 2.5 - Supervisor and sub-agent execution | Complete | Added fixture-only governed model adapter, result validation, sub-agent executor, supervisor planner/synthesis loop, execution CLI smoke, and tests for two-alias delegation and invalid-output blocking. |
| Phase 2.6 - Budget reservation and settlement | Complete | Added non-production Control API budget reservation, settlement, and release lifecycle routes plus workflow/delegation/tool-class cost aggregation helpers and tests. |
| Phase 2.7 - Read-only Tool Broker | Complete | Added read-only tool integrations, Tool Broker discovery/call/MCP routes, deterministic policy denials, sanitized audit persistence, and tests. |
| Phase 2.8 - Skill registry skeleton | Complete | Added static production-disabled skill registry metadata, validators, negative fixtures, registry-backed Control API listing, and tests. |
| Phase 2.9 - Task trace UI and observability | Complete | Added admin portal trace data model, `/trace` route, industrial trace-lab UI, endpoint ledger, workflow/delegation/timeline/cost/artifact/tool/skill panels, and sanitization tests. |
| Phase 2.10 - Evals, validation evidence, and exit review | Complete | Extended fixture eval smoke to Track 2 suites, ran final validation, completed browser validation, completed model/adversarial reviews, and recorded formal production blockers. |

Validation evidence is tracked in `docs\governance\track-2-validation-evidence.md`. Database-backed migration validation remains pending until a disposable `DATABASE_MIGRATION_URL` or `DATABASE_CHECK_URL` is configured.

## 3. Current-state analysis

### 3.1 Track 0 status

Track 0 produced the architecture and governance setup needed to start non-production implementation:

- Canonical architecture baseline: `AI-Platform-Proposal.md`, `docs\01-system-architecture-and-interfaces.md`, `docs\02-agent-workflows-tools.md`, `docs\03-knowledge-retrieval-evaluation.md`, and `docs\04-technology-roadmap-operations.md`.
- Governance artifacts: dependency rules, gateway policy enforcement contract, denial taxonomy, provider data-class policy, model/provider registry, eval dataset layout, eval runner skeleton, schema/migration conventions, GitHub permission model, and break-glass design/runbook drafts.
- Readiness validation recorded passing root checks: `pnpm workspace:validate`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:check`, `pnpm registry:validate`, `pnpm policy:validate`, and `pnpm eval:smoke`.
- Production enablement remains blocked. `docs\governance\track-0-exit-decision.md` says formal Track 0 exit is not approved until owner assignment approval and break-glass approval are recorded.

### 3.2 Track 1 status

Track 1 foundation pieces exist, but remain non-production and partial:

| Surface | Current state | Track 2 implication |
|---|---|---|
| `apps\control-api` | Fastify server, health/readiness, OpenAPI, auth route mounting, non-production virtual-key/budget/cost/registry/policy/Bifrost config routes. | Track 2 should add task/workflow/artifact APIs here, not create a parallel control plane. |
| `packages\db` | Drizzle operational schema for auth, identity, projects, audit, virtual keys, budget scopes/policies/ledger, cost events, request logs, break-glass, eval gate results. | Add workflow/agent/delegation/tool/skill tables and extend budget scope types for workflow/delegation/tool-class accounting. |
| `packages\schemas` | External OpenAI/Anthropic/MCP schemas plus shared gate, virtual-key, budget, cost, trace, policy, registry, eval schemas. | Add agent/workflow/delegation/artifact/tool-call/skill schemas and include them in the schema catalog. |
| `packages\shared-types` | Gateway/control types for virtual keys, budgets, cost events, trace context. | Add agent/workflow/task/delegation/tool/skill contract types after schema lock. |
| `packages\policy` | Data-class, denial, GitHub permission, registry/policy validation baseline. | Add deterministic delegation/tool/skill policy decisions. Agents must not decide final allow/deny. |
| `packages\observability` | Audit, cost, trace, structured logging, sink safety helpers. | Add workflow/delegation/tool-call metrics and trace helpers. |
| `apps\admin-portal` | Vite/React/TanStack operational views for health, registry, virtual keys, budgets, cost, audit, break-glass. | Add task trace UI through Control API only. |
| `apps\tool-broker` | Health-only Node HTTP skeleton. | Replace with read-only MCP/tool registry endpoints and policy-checked tool execution. |
| `workers\agent-runtime` | Python placeholder only. | Build supervisor, sub-agent executor, and workflow worker here. |
| `workers\tool-integrations` | TypeScript placeholder only. | Add read-only adapter contracts and fixture/local adapters. |
| `workers\eval-runner` | Fixture-only runner; current smoke is not a full Track 2 gate. | Extend smoke or add Track 2 command coverage for agent workflow and tool safety suites. |

### 3.3 Authoritative Track 2 roadmap

`docs\04-technology-roadmap-operations.md` defines Track 2 as:

- supervisor agent service
- sub-agent executor
- delegation contract schemas
- agent run/task/artifact schema
- custom workflow runtime skeleton
- task trace UI
- read-only Tool Broker
- skill registry skeleton

Exit criteria:

- parent agent delegates to at least two model aliases
- sub-agent result is validated, stored, and synthesized
- tool calls are policy-checked and auditable
- per-delegation budget reservation/settlement works

For this final plan, the first exit criterion is interpreted according to the confirmed planning decision: the aliases must be production-enabled before formal Track 2 exit can pass.

## 4. Track 2 scope

### 4.1 In scope

1. Versioned schemas for agent definitions, tasks, agent runs, delegations, sub-agent results, workflow state, workflow events, artifacts, tool definitions, tool calls, and skill versions.
2. Operational Postgres tables for agent/workflow/tool/skill state.
3. Budget model extension from Track 1 to workflow, delegation, and tool-class scopes.
4. Trace context extension for Control API -> workflow runtime -> supervisor -> sub-agent -> Bifrost -> Tool Broker -> audit/cost/event records.
5. Control API task/workflow/artifact endpoints.
6. Custom Postgres-backed workflow runtime skeleton with persisted states, idempotency, basic worker lease/heartbeat, and restart smoke.
7. Supervisor agent service in `workers\agent-runtime`.
8. Sub-agent executor in `workers\agent-runtime`.
9. Governed Bifrost model adapter that never accesses raw provider keys.
10. Read-only Tool Broker over MCP-compatible surfaces.
11. Read-only tool integration adapters in fixture/local mode.
12. Skill registry skeleton and lifecycle gating.
13. Admin portal task trace UI.
14. Agent workflow and tool safety eval execution in fixture mode.
15. Documentation and validation evidence for Track 2 gates.

### 4.2 Out of scope

1. Full Track 3 durable workflow feature set: robust retries, cancellation, approval pause/resume, full event outbox, workflow templates, and long-running production background tasks.
2. Side-effecting or write-capable tools.
3. Production model/provider route enablement before Track 0 and Track 1 gates pass.
4. Repository retrieval foundation, GitHub connector, Knowledge Postgres, pgvector, Neo4j GraphRAG, memory service, and context-pack production serving. Those belong to later tracks.
5. Visual DAG authoring, cron scheduling, cross-region workers, high-throughput event streaming, or multi-tenant SaaS isolation.
6. Raw provider-key access by agents, Tool Broker, admin portal, or workers.
7. Production skill rollout without passing eval gate records.

## 5. Functionality-by-functionality plan

### 5.1 Agent and workflow contract lock

Goal: remove ambiguity before implementation creates persistent workflow behavior.

Targets:

- `packages\schemas\schemas\agent\delegation.v0.1.schema.json`
- `packages\schemas\schemas\agent\agent-run.v0.1.schema.json`
- `packages\schemas\schemas\agent\sub-agent-result.v0.1.schema.json`
- `packages\schemas\schemas\agent\workflow-state.v0.1.schema.json`
- `packages\schemas\schemas\agent\workflow-event.v0.1.schema.json`
- `packages\schemas\schemas\agent\task-artifact.v0.1.schema.json`
- `packages\schemas\schemas\agent\tool-call.v0.1.schema.json`
- `packages\schemas\schemas\agent\skill-definition.v0.1.schema.json`
- `packages\schemas\schemas\index.v0.1.json`
- `packages\shared-types\src\agent-workflow.ts`

Required contract decisions:

| Contract | Required fields and rules |
|---|---|
| Agent definition | `agent_definition_id`, role, allowed model aliases, allowed tool bundles, output schema refs, owner, status, eval suite refs. |
| Agent run | `agent_run_id`, task/workflow refs, agent definition, principal/project/data class, model alias, budget scope, trace, status, parent/child links. |
| Delegation | `delegation_id`, parent agent run, task type, model alias, input context refs, allowed/disallowed tools, budget reservation, timeout, output schema, approval policy, provenance requirement. |
| Sub-agent result | `delegation_id`, schema version, status, confidence, structured result, citations/artifact refs, token/cost usage, policy/audit refs, failure cause. |
| Workflow state | Versioned states, allowed transitions, idempotency keys, current step, lease owner, heartbeat timestamp, resume token, terminal failure type. |
| Workflow event | Append-only event with `workflow_run_id`, sequence number, event type, state transition, actor, trace, audit refs, cost refs, metadata. |
| Task artifact | Object-storage-first artifact metadata with sensitivity label, owner, source, size/hash, retention, signed URL policy, and ACL scope. |
| Tool call | Tool definition, risk tier, arguments hash, policy decision, approval ref if required, audit ref, result artifact refs. |
| Skill definition | Versioned prompts/tools/model aliases/eval suites/owner/rollout state; no production rollout without passing gate result. |

Validation requirements:

- Schema catalog validation includes every new schema.
- Negative fixtures prove secret-bearing fields are rejected in agent/delegation/tool/artifact metadata.
- Delegations cannot omit principal, project, data class, budget scope, policy version, registry version, trace ID, output schema, or timeout.
- Context refs are opaque references, not raw blobs.
- Sub-agent output must fail validation before synthesis when it does not match the declared output schema.

### 5.2 Shared contract migrations for budget, trace, and route intent

Goal: adapt Track 1 contracts to agent orchestration without inventing parallel accounting or trace semantics.

Targets:

- `packages\shared-types\src\gateway-control.ts`
- `packages\schemas\schemas\shared\budget-scope.v0.1.schema.json`
- `packages\schemas\schemas\shared\cost-event.v0.1.schema.json`
- `packages\schemas\schemas\shared\trace-context.v0.1.schema.json`
- `packages\observability\src\index.ts`
- `packages\observability\src\audit.ts`
- `packages\observability\src\cost.ts`

Required additions:

| Area | Addition |
|---|---|
| Budget scope types | Add `workflow`, `delegation`, and `tool_class` as governed budget scopes. |
| Cost aggregation | Record cost by workflow, delegation, model alias, provider, tool class, project, principal, and virtual key. |
| Route intents | Add or confirm intents for `agent_planning`, `sub_agent_execution`, `tool_planning`, `tool_execution`, and `synthesis`. |
| Trace components | Add `workflow_runtime`, `agent_runtime`, `supervisor_agent`, `sub_agent_executor`, `tool_broker`, and `tool_integrations` where missing. |
| Audit actions | Add stable names for workflow creation, delegation creation, model call request, result validation, synthesis, tool policy decision, artifact creation, budget reservation, settlement, and release. |

Acceptance criteria:

- Existing Track 1 gateway/control contracts remain backward-compatible or receive explicit v0.2 schema versions.
- Budget reservation is represented before a model/tool call and settlement/release after completion.
- Trace context can be persisted in `workflow_event` and reconstructed by a worker after restart.
- Unknown workflow/delegation/tool denial reasons fail validation rather than becoming untyped strings.

### 5.3 Operational database foundation

Goal: create durable state for Track 2 while preserving Track 1's database ownership model.

Targets:

- `packages\db\src\schema\operational.ts`
- `packages\db\src\schema\index.ts`
- `packages\db\src\check.ts`
- `packages\db\migrations\*`
- `packages\db\src\seeds\non-production-fixtures.ts`

Tables to add:

| Table | Purpose |
|---|---|
| `agent_definition` | Versioned role metadata for supervisor and sub-agent roles. |
| `agent_run` | Runtime execution record for supervisor and sub-agent invocations. |
| `delegation` | Parent-to-child task contract, budget, schema, tool, context, timeout, and status. |
| `delegation_result` | Validated structured result, confidence, citations, artifact refs, and failure details. |
| `workflow_run` | Top-level persisted workflow/task state. |
| `workflow_step` | Planned/persisted steps for planning, delegation, tool call, model call, synthesis, and terminalization. |
| `step_attempt` | Attempt record with idempotency key, model/tool refs, cost/audit refs, and failure cause. |
| `workflow_event` | Append-only event stream and task trace source. |
| `workflow_lease` | Basic worker lease and heartbeat for Track 2 restart smoke. |
| `workflow_idempotency_key` | Durable dedupe for workflow creation, step execution, model calls, tool calls, and artifact writes. |
| `task_artifact` | Artifact metadata and object-storage reference, not large content blobs. |
| `tool_definition` | Read-only tool metadata, schema refs, risk tier, owner, rollout status. |
| `tool_policy` | Deterministic allowed/denied tool policy by role/project/data class/risk tier. |
| `tool_call` | Policy-checked read-only tool invocation and result metadata. |
| `skill_definition` | Stable skill identity, owner, lifecycle, policy, and eval refs. |
| `skill_version` | Versioned prompt/tool/model/eval bundle metadata. |

State and integrity rules:

- Public IDs use opaque prefixed IDs; internal numeric IDs remain database-local.
- Workflow events are append-only.
- Artifacts store metadata and object references; large payloads do not live in Postgres rows.
- Every executable step has an idempotency key before dispatch.
- Every model/tool step links to budget reservation, cost event, audit event, trace ID, and policy/registry versions.
- Every delegation has a budget at or below the parent remaining reservation.
- Every sub-agent inherits principal/project/data-class scope and cannot widen it.
- Invalid state transitions are rejected by service logic and covered by tests.

Acceptance criteria:

- `pnpm db:check` validates migrations and schema conventions.
- Duplicate idempotency keys do not create duplicate workflow steps, model calls, tool calls, artifacts, or cost events.
- A basic worker restart smoke proves a leased workflow step can be recovered or safely marked for manual review without duplicate billing.

### 5.4 Control API task, workflow, and artifact endpoints

Goal: make Control API the entry point for agent tasks and trace inspection.

Targets:

- `apps\control-api\src\routes\tasks.ts`
- `apps\control-api\src\routes\workflows.ts`
- `apps\control-api\src\routes\artifacts.ts`
- `apps\control-api\src\routes\agent-runs.ts`
- `apps\control-api\src\routes\skills.ts`
- `apps\control-api\src\openapi\*`

Endpoints:

| Endpoint | Behavior |
|---|---|
| `POST /api/tasks` | Authenticates principal, resolves project/data class/budget, creates `workflow_run`, returns `task_id`, `workflow_id`, initial status, estimated budget, artifact root. |
| `GET /api/tasks/{task_id}` | Returns task status, progress, latest event, pending blockers, cost so far, and terminal result summary if available. |
| `POST /api/tasks/{task_id}/cancel` | Track 2 records cancel request only; full cancellation execution belongs to Track 3. |
| `GET /api/tasks/{task_id}/artifacts` | Lists artifact metadata and signed download eligibility when allowed. |
| `GET /api/workflows/{workflow_id}` | Returns workflow run summary and current state. |
| `GET /api/workflows/{workflow_id}/events` | Cursor-paginated append-only event stream for trace UI. |
| `GET /api/agent-runs/{agent_run_id}` | Returns agent run metadata, delegation tree, cost, trace, and validated result status. |
| `GET /api/skills` | Lists draft/eval-ready skill metadata visible to the caller. |

Security requirements:

- Better Auth session or scoped service token is required.
- Control API resolves principal/project/data class before workflow creation.
- Missing auth, stale policy, stale registry, disabled route, exhausted budget, or missing audit sink fails closed according to environment.
- Portal and IDE clients never receive raw provider keys, raw virtual-key secrets, raw secret-bearing artifacts, or unrestricted DB rows.
- Task list and artifact endpoints enforce principal/project ACLs.

Acceptance criteria:

- OpenAPI includes task, workflow, artifact, agent-run, and skill endpoints.
- Pagination and typed errors are present for event/artifact lists.
- Production behavior remains disabled until Track 0/1/2 gates pass.

### 5.5 Custom workflow runtime skeleton

Goal: provide the smallest durable runtime needed for Track 2 orchestration without duplicating Track 3.

Targets:

- `workers\agent-runtime\src\devgateway_agent_runtime\workflow\*`
- `workers\agent-runtime\src\devgateway_agent_runtime\db\*`
- `workers\agent-runtime\src\devgateway_agent_runtime\telemetry\*`
- `workers\agent-runtime\pyproject.toml`
- `scripts\devgateway-dev.mjs`
- `infra\railway\service-matrix.md`
- `infra\railway\variable-matrix.md`

Runtime states:

| State | Meaning |
|---|---|
| `created` | Task accepted and persisted. |
| `planning` | Supervisor is creating the plan and initial delegations. |
| `delegating` | Delegation records and budget reservations are being created. |
| `running` | One or more model/tool/delegation steps are executing. |
| `synthesizing` | Supervisor is validating and merging child results. |
| `completed` | Final result is stored. |
| `failed` | Terminal failure with typed cause. |
| `cancel_requested` | Track 2 records the request; Track 3 executes robust cancellation. |

Worker dispatch:

- Use Postgres `SELECT ... FOR UPDATE SKIP LOCKED` with bounded batch size.
- Use backoff when no work is available.
- Use `workflow_lease` heartbeat while executing a step.
- Persist trace context before dispatch and reconstruct it after pickup.
- Claim work only after verifying policy version, registry version, budget reservation, idempotency key, and task state.
- Keep SQL access behind runtime repository interfaces so future Hatchet/Temporal migration does not leak into agent logic.

Idempotency:

- Required for workflow creation, step creation, model calls, tool calls, budget reservations, cost events, audit events, and artifact writes.
- The idempotency record stores semantic key, operation kind, request hash, status, result ref, and expiry/retention policy.
- Replays return the prior result or continue the persisted step; they do not double-bill.

Acceptance criteria:

- A fixture workflow can move through `created -> planning -> delegating -> running -> synthesizing -> completed`.
- Killing a worker during or after a delegated step does not duplicate a model/tool/cost artifact.
- A stale lease is recoverable or marked for manual review.
- SQL runtime details are isolated from supervisor/sub-agent business logic.

### 5.6 Governed model adapter

Goal: ensure all agent model calls go through Bifrost and Track 1 policy/budget/audit surfaces.

Targets:

- `workers\agent-runtime\src\devgateway_agent_runtime\model_adapter\*`
- `packages\registry\registry\model-aliases.v0.1.json`
- `packages\policy\*`
- `packages\observability\*`

Behavior:

1. Resolve model alias from the agent/delegation contract.
2. Verify alias lifecycle, route enablement, data class, policy version, registry version, eval gate, budget reservation, and trace context.
3. Estimate spend from registry metadata before calling Bifrost.
4. Send request through Bifrost using the platform-issued virtual key path.
5. Validate structured output against the delegation output schema.
6. Settle actual spend from Bifrost usage; release unused reservation.
7. Persist audit, cost, request log, workflow event, and step attempt refs.

Acceptance criteria:

- No agent-runtime code reads raw provider keys.
- Missing production alias/gate evidence blocks formal Track 2 exit.
- Non-production fixture/local model adapters can be used for development, but they are clearly marked and cannot satisfy the production-alias exit gate.
- Token/context limits are checked before request dispatch; over-limit payloads fail with typed error or run a governed summarization/compression step.

### 5.7 Supervisor agent service

Goal: implement the parent agent responsible for decomposition, delegation, and synthesis.

Targets:

- `workers\agent-runtime\src\devgateway_agent_runtime\supervisor\*`
- `workers\agent-runtime\src\devgateway_agent_runtime\prompts\*`
- `workers\agent-runtime\src\devgateway_agent_runtime\contracts\*`

Responsibilities:

- Accept a persisted task/workflow context.
- Build a policy-aware plan without widening principal/project/tool/data-class scope.
- Create at least two child delegations when task type requires parallel work.
- Reserve budget for each delegation before dispatch.
- Track child completion, failure, timeout, and low-confidence output.
- Validate child result schemas before synthesis.
- Synthesize final answer with provenance, confidence, cost, artifacts, and caveats.
- Treat retrieved content, repository content, tool outputs, and sub-agent outputs as tainted unless policy marks them trusted.

Acceptance criteria:

- Parent-child delegation tree is visible through Control API and portal trace UI.
- Supervisor never treats sub-agent text as system/developer instructions.
- Supervisor refuses to synthesize invalid or cross-scope child outputs.
- Supervisor records a typed failure when budget, context limit, missing output schema, missing audit sink, or model alias policy blocks execution.

### 5.8 Sub-agent executor

Goal: execute scoped delegation contracts and return validated, auditable results.

Targets:

- `workers\agent-runtime\src\devgateway_agent_runtime\sub_agent\*`
- `workers\agent-runtime\src\devgateway_agent_runtime\result_validation\*`

Responsibilities:

- Load delegation by ID and validate schema version.
- Recheck principal/project/data-class/budget/model/tool constraints.
- Resolve allowed context refs without exposing raw unauthorized content.
- Execute the delegated task through the governed model adapter and optional read-only tools.
- Validate output schema.
- Store result and artifact metadata.
- Emit workflow events, audit events, cost events, and trace spans.

Edge cases:

- Invalid output schema.
- Low confidence.
- Child timeout.
- Missing or stale policy/registry.
- Budget exhausted after reservation but before model call.
- Context ref denied by ACL or artifact sensitivity.
- Tool policy denial.
- Model alias disabled or no production gate.

Acceptance criteria:

- Child cannot widen tools, context, budget, data class, project, principal, model alias, timeout, or output schema.
- Result is unavailable to synthesis until schema validation and policy checks pass.
- Failure states preserve enough evidence for trace UI and debugging without leaking secrets.

### 5.9 Per-delegation budget reservation and settlement

Goal: make workflow and sub-agent costs enforceable before model/tool execution.

Targets:

- `packages\db\src\schema\operational.ts`
- `packages\shared-types\src\gateway-control.ts`
- `packages\observability\src\cost.ts`
- `packages\policy\src\*`
- `apps\control-api\src\routes\budgets.ts`

Flow:

1. Reserve parent workflow budget at task creation.
2. Allocate sub-budgets for each delegation and tool class.
3. Estimate spend before each model/tool call using registry metadata and token counts.
4. Deny execution if reservation cannot be made.
5. Settle actual usage after Bifrost/tool result.
6. Release unused reservation.
7. Roll up spend to workflow, delegation, tool class, virtual key, principal, project, team, and org.

Acceptance criteria:

- Budget exhaustion blocks execution before provider/tool call.
- Race conditions are handled with transactional reservation rows and idempotency keys.
- Double-retry cannot double-reserve or double-settle.
- Portal and Control API can show cost by workflow and delegation.

### 5.10 Read-only Tool Broker

Goal: replace the health-only Tool Broker skeleton with policy-checked read-only tools.

Targets:

- `apps\tool-broker\src\server.ts`
- `apps\tool-broker\src\routes\mcp.ts`
- `apps\tool-broker\src\routes\tools.ts`
- `apps\tool-broker\src\policy.ts`
- `workers\tool-integrations\src\*`
- `packages\schemas\schemas\agent\tool-call.v0.1.schema.json`
- `packages\policy\src\tool-policy.ts`

Initial tool surface:

| Tool class | Example | Track 2 policy |
|---|---|---|
| Repository metadata read | synthetic repo map, file list fixture, dependency summary fixture | Allowed only inside project scope and read-only sandbox. |
| Documentation lookup | approved docs fixture lookup | Allowed with taint markers and source refs. |
| Eval artifact read | list/get synthetic eval artifacts | Allowed if project and sensitivity policy pass. |
| Write or external side-effect | deploy, rotate key, mutate DB, create ticket, send message | Denied with typed reason and audit event. |

MCP requirements:

- Keep compatibility with `POST /mcp`, `GET /mcp/sse`, and `POST /mcp/messages`.
- Tool discovery exposes only tools visible under the caller's project and role.
- Tool call arguments validate against schema before policy evaluation completes.
- Model-supplied approval claims are ignored unless backed by trusted Control API approval artifacts.
- All tool calls emit audit events and workflow events.

Acceptance criteria:

- Read-only tool discovery works.
- A read-only tool call is policy-checked, executed, stored, and auditable.
- A write/side-effecting tool call is denied and no adapter runs.
- Prompt-injection fixture cannot widen tool permissions.

### 5.11 Skill registry skeleton

Goal: model skills as governed, versioned, eval-gated bundles without enabling production skills prematurely.

Targets:

- `packages\registry\src\skills\*`
- `packages\registry\registry\skills.v0.1.json`
- `packages\schemas\schemas\agent\skill-definition.v0.1.schema.json`
- `packages\db\src\schema\operational.ts`
- `apps\control-api\src\routes\skills.ts`

Skill fields:

- `skill_definition_id`
- `skill_version_id`
- owner
- lifecycle status: `draft`, `eval_ready`, `approved`, `limited_rollout`, `production`, `disabled`
- allowed model aliases
- tool bundle
- prompt templates
- input schema
- output schema
- approval policy
- eval suite
- rollout policy
- policy version
- registry version
- gate result refs

Acceptance criteria:

- `draft` and `eval_ready` skills can be listed in non-production contexts.
- `production` skills require passing gate result and owner approval.
- Skill registry validation fails if a skill references unknown model aliases, tools, schemas, or eval suites.
- Skills cannot grant tool permissions beyond deterministic tool policy.

### 5.12 Task trace UI

Goal: let admins inspect workflow and delegation state without direct database or gateway access.

Targets:

- `apps\admin-portal\src\features\control-api-client.ts`
- `apps\admin-portal\src\features\operational-views.ts`
- `apps\admin-portal\src\app\routes\*`
- `apps\admin-portal\src\styles\portal.css`

Views:

| View | Content |
|---|---|
| Workflow list | Task ID, status, principal/project, created time, latest event, cost so far, blocking reason. |
| Workflow detail | State machine, step list, current lease/heartbeat, idempotency key status, terminal cause. |
| Delegation tree | Parent supervisor, child sub-agents, model aliases, output schema, confidence, result status. |
| Event timeline | Append-only events with trace IDs, audit refs, cost refs, artifact refs. |
| Cost panel | Workflow/delegation/model/tool-class reservation, settlement, release, denied budget events. |
| Artifact panel | Metadata only, sensitivity, source, hash, size, signed-download eligibility. |
| Tool panel | Tool discovery and call decisions, read-only allow, write denial, approval-bypass denial. |

Acceptance criteria:

- UI calls Control API only.
- Raw prompts, secrets, provider keys, raw virtual-key values, and restricted artifact bodies are not displayed.
- Event timeline can reconstruct a single task trace across Control API, workflow runtime, supervisor, sub-agent, Tool Broker, model adapter, audit, and cost.

### 5.13 Observability, audit, and trace continuity

Goal: make every orchestration decision attributable, auditable, and traceable.

Targets:

- `packages\observability\src\index.ts`
- `packages\observability\src\audit.ts`
- `packages\observability\src\cost.ts`
- `workers\agent-runtime\src\devgateway_agent_runtime\telemetry\*`
- `apps\tool-broker\src\telemetry.ts`

Required telemetry:

- `workflow_run_id`
- `workflow_step_id`
- `step_attempt_id`
- `agent_run_id`
- `delegation_id`
- `tool_call_id`
- `task_artifact_id`
- `skill_version_id`
- `budget_scope_id`
- `trace_id`
- `request_id`
- `policy_version`
- `registry_version`
- `model_alias`
- `provider`
- `data_class`
- `route_intent`
- `decision_reason`
- `reservation_amount`
- `settled_amount`

Acceptance criteria:

- A single trace links user request -> Control API -> workflow runtime -> supervisor -> delegation -> sub-agent -> model/tool -> audit/cost -> synthesis.
- Audit sink unavailable fails closed for production behavior.
- Sensitive prompt/context/tool/artifact fields are sanitized before logs.
- Trace continuity survives worker restart by persisting trace context in workflow state/events.

### 5.14 Eval and test expansion

Goal: make Track 2 gates executable in fixture mode before any production enablement.

Targets:

- `workers\eval-runner`
- `scripts\eval-smoke.mjs`
- `evals\datasets\agent-workflow.v0.1.json`
- `evals\fixtures\agent-workflow\*.json`
- `evals\datasets\tool-safety.v0.1.json`
- `evals\fixtures\tool-safety\*.json`
- new `evals\datasets\agent-orchestration.v0.1.json` if needed
- new `evals\fixtures\agent-orchestration\*.json` if needed
- `docs\governance\track-2-validation-evidence.md`

Required coverage:

| Suite | Required cases |
|---|---|
| Agent workflow | Restart/resume, state persistence, delegation contract, budget deny, idempotency replay. |
| Tool safety | Read-only allow, write denial, model-claimed approval denial, malformed args, disabled tool, stale policy. |
| Agent orchestration | Supervisor routes to correct sub-agent, two-alias delegation, invalid child output blocks synthesis, low-confidence escalation, synthesis citation/provenance preservation. |
| Cost/latency | Per-workflow and per-delegation reservation, settlement, release, denied budget, context-limit denial. |
| Prompt injection | Tainted context cannot change system instructions, widen tools, approve actions, or cross project boundaries. |

Acceptance criteria:

- `pnpm eval:smoke` or a clearly documented Track 2 smoke command includes Track 2 fixture suites.
- Fixture mode remains the only provider mode until explicit production approval.
- Smoke output includes gate-shaped results and no live provider calls.
- Track 2 validation evidence records command results and any remaining production blockers.

## 6. Implementation phases

### Phase 2.0 - Track 2 readiness checkpoint

Deliverables:

1. Confirm Track 0 owner/break-glass blockers are tracked as production blockers.
2. Confirm Track 1 production routes remain disabled.
3. Record that Track 2 can proceed only in non-production implementation mode until gates pass.
4. Define the Track 2 production-alias exit gate as blocked until production aliases are approved.

Acceptance criteria:

- No production model, tool, workflow, retrieval, provider-key, break-glass, or skill path is enabled by Track 2 planning.

### Phase 2.1 - Contract and schema lock

Deliverables:

1. Agent/workflow/delegation/tool/skill schemas.
2. Schema catalog updates.
3. Shared TypeScript and Python contract typing strategy.
4. Negative fixtures for missing scope, secret fields, unknown model alias, invalid output schema, and forbidden tool widening.

Acceptance criteria:

- `pnpm workspace:validate` and `pnpm --filter @devgateway/schemas check` validate all schemas.
- Every executable Track 2 record has principal/project/data-class/budget/trace/policy/registry fields.

### Phase 2.2 - Database and migration foundation

Deliverables:

1. Drizzle schema/migrations for workflow, agent, delegation, tool, artifact, skill, idempotency, and basic lease tables.
2. Budget scope extension for workflow/delegation/tool-class.
3. Append-only workflow event convention.
4. Offline and database-backed `db:check` coverage.

Acceptance criteria:

- Migrations apply cleanly.
- Idempotency uniqueness and workflow event append-only behavior are tested.
- No large artifact payloads are stored directly in operational tables.

### Phase 2.3 - Control API task/workflow surface

Deliverables:

1. Task creation/status/artifact endpoints.
2. Workflow and event endpoints.
3. Agent run/delegation read endpoints.
4. Skill listing endpoint.
5. OpenAPI updates and generated/shared types.

Acceptance criteria:

- Missing auth/policy/registry/budget/audit context returns typed errors.
- Portal can read workflow traces without DB access.

### Phase 2.4 - Workflow runtime skeleton

Deliverables:

1. Python runtime repository interfaces.
2. Postgres `SKIP LOCKED` dispatcher with bounded polling/backoff.
3. Basic lease/heartbeat and stale-lease recovery behavior.
4. Idempotent step execution primitives.
5. Fixture workflow runner.

Acceptance criteria:

- Happy-path persisted workflow completes.
- Worker restart smoke does not duplicate model/tool/cost artifacts.
- SQL details do not leak into supervisor/sub-agent logic.

### Phase 2.5 - Supervisor and sub-agent execution

Deliverables:

1. Supervisor planner and synthesis loop.
2. Sub-agent executor.
3. Governed model adapter through Bifrost.
4. Structured-output validation before synthesis.
5. Tainted-context handling in prompts/results.

Acceptance criteria:

- Parent creates at least two scoped delegations in fixture/non-production mode.
- Formal exit remains blocked until the same behavior works through two production-enabled aliases.
- Invalid child result blocks synthesis.

### Phase 2.6 - Budget reservation and settlement

Deliverables:

1. Workflow/delegation budget reservation APIs/helpers.
2. Transactional reservation, settlement, and release rows.
3. Cost events linked to workflow/delegation/model/tool execution.
4. Budget denial fixtures.

Acceptance criteria:

- No model/tool call can begin without reservation.
- Retry/restart cannot double-settle.
- Portal can inspect cost by workflow and delegation.

### Phase 2.7 - Read-only Tool Broker

Deliverables:

1. MCP-compatible read-only tool discovery.
2. Read-only tool call endpoint.
3. Deterministic tool policy checks.
4. Tool call persistence and audit.
5. Read-only fixture/local adapters.

Acceptance criteria:

- Read-only call succeeds under policy.
- Write/side-effect call is denied before adapter execution.
- Approval-bypass prompt injection fixture fails closed.

### Phase 2.8 - Skill registry skeleton

Deliverables:

1. Skill registry schema and static/durable metadata.
2. Skill lifecycle validator.
3. Skill visibility through Control API.
4. Eval gate refs for skill rollout.

Acceptance criteria:

- Non-production skills can be listed.
- Production skill status requires passing gate evidence and approval.
- Skill policy cannot widen tool/model permissions.

### Phase 2.9 - Task trace UI and observability

Deliverables:

1. Portal workflow list/detail.
2. Delegation tree.
3. Event timeline.
4. Cost and artifact panels.
5. Workflow/delegation/tool metrics.

Acceptance criteria:

- One task trace links all major orchestration components.
- UI displays no secrets or raw restricted artifacts.

### Phase 2.10 - Evals, validation evidence, and exit review

Deliverables:

1. Track 2 eval runner coverage.
2. Track 2 validation evidence document.
3. Exit checklist with production blockers explicitly marked.
4. Model alias production-gate evidence check.

Acceptance criteria:

- Track 2 fixture gates pass.
- Formal Track 2 exit remains blocked unless two production-enabled aliases are available and all other exit gates pass.

## 7. Dependency order

1. Phase 2.0 readiness checkpoint.
2. Phase 2.1 contract and schema lock.
3. Phase 2.2 database and migration foundation.
4. Phase 2.3 Control API task/workflow surface.
5. Phase 2.4 workflow runtime skeleton.
6. Phase 2.5 supervisor and sub-agent execution.
7. Phase 2.6 budget reservation and settlement.
8. Phase 2.7 read-only Tool Broker.
9. Phase 2.8 skill registry skeleton.
10. Phase 2.9 task trace UI and observability.
11. Phase 2.10 evals, validation evidence, and exit review.

Parallel-safe work after Phase 2.1:

- Tool Broker read-only contracts can proceed alongside DB schema work.
- Admin portal trace UI shell can proceed once Control API response shapes are stable.
- Evals/fixtures can proceed once schemas are locked.
- Observability labels/helpers can proceed once trace and ID fields are locked.
- Skill registry static validation can proceed before durable skill tables are fully wired.

## 8. Validation command matrix

| Command | Track 2 expectation |
|---|---|
| `pnpm workspace:validate` | Validate root tooling, schema catalog, eval layout, and generated artifacts. |
| `pnpm lint` | Preserve package lint health where lint tasks exist. |
| `pnpm typecheck` | Type-check Control API, portal, registry, policy, DB, observability, schemas, shared types, Tool Broker, and TS tool integrations. |
| `pnpm test` | Run unit/contract tests for task APIs, workflow state, idempotency, policy, budget, tool broker, portal views, and observability helpers. |
| `pnpm build` | Build app/package artifacts and no-emit checks according to existing Turborepo tasks. |
| `pnpm db:check` | Validate Drizzle schema/migrations including Track 2 tables. |
| `pnpm registry:validate` | Validate model aliases and skill registry refs where applicable. |
| `pnpm policy:validate` | Validate data-class, delegation, tool, and skill policy rules. |
| `pnpm eval:smoke` | Include Track 2 agent workflow/tool safety/orchestration fixtures or delegate to a documented Track 2 smoke command. |
| `pnpm local:dev` | Start local Control API, admin portal, Tool Broker, worker, and dependencies in development profile. |
| `pnpm local:status` | Show readiness for Control API, admin portal, Tool Broker, agent runtime worker, DB, Redis, Bifrost, and observability. |

## 9. Track 2 exit criteria

Track 2 formally exits only when all criteria below pass:

1. Track 0 production blockers are resolved or explicitly carried as production blockers with owner approval.
2. Track 1 production prerequisites needed by Track 2 are satisfied: production-enabled model aliases, provider policy, registry snapshots, virtual keys, budget, audit, cost, and Bifrost route evidence.
3. Parent agent delegates to at least two production-enabled model aliases through Bifrost.
4. Sub-agent results are schema-validated, stored, and synthesized with provenance.
5. Read-only tool calls are policy-checked, audited, stored, and visible in workflow traces.
6. Write/side-effecting tool calls are denied before adapter execution.
7. Per-delegation budget reservation, settlement, release, and denial work transactionally.
8. Workflow runtime persists state transitions and survives a basic worker restart smoke without duplicate billing.
9. Idempotency exists for workflow creation, step execution, model calls, tool calls, budget reservations, cost events, audit events, and artifact writes.
10. Task trace UI shows workflow, delegation, event, tool, artifact, cost, audit, and trace context through Control API only.
11. Agent workflow, tool safety, cost/budget, prompt-injection, and orchestration eval fixtures pass.
12. No production provider keys, raw virtual-key secrets, unrestricted DB rows, write tools, retrieval paths, memory paths, or production skills are enabled by default.

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Production-alias exit gate is blocked by Track 0/1 state | Track 2 implementation may finish in non-production but cannot formally exit. | Keep a non-production milestone separate from formal exit; mark production blockers visibly in validation evidence. |
| Idempotency added too late | Worker restart can duplicate model/tool calls and cost. | Build idempotency keys before dispatch and require them for every executable step. |
| SQL runtime leaks into agent logic | Later Hatchet/Temporal migration becomes expensive. | Use workflow repository/activity interfaces and keep SQL in infrastructure adapters. |
| Postgres polling contention | Worker dispatch can waste DB CPU. | Use bounded batch size, backoff, and future `LISTEN/NOTIFY` option if needed. |
| Workflow lease expires during long model stream | Duplicate or stuck execution. | Heartbeat while streaming; store provider request IDs and idempotency refs; recover conservatively. |
| Context window overflow during synthesis | Supervisor fails or hallucinates after oversized child outputs. | Enforce token budgets and governed summarization/compression before synthesis. |
| Artifact bloat in Postgres | Row size and DB backup pressure. | Store large payloads in object storage; Postgres stores metadata/hashes/refs only. |
| Sub-agent confused deputy | Child widens project/tool/data scope. | Inherit and recheck principal/project/data-class/tool/budget constraints at every step. |
| Prompt injection in tainted context | Model may attempt to approve tools or override policy. | Mark repo/tool/sub-agent content tainted; deterministic policy ignores model-supplied authority. |
| Tool Broker scope creep | Track 2 slips into write/external side effects. | Permit read-only tools only; deny all write/external tools with audit. |
| Budget race conditions | Parallel delegations overspend. | Transactional reservations and per-request Bifrost token caps before dispatch. |
| Trace fragmentation | Task trace UI cannot explain failures. | Persist trace context in workflow events and reconstruct it on worker pickup. |
| Eval smoke misses Track 2 | Production gates lack evidence. | Add agent workflow/tool safety/orchestration suites to smoke or a documented Track 2 gate command. |

## 11. Model-review log and resolutions

| Reviewer | Key critique | Resolution |
|---|---|---|
| Claude Opus 4.8 | Clarify production-disabled alias contradiction, Track 2/Track 3 boundary, and Track 0 blocker effect. | User confirmed production-alias formal exit, Track 2 skeleton plus idempotency/basic leases, and Track 0 blockers as production blockers. |
| GPT-5.5 | Current schema index lacks agent/workflow contracts; Tool Broker and agent runtime are placeholders; `eval:smoke` does not yet cover Track 2. | Added contract-lock phase, Tool Broker/agent-runtime implementation phases, and eval expansion requirements. |
| Gemini 3.1 Pro | Add workflow abstraction for future Hatchet/Temporal migration, idempotency before dispatch, object storage artifact handling, trace continuity, context limit gates, and prompt-injection defenses. | Added runtime repository abstraction, idempotency-first dispatch, artifact metadata/object storage plan, trace continuity acceptance criteria, context-limit handling, and tainted-context controls. |

## 12. Planning review sources

Primary repository sources reviewed:

- `docs\04-technology-roadmap-operations.md`
- `docs\02-agent-workflows-tools.md`
- `docs\01-system-architecture-and-interfaces.md`
- `docs\03-knowledge-retrieval-evaluation.md`
- `docs\impl-plan\track-0-architecture-lock-implementation-setup.md`
- `docs\impl-plan\track-1-gateway-control-foundation.md`
- `docs\governance\track-0-exit-decision.md`
- `docs\governance\track-0-readiness-validation.md`
- `docs\governance\track-1-validation-evidence.md`
- `docs\governance\gateway-policy-enforcement-contract.md`
- `docs\governance\dependency-rules.md`
- `docs\governance\eval-dataset-layout.md`
- `docs\governance\eval-runner-skeleton.md`
- `evals\datasets\agent-workflow.v0.1.json`
- `evals\datasets\tool-safety.v0.1.json`
- `apps\control-api`
- `apps\admin-portal`
- `apps\tool-broker`
- `workers\agent-runtime`
- `workers\tool-integrations`
- `workers\eval-runner`
- `packages\db`
- `packages\schemas`
- `packages\shared-types`
- `packages\policy`
- `packages\registry`
- `packages\observability`
