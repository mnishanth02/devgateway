# Gateway Policy Enforcement Contract

Status: Track 0 governance artifact  
Scope: gateway/platform policy boundary, validation, fail-closed behavior, and audit contract  
Production capability: this document does not enable any production route, provider, model alias, key, or policy.

## 1. Purpose

This contract locks how the platform policy plane and Bifrost gateway cooperate before Track 1 builds gateway routes. It is intentionally a governance artifact: schemas, code, provider enablement, and production credentials remain out of scope until later approved phases.

The contract must prevent implementation drift where tool policy, project policy, approval policy, budget ownership, or principal/project metadata resolution moves into Bifrost. Bifrost is an enforcement point for virtual-key ingress and synced route/provider policy only; the Control API and platform policy services remain the source of policy decisions and metadata.

## 2. Non-negotiable responsibility boundary

| Capability | Owner | Bifrost responsibility | Must not happen |
|---|---|---|---|
| Principal resolution | Control API / platform policy | Accept only platform-issued or platform-validated principal identifiers in the request context envelope or synced key metadata. | Bifrost must not infer actor identity from headers, repositories, prompts, tools, or project names. |
| Project resolution | Control API / platform policy | Enforce the resolved project identifier and project route constraints supplied by platform policy. | Bifrost must not decide project membership, tenant membership, repository ACLs, or project policy. |
| Virtual-key ingress | Control API issues and rotates keys; Bifrost enforces ingress | Validate virtual key presence, active state, scope binding, and snapshot version. | Bifrost must not mint durable keys or override platform key state. |
| Tool policy | Platform policy / approval systems | Receive only route intent and policy outcome metadata needed for model routing. | Tool allow/deny, MCP policy, approval workflows, and repository retrieval policy must not move into Bifrost. |
| Model/provider registry | Registry service / platform policy | Use generated or validated configuration from registry snapshots. | Bifrost must not be the source of truth for provider lifecycle, aliases, eval gates, or data-class eligibility. |
| Budgets and rate limits | Platform policy / budget service | Enforce synced budget/rate-limit decisions and emit denial/audit events. | Bifrost must not define budget scopes, project quotas, or exception policy. |
| Audit contract | Platform observability/audit owner | Emit allow/deny audit events with required fields. | Bifrost must not silently allow or deny without a traceable audit event except when the audit sink itself is unavailable, which fails closed for production. |

## 3. Request context envelope

Every gateway request must carry or derive a single immutable request context envelope before provider routing. The envelope is attached to policy checks, route selection, audit events, and cost estimation. Missing required fields fail closed.

| Field | Required content | Source of truth | Enforcement expectation |
|---|---|---|---|
| `principal` | Actor identifier, actor type, and authentication subject mapped to the caller. | Control API / platform policy. | Required for all allow/deny decisions; not inferred by Bifrost. |
| `virtual_key` | Key identifier or fingerprint, key status, key scopes, and binding to allowed principal/project contexts. | Control API key issuer and synced key metadata. | Bifrost validates ingress against the active synced key state. |
| `project` | Project identifier, tenant/org boundary, and policy domain. | Control API / platform policy. | Required for budget, data-class, route, and audit decisions. |
| `data_class` | Classified data category for the request, such as public, internal, confidential, restricted, or a future registry-defined value. | Platform policy classifier / Control API. | Bifrost enforces only synced route compatibility for the resolved data class. |
| `model_alias` | Requested stable model alias, not a raw provider model unless explicitly registry-mapped. | Model/provider registry. | Alias must exist in the referenced registry version and be enabled for the route. |
| `route_intent` | Declared route purpose such as chat, completion, embedding, eval, tool-planning, or policy-defined intent. | Control API / platform policy. | Used to select only registry-approved routes; not a tool-policy decision. |
| `trace_id` | End-to-end correlation identifier. | Request entry point / platform tracing. | Required in all audit events and provider attempts. |
| `policy_version` | Immutable platform policy version used to authorize the request. | Platform policy. | Must be present, current, and verifiable; otherwise fail closed. |
| `registry_version` | Immutable registry snapshot version used to validate alias/provider/route state. | Model/provider registry. | Must be present, current, and verifiable; otherwise fail closed. |
| `budget_scope` | Scope used for cost and quota checks, for example principal, project, tenant, environment, or a policy-defined composite. | Platform budget policy. | Bifrost enforces synced decisions for this scope and records it in audit metadata. |

Envelope rules:

1. Required envelope fields are immutable after the first policy decision.
2. Bifrost may enrich the envelope only with enforcement-local fields such as provider candidate, route decision, cost estimate, and gateway instance metadata.
3. Bifrost must not replace missing principal, project, data-class, budget, or approval metadata with local defaults.
4. Any mismatch between the request envelope and synced virtual-key metadata is a denial.
5. Any unknown required envelope field value that is not accepted by the referenced policy and registry versions is a denial.

