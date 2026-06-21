# Architecture Dependency and Service-Boundary Rules

## Purpose

These rules lock the Track 0 service boundaries before implementation starts. They are review requirements, not production enablement. All production model, tool, retrieval, workflow, cache, and provider routes remain disabled until their future policy, ACL, audit, approval, and eval gates are implemented and recorded.

## Enforcement posture

- Default deny and fail closed for every boundary decision.
- Missing, stale, or unverifiable identity, project, ACL, registry, policy, eval-gate, or audit context must deny the request.
- Model and agent output is advisory only; deterministic platform services make final allow/deny decisions.
- Any path that cannot prove principal, project, data class, ACL scope, policy version, registry version, and trace ID must stop before provider, tool, retrieval-result, cache, or workflow execution.
- Generated infrastructure or gateway configuration must be validated from source registries and policies; generated config is never the source of truth.

## Explicitly forbidden dependencies and ownership transfers

The following are hard architectural violations:

- Portal directly accessing provider keys or unrestricted database tables.
- Agents making final tool-policy or provider-policy decisions.
- Bifrost owning durable workflows, MCP policy, repository retrieval, memory, or human approvals.
- Retrieval results reaching a model before ACL checks.
- Production model aliases being enabled without eval gate records.
- Semantic cache reuse across principals/projects/ACL scopes.

Additional forbidden patterns:

- UI, agent, or worker code reading raw provider credentials instead of using controlled gateway or broker surfaces.
- Runtime code enabling a provider, model alias, tool, skill, retrieval route, semantic cache, or workflow route by default.
- Repository, document, vector, graph, or artifact content being assembled into prompts before identity and ACL filtering.
- Cross-project cache keys, prompt contexts, artifacts, traces, or workflow state that omit principal, project, and ACL scope.
- Infrastructure files or Bifrost templates becoming the durable owner of policy, registry, approval, memory, or workflow state.

## Allowed dependency direction map

### Apps

| Area | May depend on | Must not depend on | Boundary rule |
|---|---|---|---|
| `apps\admin-portal` | Generated API clients, `packages\schemas`, `packages\shared-types`, public control-plane endpoints from `apps\control-api` | Provider keys, direct database connections, unrestricted tables, Bifrost admin surfaces, worker internals | The portal is a presentation surface. It requests actions from `control-api`; it never enforces final policy or reads secrets directly. |
| `apps\control-api` | `packages\config`, `packages\schemas`, `packages\db`, `packages\policy`, `packages\registry`, `packages\observability`, `packages\shared-types`, Better Auth, GitHub App sync, approved job/workflow queues | Raw model-provider calls, agent-only decisions, Bifrost-owned policy state | The control API resolves principals, projects, ownership, ACL context, registry state, policy decisions, approvals, and audit writes. |
| `apps\tool-broker` | `packages\schemas`, `packages\policy`, `packages\registry`, `packages\observability`, `packages\shared-types`, `control-api` decision endpoints, approved worker queues | Direct portal state, raw unrestricted DB access, Bifrost as MCP policy owner | The tool broker owns the external MCP endpoint and delegates final policy checks to deterministic platform policy surfaces before tool execution. |

### Workers

| Area | May depend on | Must not depend on | Boundary rule |
|---|---|---|---|
| `workers\agent-runtime` | `packages\schemas`, `packages\policy`, `packages\registry`, `packages\observability`, controlled workflow state, approved retrieval/tool APIs, Bifrost only after policy context exists | Final provider-policy decisions, final tool-policy decisions, provider keys, direct prompt assembly from unchecked retrieval results | Agents may propose actions and model calls, but platform policy must approve before execution. |
| `workers\retrieval-indexer` | `packages\schemas`, `packages\db`, `packages\observability`, repository snapshots, object storage, Postgres FTS/pgvector, Neo4j | Prompt/model delivery paths that bypass ACL checks, cross-principal cache reuse | Ingestion can build indexes, but serving retrieval context requires principal/project/ACL filtering before model exposure. |
| `workers\eval-runner` | `evals\datasets`, `evals\gates`, `evals\fixtures`, `packages\schemas`, `packages\registry`, `packages\policy`, `packages\db`, `packages\observability` | Runtime production enablement switches, unreviewed provider credentials | Eval runner writes gate records; it does not silently enable production aliases or routes. |
| `workers\tool-integrations` | `packages\schemas`, `packages\policy`, `packages\observability`, `tool-broker` approved requests, external tool APIs | Independent tool authorization, portal secrets, unrestricted database tables | Tool adapters execute only already-authorized requests and emit audit evidence. |

### Packages

| Area | May depend on | Must not depend on | Boundary rule |
|---|---|---|---|
| `packages\config` | Environment schema definitions and validation libraries | Apps, workers, infra runtime state | Configuration is typed and validated; missing required production safety config fails closed. |
| `packages\schemas` | Schema definitions and generated contract artifacts | Runtime secrets or service implementations | Schemas define contracts and must not contain capability-enabling defaults. |
| `packages\db` | Schema, migrations, seed/bootstrap conventions, database clients for owning services | Portal imports, Bifrost policy ownership | Database ownership is mediated through service APIs and migrations, not UI or gateway templates. |
| `packages\policy` | Schemas, config, registry references, data-class/tool/provider/budget rules | Agent output as authority, Bifrost-generated policy as source | Policy package is the deterministic source for allow/deny logic and denial reasons. |
| `packages\registry` | Schemas and config for model/provider aliases and lifecycle | Production aliases without gate references, Bifrost config as source of truth | Registry source controls provider eligibility; generated gateway config must match it. |
| `packages\observability` | Shared logging, tracing, metrics, and audit helpers | Policy ownership or secret storage | Observability records decisions but does not make them. |
| `packages\shared-types` | Generated and hand-authored shared types | Service runtime implementations | Shared types remain leaf contracts usable by apps, workers, evals, and scripts. |

