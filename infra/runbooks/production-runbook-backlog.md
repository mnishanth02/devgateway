# Production runbook backlog

Phase 0.8 defines the production operations backlog required by Track 0 sections 13-15. This file is a planning and ownership artifact only: it does not provision Railway production resources, enable model/provider routes, grant provider-key access, create break-glass credentials, or run production migrations.

## Gate definitions

| Gate label | Meaning |
|---|---|
| Track 0 exit | Documentation, owners, approval path, and validator expectations must exist before Track 0 can close. |
| Track 1 gate | Implementation or operational proof required while Track 1 builds the first production release path. |
| First production release | Evidence must be complete before any production traffic, provider route, tool path, retrieval path, or workflow path is enabled. |

## Exit-blocking policy

- `Track 0 exit-blocking = Yes` means the row must have an owner role, accepted runbook/checklist artifact, and explicit evidence location before Track 0 exit.
- `First-release blocking = Yes` means live or production-like validation is required before the first production release, but not before Track 0 exit unless the Track 0 column also says `Yes`.
- All backlog rows remain disabled-by-default and must be satisfied without production provisioning during Track 0.

## Backlog items

| ID | Backlog category | Required before | Owner role | Priority | Track 0 gate | Track 1 gate | Validation evidence to capture | Track 0 exit-blocking | First-release blocking | Current status |
|---|---|---|---|---|---|---|---|---|---|---|
| PRB-01 | Deployment checks | Track 0 exit for checklist shape; first production release for execution evidence | Platform operations owner | P0 | Service/store deployment checklist covers Bifrost, Control API, Admin portal, Tool Broker, durable worker profiles, eval runner, Operational Postgres, Knowledge Postgres, Redis, object storage, Neo4j, OpenTelemetry Collector, Prometheus, and Grafana; production provisioning remains disabled. | Health/readiness endpoints, durable worker heartbeat/profile readiness, filtered build/start/watch commands, preflight variable checks, and post-deploy smoke checks pass in the approved release lane. | Reviewed checklist link, `pnpm build`, `pnpm db:check`, `pnpm registry:validate`, `pnpm policy:validate`, `pnpm eval:smoke`, durable worker readiness/heartbeat outputs, service health outputs, and approval record. | Yes | Yes | Planned backlog; no production provisioning. |
| PRB-02 | Migrations | Track 0 exit for policy; first production release for dry-run/rollback proof | Platform operations owner with Platform architecture owner | P0 | Migration execution policy identifies owners, ordering, lock strategy, backup prerequisite, and fail-closed behavior for Operational Postgres, Knowledge Postgres, and Better Auth schema changes. | Production-release migration dry run, reversible/forward-fix plan, backup checkpoint, and post-migration verification are recorded. | `pnpm db:check`, reviewed migration plan, dry-run transcript, backup identifier, rollback/forward-fix decision record. | Yes | Yes | Planned backlog; no production database mutation. |
| PRB-03 | Rollback | Track 0 exit for decision tree; first production release for exercised rollback | Platform operations owner | P0 | Rollback runbook defines trigger thresholds, approvers, service rollback order, config/registry rollback order, database forward-fix rule, and communication path. | Release candidate demonstrates service rollback, Bifrost config rollback, registry/policy snapshot rollback, and disabled-route recovery. | Rollback tabletop notes, release artifact IDs, registry/policy snapshot IDs, smoke-check output after rollback, incident/audit linkage. | Yes | Yes | Planned backlog; no production deploy. |
| PRB-04 | Incident response | Track 0 exit for severity/role model; first production release for on-call readiness | Platform lead with Platform security owner | P0 | Incident response backlog defines severity levels, incident commander, security lead, comms owner, decision log, customer/internal notification rules, and audit evidence requirements. | First-release incident channel, paging/on-call coverage, escalation paths, and post-incident review template are ready. | Tabletop exercise, incident template, escalation roster, immutable audit query examples, post-incident review evidence. | Yes | Yes | Planned backlog; no live incident process activated. |
| PRB-05 | Provider key rotation | Track 0 exit for rotation design; first production release for tested rotation | Platform security owner | P0 | Provider-key inventory, credential storage path, rotation triggers, emergency rotation SLA, dual-key/zero-downtime strategy, audit fields, and owner approvals are documented. | Rotation is tested for each enabled provider key, including post-break-glass rotation and stale-key revocation. | Rotation checklist, key version references without secret values, audit events, Bifrost/provider config validation, revocation confirmation. | Yes | Yes | Planned backlog; no keys created or rotated. |
| PRB-06 | Break-glass operations | Track 0 exit | Platform lead plus engineering lead; Platform security owner approval | P0 | Break-glass design is approved with trigger, requester, approvers, scope, allowed aliases/data classes, max 4-hour TTL, credential access path, audit fields, recovery, key rotation, no retrieval cache, and no side-effecting tools. | Degraded-mode tests prove gateway-unavailable request path, TTL expiry, blocked repository retrieval cache, blocked side-effecting tools, audit emission, route disablement, and provider-key rotation after use. | Break-glass approval record, degraded-mode test output, audit event samples, key rotation evidence, incident report linkage. | Yes | Yes | Planned backlog; no break-glass credentials provisioned. |
| PRB-07 | Backups/restores | Track 0 exit for checklist; first production release for restore proof | Platform operations owner | P0 | Backup/restore checklist covers Operational Postgres durable workflow/approval/outbox/budget/artifact metadata, Knowledge Postgres, object storage, and Neo4j, with owner, cadence, retention, encryption, integrity check, and restore target. | Restore validation succeeds in non-production or approved production-like environment before first release and proves durable workers resume from restored state without duplicate side effects. | Backup policy, backup IDs, restore transcript, durable worker resume/reconciliation output, integrity check output, RTO/RPO measurement, sign-off. | Yes | Yes | Planned backlog; no production backup resources created. |
| PRB-08 | Observability/SLOs | Track 0 exit for topology/SLO draft; first production release for dashboards/alerts | Platform operations owner | P0 | OpenTelemetry Collector, Prometheus, Grafana, trace/eval/cost tables, durable worker heartbeat/profile metrics, dashboard ownership, and initial SLO candidates are represented in the deployment plan. | Traces, metrics, logs, audit correlation, cost records, alerts, and gateway/workflow/retrieval/durable-worker dashboards are validated before production traffic. | OTel smoke trace, Prometheus scrape status, Grafana dashboard links, worker heartbeat/backlog panels, alert test, trace-to-audit query, SLO review record. | Yes | Yes | Planned backlog; no observability service provisioned. |
| PRB-09 | Eval gates | Track 0 exit | Evaluation owner | P0 | Validator requirements prove no production route, model alias, tool, prompt, skill, retrieval strategy, or index version can be enabled without a matching passing eval gate result. | First production release has passing gate records for every enabled route, alias, tool, prompt, skill, retrieval strategy, and index version. | `pnpm eval:smoke`, gate-result schema validation, negative tests for missing/failed gates, gate-result persistence records. | Yes | Yes | Planned backlog; no production eval gates enabled. |
| PRB-10 | Registry/policy sync | Track 0 exit for sync design; first production release for generated config proof | Platform security owner with Platform architecture owner | P0 | Registry-to-Bifrost sync design, provider data-class policy, denial taxonomy, policy freshness behavior, and fail-closed stale version handling are documented. | Generated or validated Bifrost config exactly matches registry/policy snapshots; stale/missing versions deny production routing. | `pnpm registry:validate`, `pnpm policy:validate`, generated config diff, stale-policy denial fixture, audit event samples. | Yes | Yes | Planned backlog; no provider route enabled. |
| PRB-11 | GitHub permission sync | Track 0 exit for model; first production release for sync health evidence | SCM integration owner | P0 | GitHub App scope matrix, permission sync entity model, webhook validation rules, CODEOWNER context, and stale-sync default-deny behavior are documented. | Sync worker health, webhook signature checks, stale permission denial, and ACL safety eval fixtures pass before repository retrieval or GitHub tools are production-enabled. | Webhook fixture output, stale-sync default-deny test, ACL safety eval result, permission sync freshness dashboard/audit query. | Yes | Yes | Planned backlog; no GitHub production sync enabled. |
| PRB-12 | Audit/cost review | Track 0 exit for review contract; first production release for review cadence | Platform security owner with Platform operations owner | P1 | Audit/cost backlog identifies required immutable events, cost fields, trace correlation, reviewer roles, review cadence, retention, and exception workflow. | First release runs audit and cost review against production-candidate traffic fixtures before enabling production actions. | Audit query pack, cost report, trace correlation samples, reviewer sign-off, exception register. | Yes | Yes | Planned backlog; no production audit/cost review run. |
| PRB-13 | Railway environment management | Track 0 exit for environment plan; first production release for approved provisioning | Platform operations owner | P0 | Railway environment names, owner matrix, variable groups, secret/non-secret classification, service IDs strategy, `railway add --json` rule, watch patterns, and production approval gate are documented. | Production Railway services/stores are created only after explicit approval, with service IDs, variables, health checks, backups, and no production routes enabled by default. | Environment owner approval, variable matrix review, secret classification, Railway JSON/service ID record, health check evidence, production approval record. | Yes | Yes | Planned backlog; no production Railway mutation. |

