# Railway observability topology

Status: Track 0 deployment artifact  
Scope: OpenTelemetry Collector, Prometheus, Grafana, service variables, dashboard ownership, and pre-production validation  
Production capability: this plan does not provision, deploy, or mutate production Railway resources.

## Purpose

This topology locks the Phase 0.8 observability shape required by the Track 0 implementation plan. It is a configuration and ownership plan only: production services, stores, domains, credentials, and dashboards remain explicit-approval gated.

## Environment model

| Environment | Purpose | Provisioning rule |
|---|---|---|
| `development` | Validate instrumentation, metric scrape targets, dashboard JSON, and alert routing using fixture or development traffic. | May be provisioned after normal review. |
| `production` | First-release production observability plane. | Must not be provisioned until Track 0 approval, backup/restore validation, dashboard review, and owner sign-off are complete. |

Every Railway environment must keep `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true` until an approved release change flips them.

## Topology

| Component | Railway representation | Receives from | Sends to / exposes | Owner |
|---|---|---|---|---|
| OpenTelemetry Collector | Dedicated service using a reviewed collector image/config. | OTLP traces, metrics, and logs from Bifrost, Control API, Admin portal, Tool Broker, workers, eval runner, and retrieval/indexing workers. | Exports traces/logs to the selected backend, exposes Prometheus scrape metrics, and preserves audit/cost trace correlation metadata. | Platform operations owner |
| Prometheus | Dedicated metrics service or approved Railway template with persistent storage sizing documented before production. | Scrapes OTel Collector, Bifrost, platform app `/metrics` endpoints, worker metrics, and selected managed-service exporters where available. | Provides metrics source for Grafana and SLO burn-rate queries. | Platform operations owner |
| Grafana | Dedicated dashboard service with dashboards/config provisioned from versioned files. | Prometheus metrics plus approved trace/log/audit/cost data sources. | Gateway, workflow, retrieval, cost, eval, audit, and SLO dashboards. | Platform operations owner |

The collector is the default ingestion path for app telemetry. Direct app-to-Prometheus scraping is allowed for `/metrics` endpoints, but trace IDs and audit correlation fields must still be emitted through OpenTelemetry instrumentation.

## Track 1 gateway/control trace plan

Track 1 dashboards must make a single gateway/control decision traceable from ingress to persisted evidence:

1. Gateway receives the request and starts a root span with `request_id`, `trace_id`, `virtual_key_id`, `project_id`, and `route_intent`.
2. Control/policy decision spans record route matching, policy/gate result, selected `model_alias`, provider allow/deny, and fallback eligibility.
3. Bifrost decision spans record the concrete provider attempt sequence, selected provider/model, retry/fallback transitions, latency, error class, and final decision.
4. Audit and cost events persist the same `trace_id`/`request_id` so dashboards can link the trace waterfall to immutable audit evidence and cost aggregates.

Required dashboard dimensions for Track 1 gateway/control views are:

| Dimension | Example attribute / label | Use |
|---|---|---|
| Provider | `provider_id` | Provider health, errors, fallbacks, and cost. |
| Model alias | `model_alias` | Alias routing quality and budget allocation. |
| Virtual key | `virtual_key_id` | Tenant/key-scoped traffic and denied-route triage; never emit raw key material. |
| Project | `project_id` | Project budgets, route ownership, and SLO slices. |
| Route intent | `route_intent` | Chat/tool/eval/retrieval route class latency and policy behavior. |
| Decision | `decision` | Allow, deny, fallback, budget block, policy block, provider error. |
| Fallback | `fallback_applied`, `fallback_reason` | Fallback rate and root-cause analysis. |
| Latency | `latency_ms`, span duration | p50/p95/p99 by route/provider/model alias. |
| Cost | `cost_estimate_usd`, `input_tokens`, `output_tokens` | Cost dashboard and budget evidence. |

Raw prompts, provider API keys, raw virtual keys, database URLs, and private repository content must not be emitted in any Track 1 telemetry dimension.

## Service instrumentation plan

