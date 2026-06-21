# Budget Scope Model

Status: Track 1.0 governance contract  
Scope: budget ownership hierarchy, reservation and actual spend semantics, reset windows, cap behavior, API mapping, and gateway denial rules  
Production capability: this document does not enable production budgets, production routes, provider keys, break-glass access, Railway provisioning, retrieval, MCP, workflows, or semantic cache.

## 1. Purpose

Budget scopes define the quota and spend boundary used by gateway policy before and after provider calls. A budget scope is referenced by virtual keys, cost events, audit events, and rate-limit decisions so Track 1 can attribute cost without letting Bifrost define ownership policy.

This contract is documentation only. Production enforcement remains disabled and fail-closed until Track 0 blockers and later Track 1 production gates are satisfied.

## 2. Scope hierarchy and inheritance

Budget policy can be attached to these owner levels:

1. Organization.
2. Team.
3. Project.
4. Principal/user or service principal.
5. Virtual key.

Inheritance is restrictive. A child scope may lower or subdivide an inherited cap, but must not silently raise the effective cap above the most restrictive applicable ancestor unless a reviewed policy version explicitly records the override.

| Scope field | Requirement |
|---|---|
| `budget_scope_id` | Public opaque ID, for example `bs_...`, used by APIs, audit, and cost events. |
| `scope_type` | One of `org`, `team`, `project`, `principal`, `virtual_key`, or future versioned value. |
| `owner_ref` | Public owner ID matching the scope type. |
| `parent_budget_scope_id` | Optional parent. If present, child spend rolls up to parent. |
| `project_id` | Required for project and virtual-key scopes; recommended for principal scopes tied to one project. |
| `policy_version` | Immutable policy version that defined the scope. |
| `status` | `draft`, `active`, `disabled`, or `archived`. Production accepts only `active` after gates are approved. |

Missing parent data, inheritance cycles, unknown owner types, stale policy versions, or unresolved project boundaries deny budget checks with `policy_stale` or `budget`.

## 3. Reservation versus actual spend

Budget enforcement uses two related ledger concepts:

| Concept | Timing | Purpose |
|---|---|---|
| Reservation | Before provider call, using estimated tokens/cost. | Prevents known over-budget requests from starting and reserves headroom during gateway/fallback attempts. |
| Actual spend | After provider response or terminal failure with known usage. | Reconciles provider-reported tokens/cost and releases or adjusts reservations. |

Rules:

1. A request that requires budget enforcement must create or reference a reservation before provider routing.
2. The reservation amount is based on the best available estimate from model alias, provider candidate, route intent, max tokens, and registry price metadata.
3. Actual spend must link to the reservation when available.
4. If actual spend is lower than reserved, unused reservation is released.
5. If actual spend is higher than reserved, the ledger records the overage and policy determines whether future requests are denied.
6. If provider usage is unavailable, actual spend records `usage_source=estimated_final` and must not pretend provider usage was verified.
7. Denied pre-route requests may record zero actual spend but can still record an estimated cost event for audit.

## 4. Reset periods and caps

| Field | Requirement |
|---|---|
| `reset_period` | `daily`, `weekly`, `monthly`, `rolling_24h`, `rolling_7d`, `rolling_30d`, or `none`. |
| `reset_anchor` | Timezone-free anchor instant or policy-defined calendar boundary. |
| `hard_cap_amount` | Spend or token cap that denies requests when exceeded. |
| `soft_cap_amount` | Threshold that emits audit/alert events but does not by itself allow over-hard-cap spend. |
| `currency` | ISO 4217 uppercase code for cost budgets, for example `USD`. |
| `token_cap_input` / `token_cap_output` / `token_cap_total` | Optional token caps independent of currency. |

Hard caps are deny-by-default. Soft caps are observability and notification thresholds only; they cannot convert a hard-cap denial into an allow.

## 5. Denial semantics

Budget denials use `reason=budget` from the denial taxonomy.

A request denies with `budget` when:

- no active budget scope is resolved;
- inherited policy cannot be verified;
- reservation would exceed a hard spend or token cap;
- actual outstanding reservations plus known spend exceed hard cap;
- budget scope currency is incompatible with the cost estimate and no approved conversion policy exists;
- budget ledger or audit write is unavailable for a production decision.

Budget denials must include `budget_scope_id`, effective cap, estimated cost/tokens where available, reset period, policy version, registry version, `trace_id`, and `request_id` in audit/cost metadata.

## 6. Rate-limit interaction

Budgets and rate limits are separate controls that share attribution fields.

| Control | Denial reason | Source of truth | Required interaction |
|---|---|---|---|
| Budget cap | `budget` | Budget policy and ledger in Operational Postgres. | Checks spend/tokens and reservations. |
| Rate limit | `rate_limit` | Platform policy/rate-limit service, with Redis allowed only for short-lived counters/locks. | Checks request rate, concurrency, and burst limits. |

Evaluation order follows provider data-class policy: budget/rate-limit checks occur after provider lifecycle, data-class, and eval-gate checks. If both controls fail and the rate-limit result is known first, return `rate_limit`; if the budget result is known first, return `budget`. Audit context should include both failures when deterministically available without extra provider calls.

Redis must not become durable budget truth. Missing durable budget state fails closed for production.

## 7. DB column mapping

Phase 1.1 should implement these Operational Postgres tables.

### `budget_scope`

