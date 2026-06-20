# Track 0 Readiness Checklist

Use this checklist to decide whether Track 0 artifacts are ready to unblock Track 1 implementation planning. This checklist records readiness only; it does not enable production model, tool, retrieval, workflow, route, alias, index, or deployment capability.

Track 0 exit criteria exactly: no production model/tool/retrieval path can be enabled without eval gate; break-glass approved; first-release scope/owners assigned.

## Phase 0.2 command validation references

Track 0 readiness evidence must reference the Phase 0.2 local development command matrix and CI/readiness command plan when those commands exist.

- [ ] `pnpm lint` evidence is recorded for TypeScript lint readiness or explicitly marked not yet available.
- [ ] `pnpm typecheck` evidence is recorded for TypeScript type-check readiness or explicitly marked not yet available.
- [ ] `pnpm test` evidence is recorded for unit/contract test readiness or explicitly marked not yet available.
- [ ] `pnpm build` evidence is recorded for build artifact readiness or explicitly marked not yet available.
- [ ] `pnpm eval:smoke` evidence is recorded for eval skeleton smoke readiness or explicitly marked not yet available.
- [ ] `pnpm db:check` evidence is recorded for migration/schema contract readiness or explicitly marked not yet available.
- [ ] `pnpm registry:validate` evidence is recorded for registry schema and production-gate readiness or explicitly marked not yet available.
- [ ] `pnpm policy:validate` evidence is recorded for provider data-class, denial taxonomy, and production route gate readiness or explicitly marked not yet available.

## Track 1 prerequisite map

| Track 1 prerequisite | Required Track 0 artifact | Validation gate/evidence | Checklist |
|---|---|---|---|
| Architecture decisions can be implemented without ambiguity. | ADR index with owners, status, impacted packages, gates, and migration triggers. | Architecture owner approval and ADR review evidence. | [ ] Every ADR has an owner or named pending-owner gap. |
| Service boundaries prevent accidental policy bypass. | Dependency rule map and Gateway Policy Enforcement Contract. | Dependency review and policy responsibility review. | [ ] Portal, agents, Bifrost, retrieval, policy, provider-key, cache, and workflow boundaries are checked. |
| Model routing can be implemented safely. | Model/provider registry schema and initial registry records. | `pnpm registry:validate`. | [ ] Model/provider registry exists and validates against schema. |
| Production aliases cannot be accidentally enabled. | Disabled or non-production-gated alias records and gate-result references. | `pnpm registry:validate` plus eval gate evidence. | [ ] All initial model aliases are disabled or non-production gated. |
| Provider routing respects data-class policy. | Provider data-class matrix and typed denial taxonomy. | `pnpm policy:validate`. | [ ] Provider data-class matrix exists and validates allowed/denied routing cases. |
| Identity and tenant access are safe to build on. | Better Auth baseline, secure defaults, admin bootstrap plan, auth migration plan, and smoke-test skeleton. | Auth/security approval and smoke-test evidence. | [ ] Better Auth baseline is defined with secure defaults and smoke tests. |
| GitHub permissions fail closed when stale. | GitHub App permission model, permission sync entities, webhook validation rules, and stale-sync default-deny rules. | Permission review and ACL safety eval fixture evidence. | [ ] GitHub App permission model is defined with stale-sync default-deny behavior. |
| Retrieval strategy controls are explicit and testable. | Typed retrieval env config, GraphRAG/Neo4j toggle rules, context budget/compression controls, and retrieval strategy control fixtures. | `pnpm --filter @devgateway/config test` plus retrieval strategy control eval fixture evidence. | [ ] Retrieval can compare hybrid-only and GraphRAG paths, and invalid GraphRAG/Neo4j toggles fail closed. |
| Database work has clear ownership and conventions. | Schema and migration conventions, migration ownership by domain, and package convention representation. | `pnpm db:check` where available. | [ ] Schema and migration conventions are documented and represented in package conventions. |
| Eval gates can be executed before production enablement. | Eval dataset layout, eval case schema, fixture-mode runner skeleton, gate schema, and gate-result persistence contract. | `pnpm eval:smoke` and gate-shaped output evidence. | [ ] Eval runner skeleton can execute fixture suites and produce gate-shaped results. |
| Production enablement fails without passing gates. | Registry validator, policy validator, gate-result schema, and production enablement fixtures. | `pnpm registry:validate` and `pnpm policy:validate`. | [ ] Registry and policy validators fail production enablement without matching passing gate results. |
| Deployment can be planned without provisioning production. | Railway topology, service/store plan, environment plan, variable matrix, monorepo deploy command plan, and operations checks. | Deployment/ops review evidence. | [ ] Railway deployment plan defines services, stores, environments, variables, and operational checks. |
| Observability is ready for Track 1 SLO evidence. | OpenTelemetry Collector, Prometheus, Grafana, trace/eval/cost table, and dashboard ownership plan. | Observability review evidence. | [ ] OpenTelemetry Collector, Prometheus, and Grafana are represented in the deployment plan. |
| Sensitive data and audit behavior are locked before implementation. | Encrypted credential storage convention, tenant/ACL scope convention, retention convention, and audit immutability convention. | Security/data review evidence. | [ ] Encrypted credential storage, tenant/ACL scope, high-volume retention, and audit immutability conventions are locked. |
| Emergency access has approved limits. | Break-glass runbook covering TTL, scope, approvers, audit, recovery, and provider-key rotation. | Break-glass approval record. | [ ] Break-glass runbook is approved. |
| Release ownership is accountable. | First-release scope table and owner matrix with named people or explicit interim accountable roles. | Owner approval evidence. | [ ] First-release scope and owners are assigned. |
| Track 1 cannot bypass Track 0 gates. | Readiness decision tying registry, provider-policy, auth, eval, deployment, and break-glass gates to Track 1 entry. | Final Track 0 exit decision evidence. | [ ] Track 1 is blocked from production enablement without registry, provider-policy, auth, eval, deployment, and break-glass gates. |

