# Trace Context Contract

Status: Track 1.0 governance contract  
Scope: W3C trace context, DevGateway correlation headers, propagation across Control API, Bifrost, audit, cost, and eval records, DB mapping, and API schema mapping  
Production capability: this document does not enable production telemetry, provider routes, provider secrets, break-glass access, Railway provisioning, retrieval, MCP, workflows, or semantic cache.

## 1. Purpose

Trace context gives every gateway-control decision a stable correlation path across Control API, Bifrost, audit events, cost events, logs, metrics, and eval records. It prevents untraceable allows/denies and keeps Bifrost from inventing identity or policy context.

This contract is documentation only. Production propagation remains fail-closed until Track 0 blockers and Track 1 validation gates are complete.

## 2. Required inbound context

DevGateway uses W3C Trace Context plus explicit DevGateway headers.

| Header / field | Requirement |
|---|---|
| `traceparent` | W3C `version-trace-id-parent-id-trace-flags`. Required for propagated requests; Control API may create one at trusted ingress. |
| `tracestate` | Optional W3C vendor state. Must not contain secrets or user payloads. |
| `x-devgateway-request-id` | Stable request ID generated at trusted ingress if missing. Required in audit/cost/eval records. |
| `x-devgateway-principal-id` | Platform-resolved public principal ID. Bifrost must not infer it. |
| `x-devgateway-project-id` | Platform-resolved public project ID. |
| `x-devgateway-virtual-key-id` | Public virtual key ID after validation; never raw key material. |
| `x-devgateway-budget-scope-id` | Public budget scope ID. |
| `x-devgateway-policy-version` | Immutable policy version. |
| `x-devgateway-registry-version` | Immutable registry version. |
| `x-devgateway-route-intent` | Resolved route purpose. |
| `x-devgateway-data-class` | Resolved data class. |
| `x-devgateway-environment` | Environment label. |
| `x-devgateway-sampling-decision` | `record`, `drop`, or `defer`; audit-required events are still persisted even if trace sampling drops spans. |

Headers containing principal, project, virtual key, policy, registry, budget, route, or data-class context are trusted only when produced or validated by Control API/platform policy. Direct client-supplied values are untrusted until validated.

## 3. Propagation flow

1. Control API receives an authenticated request or virtual-key operation.
2. Control API creates or validates `traceparent`, creates `x-devgateway-request-id` when missing, resolves principal/project/budget/policy/registry context, and emits lifecycle audit events where required.
3. Control API forwards only validated context to Bifrost or writes synced metadata for Bifrost validation.
4. Bifrost validates the request context envelope, virtual-key state, policy/registry freshness, budget/rate-limit decisions, and route/provider eligibility.
5. Bifrost emits allow/deny audit events and cost events with the same `trace_id` and `request_id`.
6. Eval runners and smoke tests that exercise gateway/model compatibility copy the same trace/request context into eval records and gate-result references.
7. Logs and metrics include request and trace correlation fields without copying secrets or sensitive prompt payloads.

Missing required production correlation denies. An audit-required decision must not be silently allowed because tracing is disabled or sampled out.

## 4. W3C trace field mapping

| Concept | Source |
|---|---|
| `trace_id` | 32-hex trace ID from `traceparent`. |
| `parent_span_id` | 16-hex parent ID from inbound `traceparent`. |
| `span_id` | Current service span ID. |
| `trace_flags` | W3C flags from `traceparent`; sampled bit is advisory only for telemetry, not audit persistence. |
| `tracestate` | Optional W3C state, scrubbed of secrets. |
| `sampling_decision` | DevGateway sampling field used by observability; cannot disable required audit/cost persistence. |

Trace IDs in public APIs may use W3C hex form. They must be treated as correlation identifiers, not authentication or authorization secrets.

## 5. Record propagation requirements

| Record type | Required correlation fields |
|---|---|
| `audit_event` | `trace_id`, `request_id`, principal, project, decision/action, policy version, registry version, virtual key ID where applicable. |
| `cost_event` | `trace_id`, `request_id`, virtual key, budget scope, provider, model alias, attempt indexes, estimated/actual cost fields. |
| `budget_ledger` | `trace_id`, `request_id`, budget scope, cost event link where available. |
| `virtual_key` lifecycle audit | `trace_id`, `request_id`, virtual key ID, actor principal, project, action, outcome. |
| `eval_run` / gate evidence | `trace_id`, `request_id`, model alias, provider, dataset/suite versions, gateway attempt metadata when the eval touches gateway routes. |
| Logs | `trace_id`, `span_id`, `request_id`, service name, environment, event name, denial reason where applicable. |

## 6. DB column mapping

