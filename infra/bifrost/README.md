# Bifrost conventions for Phase 0.2

Bifrost is the provider gateway, not the source of project/tool policy. The model/provider registry and platform policy artifacts remain authoritative; Bifrost config must be generated from or validated against those artifacts before startup.

## Required conventions

- Use the upstream Docker/Go runtime path for Bifrost rather than TS/Python monorepo builds.
- Keep provider API keys and virtual-key seed in Railway variables only.
- Require principal, project, data class, policy version, registry version, and trace headers on gateway traffic.
- Keep `BIFROST_BREAK_GLASS_ENABLED=false` unless an approved break-glass runbook is active.
- Keep `PRODUCTION_PROVISIONING_ENABLED=false` until Track 0 production approval.

## Local/readiness checks

Run the root readiness commands before accepting Bifrost route/config changes:

```powershell
pnpm registry:validate
pnpm policy:validate
pnpm eval:smoke
```

`bifrost.config.example.yaml` is intentionally placeholder-only and should not contain concrete provider credentials.
