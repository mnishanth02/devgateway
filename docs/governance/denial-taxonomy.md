# Denial Taxonomy

Status: Track 0 governance artifact  
Scope: typed gateway/policy denial reason codes, audit fields, and fail-closed mapping  
Production capability: this document and related constants do not enable production routes, providers, model aliases, keys, or policy.

## Required reason codes

Gateway denials use only these stable codes:

| Code | Applies when | Gateway policy contract mapping |
|---|---|---|
| `budget` | The resolved budget scope lacks quota, spend, token, or cost headroom. | `decision=deny`, `reason=budget`; deny and audit cost estimate where available. |
| `rate_limit` | A synced principal, virtual key, project, tenant, route, or provider limit is exceeded. | `decision=deny`, `reason=rate_limit`; deny and audit limit context. |
| `data_class` | The resolved data class is not allowed for the alias, provider candidate, route intent, project, or policy version. | `decision=deny`, `reason=data_class`; deny before any provider call. |
| `provider_lifecycle` | Provider/model is disabled, outside an allowed deprecation window, retired, unhealthy-for-policy, or not production-approved. | `decision=deny`, `reason=provider_lifecycle`; exclude candidate or deny if no valid candidate remains. |
| `eval_gate` | Required eval gate evidence is missing or failing for alias, provider, route, data class, or policy version. | `decision=deny`, `reason=eval_gate`; deny production route. |
| `policy_stale` | Policy or registry version is missing, stale, unverifiable, incompatible, or not synced. | `decision=deny`, `reason=policy_stale`; fail closed before routing. |
| `route_disabled` | Alias, route intent, project route, environment, or provider route is explicitly disabled. | `decision=deny`, `reason=route_disabled`; deny before any provider call. |
| `approval_required` | Human, break-glass, security, or project approval is required and unsatisfied. | `decision=deny`, `reason=approval_required`; return a non-success denial or approval-required response without Bifrost evaluating approval. |

## Stable fields

Every typed denial definition carries:

- `code`: one of the required reason codes above.
- `message`: stable internal policy/audit message text.
- `audit`: required and recommended audit context for the denial.
- `gatewayPolicyContract`: mapping to the gateway policy enforcement contract.

The schema contract is `packages\schemas\schemas\policy\denial-reason.v0.1.schema.json`; the inert TypeScript constants are in `packages\policy\src\denial-reasons.ts`.

## Required deny audit context

Denial audit events must include `decision=deny`, `actor`, `project`, `alias`, `provider_candidate`, `policy_version`, `registry_version`, `reason`, `trace_id`, and `cost_estimate`. The `reason` field must be one required code. Optional fields such as `virtual_key_id`, `budget_scope`, `data_class`, `route_intent`, checksums, and timestamps may add context but must not replace required fields.

## Fail-closed semantics

Unknown, missing, stale, unverifiable, incompatible, or disabled policy/registry state denies the request. A denial must not be transformed into a success-shaped fallback, synthetic allow, default provider route, or provider call with missing context. `approval_required` may surface an approval-required response, but that response is still non-success and must not evaluate approval inside Bifrost.

Adding or renaming a denial code requires a versioned contract update, compatibility validation, and audit parser update.