| Column | Type / constraint | Notes |
|---|---|---|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Internal only. |
| `budget_scope_id` | `TEXT NOT NULL UNIQUE` | Public opaque ID. |
| `scope_type` | `TEXT NOT NULL CHECK (...)` | `org`, `team`, `project`, `principal`, `virtual_key`. |
| `owner_ref` | `TEXT NOT NULL` | Public owner ID; concrete FK may be added for known owners. |
| `org_id` | `BIGINT REFERENCES org(id) ON DELETE RESTRICT` | Nullable for non-org scoped rows. |
| `team_id` | `BIGINT REFERENCES team(id) ON DELETE RESTRICT` | Nullable. |
| `project_id` | `BIGINT REFERENCES project(id) ON DELETE RESTRICT` | Required by policy for project/virtual-key scopes. |
| `principal_id` | `BIGINT REFERENCES principal(id) ON DELETE RESTRICT` | Nullable. |
| `virtual_key_id` | `BIGINT REFERENCES virtual_key(id) ON DELETE RESTRICT` | Nullable. |
| `parent_budget_scope_id` | `BIGINT REFERENCES budget_scope(id) ON DELETE RESTRICT` | No inheritance cycles. |
| `status` | `TEXT NOT NULL CHECK (...)` | `draft`, `active`, `disabled`, `archived`. |
| `policy_version` | `TEXT NOT NULL` | Immutable policy reference. |
| `production_enabled` | `BOOLEAN NOT NULL DEFAULT false CHECK (production_enabled = false)` | Phase 1 default. |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL` | Standard timestamps. |

### `budget_policy`

| Column | Type / constraint | Notes |
|---|---|---|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Internal only. |
| `budget_scope_id` | `BIGINT NOT NULL REFERENCES budget_scope(id) ON DELETE RESTRICT` | Policy owner. |
| `currency` | `TEXT NOT NULL` | ISO 4217 for cost caps. |
| `hard_cap_amount` | `NUMERIC(20, 8)` | Nullable only if token hard caps exist. |
| `soft_cap_amount` | `NUMERIC(20, 8)` | Alert threshold. |
| `token_cap_input` / `token_cap_output` / `token_cap_total` | `BIGINT` | Optional token caps. |
| `reset_period` | `TEXT NOT NULL CHECK (...)` | Reset cadence. |
| `reset_anchor` | `TIMESTAMPTZ` | Required for rolling/custom windows. |
| `effective_from` / `effective_until` | `TIMESTAMPTZ` | Versioned policy window. |
| `policy_version` | `TEXT NOT NULL` | Immutable policy reference. |
| `created_audit_event_id` | `BIGINT REFERENCES audit_event(id) ON DELETE RESTRICT` | Audit correlation. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Creation time. |

### `budget_ledger`

| Column | Type / constraint | Notes |
|---|---|---|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Internal only. |
| `ledger_entry_id` | `TEXT NOT NULL UNIQUE` | Public opaque ID. |
| `budget_scope_id` | `BIGINT NOT NULL REFERENCES budget_scope(id) ON DELETE RESTRICT` | Attribution. |
| `request_id` | `TEXT NOT NULL` | Request correlation. |
| `trace_id` | `TEXT NOT NULL` | Trace correlation. |
| `cost_event_id` | `BIGINT REFERENCES cost_event(id) ON DELETE RESTRICT` | Linked cost event when available. |
| `entry_type` | `TEXT NOT NULL CHECK (...)` | `reservation`, `reservation_release`, `actual`, `adjustment`. |
| `amount` | `NUMERIC(20, 8)` | Cost amount in `currency`. |
| `currency` | `TEXT NOT NULL` | Must match or have approved conversion policy. |
| `input_tokens` / `output_tokens` / `total_tokens` | `BIGINT` | Token ledger values. |
| `status` | `TEXT NOT NULL CHECK (...)` | `pending`, `committed`, `released`, `voided`. |
| `reset_period_start` / `reset_period_end` | `TIMESTAMPTZ NOT NULL` | Aggregation window. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Append time. |

Required indexes: `budget_scope(budget_scope_id)`, `budget_scope(scope_type, owner_ref)`, `budget_policy(budget_scope_id, effective_from)`, `budget_ledger(budget_scope_id, reset_period_start, reset_period_end)`, `budget_ledger(request_id)`, and `budget_ledger(trace_id)`.

## 8. API schema mapping

| API object / route | Required fields |
|---|---|
| `POST /api/budget-scopes` request | `scope_type`, `owner_ref`, optional parent, concrete owner IDs where known, `policy_version`, `status=draft` or non-production `active`. |
| `GET /api/budget-scopes/{budget_scope_id}` response | Scope identity, owner refs, parent, status, policy version, effective policy summary, current period spend/reservation summary. |
| `POST /api/budget-policies` request | `budget_scope_id`, `currency`, hard/soft caps, token caps, `reset_period`, `reset_anchor`, effective window, `policy_version`. |
| `POST /api/budget-reservations` request | `budget_scope_id`, `request_id`, `trace_id`, estimated tokens/cost, `model_alias`, `provider`, `policy_version`, `registry_version`. |
| `POST /api/budget-actuals` request | `reservation_id`, `cost_event_id`, actual tokens/cost, usage source, request/trace correlation. |
| Budget denial response | `decision=deny`, `reason=budget`, `budget_scope_id`, cap summary, estimate summary, reset window, `request_id`, `trace_id`. |

APIs must not accept provider secrets, production enablement flags, break-glass overrides, retrieval/MCP/workflow budgets, or semantic-cache scopes in Phase 1.0/1.1.

## 9. Production-disabled and fail-closed defaults

- Budget scopes and policies default to non-production only; production enablement is constrained false in the initial schema.
- Missing budget scope, stale policy, unknown inheritance, unavailable ledger, unavailable audit, invalid currency, and cap exhaustion deny.
- Soft caps produce audit/alert signals only and do not bypass hard caps.
- Track 0 blockers remain release-blocking before production gateway traffic.

