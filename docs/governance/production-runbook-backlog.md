# Production runbook backlog governance

This governance artifact maps the Phase 0.8 production runbook backlog to Track 0 exit and first-production-release gates. The operational backlog lives in `infra\runbooks\production-runbook-backlog.md`. This file records governance ownership and exit-blocking interpretation only; it does not provision Railway production resources or enable production model, tool, retrieval, workflow, provider-key, or break-glass capability.

## Required categories

The backlog must continue to cover these categories before Track 0 exit review:

- Deployment checks.
- Migrations.
- Rollback.
- Incident response.
- Provider key rotation.
- Break-glass operations.
- Backups/restores.
- Observability/SLOs.
- Eval gates.
- Registry/policy sync.
- GitHub permission sync.
- Audit/cost review.
- Railway environment management.

## Governance matrix

| Backlog ID | Category | Owner role | Priority | Required before Track 0 exit | Required before first production release | Track 0/Track 1 gate | Validation evidence | Exit-blocking status |
|---|---|---|---|---|---|---|---|---|
| PRB-01 | Deployment checks | Platform operations owner | P0 | Checklist, service/store coverage, production-disabled stance. | Executed release preflight, health checks, and smoke checks. | Track 0: deployment checklist accepted. Track 1: release lane passes before deploy. | Checklist review, build/db/registry/policy/eval command output, service health evidence. | Track 0 exit-blocking and first-release blocking. |
| PRB-02 | Migrations | Platform operations owner; Platform architecture owner | P0 | Migration policy, owners, ordering, backup prerequisite, fail-closed behavior. | Dry run, backup checkpoint, post-migration verification, rollback/forward-fix decision. | Track 0: migration policy accepted. Track 1: migration rehearsal passes. | `pnpm db:check`, dry-run transcript, backup ID, verification output. | Track 0 exit-blocking and first-release blocking. |
| PRB-03 | Rollback | Platform operations owner | P0 | Rollback decision tree and communication path. | Service/config/registry rollback exercised for release candidate. | Track 0: rollback runbook accepted. Track 1: rollback exercise passes. | Tabletop notes, artifact IDs, registry/policy snapshot IDs, post-rollback smoke checks. | Track 0 exit-blocking and first-release blocking. |
| PRB-04 | Incident response | Platform lead; Platform security owner | P0 | Severity model, incident roles, decision log, notification rules. | On-call/escalation coverage and post-incident review template ready. | Track 0: incident response model accepted. Track 1: tabletop/on-call readiness accepted. | Tabletop evidence, escalation roster, incident template, audit query examples. | Track 0 exit-blocking and first-release blocking. |
| PRB-05 | Provider key rotation | Platform security owner | P0 | Rotation design, triggers, SLA, key-version audit fields, emergency path. | Rotation tested for every enabled provider and after break-glass use. | Track 0: rotation design accepted. Track 1: provider-specific rotation proof. | Rotation checklist, key version references, Bifrost/provider config validation, audit samples. | Track 0 exit-blocking and first-release blocking. |
| PRB-06 | Break-glass operations | Platform lead plus engineering lead; Platform security owner approval | P0 | Approved break-glass design with max 4-hour TTL, scope, approvers, audit, recovery, and provider-key rotation. | Degraded-mode tests pass and route/key recovery is verified. | Track 0: approval required for exit. Track 1: degraded-mode tests before production route enablement. | Approval record, TTL test, no-cache/no-side-effecting-tool tests, audit events, key rotation evidence. | Track 0 exit-blocking and first-release blocking. |
| PRB-07 | Backups/restores | Platform operations owner | P0 | Backup/restore checklist for Operational Postgres, Knowledge Postgres, object storage, and Neo4j. | Restore validation and RTO/RPO evidence. | Track 0: checklist accepted. Track 1: restore proof before release. | Backup policy, backup IDs, restore transcript, integrity checks, sign-off. | Track 0 exit-blocking and first-release blocking. |
| PRB-08 | Observability/SLOs | Platform operations owner | P0 | Topology, dashboard ownership, trace/eval/cost table expectations, draft SLOs. | Traces, metrics, logs, alerts, SLO dashboards, and audit/cost correlation verified. | Track 0: observability/SLO plan accepted. Track 1: dashboard/alert validation passes. | OTel smoke trace, Prometheus scrape, Grafana dashboards, alert test, trace-to-audit query. | Track 0 exit-blocking and first-release blocking. |
| PRB-09 | Eval gates | Evaluation owner | P0 | Validators defined to block production enablement without matching passing eval gate results. | Passing gate records exist for every enabled production route, alias, tool, prompt, skill, retrieval strategy, and index version. | Track 0: negative gate tests defined. Track 1: gate records required before enablement. | `pnpm eval:smoke`, schema validation, missing-gate negative tests, persisted gate records. | Track 0 exit-blocking and first-release blocking. |
| PRB-10 | Registry/policy sync | Platform security owner; Platform architecture owner | P0 | Registry-to-Bifrost sync design, data-class policy, denial taxonomy, stale-policy fail-closed behavior. | Generated/validated Bifrost config matches registry/policy snapshots. | Track 0: sync design accepted. Track 1: generated config validation and stale-policy denial pass. | `pnpm registry:validate`, `pnpm policy:validate`, generated config diff, denial fixture, audit samples. | Track 0 exit-blocking and first-release blocking. |
| PRB-11 | GitHub permission sync | SCM integration owner | P0 | Scope matrix, sync entity model, webhook rules, CODEOWNER context, stale-sync default-deny behavior. | Sync health, webhook signatures, stale-deny tests, and ACL eval fixtures pass. | Track 0: permission model accepted. Track 1: sync health and ACL fixture proof. | Webhook fixture output, stale-sync default-deny test, ACL safety eval result, freshness dashboard/audit query. | Track 0 exit-blocking and first-release blocking. |
| PRB-12 | Audit/cost review | Platform security owner; Platform operations owner | P1 | Immutable event/cost fields, trace correlation, reviewer roles, cadence, retention, exception workflow. | Review runs against production-candidate traffic fixtures before production actions. | Track 0: audit/cost review contract accepted. Track 1: review cadence and query pack proven. | Audit query pack, cost report, trace correlation samples, review sign-off, exception register. | Track 0 exit-blocking and first-release blocking. |
| PRB-13 | Railway environment management | Platform operations owner | P0 | Environment names, owner matrix, variable groups, secret classification, service-ID strategy, `railway add --json` rule, production approval gate. | Production project/environment/service creation only after explicit approval with health/backups/default-disabled routes. | Track 0: environment plan accepted. Track 1: approved provisioning evidence before release. | Owner approval, variable matrix review, secret classification, Railway JSON/service IDs, health checks, production approval record. | Track 0 exit-blocking and first-release blocking. |

## Track 0 exit interpretation

Track 0 can exit only if every category above has an accountable owner role, priority, accepted evidence location, and a reviewed Track 0 gate outcome. PRB-06 and PRB-09 are hard roadmap gates: break-glass must be approved, and production enablement must be validator-blocked without eval gates. PRB-13 must confirm that production provisioning is still disabled.

## First production release interpretation

The first production release requires execution evidence for every row, including deployment preflight, migration dry run, rollback exercise, incident tabletop, provider-key rotation test, break-glass degraded-mode tests, restore validation, observability/SLO validation, eval gate records, registry/policy sync proof, GitHub permission sync proof, audit/cost review, and explicit Railway production approval.

## Non-provisioning statement

During Track 0, this backlog authorizes documentation, review, fixture validation, and approval capture only. It must not be used as approval to provision production Railway services or stores, create production provider keys, enable production model/tool/retrieval/workflow routes, or issue break-glass credentials.
