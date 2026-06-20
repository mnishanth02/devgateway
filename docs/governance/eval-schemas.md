# Eval schemas

Phase 0.7 defines non-production eval contracts under `packages\schemas\schemas\eval\`.

- `eval-case.v0.1.schema.json` supports datasets and cases with suite/case version fields, fixture or provider-fixture mode, inputs, expected outcomes, metrics/assertions, safeguards, audit evidence, artifact refs, and synthetic/no-live-call flags.
- `gate-definition.v0.1.schema.json` binds gates to dataset/suite versions and artifact versions, declares suite thresholds, blocking severity, approver rules, and the shared gate-result contract.
- `gate-result-persistence.v0.1.schema.json` wraps the shared gate-result record with immutable persistence metadata and semver version bindings.

All Phase 0.7 schemas preserve fixture-only safety: live provider calls and production enablement remain disabled until later approved workstreams add validators and gates.

## Validation

```powershell
pnpm --filter @devgateway/schemas check
pnpm workspace:validate
```
