# Observability runbook and dashboard plan

Status: Track 0 operations artifact  
Scope: traces, metrics, logs, audit correlation, cost/eval observability, dashboards, SLOs, and ownership  
Production capability: this runbook does not provision production services or enable production traffic.

## Goals

1. Make every gateway, workflow, retrieval, eval, cost, and audit decision observable before first production release.
2. Ensure OpenTelemetry Collector, Prometheus, and Grafana have explicit owners and validation gates.
3. Preserve immutable audit correlation without storing secrets or sensitive payloads in telemetry.
4. Provide SLO evidence for Track 1 without enabling any production model, tool, retrieval, or workflow path.

## Signal requirements

| Signal | Required content | Storage / viewer | Owner |
|---|---|---|---|
| Traces | Request, route, policy, workflow, retrieval, tool, eval, provider, and persistence spans with safe IDs and versions. | OTel Collector export target and Grafana trace view when selected. | Platform operations owner |
| Metrics | RED metrics, queue depth, lease age, provider latency/errors, retrieval latency, gate pass/fail counts, cost counters, backup status, SLO burn rates. | Prometheus and Grafana. | Platform operations owner |
| Logs | Structured logs with `trace_id`, `request_id`, service name, environment, outcome, and safe error class. | OTel logs backend or Railway logs with trace correlation. | Platform operations owner |
| Audit events | Append-only records for allow/deny decisions, admin actions, provider use, tool use, break-glass, eval gates, and restore validation. | Operational Postgres immutable audit tables. | Platform security owner |
| Cost events | Token/request estimates, provider/model, route, project, eval run, and retrieval/indexing cost dimensions. | Operational Postgres cost tables plus Prometheus/Grafana aggregates. | Platform operations owner |
| Eval evidence | Eval run status, gate version, dataset version, artifact URI, pass/fail/error counts, regression links. | Operational Postgres gate records, object storage artifacts, Grafana eval dashboard. | Evaluation owner |

Telemetry must include correlation IDs, but must not include raw prompts, provider keys, private GitHub data, object storage secrets, database URLs, access tokens, or break-glass secret material.

## Dashboard plan

| Dashboard | Required panels | Primary owner | Reviewers |
|---|---|---|---|
| Trace explorer / correlation | Trace volume, sampled error traces, slow spans, cross-service waterfall, trace-to-audit lookup, trace-to-cost lookup. | Platform operations owner | Platform architecture owner, platform security owner |
| Metrics fleet overview | Service up/down, request rate, error rate, latency, CPU/memory where available, Collector health, Prometheus target status. | Platform operations owner | Platform architecture owner |
| Structured logs / errors | Error class trend, service log volume, missing correlation IDs, denied route errors, worker failure logs, audit write failures. | Platform operations owner | Platform security owner |
| Gateway / Bifrost | Request rate, latency, error rate, provider latency, policy allow/deny, missing gate blocks, route config version, model alias usage, cost per route. | Platform operations owner | Platform architecture owner, platform security owner, evaluation owner |
| Workflow / workers | Queue depth, lease age, running/failed/cancelled workflows, retry rate, dead-letter count, step latency, artifact write errors, audit write failures. | Platform operations owner | Platform architecture owner |
| Retrieval / indexing | Index run status, source/chunk counts by safe dimension, embedding/reranker latency, ACL default-deny counts, stale permission blocks, Neo4j import/export health, retrieval eval status. | Platform operations owner | SCM integration owner, evaluation owner, platform security owner |
| Cost and budgets | Spend estimate by provider/model/route/project, token counts, eval costs, retrieval indexing costs, budget threshold events, denied-over-budget routes. | Platform operations owner | Platform lead, evaluation owner |
| Eval gates | Gate pass/fail/error trend, dataset version, fixture/provider mode, production-blocking gate failures, artifact URI availability, regression candidates. | Evaluation owner | Platform architecture owner, platform operations owner |
| Audit and compliance | Audit append rate, rejected audit updates/deletes, trace-to-audit correlation coverage, break-glass audit events, restore validation audit records. | Platform security owner | Platform operations owner |
| SLO and burn rate | Availability, p95/p99 latency, error budget burn, dependency health, backup freshness, restore-test freshness. | Platform operations owner | Platform lead |

## Initial SLO evidence plan

| Area | Candidate SLI | Initial Track 1 target proposal | Evidence source |
|---|---|---|---|
| Gateway availability | Non-5xx gateway requests / total requests. | Target selected before production; dashboard must support daily and rolling windows. | Bifrost metrics, Prometheus. |
| Gateway latency | p95 request latency by route class. | Target selected per route class before production. | Bifrost spans and metrics. |
| Policy correctness | Production enablement attempts blocked without passing gate records. | 100% block for missing/failed gate. | Registry/policy validator metrics and audit events. |
| Workflow durability | Completed or safely cancelled workflow steps / started workflow steps. | Target selected after fixture runs. | Worker metrics and audit records. |
| Retrieval safety | Retrieval attempts with valid ACL scope and index version / total retrieval attempts. | 100% before production retrieval. | Retrieval metrics and audit events. |
| Audit correlation | Immutable audit events with trace/request correlation / auditable actions. | 100% for production actions. | Operational Postgres audit queries and telemetry samples. |
| Backup readiness | Latest successful restore validation age. | Fresh validation required before first production release. | Backup/restore audit records and runbook evidence. |

Targets are intentionally proposals until Track 1 traffic and owner review define release SLOs. Production traffic is blocked until dashboards can show these SLIs.

## Runbook checks

### Daily development check

1. Confirm Collector is receiving spans from at least one app or worker in development.
2. Confirm Prometheus scrape targets are up for Collector and instrumented services.
3. Confirm Grafana dashboards load without manual edits.
4. Confirm structured logs include `trace_id` and `request_id`.
5. Confirm fixture eval runs emit gate metrics and artifact links.

### Pre-release observability check

1. Run a gateway fixture request and verify trace, metrics, structured log, audit event, and cost event share a correlation ID.
2. Run a workflow fixture and verify queue/lease panels update.
3. Run a retrieval fixture and verify ACL-safe retrieval counters and indexing metrics update.
4. Run an eval smoke fixture and verify gate dashboard panels update.
5. Verify audit immutability review: runtime roles cannot update or delete immutable audit records, or reject triggers are planned and tested.
6. Verify backup/restore dashboard panel references the latest restore validation evidence.
7. Record dashboard review owner sign-off before first production release.

## Incident and regression triage

| Symptom | First checks | Escalation owner |
|---|---|---|
| Missing traces | Collector health, OTLP endpoint variables, service resource attributes, sampler settings. | Platform operations owner |
| Missing metrics | Prometheus target status, `/metrics` endpoint health, Collector exporter config. | Platform operations owner |
| Missing audit correlation | Application request ID propagation, audit write path, `AUDIT_TRACE_CORRELATION_REQUIRED`. | Platform security owner |
| Cost dashboard gaps | Bifrost cost estimate emission, provider/model labels, cost table write path. | Platform operations owner |
| Eval dashboard gaps | Eval runner fixture mode, gate-result schema, artifact object storage path. | Evaluation owner |
| SLO burn alert | Gateway/workflow/retrieval dependency panels, recent deploys, provider status, database and Redis health. | Platform operations owner |

## Non-enablement statement

This runbook defines observability readiness only. It does not create Railway services, configure production variables, deploy Collector/Prometheus/Grafana, enable production aliases, enable tools, enable retrieval, grant break-glass access, or approve production traffic.
