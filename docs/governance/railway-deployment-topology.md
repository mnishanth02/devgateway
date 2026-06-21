# Railway deployment topology governance

This governance note locks the Phase 0.8 Railway topology from Track 0 sections 13 and 15. It complements the versioned artifacts in `infra\railway\topology.v0.1.json`, `infra\railway\service-matrix.md`, and `infra\railway\monorepo-deploy-plan.md`.

## Governance posture

- Railway is the first-release platform, but services must stay portable across container hosts and standard protocols: Postgres, Redis, S3-compatible storage, Neo4j Community import/export, OTLP, Prometheus, and Grafana.
- This topology is configuration documentation only. It does not provision production, create secrets, enable provider/model routes, enable retrieval, expose tools, or activate break-glass.
- Production remains explicit-approval gated. The default gate variables are `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true`.

## Environment model

| Environment | Owner | Governance rule |
|---|---|---|
| `development` | Platform operations owner | May be provisioned after normal review for fixture/sandbox operation. Production capabilities remain disabled. |
| `production` | Platform operations owner with Platform lead approval | Must not be provisioned from this plan. Requires explicit Track 0 approval, named owners, reviewed secrets, backup/restore evidence, and passing health gates. |

## Required services and stores

| Service/store | Owner role | Governance responsibility |
|---|---|---|
| Bifrost gateway | Platform architecture owner | Provider routing, virtual-key policy, budgets, fallback, and telemetry remain policy/eval gated. |
| Control API | Platform architecture owner | Auth, policy enforcement, audit writes, DB connection policy, and health endpoints. |
| Admin portal | Platform architecture owner | Admin-only UI with approved auth origins and no direct DB/provider-key access. |
| Tool Broker | Platform architecture owner | MCP/tool endpoint plan with registry, approval policy, and eval gates before production tools. |
| Agent/workflow workers | Platform architecture owner | Durable workflow state in Postgres, short-lived Redis leases, object artifacts, and audit/trace emission. |
| Retrieval/indexing workers | Platform architecture owner | ACL-first indexing, Knowledge Postgres, object storage, Neo4j, and retrieval eval gates. |
| Eval runner | Evaluation owner | Fixture-mode gate execution and gate-shaped persistence before any production capability enablement. |
| Operational Postgres | Platform operations owner | Auth, policy, workflow, audit, budget, and eval gate data with reviewed migrations. |
| Knowledge Postgres | Platform operations owner | Source/chunk/vector metadata and pgvector readiness for retrieval. |
| Redis | Platform operations owner | Short-lived queues, locks, and rate limits only; not durable authority. |
| Object storage | Platform operations owner | Artifacts, source snapshots, generated docs, and trace bundles with scoped S3-compatible credentials. |
| Neo4j Community | Platform operations owner | Graph traversal store with export/import restore evidence before production. |
| OpenTelemetry Collector | Platform operations owner | Trace/metric collection topology and OTLP service variables. |
| Prometheus | Platform operations owner | Metrics scrape/storage plan for gateway and platform services. |
| Grafana | Platform operations owner | Dashboard service/config plan for gateway, workflow, retrieval, eval, cost, and SLO views. |

## Deployment rules

1. Use Railway JSON output and explicit service/environment IDs for scripted operations.
2. Use `railway add --json` for approved development service or database creation to avoid ambiguous duplicates.
3. Keep full repository context for app and worker services. Use filtered build/start commands and watch patterns from `infra\railway\monorepo-deploy-plan.md`.
4. Define `/healthz` and `/readyz`, worker heartbeats, or upstream equivalents before deployment.
5. Do not run migrations automatically on service boot. Use reviewed one-shot jobs, with production requiring explicit approval and backup/restore evidence.
6. Observability services are part of the topology, not optional add-ons; production traffic requires collector, metrics, dashboards, audit correlation, and cost visibility.

## Acceptance checklist

- `development` and `production` environments are represented, with production provisioning blocked by default.
- All required services and stores are represented in `topology.v0.1.json` and the service matrix.
- Service owner and environment owner roles are explicit.
- Build/start/watch/health expectations are defined before provisioning.
- Monorepo deployment uses full-repo context with filtered commands and service-specific watch patterns.
- Migration execution is manual/job-based and approval-gated for production.
- The posture remains Railway-first but portable and secret-free.