| Service/store | Required telemetry | Required labels / attributes | First dashboard coverage |
|---|---|---|---|
| Bifrost gateway | OTLP spans, request metrics, route decision logs, provider attempt/fallback counters, cost estimates, provider latency/error counters. | `service.name`, `deployment.environment`, `project_id`, `route_id`, `route_intent`, `model_alias`, `provider_id`, `virtual_key_id`, `decision`, `fallback_applied`, `fallback_reason`, `policy_version`, `gate_version`, `trace_id`, `request_id`. | Gateway/control, cost, SLO |
| Control API | OTLP spans/logs, HTTP metrics, auth/admin action audit references, policy decision traces. | `service.name`, `deployment.environment`, `project_id`, `actor_id`, `request_id`, `trace_id`, `audit_event_id`, `route_intent`, `decision`, `policy_version`, `gate_version`. | Gateway/control, audit, SLO |
| Admin portal | Web vitals or frontend request metrics where available, API correlation headers. | `service.name`, `deployment.environment`, `request_id`, `trace_id`. | SLO |
| Tool Broker | Tool-call spans, approval decision counters, denied-action counters, sandbox/runtime metrics. | `tool_id`, `policy_version`, `approval_request_id`, `project_id`, `trace_id`. | Workflow, audit, SLO |
| Agent/workflow workers | Workflow run spans, queue/lease metrics, retry/cancel/dead-letter logs. | `workflow_run_id`, `workflow_step_id`, `queue_name`, `lease_id`, `project_id`, `trace_id`. | Workflow, SLO |
| Retrieval/indexing workers | Indexing spans, ACL-default-deny counters, embedding/reranker latency, graph update metrics. | `knowledge_source_id`, `index_version`, `acl_scope_hash`, `project_id`, `trace_id`. | Retrieval, cost, SLO |
| Eval runner | Eval run spans, gate-result metrics, fixture/provider-mode logs, artifact links. | `eval_run_id`, `dataset_id`, `gate_id`, `gate_version`, `mode`, `trace_id`. | Eval/gate, cost |
| Operational Postgres | Connection pool metrics, migration check status, backup status, immutable audit append rate. | `database=operational`, `schema_domain`, `project_id` where safe. | Audit, cost, SLO |
| Knowledge Postgres | Query latency, vector/full-text index health, backup status. | `database=knowledge`, `index_version`, `project_id` where safe. | Retrieval, SLO |
| Redis | Queue depth, lock contention, TTL expiry, rate-limit counters. | `queue_namespace`, `rate_limit_namespace`, `deployment.environment`. | Workflow, SLO |
| Object storage | Artifact write/read metrics, restore-test status, bucket policy checks. | `bucket_name`, `artifact_type`, `project_id` where safe. | Eval/gate, cost |
| Neo4j Community | Import/export status, graph traversal latency, backup status. | `database=neo4j`, `index_version`, `project_id` where safe. | Retrieval, SLO |

Sensitive values must never be emitted as span attributes, metric labels, logs, dashboard variables, or audit details.

## Railway variable matrix