## Section 16 acceptance checklist

- [ ] ADRs are indexed, owned, and accepted or explicitly pending.
- [ ] Model/provider registry exists and validates against schema.
- [ ] All initial model aliases are disabled or non-production gated.
- [ ] Provider data-class matrix exists and validates allowed/denied routing cases.
- [ ] Better Auth baseline is defined with secure defaults and smoke tests.
- [ ] GitHub App permission model is defined with stale-sync default-deny behavior.
- [ ] Retrieval strategy controls and context budget/compression controls are typed, testable, and eval-gated.
- [ ] Schema and migration conventions are documented and represented in package conventions.
- [ ] Eval runner skeleton can execute fixture suites and produce gate-shaped results.
- [ ] Registry and policy validators fail production enablement without matching passing gate results.
- [ ] Railway deployment plan defines services, stores, environments, variables, and operational checks.
- [ ] OpenTelemetry Collector, Prometheus, and Grafana are represented in the deployment plan.
- [ ] Encrypted credential storage, tenant/ACL scope, high-volume retention, and audit immutability conventions are locked.
- [ ] Break-glass runbook is approved.
- [ ] First-release scope and owners are assigned.
- [ ] Track 1 is blocked from production enablement without registry, provider-policy, auth, eval, deployment, and break-glass gates.

## Track 0 exit checklist

- [ ] no production model/tool/retrieval path can be enabled without eval gate.
- [ ] break-glass approved.
- [ ] first-release scope/owners assigned.
- [ ] Validators enforce the production gate; the gate is not documentation-only.
- [ ] Break-glass design approval covers TTL, scope, approvers, audit, recovery, and provider-key rotation.
- [ ] First-release scope and owners include named people or explicit interim accountable roles.
- [ ] No production capability enablement occurs as part of this readiness approval.

## Final readiness decision

- [ ] All Track 0 artifacts above have owners, evidence locations, and unresolved gaps recorded.
- [ ] All required validation gates are passing or explicitly marked unavailable with a blocking follow-up.
- [ ] Track 1 prerequisites map to Track 0 artifacts and validation gates.
- [ ] Track 0 exit is approved, rejected, or deferred with documented rationale.
