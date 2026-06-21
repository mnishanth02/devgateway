# Architecture Change-Control Checklist

Use this checklist for any proposed Track 0 architecture delta before it changes implementation plans, contracts, schemas, registries, policies, deployment artifacts, or ownership records. This checklist records readiness only; it does not enable production model, tool, retrieval, workflow, route, alias, index, or deployment capability.

## Change summary

- [ ] Change title, requester, date, and decision owner are recorded.
- [ ] The architecture delta is described as a difference from the locked Track 0 baseline, including impacted ADRs, services, packages, contracts, schemas, registries, policies, deployment artifacts, and runbooks.
- [ ] The change states whether it affects a model, tool, retrieval path, workflow, route, prompt, skill, index version, provider policy, or production deployment.
- [ ] The change confirms no production capability is enabled by this approval alone.

## Architecture delta and ownership

- [ ] Impacted ADR entries are updated or a pending ADR follow-up is created with owner, status, gate, and migration trigger.
- [ ] Dependency-rule impact is reviewed so portal, agents, Bifrost, retrieval, policy, provider keys, cache, and durable workflow boundaries remain enforceable.
- [ ] Service/package ownership is identified for every impacted boundary.
- [ ] Owner approval is captured from the accountable architecture owner or explicitly approved interim accountable role.
- [ ] First-release scope and owner impact is recorded when the delta changes scope, staffing, or accountable roles.

## Security, eval, and deployment impact

- [ ] Security impact covers auth, provider keys, break-glass, GitHub webhooks, ACL precedence, tainted context, data class routing, tenant scope, encrypted credentials, audit immutability, and high-volume retention.
- [ ] Eval impact identifies required fixture suites, gate-result records, thresholds, and whether existing gates must be regenerated.
- [ ] Deployment impact covers Railway services, stores, environments, variables, operational checks, observability, backup/restore, and production approval requirements.
- [ ] OpenTelemetry Collector, Prometheus, and Grafana impact is reviewed when the change affects traces, metrics, dashboards, or SLO evidence.
- [ ] Break-glass impact covers TTL, scope, approvers, audit, recovery, and provider-key rotation.

## Schema, contract, and versioning

- [ ] External contract changes identify affected OpenAI-compatible, Anthropic-compatible, MCP, or async task-tool schemas.
- [ ] Database changes identify schema domain, migration owner, rollback/migration path, disposable or shadow Postgres validation, and audit immutability impact.
- [ ] Registry, policy, provider data-class matrix, denial taxonomy, and gate-result schema changes include compatible versioning or explicit migration steps.
- [ ] Contract/schema version bumps and compatibility notes are documented before any downstream Track 1 implementation consumes the change.

## Policy and eval gates

- [ ] The change preserves the gate: no production model/tool/retrieval path can be enabled without eval gate; break-glass approved; first-release scope/owners assigned.
- [ ] Registry and policy validators are expected to fail production enablement without matching passing gate results.
- [ ] Provider-policy, tool-policy, auth, deployment, eval, and break-glass gates are listed with owners and evidence locations.
- [ ] Phase 0.2 readiness command references are included in validation evidence where applicable: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm eval:smoke`, `pnpm db:check`, `pnpm registry:validate`, and `pnpm policy:validate`.

## Rollback and migration triggers

- [ ] Rollback trigger is defined for failed validation, owner rejection, policy/eval regression, deployment risk, contract incompatibility, data migration failure, or security boundary regression.
- [ ] Migration trigger is defined for provider lifecycle changes, data-class policy changes, schema/contract version changes, ADR supersession, ownership changes, and production-scope changes.
- [ ] Recovery steps include artifact rollback, registry/policy snapshot rollback, migration rollback or forward-fix, gate-result invalidation, and runbook updates.

## Documentation and validation evidence

- [ ] ADR index, dependency rules, Gateway Policy Enforcement Contract, first-release owner matrix, deployment plan, security-boundary notes, and runbooks are updated or explicitly marked not impacted.
- [ ] Validation evidence links to command output, review approvals, gate-result records, smoke-test results, schema checks, and policy/registry validator results.
- [ ] The change-control record includes a final approve/reject/defer decision and unresolved follow-up gaps.
- [ ] Track 1 remains blocked from production enablement unless all registry, provider-policy, auth, eval, deployment, and break-glass gates pass.

## Section 16 acceptance-criterion guardrail

Before approving an architecture delta, confirm it preserves every Track 0 acceptance criterion:

- [ ] ADRs are indexed, owned, and accepted or explicitly pending.
- [ ] Model/provider registry exists and validates against schema.
- [ ] All initial model aliases are disabled or non-production gated.
- [ ] Provider data-class matrix exists and validates allowed/denied routing cases.
- [ ] Better Auth baseline is defined with secure defaults and smoke tests.
- [ ] GitHub App permission model is defined with stale-sync default-deny behavior.
- [ ] Schema and migration conventions are documented and represented in package conventions.
- [ ] Eval runner skeleton can execute fixture suites and produce gate-shaped results.
- [ ] Registry and policy validators fail production enablement without matching passing gate results.
- [ ] Railway deployment plan defines services, stores, environments, variables, and operational checks.
- [ ] OpenTelemetry Collector, Prometheus, and Grafana are represented in the deployment plan.
- [ ] Encrypted credential storage, tenant/ACL scope, high-volume retention, and audit immutability conventions are locked.
- [ ] Break-glass runbook is approved.
- [ ] First-release scope and owners are assigned.
- [ ] Track 1 is blocked from production enablement without registry, provider-policy, auth, eval, deployment, and break-glass gates.
