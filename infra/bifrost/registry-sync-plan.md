# Bifrost registry sync plan v0.1

## Objective

Keep Bifrost route/provider configuration derived from the DevGateway model/provider registry and provider-policy artifacts. The sync path prevents registry drift, stale policy use, and accidental movement of raw tool-policy ownership into Bifrost.

## Sources and outputs

| Item | Owner | Purpose |
|---|---|---|
| Model/provider registry snapshot | Registry owner | Source of aliases, provider candidates, wire format, prices, lifecycle, data-class eligibility, and eval gate references. |
| Provider/data-class policy snapshot | Platform security owner | Source of provider posture, allowed data classes, denial taxonomy, production gate requirements, and freshness policy. |
| Gate-result records | Evaluation owner | Evidence that production aliases/routes have matching passing eval gates. |
| Generated Bifrost config | Gateway owner | Runtime route/provider config consumed by the upstream Bifrost Docker/Go runtime. |
| Virtual-key map | Gateway owner with Platform security owner review | Binds virtual keys to principal/project/budget scopes and registry/policy versions. |

## Sync sequence

1. Validate registry and policy artifacts with workspace commands.
2. Materialize immutable registry and policy snapshots with version IDs.
3. Verify production-enabled aliases/routes have matching passing gate-result records.
4. Generate Bifrost route/provider config from snapshots, or validate a checked-in/generated config against snapshots.
5. Attach snapshot version IDs to `BIFROST_ROUTE_CONFIG_VERSION` and `BIFROST_POLICY_VERSION`.
6. Deploy or restart Bifrost only after config validation succeeds.
7. Emit an audit event containing snapshot versions, checksum, approver, environment, and deployment ID.

## Freshness and fail-closed policy

- Missing snapshots fail validation.
- Stale snapshots fail validation when older than `BIFROST_POLICY_MAX_STALENESS_SECONDS` or the approved release window.
- Checksum/signature mismatch fails validation.
- Bifrost startup fails when generated config and environment versions do not match.
- Runtime requests fail closed when their policy or registry version headers are missing, stale, or not equal to the active gateway versions.
- Break-glass does not bypass freshness checks unless an approved break-glass TTL explicitly names the route and provider scope; all use is audited and followed by provider-key rotation.

## Virtual-key integration

- Virtual keys are issued by the platform control plane, backed by Railway variables or approved encrypted records.
- Each key is scoped to principal/project/budget/data-class constraints and the active registry/policy versions.
- Bifrost validates the virtual key and required context envelope before selecting a provider.
- Virtual-key rotation must revoke stale keys and write audit events for old/new key IDs, scope, actor, and reason.

## Tool-policy boundary

Bifrost may enforce synced model/provider route constraints, budget/rate-limit hooks, and virtual-key ingress. It must not own raw MCP tool policy, repository authorization, sandbox policy, approval workflows, or side-effect permissions. Those remain with Tool Broker, Control API, and platform policy packages.

## Validation commands

Run these before accepting a sync artifact or route change:

```powershell
pnpm registry:validate
pnpm policy:validate
pnpm eval:smoke
pnpm workspace:validate
```

Production remains disabled until explicit approval changes the production gate variables during an approved release.