## 4. Principal and project resolution flow

1. The caller enters through the platform-approved path using a platform-issued virtual key or a Control API-mediated request.
2. The Control API and platform policy resolve principal metadata, project metadata, tenant boundaries, data class, route intent, budget scope, and any approval requirements.
3. The request reaches Bifrost with a verifiable context envelope or with enough platform-issued synced key metadata for Bifrost to validate the envelope.
4. Bifrost validates virtual-key ingress, envelope completeness, key status, project binding, route intent, data-class compatibility, policy freshness, and registry freshness using synced snapshots.
5. Bifrost selects only provider candidates allowed by the registry snapshot and synced route policy.
6. Bifrost emits an allow or deny audit event before returning the final gateway decision.

Track 1 implementations must not add code paths where Bifrost performs durable principal lookup, project membership lookup, repository ACL evaluation, tool-policy evaluation, or human approval evaluation. If Bifrost lacks platform-resolved metadata, it must deny the request.

## 5. Registry sync contract

The model/provider registry is the source of truth for:

- model aliases;
- provider candidates and provider identifiers;
- provider lifecycle state;
- route enablement and route disablement;
- data-class eligibility;
- eval gate status;
- cost estimation metadata where available;
- provider/model deprecation and retirement windows;
- registry version identifiers, checksums, signatures, and freshness metadata.

Bifrost configuration must be generated from registry snapshots or mechanically validated against registry snapshots before use. Manual Bifrost-only model/provider configuration is not allowed for production routes.

Registry snapshot expectations:

1. Each snapshot has an immutable `registry_version`, creation time, freshness deadline, checksum, and verifiable signature or equivalent integrity proof.
2. Generated Bifrost config must record the `registry_version` it came from.
3. Startup, deploy, and reload validation must fail if Bifrost config references aliases, providers, data classes, routes, or eval-gate states that are absent from the registry snapshot.
4. Runtime requests must fail closed if the envelope `registry_version` is missing, stale, unverifiable, or incompatible with the active Bifrost config.
5. Registry validation must be part of the production gate before any model alias or route can be used outside non-production tests.

## 6. Policy freshness and fail-closed behavior

Missing, stale, unverifiable, incompatible, or downgraded policy and registry versions fail closed. There is no permissive fallback for production traffic.

Fail-closed cases include:

- missing `policy_version`;
- missing `registry_version`;
- policy version not recognized by the synced policy snapshot;
- registry version not recognized by the synced registry snapshot;
- stale snapshot based on its signed freshness deadline or platform-defined maximum age;
- unverifiable snapshot checksum, signature, or integrity proof;
- request envelope version older than the minimum accepted production version;
- active Bifrost config not generated from, or not validated against, the referenced registry snapshot;
- audit sink unavailable for production decisions when policy requires durable audit emission;
- policy service, registry sync, or validator unavailable in a way that prevents verification.

The denial reason for missing, stale, or unverifiable policy/registry state is `policy_stale` unless a more specific route-disabled or provider-lifecycle reason is available and verifiable.

## 7. Denial taxonomy

Gateway denials must use stable typed reason codes. The codes below are required and must appear exactly as listed in policy outputs, logs, metrics, and audit events.

| Reason code | Applies when | Owner of decision | Bifrost action |
|---|---|---|---|
| `budget` | The resolved budget scope lacks quota, spend, token, or cost headroom. | Platform budget policy. | Deny and audit with cost estimate where available. |
| `rate_limit` | The principal, virtual key, project, tenant, route, or provider exceeds a synced rate limit. | Platform policy / rate-limit service. | Deny and audit limit context. |
| `data_class` | The resolved data class is not allowed for the alias, provider candidate, route intent, project, or policy version. | Platform policy and registry eligibility. | Deny before provider call. |
| `provider_lifecycle` | Provider/model is disabled, deprecated beyond allowed window, retired, unhealthy-for-policy, or not production-approved. | Model/provider registry. | Exclude candidate or deny if no valid candidate remains. |
| `eval_gate` | Alias, provider, route, data class, or policy version lacks required evaluation gate evidence. | Eval owner / registry policy. | Deny production route. |
| `policy_stale` | Registry or policy version is missing, stale, unverifiable, incompatible, or not synced. | Platform policy / registry validators. | Fail closed before routing. |
| `route_disabled` | The alias, route intent, project route, environment, or provider route is explicitly disabled. | Platform policy / registry. | Deny before provider call. |
| `approval_required` | A human, break-glass, security, or project approval is required and not satisfied. | Platform approval policy. | Deny or return approval-required response without evaluating approval in Bifrost. |

Unknown denial reasons are not allowed for production. Adding or renaming a reason code requires a versioned contract update, policy compatibility validation, and audit parser update.

## 8. Audit event shape

