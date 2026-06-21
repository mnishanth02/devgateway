# Cost Event Contract

Status: Track 1.0 governance contract  
Scope: gateway cost event fields, estimated and actual usage semantics, aggregation targets, DB column mapping, and API schema mapping  
Production capability: this document does not enable production billing, model routes, provider secrets, break-glass access, Railway provisioning, retrieval, MCP, workflows, or semantic cache.

## 1. Purpose

Cost events record estimated and actual token/cost data for gateway requests, provider attempts, fallback attempts, eval runs, and budget reconciliation. They are append-only operational evidence used by budget enforcement, audit, dashboards, and later billing-safe aggregates.

This contract is documentation only. Production cost enforcement remains disabled and fail-closed until Track 0 blockers and Track 1 gates are satisfied.

## 2. Event lifecycle

| Stage | Event requirement |
|---|---|
| Pre-route estimate | Emit or prepare an estimated event before provider routing when price metadata is available. Missing estimate may still deny if budget policy requires it. |
| Reservation link | Link the estimate to a budget reservation where budget enforcement applies. |
| Provider attempt | Record gateway attempt and fallback attempt indexes for each provider candidate attempt. |
| Actual usage | Record provider-reported tokens and cost after response when available. |
| Reconciliation | Link actual cost to reservation/ledger and mark usage source. |
| Denial | Denied requests can record estimate-only cost context with `decision=deny` and zero actual cost. |

Cost events must not include prompt text, completion text, raw provider keys, raw virtual-key secret material, or unredacted sensitive payloads.

## 3. Required fields

| Field | Requirement |
|---|---|
| `cost_event_id` | Public opaque ID for audit, budget ledger, and dashboard lookup. |
| `event_type` | `estimate`, `actual`, `reconciliation`, `denial_estimate`, or future versioned value. |
| `request_id` | Stable request ID from trace context. |
| `trace_id` | End-to-end trace ID. |
| `span_id` | Current span ID when available. |
| `principal_id` | Principal attribution from request context. |
| `project_id` | Project attribution from request context. |
| `virtual_key_id` | Virtual key public ID or null only for Control API internal non-gateway events. |
| `budget_scope_id` | Required budget attribution. |
| `policy_version` | Policy version used for the event. |
| `registry_version` | Registry snapshot used for alias/provider/price metadata. |
| `provider` | Provider identifier selected or attempted. |
| `model_alias` | Requested stable model alias. |
| `provider_model_id` | Provider-native model identifier when known. |
| `gateway_attempt` | One-based attempt number for gateway routing. |
| `fallback_attempt` | Zero for primary route, one or higher for fallback attempts. |
| `currency` | ISO 4217 currency, for example `USD`. |
| Estimated tokens/cost | `estimated_input_tokens`, `estimated_output_tokens`, `estimated_total_tokens`, `estimated_cost_amount`. |
| Actual tokens/cost | `actual_input_tokens`, `actual_output_tokens`, `actual_total_tokens`, `actual_cost_amount`. |
| `usage_source` | `registry_estimate`, `gateway_counter`, `provider_reported`, `estimated_final`, or `not_available`. |
| `decision` / `denial_reason` | `allow` or `deny`; denial reason uses the stable denial taxonomy. |
| Aggregation targets | Fields needed to aggregate by project, principal, virtual key, budget scope, provider, model alias, environment, route intent, data class, and reset window. |

## 4. Estimated and actual semantics

Estimated values are pre-route or in-flight predictions. Actual values are provider-reported or final gateway-counted usage. Consumers must not treat estimates as verified provider usage.

Rules:

1. Estimated fields may be null only when `usage_source=not_available` and audit records why the estimate was unavailable.
2. Actual fields may be null until the provider attempt completes.
3. A completed provider call with provider usage must set `usage_source=provider_reported`.
4. If provider usage is missing but gateway counters can produce a final value, use `gateway_counter`.
5. If final usage cannot be verified, use `estimated_final` and keep the event distinguishable from provider-reported data.
6. Currency conversion is forbidden unless a versioned policy explicitly defines rates and audit fields. Without conversion, incompatible currency denies budget enforcement.

## 5. Gateway and fallback attempts

Each provider call attempt records:

- `gateway_attempt`: the route decision attempt for the request.
- `fallback_attempt`: `0` for the primary provider candidate, `1+` for fallback candidates.
- `provider`: provider ID from the registry snapshot.
- `model_alias`: stable alias requested by the caller.
- `provider_model_id`: provider-native model selected by the registry.
- `attempt_status`: `started`, `succeeded`, `failed`, `denied`, `cancelled`, or `timed_out`.

Fallback is not a production-enablement shortcut. A fallback attempt must satisfy the same policy, registry, data-class, eval-gate, budget, rate-limit, trace, and audit requirements as the primary attempt.

## 6. Aggregation targets

Cost events must support aggregation by:

1. `budget_scope_id` and reset period.
2. `project_id`.
3. `principal_id`.
4. `virtual_key_id`.
5. `provider`.
6. `model_alias`.
7. `route_intent`.
8. `data_class`.
9. `environment`.
10. `policy_version` and `registry_version`.
11. `gateway_attempt` and `fallback_attempt`.
12. `trace_id` and `request_id` for incident correlation.

