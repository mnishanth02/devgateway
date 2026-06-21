# Track 0 - Architecture Lock and Implementation Setup

## 1. Executive summary

Track 0 is the architecture hardening and implementation setup phase for the internal agentic AI platform. It should turn the current blueprint into a build-ready monorepo without enabling production model, tool, retrieval, or workflow paths. Its output is not a working product feature; its output is the set of decisions, contracts, schemas, registries, test skeletons, deployment plans, and ownership gates that make Tracks 1-4 safe to implement.

The repository should now be treated as the implementation monorepo. The existing documents remain the source architecture baseline:

- `AI-Platform-Proposal.md`
- `docs\01-system-architecture-and-interfaces.md`
- `docs\02-agent-workflows-tools.md`
- `docs\03-knowledge-retrieval-evaluation.md`
- `docs\04-technology-roadmap-operations.md`

Track 0 should lock what is already decided, make unresolved implementation setup choices explicit, and produce a readiness gate that blocks Track 1 until the platform can enforce policy, auth, eval, deployment, and ownership requirements.

## 2. Current-state analysis

### Repository state

The repository currently contains only architecture and roadmap documentation. There are no application packages, workspace configuration files, API services, database migrations, eval runner, deployment manifests, or tests yet.

### Architecture baseline already decided

The existing blueprint already locks these decisions:

| Area | Locked decision |
|---|---|
| Platform posture | Company-owned, single-tenant internal platform with project/team/user isolation. |
| Gateway | Self-hosted Bifrost OSS on Railway for provider access, virtual keys, budgets, routing, fallback, telemetry, and semantic cache hooks. |
| External MCP | Platform Tool Broker serves the external MCP endpoint; Bifrost is not exposed as a raw tool-policy surface. |
| Workflow runtime | Custom Postgres-backed durable workflow runtime for the first release, with mandatory migration triggers to Hatchet OSS or Temporal OSS. |
| Retrieval | Postgres full-text search, pgvector, self-hosted Neo4j Community, and object storage snapshots. |
| Identity | Better Auth OSS with Railway Postgres and invite-only internal accounts. |
| SCM/ACL source | GitHub App permission sync and CODEOWNER context. |
| Provider policy | Every outbound model call is checked against data class, provider terms, region, DPA/ZDR status, retention/training policy, and eval gate. |
| IDE protocols | OpenAI Chat Completions, Anthropic Messages, and MCP Streamable HTTP/SSE compatibility. |
| Async IDE task contract | Exactly five MCP tools: `start_background_task`, `check_task_status`, `get_task_result`, `cancel_task`, and `list_task_artifacts`. |
| UI stack | React, TanStack Router, TanStack Query, TanStack Table, and TanStack Virtual. |
| Deployment | Railway-first for first-release services and stores. |
| Observability | OpenTelemetry, Prometheus, Grafana, trace/eval/cost tables, and immutable audit events. |
| Validation | Evals are mandatory gates before production enablement of model aliases, routing changes, retrieval strategies, prompts, tools, and skills. |

### Track 0 deliverables from roadmap

Track 0 must deliver:

- Approved ADR set.
- Model/provider registry.
- Better Auth configuration, auth schema migration, initial admin bootstrap, and auth smoke tests.
- GitHub App permission model.
- Provider data-class matrix.
- Eval datasets and runner skeleton.
- Railway deployment plan.
- Schema and migration conventions.

Track 0 exits only when:

- No production model/tool/retrieval path can be enabled without an eval gate.
- Break-glass design is approved.
- First-release scope and owners are assigned.

## 3. Track 0 principles

1. Policy before capability: production routes stay disabled until eval and policy gates exist.
2. Contracts before implementations: define schemas, registries, API contracts, and ownership before feature behavior.
3. Deterministic enforcement outside agents: model output may request actions, but platform services approve, deny, sandbox, and audit.
4. Railway-first, portable interfaces: use Railway now, but keep Postgres, Redis protocol, S3-compatible storage, OpenTelemetry, and container boundaries portable.
5. ACL-first retrieval: permissions are evaluated before reranking, cache lookup, prompt assembly, tool execution, or display.
6. Audit everything material: model calls, policy decisions, provider-key access, tool calls, approvals, workflow states, eval gate decisions, and break-glass actions.
7. Default disabled: registry entries, providers, tools, skills, caches, and retrieval routes start disabled until gated.

## 4. Recommended monorepo shape

This is the locked baseline for the implementation monorepo:

