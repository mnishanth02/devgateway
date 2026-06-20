# 04 - Technology Decisions, Roadmap, and Operations

## ADR-001: Bifrost is the AI traffic gateway

**Decision:** Use self-hosted Bifrost OSS on Railway for model/provider traffic, virtual keys, budgets,
rate limits, provider routing, fallback, load balancing, semantic cache hooks, Prometheus, and
OpenTelemetry.

**Boundary:** Durable workflows, external MCP, human approvals, side-effecting tool policy, repository
retrieval, long-term memory, GraphRAG, and portal UX are company platform services.

**Upgrade trigger:** Move to Bifrost Enterprise or an alternate highly available gateway when simple
gateway availability falls below 99.5% for two months, restart recovery causes a business-impacting
incident, or multi-team usage requires formal HA/RBAC/audit guarantees.

## ADR-002: Support OpenAI, Anthropic, and MCP interfaces

**Decision:** Expose:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`
- `POST /mcp`
- `GET /mcp/sse`
- `POST /mcp/messages`

The Platform Tool Broker serves MCP. Bifrost handles model traffic.

## ADR-003: Use a custom Postgres-backed workflow runtime for the first release

**Decision:** Build the small durable runtime specified in `docs\02-agent-workflows-tools.md`.

**Reason:** The first release needs persisted state, retries, idempotency, approvals, cancellation,
budget settlement, and resume-after-restart without adding a large workflow platform on day one.

**Guardrail:** Migration to Hatchet OSS or Temporal OSS is mandatory when a trigger in the workflow
runtime document is met.

## ADR-004: Policy enforcement lives outside agents

Models may request tools or delegations, but deterministic platform services approve, deny, sandbox,
and audit them.

Policy services own:

- tool allowlists
- sandbox selection
- budget caps
- model/provider allowlists
- project ACLs
- approval requirements
- audit emission
- provider data-class enforcement

## ADR-005: Memory is governed platform data

Durable memory must be inspectable, correctable, scoped, expirable, and deletable. Agent memory is stored
as governed data with source, scope, retention, correction trail, and ACLs.

## ADR-006: Better Auth OSS is the first-release human identity layer

**Decision:** Humans authenticate through Better Auth OSS hosted with the platform on Railway. The
platform stores stable `principal_id` records mapped to Better Auth user IDs, email, optional linked
GitHub account, team memberships, and platform roles.

**Reason:** The first release is a small, internal-only deployment. Better Auth keeps the auth layer in
our codebase and database, avoids per-seat SaaS auth cost, and avoids Microsoft Entra ID, Azure, AWS,
or GCP managed identity dependencies until explicitly approved.

**First-release controls:** User access is invite-only or admin-created. Admin, developer, and
stakeholder roles are enforced by platform policy. Rate limiting, CSRF/origin checks, secure cookies,
session expiry, audit hooks, and TOTP 2FA for admin accounts are required before production use.

**Alternatives reviewed:** Clerk can be reconsidered if prebuilt hosted auth UI becomes more important
than Railway-only operation and SaaS lock-in. WorkOS can be reconsidered if enterprise SSO becomes a
near-term requirement. Both require explicit approval before adoption.

**Future federation:** OIDC, SAML, SCIM, or external IdP integration remains a migration option, not a
first-release dependency.

**Repository ACL source:** GitHub App sync supplies repo, team, collaborator, CODEOWNER, and visibility
permissions. Platform roles can grant portal visibility but cannot exceed GitHub restrictions for private
repo content.

**Service auth:** Service principals use signed service tokens with explicit project scope, owner, expiry,
rotation policy, and audit trail.

## ADR-007: Provider data classification gates routing

Every project has a data class:

| Data class | Examples | Allowed routing |
|---|---|---|
| `public` | public docs, OSS examples | Any approved provider/model alias. |
| `internal` | internal docs, non-client code, planning docs | Approved providers with acceptable retention/training terms. |
| `confidential` | private source code, client-sensitive designs, non-public incidents | Providers with DPA/ZDR or explicit company approval; traces redact sensitive snippets. |
| `restricted` | secrets, credentials, regulated data, contractual no-external-processing code | No external model calls; use deterministic tooling or approved self-hosted route only. |

Every provider registry entry declares retention, training-use, DPA/ZDR, region, trace storage, and
approved data classes. Routing denies requests when the project class is not allowed.

## ADR-008: Semantic cache is ACL-scoped

Semantic cache is enabled only for request classes that pass cache-safety evals. Cache keys include
principal, project, ACL hash, model alias, provider data class, index version, tool policy version, and
prompt template version. Repo-aware responses cannot be reused across principals or projects.

## ADR-009: Model/provider registry is the single source of truth

Model names, providers, prices, aliases, policy status, eval scores, data-class rules, and fallbacks live
in a versioned registry. Other documents reference aliases only.

Representative registry:

```yaml
models:
  devgateway/orchestrator:
    candidates:
      - provider: openai
        model: gpt-5.5
      - provider: fireworks
        model: moonshotai/kimi-k2.7-code
    policy:
      max_cost_usd_per_task: 2.00
      requires_tools: true
      eval_suite: agent_orchestration_v1
      allowed_data_classes: [public, internal, confidential]
  devgateway/deep-reasoning:
    candidates:
      - provider: anthropic
        model: claude-opus-4.8
    policy:
      eval_suite: deep_reasoning_v1
      allowed_data_classes: [public, internal, confidential]
  devgateway/large-context:
    candidates:
      - provider: google_vertex
        model: gemini-3.1-pro
        region: asia-south1
        lifecycle_status: disabled
        approval_gate: manual_gcp_approval
    policy:
      eval_suite: large_context_v1
      allowed_data_classes: [public, internal, confidential]
  devgateway/fast:
    candidates:
      - provider: google_vertex
        model: gemini-3.5-flash
        lifecycle_status: disabled
        approval_gate: manual_gcp_approval
      - provider: groq
        model: openai/gpt-oss-120b
    policy:
      eval_suite: fast_tasks_v1
      allowed_data_classes: [public, internal]