High-volume retention, archive/export, partitioning, and indexes must be approved before production as required by schema and migration conventions.

## 7. DB column mapping

Phase 1.1 should implement append-oriented `cost_event` rows in Operational Postgres.

| Column | Type / constraint | Notes |
|---|---|---|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Internal only. |
| `cost_event_id` | `TEXT NOT NULL UNIQUE` | Public opaque ID. |
| `event_type` | `TEXT NOT NULL CHECK (...)` | `estimate`, `actual`, `reconciliation`, `denial_estimate`. |
| `request_id` | `TEXT NOT NULL` | Request correlation. |
| `trace_id` | `TEXT NOT NULL` | Trace correlation. |
| `span_id` | `TEXT` | Span correlation. |
| `principal_id` | `BIGINT REFERENCES principal(id) ON DELETE RESTRICT` | Nullable only for non-gateway internal events. |
| `project_id` | `BIGINT NOT NULL REFERENCES project(id) ON DELETE RESTRICT` | Project attribution. |
| `virtual_key_id` | `BIGINT REFERENCES virtual_key(id) ON DELETE RESTRICT` | Virtual key attribution. |
| `budget_scope_id` | `BIGINT NOT NULL REFERENCES budget_scope(id) ON DELETE RESTRICT` | Budget attribution. |
| `policy_version` | `TEXT NOT NULL` | Policy pin. |
| `registry_version` | `TEXT NOT NULL` | Registry/price pin. |
| `environment` | `TEXT NOT NULL` | Production disabled by default. |
| `route_intent` | `TEXT NOT NULL` | Request route purpose. |
| `data_class` | `TEXT NOT NULL` | Classified data category. |
| `provider` | `TEXT` | Provider ID from registry snapshot. |
| `model_alias` | `TEXT NOT NULL` | Stable alias. |
| `provider_model_id` | `TEXT` | Provider-native model ID. |
| `gateway_attempt` | `INTEGER NOT NULL DEFAULT 1` | One-based. |
| `fallback_attempt` | `INTEGER NOT NULL DEFAULT 0` | Zero for primary. |
| `attempt_status` | `TEXT NOT NULL CHECK (...)` | `started`, `succeeded`, `failed`, `denied`, `cancelled`, `timed_out`. |
| `currency` | `TEXT NOT NULL` | ISO 4217. |
| `estimated_input_tokens` / `estimated_output_tokens` / `estimated_total_tokens` | `BIGINT` | Estimate fields. |
| `estimated_cost_amount` | `NUMERIC(20, 8)` | Estimate cost. |
| `actual_input_tokens` / `actual_output_tokens` / `actual_total_tokens` | `BIGINT` | Actual fields. |
| `actual_cost_amount` | `NUMERIC(20, 8)` | Actual cost. |
| `usage_source` | `TEXT NOT NULL CHECK (...)` | `registry_estimate`, `gateway_counter`, `provider_reported`, `estimated_final`, `not_available`. |
| `decision` | `TEXT NOT NULL CHECK (decision IN ('allow','deny'))` | Gateway decision. |
| `denial_reason` | `TEXT` | Required when `decision=deny`. |
| `budget_reservation_ledger_id` | `BIGINT REFERENCES budget_ledger(id) ON DELETE RESTRICT` | Reservation link. |
| `audit_event_id` | `BIGINT REFERENCES audit_event(id) ON DELETE RESTRICT` | Audit correlation. |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | Non-authoritative provider/request metadata only. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Append time. |

Required indexes: `(budget_scope_id, created_at)`, `(project_id, created_at)`, `(virtual_key_id, created_at)`, `(provider, model_alias, created_at)`, `request_id`, `trace_id`, `(policy_version, registry_version)`, and `(environment, route_intent, data_class)`.

## 8. API schema mapping

| API object / route | Required fields |
|---|---|
| `POST /api/cost-events/estimate` request | `request_id`, `trace_id`, `virtual_key_id`, `budget_scope_id`, `provider`, `model_alias`, `gateway_attempt`, `fallback_attempt`, estimated tokens/cost, `currency`, `policy_version`, `registry_version`. |
| `POST /api/cost-events/actual` request | `request_id`, `trace_id`, `cost_event_id` or reservation reference, actual tokens/cost, `usage_source`, `attempt_status`, provider/model fields. |
| `GET /api/cost-events` filters | `budget_scope_id`, `project_id`, `virtual_key_id`, `provider`, `model_alias`, `request_id`, `trace_id`, time range, `event_type`. |
| Cost event response | All public IDs, attribution fields, estimated/actual fields, usage source, decision/denial reason, attempt indexes, created time. |
| Aggregate response | Group key, window start/end, estimated totals, actual totals, currency, token totals, event count, source completeness flags. |

APIs must reject prompt/completion payloads, raw provider secrets, raw virtual-key secrets, production enablement flags, break-glass bypass fields, retrieval/MCP/workflow payloads, and semantic-cache controls.

## 9. Production-disabled and fail-closed defaults

- Cost events do not enable production billing or production provider calls.
- Missing trace/request correlation, budget scope, policy version, registry version, currency, or audit linkage fails closed for production enforcement.
- Fallback cost events must not bypass provider lifecycle, eval gates, budget, rate limits, or data-class policy.
- Track 0 break-glass and owner-assignment blockers remain preserved.