## Phase 10 durable worker operations blockers

Durable worker profiles are documented for non-production and production-candidate validation only. Production remains blocked until:

1. Each durable worker profile has an approved Railway service or job shape, start command, owner ID, required variables, and readiness/metrics evidence.
2. Operational Postgres backup/restore validation proves workflow state, leases, approvals, outbox rows, budget reservations, artifact metadata, audit rows, and worker heartbeats recover consistently.
3. Object storage restore validation proves artifact bodies reconcile with restored metadata by object ref and SHA-256, without exposing signed URLs in evidence.
4. Prometheus/Grafana dashboards include runtime-service, lease/retry sweeper, cancellation, approval expiry, outbox, budget reaper, and artifact lifecycle counters/backlogs with alert owners.
5. Local launch remains explicit: `pnpm local:dev workers` may validate dependencies and print opt-in instructions, but durable workers must not auto-start or imply production enablement.
6. Production model routes, tool execution, retrieval, break-glass, and provider credentials stay disabled until their independent gates pass.

## Track 0 exit minimum

The following backlog outcomes are required before Track 0 exit:

1. Every PRB row has an accepted owner role and priority.
2. Deployment, migration, rollback, incident response, provider-key rotation, break-glass, backup/restore, observability/SLO, eval gate, registry/policy sync, GitHub permission sync, audit/cost review, and Railway environment management runbook/checklist drafts have evidence locations.
3. Break-glass design approval is recorded.
4. Eval, registry, and policy validators are defined to fail production enablement without passing gate records.
5. Railway production provisioning remains disabled and explicitly approval-gated.