```

Required fields:

- provider/model ID
- model alias
- wire format
- tokenizer/counting source
- context window and output limit
- input/output/cache/batch prices with timestamp
- tool and structured-output support
- streaming support
- data residency and allowed data classes
- rate limits
- eval scores and gate status
- routing tier and fallback aliases
- lifecycle status: `experimental`, `approved`, `deprecated`, `disabled`

## ADR-010: React + TanStack is the portal stack

**Decision:** Use React, TanStack Router, TanStack Query, TanStack Table, and TanStack Virtual for the
developer/admin/stakeholder portal. Use TypeScript/TSX for frontend code and generated API types.

## ADR-011: Backend/service stack

| Service type | First production choice |
|---|---|
| Bifrost gateway | Bifrost Docker/Go runtime. |
| Control API | TypeScript/Node.js with generated OpenAPI/types shared with the portal. |
| Agent orchestration | Python workers for agent/retrieval tasks and Node.js workers for TypeScript tool integrations on the custom durable runtime. |
| Retrieval/indexing | Python for parsing, ML/NLP, embeddings, and graph extraction. |
| High-performance gateway plugins | Go/WASM for hot-path Bifrost plugins. |

## ADR-012: Store choices

| Need | First production choice | Migration trigger |
|---|---|---|
| Operational DB | Railway Postgres | Upgrade within Railway or move to another Postgres provider only after manual approval when production criticality or restore SLO requires it. |
| Redis/cache/queue helpers | Railway Redis | Upgrade within Railway or move to another Redis provider only after manual approval when availability or throughput SLO requires it. |
| Knowledge DB/vector/lexical/graph | Postgres full-text + pgvector + **self-hosted Neo4j Community** | Split vector/lexical to Qdrant/Zoekt/OpenSearch only when thresholds are exceeded; keep Neo4j for graph traversal from first graph release. |
| Object storage | Railway Object Storage bucket using the S3-compatible API | Move to another S3-compatible provider only after manual approval when cost, lifecycle, or compliance requires it. |
| Trace/eval/cost tables | Postgres tables separated from gateway policy compute | Split when write volume affects gateway/control latency. |

Migration thresholds:

- vector p95 search latency > 750 ms on approved workload after indexing/query tuning
- lexical p95 search latency > 500 ms for symbol/path queries
- Neo4j graph traversal p95 latency > 500 ms for approved multi-hop questions after query/index tuning
- knowledge DB workload impacts operational DB latency
- index rebuild time exceeds accepted recovery window

## ADR-013: Secrets and key management

**Decision:** Store first-release deployment secrets in Railway variables. If provider keys,
break-glass credentials, or webhook secrets must be managed dynamically by the platform, store them in
Operational Postgres encrypted with an application-managed encryption key supplied through Railway
variables.

Provider keys are never surfaced to clients. Key access is role-scoped, audited, rotated on schedule,
and rotated immediately after break-glass use or suspected exposure. Moving secrets to Infisical,
Vault, SOPS/age, Azure Key Vault, AWS Secrets Manager, or GCP Secret Manager requires explicit manual
approval.

## ADR-014: Observability stack

**Decision:** Use OpenTelemetry instrumentation, Prometheus metrics, Grafana dashboards, platform trace
tables, eval result tables, cost event tables, and immutable audit events.

Required telemetry:

- Bifrost request metrics: provider, model alias, virtual key, status, latency, retries, fallback, cache hit.
- Agent traces: workflow, parent/sub-agent, delegation, prompt/context refs, tool calls, approvals.
- Retrieval traces: query plan, indexes used, candidate counts, rerank scores, citations, ACL filters.
- Cost events: input/output/cache/batch tokens, provider price snapshot, task attribution.
- Eval results: dataset, model alias, retrieval strategy, pass/fail, regression delta.
- System metrics: CPU/memory, queue depth, DB latency, index lag, error rates.
- Audit events: policy changes, key access, break-glass, approvals, denied actions, admin changes.

## ADR-015: Break-glass direct-provider route

Break-glass exists only for gateway outage or critical provider routing failure.

| Control | Decision |
|---|---|
| Trigger | Bifrost unavailable, routing failure blocks critical work, or incident commander declares emergency access. |
| Approver | Platform lead plus engineering lead; production-impacting tools require CTO/founder approval. |
| Credential storage | Railway variables for bootstrap credentials and encrypted Operational Postgres records for platform-managed provider credentials; access is granted through a short-lived break-glass service principal. |
| TTL | Maximum 4 hours, auto-expiring by default. |
| Scope | Approved provider/model aliases only; no repository retrieval cache and no side-effecting tools. |
| Audit | Immutable audit event with requester, approver, reason, provider, model, project, start/end time, and usage. |
| Recovery | Disable route after recovery, rotate used provider keys, attach usage report to incident record. |

## ADR-016: Embedding and reranker baseline

**Decision:** Use `BAAI/bge-m3` for first-release embeddings and `BAAI/bge-reranker-v2-m3` for reranking.
Code-specific embeddings are not enabled until retrieval evals prove a material improvement.

## ADR-017: Cloud and managed-service approval gate

**Decision:** Railway is the approved first-release managed platform. Azure, AWS, GCP, hosted auth
providers, non-Railway object storage, non-Railway databases, and non-Railway hosting services cannot
become committed dependencies without explicit manual approval.

**Scope:** This gate covers Microsoft Entra ID, GCP Secret Manager, Cloud KMS, Google Vertex AI,
Fly.io, Tigris, Clerk, WorkOS, and similar managed services. Protocol-level compatibility such as OIDC,
SAML, OpenTelemetry, Redis, Postgres, and S3-compatible APIs remains allowed when the concrete
first-release provider is Railway-hosted or self-hosted.

**Model providers:** Model API providers are governed separately by provider data-class policy, budget
approval, eval gates, and this managed-service approval gate when the provider is Azure, AWS, or GCP.

## Roadmap

### Track 0 - Architecture lock and implementation setup

Deliver:

- approved ADR set
- model/provider registry
- Better Auth configuration, auth schema migration, initial admin bootstrap, and auth smoke tests
- GitHub App permission model
- provider data-class matrix
- eval datasets and runner skeleton
- Railway deployment plan
- schema and migration conventions

Exit:

- no production model/tool/retrieval path enabled without an eval gate
- break-glass design approved
- first release scope and owners assigned

### Track 1 - Gateway and control foundation

Build:

- Bifrost deployment
- virtual key model
- provider/model registry
- team/project/user budget policy
- provider data-class enforcement
- OpenAI + Anthropic endpoint verification
- Prometheus/OTel export
- basic admin portal
- gateway/model smoke evals

Exit:

- Continue/Cline/Kilo/Aider/Claude Code smoke tests pass where supported
- cost, latency, provider, model alias, virtual key visible per request
- fallback, budget, and break-glass degraded mode tested
- cache-scope leak test passes before cache enablement

### Track 2 - Agent orchestration foundation

Build:

- supervisor agent service
- sub-agent executor
- delegation contract schemas
- agent run/task/artifact schema
- custom workflow runtime skeleton
- task trace UI
- read-only Tool Broker
- skill registry skeleton

Exit:

- parent agent delegates to at least two model aliases
- sub-agent result is validated, stored, and synthesized
- tool calls are policy-checked and auditable
- per-delegation budget reservation/settlement works

### Track 3 - Durable workflows and approvals

Build:

- retries, leases, idempotency, cancellation, approvals, event outbox
- long-running background tasks
- human approval gates
- artifact storage
- workflow templates

Exit:

- workflow survives process restart
- approval pauses/resumes safely
- failed steps are explainable and retryable
- stuck lease recovery test passes

### Track 4 - Retrieval foundation

Build:

- GitHub connector
- GitHub permission sync into platform ACLs
- docs connector
- metadata DB
- graph schema and provenance model
- deterministic repo graph extraction for initial languages
- Postgres full-text/symbol index
- pgvector index
- hybrid retrieval
- ACL filtering
- citation generation
- embedding/reranker eval

Exit:

- agents answer repo/doc questions with citations
- retrieval eval baseline passes
- ACL leak tests pass
- graph-backed APIs exist for stakeholder portal

### Track 5 - Stakeholder portal

Build:

- project explorer
- repository map
- API discovery
- architecture view
- product/business view
- executive summary view
- dependency/ownership view
- source citation UI
- persona answer contracts and eval rubrics

Exit:

- non-developer personas can answer project questions without IDE access
- persona-specific answer formats pass eval gates

### Track 6 - GraphRAG enrichment

Build:

- expanded deterministic repo graph coverage
- LLM entity/relation extraction for unstructured docs/tickets/conversations
- graph expansion retrieval
- community/domain summaries where useful
- code-to-business traceability

Exit:

- multi-hop questions outperform hybrid-only retrieval in evals
- graph provenance is visible and correct

### Track 7 - Governance expansion

Build:

- larger retrieval eval datasets
- agent eval datasets
- tool safety evals
- routing quality evals
- cost/latency dashboards
- regression gates before model/routing/prompt/index changes

Exit:

- every production routing/retrieval/tool change has an eval result
- cost-per-accepted-task is measurable by team/project/use case

### Track 8 - Self-hosted model runtime activation

Prepare:

- vLLM-compatible provider adapter
- GPU provider runbook
- model registry hooks
- cost/break-even model
- restricted-data routing policy

Activation requires:

- restricted or confidential workload volume justifies GPU operations
- self-hosted route passes provider-policy and eval gates
- operations owner accepts GPU uptime/cost responsibilities

## First production release definition

The first production release is complete when Tracks 0-4 pass exit criteria and the platform supports:

- principal-bound virtual keys
- OpenAI and Anthropic IDE traffic
- async MCP background tasks
- read-only Tool Broker
- durable workflow restart/resume
- GitHub ACL sync
- repo/doc retrieval with citations
- eval gates
- cost attribution
- break-glass route
- admin portal
- developer onboarding snippets

Stakeholder portal ships after the first production release. GraphRAG foundation ships with the first
graph-enabled release through Neo4j; advanced graph analytics/community summaries can come later.

## Deployment baseline

| Workload | Baseline |
|---|---|
| Gateway/stateless services | Railway first; non-Railway hosting migration requires manual approval when latency or reliability SLO evidence justifies it. |
| Operational Postgres | Railway Postgres with backup/restore drills. |
| Redis | Railway Redis. |
| Knowledge Postgres | Separate Railway Postgres instance or database compute from operational DB. |
| Graph store | Self-hosted Neo4j Community with volume, memory, backup, and restore validation. |
| Object storage | Railway Object Storage bucket with S3-compatible API. |
| Observability | OTel, Prometheus, Grafana, trace/eval/cost tables. |
| Workflow runtime | Custom Postgres-backed workers on Railway. |
| Secrets | Railway variables plus encrypted Operational Postgres records for platform-managed provider credentials. |

## SLOs

| Surface | Initial SLO |
|---|---|
| Simple gateway availability | 99.5% monthly for internal rollout. |
| Gateway p95 internal overhead | <= 250 ms excluding provider latency for India developers. |
| Agent task durability | Zero lost workflow state after process restart. |
| Worker stuck lease recovery | Recovered or marked for manual review within 5 minutes. |
| Retrieval freshness | Default branch updates indexed within 30 minutes for active repos and 4 hours for inactive repos. |
| GitHub permission sync | Sync lag <= 15 minutes; stale sync defaults to deny. |
| Critical DB restore | PITR restore drill completed quarterly; RTO <= 4 hours for first release. |
| Cost dashboard lag | Same business day. |

## Backup and DR

| Store | DR policy |
|---|---|
| Operational Postgres | PITR, daily backup, restore drill, migration scripts. |
| Workflow state | Same as operational DB; artifacts in object storage. |
| Knowledge Postgres | Daily backup; source snapshots allow rebuild. |
| Vector/lexical/graph indexes | Rebuildable from chunks and source snapshots; backup based on rebuild time. |
| Object storage | Versioning and lifecycle policy for artifacts and source snapshots. |
| Secrets | Railway variable backup procedure, encrypted credential records, rotation procedure, and access audit. |

## Security operations

- Signed GitHub webhooks.
- Least-privilege GitHub App permissions.
- Better Auth invite-only access, secure sessions, rate limiting, trusted origins, and TOTP 2FA for admin accounts.
- Provider key encryption and rotation.
- Virtual key revocation.
- Tool allowlists.
- Prompt-injection test suite.
- Secret scanning before indexing.
- Audit logs for model calls, tool calls, approvals, policy changes, and key access.
- GitHub permission sync with default-deny when stale.
- Semantic-cache partitioning by principal/project/ACL scope.
- Provider data-class allowlists before outbound routing.
- Tainted-context policy for retrieved content.
- Separate admin, developer, and stakeholder roles.
- Break-glass workflow for gateway outage and production-impacting tools.

## Cost governance

Budgets exist at:

- org
- team
- project
- user
- virtual key
- workflow
- sub-agent delegation
- tool class

Track:

- cost per accepted task
- cost per workflow
- cost per user/team/project
- premium escalation rate
- cache savings
- batch savings
- failed-task cost
- long-context cost

## Estimated early platform infra cost

Indicative monthly infrastructure range before model tokens:

| Component | Estimate |
|---|---:|
| Compute for stateless services/workers | $200-$450 |
| Operational Postgres | ~$45 |
| Knowledge Postgres with pgvector/FTS/graph tables | ~$60-$150 |
| Trace/eval/cost tables and dashboards | ~$30-$120 |
| Redis | ~$5-$30 |
| Object storage | ~$1-$10 |
| Bulk embedding generation | estimated per repository before first full index |
| **Approximate early total** | **~$340-$805/month before model tokens** |

Model, embedding, reranker, and workflow costs are tracked separately by provider/model/use case.

## Production runbooks

Create and approve these runbooks before first production release:

1. Bifrost gateway unavailable and break-glass activation.
2. Provider outage or fallback storm.
3. Budget/rate-limit misconfiguration.
4. Critical DB restore.
5. Redis/cache outage.
6. Indexing backlog.
7. Retrieval returns stale or wrong source.
8. Tool-call policy denial or unsafe tool request.
9. Prompt-injection suspected.
10. Provider key leak/rotation.
11. Eval regression blocks deployment.
12. Cost spike investigation.
13. Semantic cache leak suspicion.
14. GitHub permission sync stale/default-deny event.
15. Workflow-engine outage.
16. Worker stuck lease recovery.
17. Break-glass deactivation and provider key rotation.
