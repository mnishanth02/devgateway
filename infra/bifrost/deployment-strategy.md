# Bifrost deployment strategy v0.1

## Purpose

Bifrost is the provider gateway for DevGateway. It validates virtual-key ingress and enforces provider-route constraints generated from platform registry and policy artifacts. It does not own durable workflows, MCP/tool policy, repository retrieval, memory, human approvals, or raw project/tool authorization.

## Runtime strategy

- Run Bifrost from the upstream Docker/Go runtime rather than the TypeScript/Python monorepo build path.
- Deploy it as a dedicated Railway service with full production provisioning disabled by default.
- For local development, expose Bifrost at `http://localhost:43180` and run only a digest-pinned image, for example `ghcr.io/maximhq/bifrost@sha256:<approved-bifrost-image-digest>`. Mutable tags such as `latest` are not acceptable evidence for readiness.
- Keep the Bifrost service declarative: image digest, app-dir `config.json` mount, health endpoint, environment variables, and watch/deploy controls are reviewed artifacts.
- Upstream Bifrost reads `<app-dir>/config.json`, not `BIFROST_CONFIG_PATH`. Keep `infra\bifrost\bifrost.config.example.yaml` as DevGateway evidence and mount the separate upstream runtime artifact `infra\bifrost\config.runtime.example.json` into the container as `/app/data/config.json` for local Track 1 readiness.
- Provider credentials, admin token, and virtual-key seed live only in Railway variables or approved encrypted credential storage. No raw secrets belong in source control.

## Railway deployment controls

| Control | Strategy |
|---|---|
| Environments | `development` and `production`; production provisioning remains disabled until explicit approval. |
| Image | Pin an approved upstream Bifrost Docker image by digest (for example `ghcr.io/maximhq/bifrost@sha256:<approved-bifrost-image-digest>`); mutable tags are not valid for local, development, or production readiness. |
| Start command | Use the upstream image default command (`/app/main`) through its entrypoint; mount the generated/validated artifact as `/app/data/config.json`. |
| Health | Require upstream health endpoint to pass before ingress or route promotion. |
| Variables | Use `infra\railway\variable-matrix.v0.1.json`; set `BIFROST_CONFIG_PATH` for host-side DevGateway evidence, `BIFROST_RUNTIME_CONFIG_PATH` for the host-side upstream runtime artifact, `BIFROST_CONTAINER_CONFIG_PATH=/app/data/config.json`, `BIFROST_ROUTE_CONFIG_VERSION`, `BIFROST_POLICY_VERSION`, safe provider-key placeholders/references, and no dashboard-only variable ownership. |
| Watch/deploy | Bifrost redeploys on Bifrost config generator/template and registry/policy artifact changes only. |
| Production gate | Keep `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true` until Track 0 approval. |

## Config generation and validation

1. The model/provider registry remains the source of truth for aliases, provider candidates, data-class eligibility, lifecycle, prices, and eval status.
2. Provider/data-class policy artifacts remain the source of truth for allowed data classes, provider posture, deny reasons, and production gates.
3. A registry snapshot is signed or checksummed and assigned a `BIFROST_ROUTE_CONFIG_VERSION`.
4. A policy snapshot is signed or checksummed and assigned a `BIFROST_POLICY_VERSION`.
5. The Bifrost config generator emits route/provider config from those snapshots or validates an existing config against them.
6. Startup fails before accepting traffic when the config, registry snapshot, policy snapshot, or gate evidence is missing, stale, unverifiable, or mismatched.
7. Readiness remains failed until the host evidence path, mounted `/app/data/config.json`, route config version, policy version, registry checksum, and policy checksum all match the generated artifact evidence.

## Reload and promotion behavior

- Hot reload is allowed only when Bifrost supports an atomic reload primitive and the new config has already passed registry, policy, checksum, freshness, and gate-evidence validation.
- If atomic hot reload is unavailable or unverified, restart the Bifrost instance and promote it only after readiness passes with the new `BIFROST_ROUTE_CONFIG_VERSION` and `BIFROST_POLICY_VERSION`.
- Zero-downtime reload remains a tracked risk until the upstream runtime demonstrates atomic config swap, rollback on validation failure, and no mixed-version request handling under load.
- Failed reload or restart validation must keep the previous ready instance serving or leave the service unready; it must never promote a partially validated config.

## Local runtime store lifecycle

- The fail-closed local runtime artifact enables Bifrost `config_store` and `logs_store` with SQLite files under `/app/data` because the upstream runtime requires stores to boot and serve health predictably.
- These local stores are operational runtime state only. They are not the DevGateway source of truth for registry, policy, virtual keys, budgets, audit, or cost evidence.
- The committed runtime config keeps `providers` empty and production/provider credentials disabled; persisted local store files must not be treated as approval evidence or route enablement evidence.
- `pnpm local:reset --yes` removes the Docker volumes, including `bifrost-data`, and is the required cleanup path when validating a fresh fail-closed Bifrost boot.
- Railway production or shared development deployments must use an explicit persistence/backup decision for Bifrost runtime stores before provider routes are enabled.

## Virtual-key policy integration

- Control API/platform policy resolves principal, project, data class, model alias, route intent, policy version, registry version, budget scope, and trace ID.
- Bifrost requires the virtual key plus the policy context envelope on every gateway request.
- Bifrost enforces virtual-key validity, route/provider eligibility, budget/rate-limit hooks, and synced route constraints.
- Tool Broker remains authoritative for MCP tools, risk tier, approval requirements, sandboxing, and side-effect policy. Bifrost must not accept or store raw tool-policy ownership.
- Every allow or deny emits audit fields for actor, project, alias, provider candidate, policy version, registry version, denial reason, trace ID, and cost estimate where available.

## Fail-closed rules

Bifrost must deny or refuse startup for:

- Missing `BIFROST_ROUTE_CONFIG_VERSION` or `BIFROST_POLICY_VERSION`.
- Missing host-side `BIFROST_CONFIG_PATH`, missing `/app/data/config.json` mount, unreadable config, missing provider-key references/placeholders for enabled providers, or absent registry/policy gate evidence.
- Registry/policy snapshot older than the approved freshness window.
- Registry checksum/signature mismatch.
- Config routes not present in the registry snapshot.
- Production-enabled route without a matching passing eval gate.
- Request context with missing principal, project, data class, policy version, registry version, or trace ID.
- Break-glass route without active approved TTL and audit metadata.

## Production approval

Production deployment is a reviewed release action, not a default. Before provisioning production Bifrost, owners must approve the registry snapshot, policy snapshot, eval gate evidence, variable matrix, health check, observability wiring, backup/restore dependencies, and break-glass runbook.
