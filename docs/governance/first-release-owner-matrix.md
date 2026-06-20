# First-release owner and scope matrix

This Track 0 governance artifact assigns interim accountable roles for the first production release scope. It does not enable any production model, tool, retrieval, workflow, or deployment capability; all first-release capability remains disabled until the Track 1 production gates below are implemented and approved.

## Track 0 exit owner requirement

Named people may replace the interim roles below during implementation. Track 0 cannot exit until each row has either a named accountable person or an explicitly approved accountable role, and until the approval roles have accepted the assignment. Production provisioning and production capability enablement remain separately gated.

## Interim role coverage

| Plan area | Interim owner role required before Track 0 exit |
|---|---|
| ADR approval | Platform architecture owner |
| Security policy | Platform security owner |
| Eval gates | Evaluation owner |
| Railway operations | Platform operations owner |
| GitHub App permissions | SCM integration owner |
| Break-glass approval | Platform lead plus engineering lead; production-impacting tools require CTO/founder approval |

## First-release owner matrix

| Scope | Owner role | Approval role | Impacted packages/services | Track 0 artifact | Required validation | Track 1 production gate |
|---|---|---|---|---|---|---|
| Gateway / Bifrost | Platform architecture owner | Platform security owner; Evaluation owner for route gates | Bifrost gateway, `infra\bifrost`, `packages\registry`, `packages\policy`, `packages\observability` | Gateway Policy Enforcement Contract, Bifrost Docker/config strategy, registry sync plan | Registry-to-Bifrost config validation; policy freshness fail-closed check; route denial taxonomy coverage | No production model alias or route until registry, policy, audit, budget, and passing eval gate records are present |
| Control API | Platform architecture owner | Platform security owner | `apps\control-api`, `packages\schemas`, `packages\db`, `packages\policy`, `packages\config`, `packages\observability` | OpenAPI 3.1 contract skeleton, dependency rules, service definition, env matrix | Contract validation; auth/policy middleware smoke checks; DB connection policy check | Production API only with Better Auth, authorization, immutable audit writes, and disabled-by-default production mutations |
| Admin portal | Platform architecture owner | Platform security owner | `apps\admin-portal`, `packages\shared-types`, `packages\config` | First-release admin portal scope, build command, API URL/auth origin settings | Portal build/typecheck once package exists; route access smoke tests; no direct provider-key or DB access | Production portal only after invite-only auth, admin TOTP, approved origins, and audited admin actions are enforced |
| Tool Broker / MCP | Platform architecture owner | Platform security owner; Evaluation owner for tool gates | `apps\tool-broker`, `packages\schemas`, `packages\policy`, `packages\registry`, `workers\tool-integrations` | MCP endpoint service plan, frozen MCP/async task schemas, tool registry dependency, approval policy dependency | MCP contract tests; tool-policy validator; approval-required and denied-action fixtures | No production tool, skill, or side-effecting MCP path until approval policy, audit, and passing eval gate records exist |
| Agent runtime / workflows | Platform architecture owner | Platform security owner; Evaluation owner | `workers\agent-runtime`, `packages\db`, `packages\schemas`, `packages\policy`, object storage, Redis | Durable workflow runtime contract, queue/lease variables, workflow schema conventions | Fixture workflow execution; lease/TTL checks; audit event shape validation | Production workflows only after durable state, cancellation, audit, budget, sandbox, and eval gates are enforced |
| Retrieval / indexing | Platform architecture owner | Platform security owner; SCM integration owner; Evaluation owner | `workers\retrieval-indexer`, Knowledge Postgres, object storage, Neo4j, `packages\config`, `packages\schemas`, `packages\policy` | Retrieval/indexing worker plan, ACL-first retrieval rules, strategy toggles, context budget/compression controls, tainted-context fixtures | ACL precedence tests; stale permission default-deny fixtures; prompt-injection/tainted-context evals; retrieval strategy control evals; context-pack budget/compression evals | No production retrieval/index version until ACL checks, index provenance, artifact audit, strategy controls, context budget/compression, and passing retrieval eval gate exist |
| Eval runner / gates | Evaluation owner | Platform architecture owner | `workers\eval-runner`, `evals\datasets`, `evals\gates`, `evals\fixtures`, `packages\schemas`, Operational Postgres, object storage | Eval dataset layout, gate schema, fixture-mode runner skeleton, gate-result persistence contract | `pnpm eval:smoke` once implemented; gate-result schema validation; negative test for missing gate | Every production route, alias, tool, prompt, skill, retrieval strategy, or index version requires a matching passing gate result |
| Operational Postgres | Platform operations owner | Platform security owner; Platform architecture owner | Operational Postgres, `packages\db`, Better Auth schema, Control API, agent runtime, eval runner | Schema/migration conventions, migration execution policy, backup/restore checklist | `pnpm db:check` once implemented; append-only audit controls; backup/restore validation | Production DB use only after migrations are reviewed, backups are verified, least-privilege roles exist, and audit immutability is enforced |
| Knowledge Postgres / pgvector | Platform operations owner | Platform security owner; Evaluation owner | Knowledge Postgres, pgvector, retrieval/indexing workers, `packages\db`, `packages\schemas` | Knowledge schema ownership decision, source/chunk/vector metadata conventions, backup/restore checklist | Vector/full-text schema checks; ACL-bearing metadata validation; restore test | Production retrieval queries only after ACL metadata, index versioning, backup/restore, and retrieval eval gates are in place |
| Redis | Platform operations owner | Platform security owner | Redis, agent/workflow workers, Tool Broker, Control API | Redis variable group, queue namespace, lock/rate-limit namespace plan | TTL/namespace validation; no durable authority stored only in Redis; failover behavior documented | Production Redis only for short-lived queues, locks, and rate limits with Postgres as durable source of truth where required |
| Object storage | Platform operations owner | Platform security owner | Object storage, eval runner, retrieval/indexing workers, agent runtime, audit artifacts | Bucket/variable matrix, artifact/source snapshot/trace bundle layout, backup/restore checklist | Bucket access policy check; encryption/secret classification review; restore test | Production artifact storage only after scoped credentials, retention rules, audit linkage, and restore validation are complete |
| Neo4j Community | Platform operations owner | Platform security owner | Neo4j Community, retrieval/indexing workers, Knowledge Postgres, `packages\config` | Graph traversal store plan, runtime toggle contract, and backup/restore plan | Graph import/export fixture; backup/restore validation; ACL-bound graph edge checks; invalid GraphRAG/Neo4j toggle fail-closed fixture | Production graph traversal only after ACL-safe graph materialization, restore validation, typed toggle validation, and retrieval eval gate pass |
| Better Auth | Platform security owner | Platform architecture owner | Better Auth, Operational Postgres, Control API, Admin portal, `packages\db`, `packages\config` | Better Auth config skeleton, auth migration plan, admin bootstrap plan, auth smoke-test skeleton | Invite-only auth smoke tests; trusted origin check; admin TOTP/provider-key access check | Production auth only after secure secrets, admin TOTP, audited bootstrap, session/cookie policy, and origin restrictions are approved |
| GitHub App permission sync | SCM integration owner | Platform security owner | GitHub App integration, Control API, retrieval/indexing workers, Operational Postgres, `workers\tool-integrations` | GitHub App scope matrix, permission sync entity model, webhook validation rules, stale-sync default-deny rules | Webhook signature tests; stale-sync default-deny tests; CODEOWNER/ACL fixture coverage | Production repository retrieval/tools only after permission sync health, stale-deny enforcement, and ACL eval gates are passing |
| Provider registry / policy | Platform security owner | Platform architecture owner; Evaluation owner | `packages\registry`, `packages\policy`, `packages\schemas`, Bifrost gateway, Control API | Model/provider registry schema, provider data-class matrix, typed denial reasons, validator commands | `pnpm registry:validate` and `pnpm policy:validate` once implemented; denied-route fixtures | No production provider/model route until provider policy, data class, retention/DPA/ZDR posture, budget, and eval gate pass |
| Observability | Platform operations owner | Platform architecture owner; Platform security owner | OpenTelemetry Collector, Prometheus, Grafana, `packages\observability`, Bifrost gateway, platform services | Observability topology, service variables, trace/eval/cost tables, dashboard ownership | OTel trace smoke check; metrics scrape check; dashboard and immutable audit correlation review | Production traffic only after traces, metrics, logs, audit events, cost records, and gateway/workflow/retrieval dashboards are available |
| Railway deploys | Platform operations owner | Platform lead; Platform architecture owner; Platform security owner for secrets | `infra\railway`, Bifrost, Control API, Admin portal, Tool Broker, workers, stores, observability services | Railway topology, service owner/environment owner matrix, variable matrix, filtered build/start/watch/health plan | Service matrix review; health check definitions; secret/non-secret classification; backup/restore plan validation | Production provisioning/deploy only with explicit Track 0 approval, named owners, healthy checks, backups, and no production routes enabled by default |
| Break-glass | Platform lead plus engineering lead | Platform security owner; CTO/founder for production-impacting tools | `infra\runbooks`, Bifrost/provider credentials, Control API approvals, Operational Postgres audit, observability | Break-glass runbook with trigger, approvers, scope, TTL, credential path, audit, recovery, and key rotation | Degraded-mode tests: gateway unavailable path, TTL expiry, no retrieval cache, no side-effecting tools, audit emission, key rotation | No production break-glass path until runbook is approved; every activation is scoped, <=4 hours, audited, recovered, and explicitly approved |
| Audit / cost tracking | Platform security owner | Platform architecture owner; Platform operations owner; Evaluation owner for gate records | Operational Postgres, `packages\observability`, Bifrost gateway, Control API, Tool Broker, agent runtime, eval runner | Audit event schema, cost table conventions, credential/audit immutability conventions, trace correlation policy | Append-only audit DB controls; cost estimation/persistence fixture; trace-to-audit correlation checks | No production model/tool/retrieval/workflow action unless allow/deny decision, actor, policy version, gate version, cost, and trace are recorded |

## Deployment-plan coverage check

The first-release deployment-plan services and stores are covered as follows:

| Deployment-plan service/store | Covered by scope row |
|---|---|
| Bifrost gateway | Gateway / Bifrost |
| Control API | Control API |
| Admin portal | Admin portal |
| Tool Broker | Tool Broker / MCP |
| Agent/Workflow workers | Agent runtime / workflows |
| Retrieval/Indexing workers | Retrieval / indexing |
| Eval runner | Eval runner / gates |
| Operational Postgres | Operational Postgres |
| Knowledge Postgres | Knowledge Postgres / pgvector |
| Redis | Redis |
| Object storage | Object storage |
| Neo4j Community | Neo4j Community |
| OpenTelemetry Collector | Observability |
| Prometheus | Observability |
| Grafana | Observability |

## Non-enablement statement

This matrix assigns accountability and gates only. It intentionally does not provision Railway production resources, enable providers, expose tools, enable retrieval, grant break-glass credentials, or activate production workflow paths.
