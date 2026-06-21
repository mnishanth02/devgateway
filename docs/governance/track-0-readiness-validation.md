# Track 0 readiness validation

Status: Phase 0.9 evidence, captured 2026-06-20.

This validation records command and validator-gate evidence only. It does not enable production model routes, aliases, tools, prompts, skills, retrieval strategies, index versions, deployments, or break-glass access.

## Command evidence

| Command | Result | Evidence |
|---|---:|---|
| `pnpm workspace:validate` | Pass | Root tooling validation passed; eval dataset layout validation passed with 10 datasets and 50 fixtures; schema catalog validation passed with 11 schema JSON files and catalog references. |
| `pnpm lint` | Pass | Turbo completed 6/6 lint tasks successfully. |
| `pnpm typecheck` | Pass | Turbo completed 11/11 typecheck tasks successfully. |
| `pnpm test` | Pass | Turbo completed 4/4 test tasks successfully. |
| `pnpm build` | Pass | Turbo completed 2/2 build tasks successfully. |
| `pnpm db:check` | Pass | Turbo completed 5/5 db:check tasks successfully; schema catalog check passed. |
| `pnpm registry:validate` | Pass | Turbo completed 6/6 tasks; `@devgateway/registry` printed `Registry validation passed.` |
| `pnpm policy:validate` | Pass | Turbo completed 6/6 tasks; `@devgateway/policy` printed `Policy validation passed.` |
| `pnpm eval:smoke` | Pass | Turbo completed 4/4 tasks; fixture runner emitted a passing gate-shaped result with `pass: true`, `blocking_severity: none`, `total_cases: 6`, `failed_cases: 0`, `fixture_mode: 1`, and `live_provider_calls: 0`. |

## Wiring confirmation

- Schema catalog is wired through `packages\schemas\src\validate-json.mjs` and `packages\schemas\schemas\index.v0.1.json`; workspace validation confirmed 11 schema JSON files and catalog references.
- Eval layout is wired through `scripts\validate-eval-layout.mjs`; workspace validation confirmed 10 datasets and 50 referenced fixtures.
- Registry validator is wired through `pnpm registry:validate` and `packages\registry\src\validate-registry.ts`.
- Policy validator is wired through `pnpm policy:validate` and `packages\policy\src\validate-policy.ts`.
- Fixture runner is wired through `pnpm eval:smoke`, `scripts\eval-smoke.mjs`, and `workers\eval-runner`; smoke output targets fixture-mode ACL safety and emits shared gate-result fields.

## Validator gate evidence

Existing negative fixtures were executed directly without creating committed or temporary files:

```powershell
node --experimental-strip-types --input-type=module
```

Probe result:

```json
{
  "registryProductionAliasWithoutGateBlocked": { "ok": true, "issues": [] },
  "policyProductionProviderWithoutGateOrPassingGateBlocked": { "ok": true, "issues": [] }
}
```

Interpretation:

- `validateRegistryNegativeFixtures()` mutates a registry alias to production-enabled/route-allowed with no gate reference and succeeds only if the registry validator reports a `production_gate` or `eval_gate` failure for that mutation.
- `validatePolicyNegativeFixtures()` mutates provider policy into production posture and succeeds only if missing gate evidence, non-passing gate evidence, and restricted external model routing are blocked.
- Therefore registry and policy validators fail production enablement without matching passing eval-gate evidence.

## Phase 0.9 decision

Readiness command validation passed. Track 1 production enablement remains blocked unless registry, provider-policy, auth, eval, deployment, and break-glass gates are satisfied. Owner coverage exists through explicit interim accountable roles in `docs\governance\first-release-owner-matrix.md`.

Track 0 exit is not approved by this evidence alone because `docs\governance\break-glass-design.md` still records approval status as pending. No production routes or behavior were enabled.
