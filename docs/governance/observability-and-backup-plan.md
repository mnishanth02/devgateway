# Observability and backup governance plan

Status: Track 0 governance artifact  
Scope: Phase 0.8 observability topology, dashboard ownership, backup/restore validation, retention/archive, and audit immutability controls  
Production capability: this document does not provision production Railway services, create credentials, enable dashboards against production data, or approve production traffic.

## Source artifacts

| Artifact | Purpose |
|---|---|
| `infra\railway\observability-topology.md` | OpenTelemetry Collector, Prometheus, Grafana topology, service instrumentation, Railway variables, and dashboard ownership. |
| `infra\runbooks\observability-plan.md` | Trace/metric/log/audit/cost/eval dashboard plan, SLO evidence plan, checks, and triage. |
| `infra\runbooks\backup-restore-plan.md` | Store-specific backup and restore checklist plus retention, archive, partition, and audit immutability requirements. |

These artifacts satisfy Phase 0.8 items for OpenTelemetry Collector, Prometheus, Grafana, backup/restore, observability planning, and no-production-provisioning constraints.

## Required architecture decisions

| Decision area | Locked Track 0 position | Owner |
|---|---|---|
| Telemetry ingestion | App and worker traces/metrics/logs flow through OpenTelemetry Collector by default; Prometheus scrapes app/collector metrics. | Platform operations owner |
| Dashboard source of truth | Grafana dashboards must be represented as reviewed configuration before first production release. | Platform operations owner |
| Audit correlation | Auditable actions must record trace/request correlation in immutable Operational Postgres audit events. | Platform security owner |
| Cost observability | Gateway, retrieval/indexing, and eval paths must emit cost events and dashboard-safe aggregates before production traffic. | Platform operations owner |
| Restore validation | Operational Postgres, Knowledge Postgres, object storage, and Neo4j Community require successful non-production restore validation before first production release. | Platform operations owner |
| Retention and archive | High-volume append-only tables require retention, archive/export, partition, and index decisions before production migrations. | Platform architecture owner with platform operations owner |

## Dashboard ownership gate

| Dashboard | Release-blocking coverage | Owner | Required evidence |
|---|---|---|---|
| Trace explorer / correlation | Trace volume, slow/error traces, cross-service waterfall, trace-to-audit and trace-to-cost lookup. | Platform operations owner | Development trace smoke evidence. |
| Metrics fleet overview | Service health, Collector health, Prometheus scrape status, request rate, errors, latency. | Platform operations owner | Prometheus target review. |
| Structured logs / errors | Error classes, log volume, missing correlation IDs, denied-route errors, worker failures. | Platform operations owner | Structured log sample with redaction review. |
| Gateway / Bifrost | Latency, errors, route decisions, provider health, policy/gate blocks, cost by route. | Platform operations owner | Dashboard review link or versioned dashboard file. |
| Workflow / workers | Queue depth, lease age, workflow status, retries, dead letters, audit write failures. | Platform operations owner | Development fixture evidence. |
| Retrieval / indexing | Index status, ACL default-deny counters, embedding/reranker latency, graph health, retrieval eval status. | Platform operations owner | ACL-safe retrieval fixture evidence. |
| Cost and budgets | Provider/model/project/route costs, eval costs, retrieval indexing costs, budget threshold events. | Platform operations owner | Cost event fixture and aggregate panel. |
| Eval gates | Gate pass/fail/error, dataset/gate versions, fixture/provider mode, production-blocking failures. | Evaluation owner | `pnpm eval:smoke` or equivalent fixture evidence when available. |
| Audit and compliance | Audit append rate, rejected mutation attempts, trace-to-audit coverage, restore validation records. | Platform security owner | Immutable audit review evidence. |
| SLO and burn rate | Availability, latency, error budget burn, dependency health, backup/restore freshness. | Platform operations owner | SLO panel review and owner approval. |

## Backup and restore release gate

Before the first production release, release approval must include restore validation evidence for:

1. Operational Postgres, including Better Auth, policy, workflow, audit, budget, cost, and eval gate tables.
2. Knowledge Postgres, including source/chunk/vector/full-text metadata and ACL/index-version fields.
3. Object storage, including artifacts, source snapshots, generated docs, trace bundles, eval artifacts, checksums, and scoped access validation.
4. Neo4j Community volume/export, including graph indexes, representative node/edge counts, ACL-bound metadata, and cross-checks against Knowledge Postgres.

Any failed or missing restore validation blocks production provisioning and production traffic.

## Retention, archive, partition, and audit immutability policy

| Candidate | Governance requirement before production |
|---|---|
| `audit_event` | Define long-term retention and archive/export path; enforce append-only DB roles or reject triggers; never rewrite archived event content. |
| `request_log` | Define hot retention, archive/aggregate policy, partition candidate, indexes, and payload redaction. |
| `workflow_event` | Define retention by workflow age/status, partition candidate, and audit links for security-relevant transitions. |
| `cost_event` | Define retention for budget enforcement, archive aggregates/raw events, partition strategy, and trace/audit correlation. |
| `eval_run` | Define retention for gate evidence, object storage artifact archive, partition/index strategy, and immutable gate records for production enablement. |
| `trace_ref` | Define retention for incident/audit correlation and avoid storing large trace payloads in Postgres. |
| `metric` | Prefer Prometheus for high-volume metrics; persist only required rollups with time-based retention. |

Audit immutability is a hard gate: runtime roles must not update or delete immutable audit records, and archive workflows must preserve the original record content and correlation identifiers.

## Track 0 acceptance checklist

- [ ] OTel Collector, Prometheus, and Grafana topology reviewed in `infra\railway\observability-topology.md`.
- [ ] Service variables are classified as secret/internal and no secrets are committed.
- [ ] Gateway, workflow, retrieval, cost, eval, audit, and SLO dashboard owners are assigned.
- [ ] Trace, metric, log, audit, cost, and eval signal requirements are documented.
- [ ] Backup/restore checklist covers Operational Postgres, Knowledge Postgres, object storage, and Neo4j Community.
- [ ] Restore validation before first production release is explicitly required.
- [ ] High-volume retention, archive, and partition candidates are tied to immutable audit requirements.
- [ ] No production Railway provisioning is performed by these artifacts.

## Non-enablement statement

This governance plan records readiness expectations only. Production services, managed stores, object storage buckets, volumes, Grafana dashboards, providers, model routes, retrieval paths, workflow paths, and break-glass access remain disabled until separate approved implementation and release gates are complete.