```text
devgateway\
|-- apps\
|   |-- control-api\          # TypeScript API for admin/control surfaces
|   |-- admin-portal\         # Basic first-release React + TanStack admin portal
|   `-- tool-broker\          # MCP endpoint and tool policy API
|-- workers\
|   |-- agent-runtime\        # Python workers for orchestration/retrieval/agent tasks
|   |-- retrieval-indexer\    # Python ingestion, parsing, embeddings, graph extraction
|   |-- eval-runner\          # Eval execution and gate result writer
|   `-- tool-integrations\    # Node.js workers/adapters for TypeScript tool integrations
|-- packages\
|   |-- config\               # Shared typed configuration and env validation
|   |-- schemas\              # JSON schemas, OpenAPI, MCP/tool schemas, eval schemas
|   |-- db\                   # Schema, migrations, seed/bootstrap conventions
|   |-- policy\               # Provider/data-class/tool/budget policy definitions
|   |-- registry\             # Model/provider registry source files
|   |-- observability\        # OTel/logging/audit helpers
|   `-- shared-types\         # Generated and hand-authored shared TypeScript types
|-- infra\
|   |-- railway\              # Railway service topology, variable matrix, deploy notes
|   |-- bifrost\              # Bifrost config templates and registry sync plan
|   `-- runbooks\             # Operations and break-glass runbooks
|-- evals\
|   |-- datasets\             # Versioned eval case fixtures
|   |-- gates\                # Gate definitions and thresholds
|   `-- fixtures\             # Mock provider/tool/retrieval responses
|-- docs\
|   `-- ...                   # Existing architecture docs remain canonical
`-- scripts\                  # Safe local scripts for setup, checks, and validation
```

Recommended tooling to confirm:

| Concern | Recommendation | Reason |
|---|---|---|
| Package manager | pnpm workspaces | Locked. Efficient monorepo dependency management and strong workspace boundaries. |
| Build orchestration | Turborepo | Locked. Matches multi-service monorepo, supports filtered builds, and works well with Railway shared monorepo deploys. |
| TypeScript API services | Fastify + OpenAPI generation | Locked. Lightweight, explicit, good schema validation, easier than Nest for a small platform team. |
| Frontend | Vite + React + TanStack stack | Aligns with locked UI decision; TanStack Start remains out of first release. |
| TypeScript DB/migrations | Drizzle migrations for Operational Postgres and Better Auth schema integration | Locked. Type-safe schema ownership and generated types for API/portal packages. |
| Python workers | uv or Poetry; consume shared schema contracts | Locked for database ownership unless Knowledge Postgres later requires an independent Python-owned schema, in which case Alembic is allowed. |
| API contracts | OpenAPI 3.1 plus generated clients/types | Required by blueprint and keeps portal/API integration typed. |
| Schema contracts | JSON Schema with semantic version suffixes | Matches delegation/tool/eval contract requirements. |

## 5. Workstream A - Architecture lock and governance baseline

### Goal

Freeze the architecture baseline and make it enforceable for future implementation.

### Deliverables

1. ADR index that maps ADR-001 through ADR-017 to implementation owners, status, impacted packages, and follow-up gates.
2. Dependency rule map for service boundaries.
3. Architecture change-control checklist.
4. Track 0 readiness checklist.
5. First-release scope table with explicit owners.
6. Gateway Policy Enforcement Contract.
7. Security-boundary review covering auth, provider keys, break-glass, GitHub webhooks, ACL precedence, tainted context, and audit immutability.
8. Gate-result schema available before registry/policy implementation so production enablement can be validated mechanically.

### Implementation details

The ADR index should include:

| Field | Purpose |
|---|---|
| ADR ID | Stable reference such as `ADR-001`. |
| Decision | Short locked decision. |
| Owner | Person or role accountable for implementation consistency. |
| Impacted services/packages | Where the decision is implemented. |
| Gate | Eval, smoke test, security approval, or manual approval required before production. |
| Migration trigger | Conditions that require revisiting the decision. |
| Status | Accepted, superseded, pending owner, or pending approval. |

Dependency rules should explicitly forbid:

- Portal directly accessing provider keys or unrestricted database tables.
- Agents making final tool-policy or provider-policy decisions.
- Bifrost owning durable workflows, MCP policy, repository retrieval, memory, or human approvals.
- Retrieval results reaching a model before ACL checks.
- Production model aliases being enabled without eval gate records.
- Semantic cache reuse across principals/projects/ACL scopes.

### Gateway Policy Enforcement Contract

Track 0 must define exactly how Bifrost and platform policy cooperate before Track 1 builds gateway routes:

| Contract area | Track 0 decision to capture |
|---|---|
| Request context envelope | Principal, virtual key, project, data class, model alias, route intent, trace ID, policy version, registry version, and budget scope passed to the gateway/policy path. |
| Principal and project resolution | Control API/platform policy resolves principal and project metadata; Bifrost enforces virtual-key ingress and synced route policy. |
| Registry sync | Model/provider registry remains the source of truth; Bifrost config is generated or validated from registry snapshots. |
| Policy freshness | Missing, stale, or unverifiable registry/policy versions fail closed. |
| Denial taxonomy | Typed denial reasons for budget, rate limit, data-class, provider lifecycle, eval gate, policy stale, route disabled, and approval required. |
| Audit event shape | Every allow/deny includes actor, project, alias, provider candidate, policy version, registry version, reason, trace ID, and cost estimate where available. |

### Acceptance criteria

- Every ADR has an owner or a named pending-owner gap.
- Every Track 1 prerequisite maps to a Track 0 artifact.
- The architecture lock prevents production enablement without eval and policy gates.
- Gateway/platform policy responsibility is explicit enough that Track 1 cannot accidentally move tool or project policy into Bifrost.

## 6. Workstream B - Monorepo implementation setup

### Goal

Create the repo structure, tooling conventions, and package boundaries needed for later tracks.

### Deliverables

1. Workspace layout.
2. Root package/build configuration.
3. TypeScript strict configuration baseline.
4. Python worker dependency convention.
5. Shared schema/config package conventions.
6. Local development command matrix.
7. CI/readiness command plan.
8. Frozen OpenAI, Anthropic, MCP endpoint, and async task-tool contract schemas.

### Recommended root commands

| Command | Purpose |
|---|---|
| `pnpm lint` | Lint TypeScript packages once lint tooling exists. |
| `pnpm typecheck` | Type-check TS services/packages. |
| `pnpm test` | Run unit/contract tests. |
| `pnpm build` | Build app/package artifacts. |
| `pnpm eval:smoke` | Run eval skeleton smoke suite. |
| `pnpm db:check` | Validate migrations/schema contracts. |
| `pnpm registry:validate` | Validate model/provider registry against schema and fail production-enabled aliases without passing gate results. |
| `pnpm policy:validate` | Validate provider data-class matrix, denial taxonomy, and production route gate references. |

### Locked external contract schemas

Track 0 should create schema stubs for the externally visible contracts that later tracks must not reinterpret:

- OpenAI-compatible `GET /v1/models` and `POST /v1/chat/completions`.
- Anthropic-compatible `GET /v1/models`, `POST /v1/messages`, and `POST /v1/messages/count_tokens`.
- MCP `POST /mcp`, `GET /mcp/sse`, and `POST /mcp/messages`.
- Async MCP task tools:
  - `start_background_task`
  - `check_task_status`
  - `get_task_result`
  - `cancel_task`
  - `list_task_artifacts`

### Railway monorepo note

For services importing shared packages, Railway should keep the full repository context and use filtered build/start commands rather than setting restrictive service root directories. Watch patterns should prevent unrelated package changes from redeploying every service.

Bifrost is an exception to the TS/Python monorepo build path: it should run from the upstream Docker/Go runtime with declarative config and environment variables generated or validated from the registry/policy artifacts.

## 7. Workstream C - Model/provider registry

### Goal

Create the single source of truth for model aliases, provider candidates, routing eligibility, policy constraints, and eval status.

### Deliverables

1. Registry schema.
2. Initial registry file.
3. Registry validator.
4. Registry-to-Bifrost synchronization design.
5. Production enablement gate.

### Registry fields

Each model alias must declare:

- Alias name.
- Candidate provider/model IDs.
- Wire format: OpenAI Chat Completions, Anthropic Messages, or provider-native translated through Bifrost.
- Tokenizer/counting source.
- Context window and output limit.
- Input/output/cache/batch prices with timestamp.
- Tool-call support and schema dialect.
- Structured-output support and validation strategy.
- Streaming support.
- Data residency and allowed data classes.
- Provider retention/training/DPA/ZDR posture.
- Rate limits.
- Eval suite and latest gate status.
- Routing tier and fallback aliases.
- Lifecycle status: `experimental`, `approved`, `deprecated`, or `disabled`.
- Manual approval gate when applicable, especially for Azure/AWS/GCP/Vertex-backed candidates.

### Initial alias posture

All aliases should start disabled for production:

| Alias | Purpose | Initial status |
|---|---|---|
| `devgateway/orchestrator` | Supervisor/decomposition/synthesis | Disabled until gateway/model smoke and agent orchestration eval pass. |
| `devgateway/deep-reasoning` | Architecture and high-complexity planning | Disabled until deep-reasoning eval pass. |
| `devgateway/code-review` | Diff review and bug/security finding | Disabled until code-review eval pass. |
| `devgateway/large-context` | Large docs/repos/context packs | Disabled; Google Vertex route remains manual-approval gated if used. |
| `devgateway/fast` | Low-cost high-volume tasks | Disabled until fast-task eval pass and data-class policy allows. |
| `devgateway/retrieval-planner` | Query planning and context-pack construction | Disabled until retrieval planning eval pass. |

### Enforceable production gate

The registry validator must make the Track 0 exit criterion mechanically checkable:

- A model alias, fallback route, tool, prompt template, retrieval strategy, skill, or index version cannot be marked production-enabled unless it references a gate-result record.
- The referenced gate-result record must match the change ID, dataset version, suite version, and artifact version being enabled.
- The gate result must have `pass=true`, no blocking severity finding, and an approver when owner approval is required.
- Disabled, experimental, and draft entries can exist without a passing production gate, but they must be impossible to route from production keys.
- CI/readiness checks must run `registry:validate` and `policy:validate` before Track 0 exit.

## 8. Workstream D - Provider data-class matrix

### Goal

Make routing decisions deterministic and auditable before any outbound model call.

### Data classes

| Data class | Routing rule |
|---|---|
| `public` | Any approved provider/model alias. |
| `internal` | Approved providers with acceptable retention/training terms. |
| `confidential` | Providers with DPA/ZDR or explicit company approval; traces redact sensitive snippets. |
| `restricted` | No external model calls; deterministic tooling or approved self-hosted route only. |

### Deliverables

1. Provider policy schema.
2. Provider matrix file.
3. Policy evaluation order.
4. Denial reason taxonomy.
5. Policy eval dataset with allowed/denied cases.
6. Registry/policy/gate cross-check validator.

### Deterministic policy order

1. Resolve principal and project.
2. Resolve project data class and requested task/tool context.
3. Resolve requested model alias and provider candidate.
4. Check provider lifecycle and approval gate.
5. Check data-class allowlist, DPA/ZDR, retention/training, region, and trace storage policy.
6. Check eval gate status for alias/routing/prompt/tool/retrieval strategy.
7. Check budget/rate limit.
8. Check semantic-cache eligibility and ACL-scoped cache key requirements.
9. Select route or return a typed denial.

## 9. Workstream E - Better Auth identity baseline

### Goal

Define the first-release human authentication foundation without adding hosted auth dependencies.

### Deliverables

1. Better Auth server configuration skeleton.
2. Auth schema migration plan.
3. Initial admin bootstrap plan.
4. Auth smoke-test skeleton.
5. Security checklist.
6. Audit-event requirements for auth mutations.

### Required security posture

- Strong `BETTER_AUTH_SECRET`; never committed.
- `BETTER_AUTH_URL` set per environment.
- Trusted origins configured explicitly.
- CSRF and origin checks enabled.
- Secure cookies in production.
- Invite-only or admin-created users.
- Rate limiting enabled, preferably persistent database or Redis-backed storage.
- Admin TOTP 2FA required before production/provider-key access.
- Session expiry and refresh policy documented.
- Session/user/account hooks emit audit events.
- Generic auth errors to prevent account enumeration.
- Service principals use signed service tokens, not Better Auth human sessions.

### Smoke tests

| Test | Expected result |
|---|---|
| `GET /api/auth/ok` | Returns `{ "status": "ok" }`. |
| Missing/invalid origin | Denied by trusted-origin/CSRF policy. |
| Invite-only sign-up | Uninvited user cannot create account. |
| Valid admin sign-in | Session created and audit event emitted. |
| Sensitive endpoint rate limit | Excess attempts denied with typed error. |
| Admin without TOTP after production gate | Denied from provider-key/admin-sensitive actions. |
| Session revoke | Session invalidated and audit event emitted. |

## 10. Workstream F - GitHub App permission model

### Goal

Define GitHub as the first-release SCM and source-of-truth permission graph for repository content.

### Deliverables

1. GitHub App scope matrix.
2. Permission entity model.
3. Webhook validation and sync rules.
4. Stale-sync default-deny behavior.
5. ACL safety eval cases.

### Permission model entities

- GitHub installation.
- GitHub organization.
- Repository.
- Branch/ref.
- Team.
- Collaborator.
- CODEOWNER rule.
- Principal GitHub account link.
- Platform role.
- Permission grant.
- Sync run.
- Sync stale marker.

### Required rules

- Platform roles can grant portal visibility but cannot exceed GitHub restrictions for private repo content.
- Shared anonymous team keys are forbidden for retrieval.
- Every chunk, entity, relation, memory item, and context pack stores ACL scope and index version.
- Permission sync lag greater than the SLO causes default-deny for repo-aware retrieval.
- Webhooks are signed and idempotent.
- ACL checks are repeated immediately before prompt assembly.
- Knowledge, graph, memory, and context-pack rows include `project_id`, `acl_scope_hash`, source reference, and `index_version` where applicable.

## 11. Workstream G - Schema and migration conventions

### Goal

Prevent schema drift across the TypeScript services, Python workers, eval runner, and future retrieval stack.

### Recommended conventions

| Concern | Convention |
|---|---|
| Table names | Singular snake_case. |
| Column names | Singular snake_case. |
| Internal relational IDs | `BIGINT GENERATED ALWAYS AS IDENTITY`. |
| Public opaque IDs | UUIDv7 or prefixed text IDs where external exposure requires opacity. |
| Time values | `TIMESTAMPTZ`, not timestamp without time zone. |
| Status fields | `TEXT` with CHECK constraints instead of custom ENUMs. |
| Foreign keys | Explicit `ON DELETE` behavior and indexed FK columns. |
| Audit events | Append-only, immutable, actor-scoped, request-correlated. |
| JSON data | `JSONB` only for flexible metadata, not core relational fields. |
| Migrations | Forward-only by default, reversible where safe, reviewed before deployment. |
| Seeds | Separate bootstrap/admin seed from test fixtures. |
| Sensitive credentials | Store ciphertext plus metadata only; provider keys and break-glass credentials use application-level encryption with key material supplied through Railway variables. |
| Tenant/ACL scope | Knowledge, memory, graph metadata, and context-pack tables include `project_id`, `acl_scope_hash`, source reference, and `index_version` columns. |
| High-volume append-only tables | Define retention, archive, partitioning candidates, and indexes before production for `audit_event`, `request_log`, `workflow_event`, `cost_event`, and `eval_run`. |

### Migration ownership decision

Track 0 must lock migration ownership before creating schema stubs:

| Store | Recommended owner/tool |
|---|---|
| Operational Postgres | Locked to TypeScript `packages\db` using Drizzle migrations for auth, tenancy, policy, workflow, audit, cost, and eval-gate tables. |
| Better Auth tables | Locked to Better Auth CLI/config output reconciled into the Operational Postgres Drizzle migration plan, with table naming/mapping documented. |
| Knowledge Postgres | Python retrieval/indexing domain can use Alembic only if it owns independent knowledge schemas; otherwise it consumes generated contracts from `packages\db`. |
| pgvector/UUID helpers | Extension policy must be explicit; install extension operations are approval-gated/user-run when required by the environment. |
| Python workers | Consume generated schema contracts and typed query/data-access boundaries; no independent migrations unless explicitly approved. |

`db:check` should validate migrations against a disposable or shadow Postgres database before Track 0 exit.

### Audit immutability convention

Audit tables should be immutable by database enforcement, not convention alone. Track 0 should choose one of:

- Separate app roles where normal runtime roles have INSERT only and no UPDATE/DELETE on `audit_event`.
- A database trigger that rejects UPDATE/DELETE on immutable audit tables.
- Both for production environments.

### Initial schema domains

| Domain | Representative tables |
|---|---|
| Identity/tenancy | `org`, `team`, `project`, `principal`, `role`, `permission_grant`, `virtual_key`. |
| Provider/model | `provider`, `model`, `model_alias`, `capability`, `price_snapshot`, `rate_limit`, `routing_policy`. |
| Agents/workflows | `agent_definition`, `agent_run`, `delegation`, `workflow_definition`, `workflow_run`, `workflow_step`, `step_attempt`, `workflow_event`, `workflow_outbox`, `workflow_lease`, `task_artifact`. |
| Tools/MCP/skills | `tool_definition`, `mcp_server`, `tool_policy`, `tool_call`, `approval_request`, `sandbox_run`, `skill_definition`, `skill_version`. |
| Knowledge | `knowledge_source`, `document`, `chunk`, `embedding`, `entity`, `relation`, `repo_symbol`, `api_endpoint`, `decision`. |
| Memory | `working_memory`, `episodic_summary`, `semantic_memory`, `decision_memory`, `memory_correction`, `retention_policy`. |
| Observability/evals | `request_log`, `trace_ref`, `eval_dataset`, `eval_case`, `eval_run`, `metric`, `cost_event`, `audit_event`. |

## 12. Workstream H - Eval datasets and runner skeleton

### Goal

Create the minimum eval control plane before any production enablement.

### Deliverables

1. Eval dataset directory convention.
2. Eval case schema.
3. Eval runner CLI skeleton.
4. Gate definition schema.
5. Gate result persistence contract.
6. Mock/fixture provider so evals run before real gateway integration.
7. Validator integration so registry/policy production enablement fails without matching passing gates.

### Initial eval suites

| Suite | Minimum first skeleton |
|---|---|
| Gateway/model smoke | Fixture cases for auth, streaming, usage attribution, fallback, and error shape. |
| Provider data policy | All data classes x approved provider classes with allowed/denied expectations. |
| Retrieval recall | Placeholder known-answer cases and citation requirements. |
| Faithfulness | Adversarial/contradiction fixtures. |
| ACL safety | Cross-project, cross-principal, cache, and context-ref leak cases. |
| Prompt injection and tainted context | Retrieved-content instruction override, permission widening, hidden approval, and tool-bypass attempts. |
| Tool safety | Allowed/denied tool-plan cases and approval-bypass checks. |
| Agent workflow | Restart/resume, budget, delegation, and state persistence fixtures. |
| Persona answers | Product, business, architecture, support, and executive answer contract fixtures. |
| Cost/latency | Cost attribution and gateway overhead measurement shape. |

### Gate result contract

Each gate result should include:

- Change ID.
- Dataset version.
- Eval suite version.
- Runner version.
- Model alias/provider where relevant.
- Retrieval strategy/prompt/tool/skill/index version where relevant.
- Metrics.
- Thresholds.
- Pass/fail decision.
- Blocking severity.
- Reviewer/approver.
- Artifact references.
- Audit event ID.

### Gate dependency ordering

Gate schema and gate-result schema should be created before registry/policy validators are finalized. Domain-specific fixtures such as ACL safety and tool safety should depend on the common eval case schema rather than inventing local formats.

## 13. Workstream I - Railway deployment plan

### Goal

Make deployment topology and variable ownership explicit before provisioning production resources.

### Environments

Recommended environment names:

- `development`
- `production`

Track 0 should produce configuration artifacts for both environments. Production provisioning remains explicit-approval gated.

### Services and stores

| Service/store | Track 0 output |
|---|---|
| Bifrost gateway | Upstream Docker/Go runtime plan, config template, registry sync plan, virtual-key policy integration points. |
| Control API | Service definition, env variables, DB connection policy, health check. |
| Admin portal | Service definition, build command, API URL variables, auth origin settings. Stakeholder portal remains post-first-production-release. |
| Tool Broker | MCP endpoint service plan, tool registry dependency, approval policy dependency. |
| Agent/Workflow workers | Worker service plan, queue/lease variables, DB/object storage dependencies. |
| Retrieval/Indexing workers | Worker service plan, knowledge DB, object storage, Neo4j, retrieval strategy toggles, context budget/compression controls, and embedding model/reranker route variables. |
| Eval runner | On-demand/worker plan, fixture mode, DB/object storage output. |
| Operational Postgres | Auth, policies, workflows, audit, budgets, eval gates. |
| Knowledge Postgres | Sources, chunks, full-text/symbol metadata, pgvector. |
| Redis | Short-lived queues, locks, secondary auth/rate-limit storage if selected. |
| Object storage | Artifacts, source snapshots, generated docs, trace bundles. |
| Neo4j Community | Graph traversal store with backup/restore plan. |
| OpenTelemetry Collector | Trace/metric collection topology and service variables. |
| Prometheus | Metrics scrape/storage plan for Bifrost and platform services. |
| Grafana | Dashboard service/config plan for gateway, workflow, retrieval, cost, and SLO views. |

### Variable groups

- Auth: Better Auth URL/secret, trusted origins, admin bootstrap controls.
- Database: operational DB URL, knowledge DB URL, migration role, read-only role if used.
- Redis: URL, queue namespace, rate-limit namespace.
- Bifrost/provider: provider keys, virtual-key config, route config, break-glass controls.
- GitHub App: app ID, installation IDs, private key, webhook secret.
- Object storage: endpoint, bucket, access key, secret key, region.
- Observability: OTel endpoint, service name, environment, trace sampling, metrics push/export config.
- Eval: dataset path, gate mode, artifact bucket, fixture/provider mode.
- Secrets/encryption: application encryption key reference, credential key version, rotation controls, and audit correlation settings.

### Deployment rules

- Do not provision or deploy production services before Track 0 approval.
- Use Railway JSON/explicit service IDs for scripted operations.
- Use `railway add --json` for services/databases to avoid duplicate ambiguous creation.
- Use full-repo shared monorepo builds when services import shared packages.
- Configure watch patterns per service.
- Define health endpoints before deployment.
- Validate backup/restore plan for Postgres, object storage, and Neo4j before first production release.

### Railway config artifact strategy

Track 0 should represent the deployment plan as versioned artifacts, not dashboard-only notes:

- Per-service build/start/watch/health matrix.
- Service owner and environment owner matrix.
- Variable matrix by environment with secret/non-secret classification.
- Bifrost Docker image/config strategy.
- Monorepo filtered build/start command strategy for TS/Python services.
- Migration execution policy for deploys.
- Backup/restore checklist for Operational Postgres, Knowledge Postgres, object storage, and Neo4j volume.
- Observability service topology for OpenTelemetry Collector, Prometheus, and Grafana.

## 14. Workstream J - Break-glass and runbooks

### Goal

Make emergency provider access safe, scoped, auditable, and temporary.

### Break-glass runbook fields

- Trigger.
- Requester.
- Approvers.
- Scope.
- Provider/model aliases allowed.
- Data classes allowed.
- TTL, max 4 hours.
- Credential storage/access path.
- Audit event fields.
- Restrictions: no repo retrieval cache and no side-effecting tools.
- Recovery steps.
- Provider-key rotation after use.
- Incident report linkage.

### Track 0 approval need

The break-glass design must be approved before Track 1 can enable gateway/model routes.

### Required degraded-mode tests

Track 0 should define the degraded-mode tests that Track 1 must later execute:

- Bifrost unavailable triggers break-glass request path.
- Break-glass service principal expires automatically at TTL.
- Break-glass route blocks repository retrieval cache and side-effecting tools.
- Provider-key use emits immutable audit events.
- Route is disabled after recovery and used provider keys are rotated.

## 15. Track 0 implementation sequence

### Phase 0.1 - Confirm unresolved setup decisions

1. Confirm owner model for architecture, security, eval, Railway, GitHub, and break-glass decisions.

### Phase 0.2 - Add implementation skeleton

1. Create workspace/package layout.
2. Add root config and empty package placeholders.
3. Add shared schema/config/registry/policy package placeholders.
4. Add initial check commands.
5. Add environment example conventions without secrets.

### Phase 0.3 - Lock architecture governance

1. Add ADR index.
2. Add architecture dependency rules.
3. Add change-control checklist.
4. Add Track 0 readiness checklist.
5. Add Gateway Policy Enforcement Contract.
6. Add first-release owner matrix.

### Phase 0.4 - Define schema and auth baseline

1. Add DB naming/migration conventions.
2. Lock migration ownership by database/domain.
3. Add encrypted credential storage and audit immutability conventions.
4. Add tenant/ACL schema conventions.
5. Add initial domain schema map.
6. Add Better Auth configuration skeleton.
7. Add auth migration plan.
8. Add admin bootstrap plan.
9. Add auth smoke-test skeleton.

### Phase 0.5 - Define provider/model/policy baseline

1. Add shared gate-result schema.
2. Add model/provider registry schema.
3. Add initial disabled aliases.
4. Add provider data-class matrix.
5. Add typed denial reasons.
6. Add registry/policy/gate validation commands.

### Phase 0.6 - Define GitHub permission baseline

1. Add GitHub App scope matrix.
2. Add permission sync entity model.
3. Add webhook validation rules.
4. Add stale-sync default-deny rules.
5. Add ACL safety eval fixtures using the shared eval case schema.

### Phase 0.7 - Define eval baseline

1. Add eval dataset layout.
2. Add eval case schema.
3. Add gate schema.
4. Add fixture-mode runner skeleton.
5. Add gate-result persistence contract.
6. Add prompt-injection and tainted-context safety fixtures.

### Phase 0.8 - Define deployment and operations baseline

1. Add Railway topology.
2. Add service variable matrix.
3. Add monorepo deploy command plan.
4. Add Bifrost Docker/config deployment strategy.
5. Add OpenTelemetry Collector, Prometheus, and Grafana topology.
6. Add backup/restore and observability plan.
7. Add break-glass runbook draft.
8. Add production runbook backlog.

### Phase 0.9 - Readiness review

1. Validate all registries/schemas/policies.
2. Run smoke checks for skeleton commands.
3. Confirm owners.
4. Confirm break-glass approval.
5. Confirm validators fail any production route, alias, tool, prompt, skill, retrieval strategy, or index version without matching passing eval gate.
6. Produce Track 0 exit decision.

## 16. Acceptance criteria

Track 0 is complete when:

- ADRs are indexed, owned, and accepted or explicitly pending.
- Model/provider registry exists and validates against schema.
- All initial model aliases are disabled or non-production gated.
- Provider data-class matrix exists and validates allowed/denied routing cases.
- Better Auth baseline is defined with secure defaults and smoke tests.
- GitHub App permission model is defined with stale-sync default-deny behavior.
- Schema and migration conventions are documented and represented in package conventions.
- Eval runner skeleton can execute fixture suites and produce gate-shaped results.
- Registry and policy validators fail production enablement without matching passing gate results.
- Railway deployment plan defines services, stores, environments, variables, and operational checks.
- OpenTelemetry Collector, Prometheus, and Grafana are represented in the deployment plan.
- Encrypted credential storage, tenant/ACL scope, high-volume retention, and audit immutability conventions are locked.
- Break-glass runbook is approved.
- First-release scope and owners are assigned.
- Track 1 is blocked from production enablement without registry, provider-policy, auth, eval, deployment, and break-glass gates.

## 16.1 Track 0 exit criteria

Track 0 exits only when these roadmap criteria are satisfied exactly:

1. No production model/tool/retrieval path can be enabled without an eval gate. This must be enforced by validators, not just documented.
2. Break-glass design is approved, including TTL, scope, approvers, audit, recovery, and provider-key rotation.
3. First-release scope and owners are assigned, with named people or explicit interim accountable roles.

## 17. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Building features before gates | Unsafe model/tool/retrieval routes | Keep all aliases/tools/routes disabled until eval gate exists. |
| Ambiguous service ownership | Slow reviews and inconsistent boundaries | Owner matrix required for Track 0 exit. |
| Auth under-secured during internal rollout | Account compromise or provider-key exposure | Secure Better Auth defaults, TOTP for admin/provider-key actions, audit hooks. |
| GitHub permission sync stale | Unauthorized retrieval | Stale sync defaults to deny; ACL eval suite blocks release. |
| Registry drift from Bifrost config | Wrong routing or policy bypass | Registry is source of truth; Bifrost config sync validates against it. |
| Railway monorepo misconfiguration | Broken builds or hidden shared packages | Use shared monorepo pattern and watch paths. |
| Schema split across TS/Python | Data drift | Central schema package and generated/shared contracts. |
| Eval runner treated as optional | Ungated production changes | Track 0 exit blocks without runner skeleton and gate schema. |
| Break-glass overreach | Ungoverned provider use | TTL, approvals, scope limits, audit, post-use key rotation. |
| Observability omitted from topology | Track 1 cannot prove SLOs or gateway overhead | Include OTel Collector, Prometheus, Grafana, trace/eval/cost tables, and dashboard ownership in Track 0 deployment artifacts. |
| Audit immutability by convention only | Provider-key or break-glass history can be altered | Enforce append-only audit at DB role/trigger level. |

## 18. Clarifications resolved

All Track 0 implementation setup decisions needed for this planning pass are resolved. Named people can replace interim owner roles during implementation, but Track 0 cannot exit until named people or explicitly approved accountable roles are assigned.

Confirmed:

- Monorepo/build setup is pnpm workspaces plus Turborepo.
- Node.js API framework is Fastify with OpenAPI generation for Control API and Tool Broker.
- Migration ownership is Drizzle in `packages\db` for Operational Postgres and Better Auth schema integration; Alembic is reserved only if Knowledge Postgres needs independent Python-owned schema.
- Railway environments are `development` and `production`; Track 0 produces configuration artifacts and production provisioning remains explicit-approval gated.
- First-release secrets strategy is Railway variables plus application-encrypted Operational Postgres records for provider keys and break-glass credentials; Infisical, Vault, cloud secret managers, and cloud KMS are deferred unless manually approved.
- Admin TOTP 2FA remains required before production use and before any provider-key or break-glass credential access.
- Owner model is interim role-based ownership, with named people required before Track 0 exit.

Interim owner roles:

| Area | Interim owner role |
|---|---|
| ADR approval | Platform architecture owner |
| Security policy | Platform security owner |
| Eval gates | Evaluation owner |
| Railway operations | Platform operations owner |
| GitHub App permissions | SCM integration owner |
| Break-glass approval | Platform lead plus engineering lead; production-impacting tools require CTO/founder approval |

## 19. Model review log

Reviewed by:

- Claude Opus 4.8
- GPT-5.5
- Gemini 3.1 Pro

Incorporated findings:

- Made eval gating mechanically enforceable through registry/policy validators.
- Added Gateway Policy Enforcement Contract for Bifrost/platform policy boundaries.
- Added OpenTelemetry Collector, Prometheus, and Grafana to Railway topology.
- Added encrypted credential storage, tenant/ACL columns, high-volume retention, migration ownership, and DB-enforced audit immutability conventions.
- Added prompt-injection/tainted-context evals and locked async MCP tool schemas.
- Clarified Bifrost Docker/config deployment separately from TS/Python monorepo builds.
- Clarified first-release admin portal scope and deferred stakeholder portal expansion.
