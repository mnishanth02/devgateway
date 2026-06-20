# Track 0 exit decision

Status date: 2026-06-20

Decision: **formal Track 0 exit is not approved yet**.

Track 0 implementation artifacts are ready for handoff to Track 1 implementation planning, but formal Track 0 exit remains blocked until owner assignment approval and break-glass approval are recorded. Track 1 remains blocked from production enablement of model, tool, retrieval, workflow, provider-key, break-glass, Railway production, or other production capability paths.

This decision does not enable production model routes, aliases, tools, prompts, skills, retrieval strategies, index versions, deployments, provider credentials, or break-glass access.

## Source evidence

- `docs\impl-plan\track-0-architecture-lock-implementation-setup.md`
- `docs\governance\track-0-readiness-validation.md`
- `docs\governance\track-0-owner-breakglass-confirmation.md`
- `docs\governance\track-0-readiness-checklist.md`
- `docs\governance\first-release-owner-matrix.md`
- `docs\governance\break-glass-design.md`
- `infra\runbooks\break-glass.md`

## Completed Track 0 artifacts by phase/workstream

| Phase / workstream | Completed artifacts | Exit impact |
|---|---|---|
| Phase 0.1 - setup decisions and ownership model | Interim role-based ownership model is documented in the implementation plan and first-release owner matrix. | Coverage exists, but Track 0 exit still requires named people or explicitly approved accountable roles. |
| Phase 0.2 - implementation skeleton and commands | Workspace validation commands are present and were exercised by readiness validation: `workspace:validate`, `lint`, `typecheck`, `test`, `build`, `db:check`, `registry:validate`, `policy:validate`, and `eval:smoke`. | Command evidence is passing. No production capability was enabled. |
| Phase 0.3 - architecture governance | ADR index, dependency rules, change-control checklist, readiness checklist, Gateway Policy Enforcement Contract, and first-release owner matrix are present in governance artifacts. | Governance baseline is present; owner acceptance remains exit-blocking. |
| Phase 0.4 - schema, migration, auth, audit baseline | Schema and migration conventions, auth migration/bootstrap/smoke plans, credential storage conventions, tenant/ACL scope conventions, retention conventions, and audit immutability conventions are documented. | Ready as implementation setup artifacts; production auth/provider-key paths remain blocked until Track 1 gates. |
| Phase 0.5 - provider, model, registry, policy baseline | Model/provider registry, initial model aliases, provider data-class policy, denial taxonomy, gate-result persistence contract, and registry/policy validation commands are present. | Validators make production enablement fail without matching passing eval-gate evidence. |
| Phase 0.6 - GitHub permission and ACL baseline | GitHub App scope matrix, permission entity model, webhook sync rules, stale-sync default-deny behavior, and ACL safety eval fixtures are present. | Ready for implementation; production repository retrieval/tool paths remain gated. |
| Phase 0.7 - eval baseline | Eval dataset layout, eval schemas, fixture-mode eval runner skeleton, gate-result contract, and ACL/prompt-injection fixture coverage are present. | `pnpm eval:smoke` passed in fixture mode with gate-shaped output. |
| Phase 0.8 - deployment and operations baseline | Railway deployment topology, observability and backup plans, production runbook backlog, local CI readiness, and break-glass design/runbook drafts are present. | Deployment/ops planning artifacts are ready; break-glass approval remains pending and exit-blocking. |
| Phase 0.9 - readiness review | Readiness validation and owner/break-glass confirmation artifacts are present. This exit decision records the final Phase 0.9 status. | Readiness evidence passed, but formal exit is deferred because approvals remain incomplete. |

## Validation evidence summary

Readiness validation passed and is recorded in `docs\governance\track-0-readiness-validation.md`.

Passing command evidence:

- `pnpm workspace:validate`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm db:check`
- `pnpm registry:validate`
- `pnpm policy:validate`
- `pnpm eval:smoke`

Gate-enforcement evidence:

- Registry negative fixtures confirm production alias/route enablement without gate evidence is blocked.
- Policy negative fixtures confirm production provider posture with missing or non-passing gate evidence is blocked.
- Therefore validators fail production enablement of production routes, aliases, tools, prompts, skills, retrieval strategies, or index versions without matching passing eval-gate evidence.

Eval smoke evidence:

- Fixture mode works through `pnpm eval:smoke`.
- The smoke runner emitted a passing gate-shaped result with `pass: true`, `blocking_severity: none`, `total_cases: 6`, `failed_cases: 0`, `fixture_mode: 1`, and `live_provider_calls: 0`.

## Exact exit criteria status

| Exit criterion | Status | Evidence / gap |
|---|---|---|
| 1. No production model/tool/retrieval path can be enabled without an eval gate. | **Satisfied by validators.** | Readiness validation confirms registry and policy validators fail production enablement without matching passing eval-gate evidence. |
| 2. Break-glass design approved. | **Not satisfied; pending approval.** | `docs\governance\break-glass-design.md` and `infra\runbooks\break-glass.md` remain draft/pending. No approval record is documented. |
| 3. First-release scope and owners assigned. | **Partially satisfied; not formally complete.** | Interim owner-role coverage exists in `docs\governance\first-release-owner-matrix.md`, but named people or explicitly approved accountable roles are still required before Track 0 exit. |

## Final decision

Implementation artifacts are ready, and readiness command validation passed. However, **formal Track 0 exit is not approved** until both of these are recorded:

1. approval of the owner assignments with named accountable people or explicitly approved accountable roles; and
2. approval of the break-glass design/runbook, including TTL, scope, approvers, audit, recovery, degraded-mode tests, and provider-key rotation evidence.

Track 1 may continue non-production implementation planning only. Track 1 remains blocked from production enablement unless registry, provider-policy, auth, eval, deployment, ownership, and break-glass gates are satisfied.

## Next blocking actions

1. Record named accountable people or explicitly approved accountable roles for every first-release owner-matrix row.
2. Record acceptance by the required approval roles for the accountable assignments.
3. Record break-glass approval with approver identities, timestamps, and reviewed TTL/scope/approver/audit/recovery/provider-key-rotation design.
4. Add or link degraded-mode break-glass test implementation evidence before enabling gateway/model production routes.
5. Keep all production routes, aliases, tools, prompts, skills, retrieval strategies, index versions, Railway production provisioning, provider-key access, and break-glass access disabled until the relevant gates are approved and passing.