## First production release minimum

The following evidence is required before the first production release:

1. Deployment, migration, rollback, backup/restore, observability, eval, registry/policy, GitHub permission, audit/cost, and Railway environment checks have release-candidate evidence.
2. Break-glass degraded-mode tests pass, and provider-key rotation after use is verified.
3. Backups restore successfully for Operational Postgres, Knowledge Postgres, object storage, and Neo4j.
4. SLO dashboards and alerting are reviewed by operations, security, and architecture owners.
5. Production Railway provisioning occurs only under explicit approval, and all production model/tool/retrieval/workflow paths remain disabled until their gates pass.

## Evidence ledger template

| Backlog ID | Evidence link/path | Captured by | Captured at | Review decision | Notes |
|---|---|---|---|---|---|
| PRB-01 | TBD | Platform operations owner | TBD | Pending | No production provisioning during Track 0. |
| PRB-02 | TBD | Platform operations owner | TBD | Pending | No production database mutation during Track 0. |
| PRB-03 | TBD | Platform operations owner | TBD | Pending | Rollback is tabletop-only during Track 0. |
| PRB-04 | TBD | Platform lead | TBD | Pending | Incident process is not activated during Track 0. |
| PRB-05 | TBD | Platform security owner | TBD | Pending | No secret values in evidence. |
| PRB-06 | TBD | Platform security owner | TBD | Pending | Break-glass credentials are not provisioned during Track 0. |
| PRB-07 | TBD | Platform operations owner | TBD | Pending | Restore proof is first-release blocking. |
| PRB-08 | TBD | Platform operations owner | TBD | Pending | No observability service provisioning during Track 0. |
| PRB-09 | TBD | Evaluation owner | TBD | Pending | Negative gate tests are Track 0 exit-blocking. |
| PRB-10 | TBD | Platform security owner | TBD | Pending | No provider routes enabled. |
| PRB-11 | TBD | SCM integration owner | TBD | Pending | No production repository sync enabled. |
| PRB-12 | TBD | Platform security owner | TBD | Pending | Use fixture/candidate traffic before release. |
| PRB-13 | TBD | Platform operations owner | TBD | Pending | Production Railway mutation requires explicit approval. |
