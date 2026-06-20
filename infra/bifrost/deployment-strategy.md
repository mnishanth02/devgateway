# Bifrost deployment strategy v0.1

## Purpose

Bifrost is the provider gateway for DevGateway. It validates virtual-key ingress and enforces provider-route constraints generated from platform registry and policy artifacts. It does not own durable workflows, MCP/tool policy, repository retrieval, memory, human approvals, or raw project/tool authorization.

## Runtime strategy

- Run Bifrost from the upstream Docker/Go runtime rather than the TypeScript/Python monorepo build path.
- Deploy it as a dedicated Railway service with full production provisioning disabled by default.
- Keep the Bifrost service declarative: image tag, config path, health endpoint, environment variables, and watch/deploy controls are reviewed artifacts.
- Use `infra\bifrost\bifrost.config.example.yaml` only as a placeholder template. Concrete config is generated or validated from registry snapshots before startup.
- Provider credentials, admin token, and virtual-key seed live only in Railway variables or approved encrypted credential storage. No raw secrets belong in source control.

## Railway deployment controls

| Control | Strategy |
|---|---|
| Environments | `development` and `production`; production provisioning remains disabled until explicit approval. |
| Image | Pin an approved upstream Bifrost Docker image digest or immutable tag during implementation. |
| Start command | Use upstream container entrypoint with `BIFROST_CONFIG_PATH` pointing at generated/validated config. |
| Health | Require upstream health endpoint to pass before ingress or route promotion. |
| Variables | Use `infra\railway\variable-matrix.v0.1.json`; no dashboard-only variable ownership. |
| Watch/deploy | Bifrost redeploys on Bifrost config generator/template and registry/policy artifact changes only. |
| Production gate | Keep `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true` until Track 0 approval. |

## Config generation and validation

1. The model/provider registry remains the source of truth for aliases, provider candidates, data-class eligibility, lifecycle, prices, and eval status.
2. Provider/data-class policy artifacts remain the source of truth for allowed data classes, provider posture, deny reasons, and production gates.
3. A registry snapshot is signed or checksummed and assigned a `BIFROST_ROUTE_CONFIG_VERSION`.
4. A policy snapshot is signed or checksummed and assigned a `BIFROST_POLICY_VERSION`.
5. The Bifrost config generator emits route/provider config from those snapshots or validates an existing config against them.
6. Startup fails before accepting traffic when the config, registry snapshot, policy snapshot, or gate evidence is missing, stale, unverifiable, or mismatched.

## Virtual-key policy integration

- Control API/platform policy resolves principal, project, data class, model alias, route intent, policy version, registry version, budget scope, and trace ID.
- Bifrost requires the virtual key plus the policy context envelope on every gateway request.
- Bifrost enforces virtual-key validity, route/provider eligibility, budget/rate-limit hooks, and synced route constraints.
- Tool Broker remains authoritative for MCP tools, risk tier, approval requirements, sandboxing, and side-effect policy. Bifrost must not accept or store raw tool-policy ownership.
- Every allow or deny emits audit fields for actor, project, alias, provider candidate, policy version, registry version, denial reason, trace ID, and cost estimate where available.

## Fail-closed rules

Bifrost must deny or refuse startup for:

- Missing `BIFROST_ROUTE_CONFIG_VERSION` or `BIFROST_POLICY_VERSION`.
- Registry/policy snapshot older than the approved freshness window.
- Registry checksum/signature mismatch.
- Config routes not present in the registry snapshot.
- Production-enabled route without a matching passing eval gate.
- Request context with missing principal, project, data class, policy version, registry version, or trace ID.
- Break-glass route without active approved TTL and audit metadata.

## Production approval

Production deployment is a reviewed release action, not a default. Before provisioning production Bifrost, owners must approve the registry snapshot, policy snapshot, eval gate evidence, variable matrix, health check, observability wiring, backup/restore dependencies, and break-glass runbook.