| Variable | Scope | Classification | Applies to | Notes |
|---|---|---|---|---|
| `OTEL_SERVICE_NAME` | per service | Internal | All instrumented services | Stable logical service name used in traces, metrics, and logs. |
| `OTEL_RESOURCE_ATTRIBUTES` | per service | Internal | All instrumented services | Must include `deployment.environment` and may include safe service version metadata. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | environment | Internal | All instrumented services | Points to the OTel Collector internal Railway URL. |
| `OTEL_EXPORTER_OTLP_HEADERS` | environment | Secret | All instrumented services if auth is enabled | Store only in Railway variables; never commit. |
| `OTEL_TRACES_SAMPLER` | environment | Internal | All instrumented services | Default `parentbased_traceidratio`; production ratio requires observability owner approval. |
| `OTEL_TRACES_SAMPLER_ARG` | environment | Internal | All instrumented services | Development may use higher sampling; production must balance cost and incident needs. |
| `OTEL_METRICS_EXPORTER` | environment | Internal | TS/Python services | `otlp` or `prometheus` by service; selected before deployment. |
| `OTEL_LOGS_EXPORTER` | environment | Internal | TS/Python services | `otlp` where supported; otherwise structured logs with trace IDs. |
| `PROMETHEUS_SCRAPE_TARGETS` | Prometheus | Internal | Prometheus | Versioned target list generated from service IDs/internal URLs. |
| `PROMETHEUS_RETENTION_TIME` | Prometheus | Internal | Prometheus | Initial production proposal must be reviewed with storage cost. |
| `GRAFANA_ADMIN_USER` | Grafana | Secret | Grafana | Railway secret only. |
| `GRAFANA_ADMIN_PASSWORD` | Grafana | Secret | Grafana | Railway secret only. |
| `GRAFANA_AUTH_ALLOWED_DOMAINS` | Grafana | Internal | Grafana | Must match approved admin domains. |
| `GRAFANA_DASHBOARD_PROVIDER_PATH` | Grafana | Internal | Grafana | Points at versioned dashboard provisioning path. |
| `AUDIT_TRACE_CORRELATION_REQUIRED` | environment | Internal | Control API, Bifrost, Tool Broker, workers | Must be `true` before production traffic. |
| `COST_EVENT_EXPORT_ENABLED` | environment | Internal | Bifrost, retrieval/indexing workers, eval runner | Enables cost event metrics/logs after schema approval. |

## Dashboard and alert ownership

| Dashboard / view | Primary audience | Owner | Required before production traffic |
|---|---|---|---|
| Trace explorer and request correlation | Platform operations, platform architecture | Platform operations owner | Yes |
| Metrics fleet overview | Platform operations | Platform operations owner | Yes |
| Structured logs and error classes | Platform operations, platform security | Platform operations owner | Yes |
| Gateway health and policy decisions | Platform operations, platform security | Platform operations owner | Yes |
| Workflow/worker queues and durable execution | Platform operations, platform architecture | Platform operations owner | Yes |
| Retrieval/indexing quality and ACL safety | Platform operations, SCM integration, evaluation owner | Platform operations owner | Yes |
| Cost and provider usage | Platform operations, evaluation owner, platform lead | Platform operations owner | Yes |
| Eval gates and regression trends | Evaluation owner, platform architecture | Evaluation owner | Yes |
| Audit immutability and correlation | Platform security, platform operations | Platform security owner | Yes |
| SLO and burn-rate | Platform operations, platform lead | Platform operations owner | Yes |

Dashboard provisioning must use reviewed JSON/config artifacts. Manual dashboard edits in Railway/Grafana are temporary only and must be backported to versioned configuration before first production release.

## Audit sink unavailable behavior

Audit writes are part of the production safety boundary. If the audit sink is unavailable in production, services must fail closed: deny or stop the auditable operation, return a safe error, emit a structured non-secret operational log with `trace_id` and `request_id`, and preserve retry/dead-letter evidence where applicable. Production must not silently continue a gateway/control/provider/tool/admin action that requires an audit record.

In non-production environments, teams may explicitly allow fixture or development flows to continue when the audit sink is unavailable only when the behavior is configured, documented in the test/runbook context, and logged at error level with `audit_sink_unavailable=true`, environment, service, `trace_id`, `request_id`, and the safe decision outcome. Non-production continuation must never be used as evidence for production readiness.

## Validation gates

Before first production provisioning:

1. Collector config review confirms OTLP receivers, safe exporters, resource labels, and no secret logging.
2. Development smoke emits at least one trace, metric, structured log, audit correlation ID, eval gate metric, and cost event sample.
3. Prometheus scrape target review covers OTel Collector OTLP metrics, Collector self-metrics, Bifrost gateway `/metrics`, and documented pending `/metrics` endpoints for Control API, Tool Broker, workers, and available store/exporter metrics.
4. Grafana dashboard review confirms gateway, workflow, retrieval, cost, eval, audit, and SLO views have owners.
5. Backup/restore validation evidence links to `infra\runbooks\backup-restore-plan.md`.
6. No production Railway service, store, credential, volume, or bucket is created by this plan.