### Infra

| Area | May depend on | Must not depend on | Boundary rule |
|---|---|---|---|
| `infra\railway` | Service topology, variable matrix, deploy notes, validated package outputs | Production-enabling defaults, secret material committed to repo | Deployment plans describe disabled-by-default services and required gates. |
| `infra\bifrost` | Generated or validated config from `packages\registry` and `packages\policy`, provider virtual-key ingress, routing, budgets, fallback, telemetry, semantic-cache hooks | Durable workflows, MCP policy, repository retrieval, memory, human approvals, source-of-truth registry/policy | Bifrost is a gateway enforcement component, not the platform policy owner. |
| `infra\runbooks` | Approved operations, break-glass, rollback, and incident procedures | Silent bypasses of audit, eval, ACL, approval, or policy gates | Operational procedures must preserve auditability and require explicit approvals. |

### Evals

| Area | May depend on | Must not depend on | Boundary rule |
|---|---|---|---|
| `evals\datasets` | Versioned fixtures and schema contracts | Production traffic or secrets | Datasets are non-production fixtures unless explicitly classified and approved. |
| `evals\gates` | Gate definitions, thresholds, registry/policy references | Runtime alias toggles without review | Gates define required evidence before production capability enablement. |
| `evals\fixtures` | Mock provider, tool, retrieval, and workflow responses | Live provider/tool credentials by default | Fixtures support validation without enabling production paths. |

### Docs and scripts

| Area | May depend on | Must not depend on | Boundary rule |
|---|---|---|---|
| `docs` | Architecture decisions, governance, implementation plans, readiness checklists | Runtime secrets or production-enabling config | Documentation records decisions and review gates; it does not enable capabilities. |
| `scripts` | Local setup, validation, registry/policy/eval checks, generated artifact verification | Default production enablement, secret exfiltration, policy bypass flags | Scripts may validate or generate artifacts, but production-impacting actions must require explicit gated inputs. |

### External systems

| External system | Allowed relationship | Forbidden relationship |
|---|---|---|
| Bifrost | Provider gateway for virtual keys, route enforcement from synced registry/policy, budgets, fallback, telemetry, semantic-cache hooks | Owning durable workflows, MCP policy, repository retrieval, memory, human approvals, or source-of-truth provider policy |
| Model providers | Invoked only through approved gateway paths after policy, data-class, eval, budget, and audit checks | Direct calls from portal, agents, or unrestricted workers |
| Better Auth | Identity/session source consumed by control-plane services | UI or workers inventing principals or bypassing auth context |
| GitHub App | Source for repository permissions, CODEOWNER context, and ACL sync | Retrieval or tool execution that ignores synced ACL state |
| Postgres, pgvector, Neo4j, object storage, Redis-compatible stores | Accessed through owning services/workers with scoped credentials and audit context | Unrestricted portal access, cross-project context leakage, or ACL-free retrieval serving |
| Human approval systems | Approval records consumed by control-plane policy and durable workflows | Bifrost or agents granting final approvals by themselves |

## Review-time fail-closed checks

A PR must be rejected or redesigned when any answer is unknown, unverifiable, or "not yet enforced":

- Does the change preserve default-disabled providers, aliases, tools, skills, retrieval routes, caches, and workflows?
- Can every model call prove principal, project, data class, alias, provider candidate, policy version, registry version, eval-gate record, trace ID, and audit event?
- Can every retrieval result prove ACL filtering happened before prompt assembly, reranking output exposure, cache lookup/reuse, tool execution, or display?
- Are semantic cache keys scoped by principal, project, data class, ACL scope, registry version, policy version, and retrieval corpus/version where applicable?
- Does the portal call a control-plane API instead of directly reading provider keys, unrestricted tables, or gateway internals?
- Are agents prevented from making final provider-policy, tool-policy, approval, or ACL decisions?
- Does Bifrost remain limited to gateway responsibilities and generated/validated config from source registries and policies?
- Does any production alias, provider route, retrieval strategy, prompt, tool, or skill require a passing gate record before enablement?
- Are denial reasons typed, auditable, and safe when registry or policy data is missing, stale, or inconsistent?
- Are external system credentials scoped to the owning service and absent from docs, portal code, fixtures, and committed config?
- Does the change avoid introducing peer-to-peer service shortcuts that bypass `control-api`, `tool-broker`, policy, ACL, workflow, or audit boundaries?
- Is any script or infrastructure change incapable of enabling production capability without explicit gated inputs and review?

## Durable ownership summary

- Control-plane policy, registry state, ACL resolution, approval records, and audit writes are platform-owned, not agent-owned and not Bifrost-owned.
- Durable workflow state is owned by the platform workflow runtime and its database schema, not by Bifrost or transient agent prompts.
- Retrieval indexes may be built ahead of time, but retrieval serving must be ACL-filtered before model, cache, tool, or display use.
- Eval gate records are mandatory evidence for production enablement; absence of a valid record is a deny.
- Semantic cache entries are reusable only inside the same validated principal, project, and ACL scope; scope mismatch is a miss and must not fall back to broader reuse.