Phase 1.1 may implement a lightweight `trace_ref` table for cross-record lookup. High-volume trace payloads should remain in the observability backend, not Operational Postgres.

### `trace_ref`

| Column | Type / constraint | Notes |
|---|---|---|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Internal only. |
| `trace_id` | `TEXT NOT NULL` | W3C trace ID. |
| `request_id` | `TEXT NOT NULL` | DevGateway request ID. |
| `root_service` | `TEXT NOT NULL` | Service that created/trusted the context. |
| `entrypoint` | `TEXT NOT NULL` | Control API route, gateway route, eval runner, or admin action. |
| `principal_id` | `BIGINT REFERENCES principal(id) ON DELETE RESTRICT` | Nullable for unauthenticated denied ingress only. |
| `project_id` | `BIGINT REFERENCES project(id) ON DELETE RESTRICT` | Nullable only before project resolution denial. |
| `virtual_key_id` | `BIGINT REFERENCES virtual_key(id) ON DELETE RESTRICT` | Nullable for non-gateway admin actions. |
| `budget_scope_id` | `BIGINT REFERENCES budget_scope(id) ON DELETE RESTRICT` | Nullable only before budget resolution denial. |
| `policy_version` | `TEXT` | Required after policy resolution. |
| `registry_version` | `TEXT` | Required for gateway/model decisions. |
| `sampling_decision` | `TEXT NOT NULL CHECK (...)` | `record`, `drop`, `defer`. |
| `trace_flags` | `TEXT` | W3C flags. |
| `tracestate` | `TEXT` | Scrubbed optional state. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | First observed time. |
| `last_seen_at` | `TIMESTAMPTZ NOT NULL` | Last correlated record time. |

Required indexes: `trace_id`, `request_id`, `(principal_id, created_at)`, `(project_id, created_at)`, `(virtual_key_id, created_at)`, and `(budget_scope_id, created_at)`.

### Required columns on related tables

| Table | Required columns |
|---|---|
| `audit_event` | `trace_id TEXT NOT NULL`, `request_id TEXT NOT NULL`, optional `span_id TEXT`. |
| `cost_event` | `trace_id TEXT NOT NULL`, `request_id TEXT NOT NULL`, optional `span_id TEXT`. |
| `budget_ledger` | `trace_id TEXT NOT NULL`, `request_id TEXT NOT NULL`. |
| `eval_gate_result` / `eval_run` | `trace_id TEXT`, `request_id TEXT` when produced by gateway/eval execution. |
| `request_log` | `trace_id TEXT NOT NULL`, `request_id TEXT NOT NULL`, `span_id TEXT`, `parent_span_id TEXT`. |

## 7. API schema mapping

| API object / route | Required fields |
|---|---|
| Common request context schema | `traceparent`, optional `tracestate`, `request_id`, `sampling_decision`, principal/project/virtual-key/budget/policy/registry fields after validation. |
| Common response headers | `traceparent`, `x-devgateway-request-id`, optional `tracestate`, and denial/audit correlation where safe. |
| Audit event API schema | `trace_id`, `request_id`, optional `span_id`, actor, project, virtual key, decision/action, reason, policy and registry versions. |
| Cost event API schema | `trace_id`, `request_id`, optional `span_id`, attempt indexes, provider/model/cost fields, budget scope. |
| Eval record API schema | `trace_id`, `request_id`, model alias, provider, gateway attempt fields, dataset/suite versions. |
| Denial response schema | `decision=deny`, stable `reason`, `trace_id`, `request_id`, and safe audit/cost correlation IDs when available. |

APIs must reject caller attempts to self-assert trusted principal/project/policy/registry fields unless the caller is an approved internal service using a validated service-to-service path.

## 8. Sampling and log correlation

Tracing sampling controls observability volume only. It does not control audit immutability, budget ledger writes, cost events, or denial persistence.

Rules:

1. `sampling_decision=drop` may drop high-volume spans, but audit/cost records required by policy still persist.
2. Logs include `trace_id`, `span_id`, `request_id`, service name, route, decision, denial reason, and safe public IDs.
3. Logs must not include raw virtual-key secrets, provider secrets, prompt/completion text, sensitive headers, or credential ciphertext.
4. Missing log correlation is a validation failure before production.

## 9. Production-disabled and fail-closed defaults

- Missing `traceparent` at untrusted ingress may be replaced only by Control API; missing trace/request context after validation denies production gateway decisions.
- Missing audit/cost correlation denies production decisions when those records are required.
- Trace sampling cannot bypass audit, budget, policy, registry, data-class, or eval-gate checks.
- Track 0 break-glass and owner-assignment blockers remain release-blocking.
- This contract does not enable production telemetry pipelines, Railway services, provider routes, break-glass access, retrieval, MCP, workflows, or semantic cache.