Every gateway decision must emit a structured audit event. Both allow and deny events include the same core shape so downstream audit, billing, incident response, and policy validation can reason over decisions uniformly.

Required fields:

| Field | Requirement |
|---|---|
| `decision` | `allow` or `deny`. |
| `actor` | Principal actor identifier and actor type from the context envelope. |
| `project` | Resolved project identifier from the context envelope. |
| `alias` | Requested model alias. |
| `provider_candidate` | Provider candidate selected for allow events; denied candidate or best-known candidate for deny events when available. |
| `policy_version` | Immutable policy version used for the decision. |
| `registry_version` | Immutable registry version used for the decision. |
| `reason` | `allowed` for successful route decisions, or one of the denial taxonomy codes for deny decisions. |
| `trace_id` | End-to-end trace identifier from the context envelope. |
| `cost_estimate` | Estimated tokens, currency, or unit cost when available before the provider call. If unavailable, record a null value and reason such as `not_available_pre_route`. |

Recommended fields include `virtual_key_id`, `budget_scope`, `data_class`, `route_intent`, `environment`, `gateway_instance`, `decision_latency_ms`, `policy_snapshot_checksum`, `registry_snapshot_checksum`, and `request_timestamp`.

Minimum event examples:

```json
{
  "decision": "allow",
  "actor": { "id": "principal_123", "type": "user" },
  "project": "project_abc",
  "alias": "default-chat",
  "provider_candidate": "provider_x/model_y",
  "policy_version": "policy-2026-06-20.1",
  "registry_version": "registry-2026-06-20.1",
  "reason": "allowed",
  "trace_id": "trace_789",
  "cost_estimate": { "input_tokens": 1200, "output_tokens": 800, "currency": "USD", "estimated_cost": 0.01 }
}
```

```json
{
  "decision": "deny",
  "actor": { "id": "principal_123", "type": "user" },
  "project": "project_abc",
  "alias": "default-chat",
  "provider_candidate": null,
  "policy_version": "policy-2026-06-20.1",
  "registry_version": "registry-2026-06-20.1",
  "reason": "policy_stale",
  "trace_id": "trace_790",
  "cost_estimate": null
}
```

## 9. Production gate requirements

Before any production gateway capability is enabled, the responsible track must provide evidence that:

1. Bifrost config is generated from or validated against a registry snapshot.
2. The active registry snapshot is current, immutable, and verifiable.
3. The active policy snapshot is current, immutable, and verifiable.
4. Request context envelope validation rejects missing principal, virtual key, project, data class, model alias, route intent, trace ID, policy version, registry version, and budget scope.
5. All required denial reason codes are emitted and audited.
6. Allow and deny audit events contain actor, project, alias, provider candidate, policy version, registry version, reason, trace ID, and cost estimate where available.
7. Eval gates are present for every production alias/provider/route/data-class combination.
8. Route-disabled, provider-lifecycle, approval-required, stale-policy, budget, rate-limit, and data-class checks are exercised in validation.
9. Platform policy ownership is documented so tool policy, project policy, and approval policy remain outside Bifrost.
10. Production behavior fails closed when policy, registry, audit, or validation dependencies cannot prove the request is allowed.

This contract itself does not satisfy those gates and must not be treated as production approval.

## 10. Versioning and validation expectations

- Contract changes use a documented review path and must remain backward-compatible or define an explicit migration window.
- `policy_version` and `registry_version` are immutable references. Reusing a version identifier for changed content is forbidden.
- Validators must check required envelope fields, allowed denial reason codes, required audit fields, snapshot freshness, integrity proof, and Bifrost config provenance.
- CI or release validation must compare generated Bifrost config to the registry snapshot before deployment.
- Runtime validation must compare request envelope versions to active synced versions before any provider call.
- Any new provider lifecycle state, route intent, data class, budget scope, or denial reason requires a versioned policy/registry update and compatible audit handling.
- Non-production experiments may use clearly labeled test registry/policy versions, but must not be promoted to production without the production gate evidence above.

## 11. Required-area validation checklist

This document explicitly covers the required contract areas:

- Request context envelope: principal, virtual key, project, data class, model alias, route intent, trace ID, policy version, registry version, budget scope.
- Principal and project resolution: Control API/platform policy resolves metadata; Bifrost enforces virtual-key ingress and synced route policy.
- Registry sync: model/provider registry is the source of truth; Bifrost config is generated or validated from registry snapshots.
- Policy freshness: missing, stale, or unverifiable registry/policy versions fail closed.
- Denial taxonomy: `budget`, `rate_limit`, `data_class`, `provider_lifecycle`, `eval_gate`, `policy_stale`, `route_disabled`, `approval_required`.
- Audit event shape: allow/deny includes actor, project, alias, provider candidate, policy version, registry version, reason, trace ID, and cost estimate where available.
