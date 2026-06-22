---
goal: Close Track 3 durable-execution gaps so durable workflows, approvals, retries, cancellation, outbox, budget, and artifact lifecycle are proven against real Postgres and object storage
version: 1.0
date_created: 2026-06-22
last_updated: 2026-06-22
owner: DevGateway Platform Team
tags: [feature, architecture, durability, remediation, track-3]
---

# Introduction

This plan remediates the validated gaps between the Track 3 plan (`docs/impl-plan/track-3-durable-workflows-approvals.md`) and the actual implementation recorded in `docs/governance/track-3-validation-evidence.md`. The validation found that Track 3 currently delivers contracts, schemas, a migration, Control API read/decision routes, and pure runtime helper modules, but does **not** deliver durable execution: the Postgres runtime repository is never executed against a real database, the runtime CLI only supports `--mode fixture`, there are no long-running workers, no durable/approval/outbox eval suites, no budget reaper, no executor-level cancellation, no approval expiry path, and no operator portal surfaces. This plan converts the Track 3 scaffolding into enforced, test-proven durable behavior and re-validates the Track 3 exit criteria.

The plan is non-production by default. It does not enable production model routes, provider keys, write-capable tools, retrieval, or production workflow dispatch. Those remain separately gated and fail-closed.

## 1. Requirements & Constraints

- **REQ-001**: Workflow runtime state MUST survive worker process restart using Postgres-backed state only (Track 3 exit criterion 3).
- **REQ-002**: Approval requests MUST durably pause a workflow, release the worker lease, and resume exactly once when an authorized, unexpired, audited decision is recorded (exit criteria 4, 5).
- **REQ-003**: Approval denial, expiry, and cancellation MUST fail closed according to policy (exit criterion 6).
- **REQ-004**: Retryable failures MUST retry with bounded exponential backoff and jitter; non-idempotent or ambiguous side effects MUST open manual review instead of auto-retry (exit criteria 7, 8).
- **REQ-005**: Stuck-lease recovery MUST reclaim only idempotent pre-side-effect work and MUST fence off stale worker writes via monotonic fencing tokens (exit criterion 9).
- **REQ-006**: Cancellation MUST stop queued/future work, best-effort abort active work, release unused reservations, and preserve audit evidence (exit criterion 10).
- **REQ-007**: The workflow outbox MUST deliver trace/audit/portal/eval events at-least-once with idempotent consumers and MUST survive crash before delivery (exit criterion 11).
- **REQ-008**: Artifact bodies MUST be stored in object storage; only metadata/hash/refs in Postgres; signed access MUST be ACL-checked, short-lived, and issued only through Control API (exit criterion 12).
- **REQ-009**: Workflow templates MUST be immutable by version and active runs MUST remain pinned to their instantiated version (exit criterion 13).
- **REQ-010**: Long-running worker profiles MUST expose readiness, metrics, and graceful shutdown, and MUST fail closed when DB/audit/policy/registry/object storage is unavailable in production-like mode (exit criterion 14).
- **REQ-011**: Durable workflow, approval, retry, lease, cancellation, outbox, artifact, budget, template, and prompt-injection eval suites MUST exist and pass (exit criterion 15).
- **REQ-012**: Database-backed migration and invariant validation MUST pass against a disposable Postgres database (exit criterion 17).
- **SEC-001**: No raw prompts, raw context, raw artifact bodies, provider keys, raw virtual keys, signed URLs, bearer/refresh tokens, or secret-like fields may appear in logs, portal, APIs, outbox payloads, or metadata (exit criterion 16).
- **SEC-002**: Model-supplied approval claims MUST be ignored; only trusted Control API approval records with an authorized approver principal, role, policy version, and audit event may authorize a paused workflow.
- **SEC-003**: All durable mutation routes MUST require auth, role checks, policy/registry freshness pins, idempotency keys, and audit events.
- **CON-001**: Production capability remains gated; Track 0 governance approval `mnishanth02-track0-approval-2026-06-21` and Track 1/2 production blockers remain fail-closed.
- **CON-002**: The Python runtime business interface MUST remain SQL-free; all SQL lives behind the repository adapter. Supervisor/sub-agent planning MUST NOT import SQL.
- **CON-003**: The in-memory fixture repository remains for unit tests but MUST NOT satisfy Track 3 exit; durability gates MUST run against real ephemeral Postgres.
- **CON-004**: Custom durable runtime stays within the six-week time-box from `docs/02-agent-workflows-tools.md`; if durability gates miss the time-box, the Hatchet/Temporal migration trigger MUST be evaluated.
- **GUD-001**: Reuse existing contracts in `packages/shared-types/src/agent-workflow.ts` and JSON schemas in `packages/schemas/schemas/agent/` rather than introducing parallel shapes.
- **GUD-002**: Every worker loop MUST be idempotent, restart-safe, and observable; no worker may hold a side effect across an un-fenced lease boundary.
- **PAT-001**: Use transactional claim with `SELECT ... FOR UPDATE SKIP LOCKED`, fencing token write in the claim transaction, idempotency record before side effect, and transactional outbox enqueue with state change.
- **PAT-002**: Follow the non-production route-gating pattern `assertAgentWorkflowRouteEnabledOutsideProduction` already used in `apps/control-api/src/routes/*`.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Make the Postgres-backed runtime executable and prove crash/restart durability against real ephemeral Postgres. This phase is the foundation; all later durability claims depend on it.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add an async Postgres client dependency (`psycopg[binary,pool]` v3) to `workers/agent-runtime/pyproject.toml` under an optional `postgres` extra and a `test` extra, keeping module import free of live DB imports per existing `test_postgres_module_import_does_not_require_psycopg`. | | |
| TASK-002 | Create `workers/agent-runtime/src/devgateway_agent_runtime/db.py` providing an async connection/pool factory that reads `OPERATIONAL_DATABASE_URL`, enforces statement timeouts, and exposes a transaction context manager. No connection at import time. | | |
| TASK-003 | Implement `PostgresRuntimeRepository` in `workers/agent-runtime/src/devgateway_agent_runtime/postgres_repository.py` to satisfy the full `RuntimeRepository` interface in `repositories.py`: transactional `claim_next_step` (`SELECT ... FOR UPDATE SKIP LOCKED`), lease creation with fencing token in the same transaction, attempt persistence before side effects, trace persistence before dispatch, idempotency checks before model/tool/budget/outbox/artifact writes, and transactional completion + lease release + outbox enqueue. | | |
| TASK-004 | Add a runtime service entrypoint `workers/agent-runtime/src/devgateway_agent_runtime/service.py` with a base worker loop (claim, heartbeat, execute, complete, release) and graceful shutdown that stops claiming new work and finishes or fences safe in-flight work. | | |
| TASK-005 | Extend `workers/agent-runtime/src/devgateway_agent_runtime/cli.py` to add `--mode postgres` (single-shot durable run) and `--mode service` (long-running) alongside the existing `fixture` mode; remove the hard error that only fixture mode is supported and gate `postgres`/`service` behind explicit `OPERATIONAL_DATABASE_URL` presence. | | |
| TASK-006 | Add a pytest harness `workers/agent-runtime/tests/conftest.py` that provisions an ephemeral Postgres database, applies the committed migrations from `packages/db/migrations/`, and tears it down per session; skip (not pass) durability tests when no `DATABASE_CHECK_URL`/ephemeral Postgres is available. | | |
| TASK-007 | Add `workers/agent-runtime/tests/postgres_durability_test.py` proving: a simple workflow completes using Postgres only; an in-progress workflow resumes from persisted state after simulated process restart and does not restart from the beginning; no SQL leaks into supervisor/sub-agent logic. | | |
| TASK-008 | Add a Track 3 durability gate command `test:durable:postgres` to `workers/agent-runtime/package.json` and wire it into the root validation surface (`package.json` / `turbo.json`) as an opt-in gate that requires a disposable Postgres URL. | | |

### Implementation Phase 2

- GOAL-002: Enforce retry policy and lease fencing against real Postgres, with a lease sweeper that recovers stuck work or escalates to manual review. Depends on GOAL-001.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Wire `workers/agent-runtime/src/devgateway_agent_runtime/retry.py` decision logic into the dispatcher so retryable failures schedule a retry with bounded exponential backoff + jitter, persisting `next_attempt_time`, `failure_class`, and attempt linkage in `step_attempt`. | | |
| TASK-010 | Enforce manual-review fallback: non-idempotent or ambiguous post-side-effect failures create a `manual_review_item` row instead of auto-requeueing, per `packages/schemas/schemas/agent/manual-review.v0.1.schema.json`. | | |
| TASK-011 | Enforce fencing on every worker write in `PostgresRuntimeRepository`: each state mutation includes the current fencing token; stale-token writes are rejected. Add `leases.py` helpers for monotonic token issue and validation. | | |
| TASK-012 | Create `workers/agent-runtime/src/devgateway_agent_runtime/lease_sweeper.py` worker that reclaims expired leases only when the latest attempt is idempotent/pre-side-effect, escalates ambiguous work to manual review, and emits workflow + audit + outbox events with owner/token/expiry/last-heartbeat/decision evidence. | | |
| TASK-013 | Add Postgres-backed tests in `workers/agent-runtime/tests/postgres_durability_test.py` (or a new `lease_retry_test.py`): transient retry, terminal validation failure, retry exhaustion, conflicting idempotency replay denial, stale-worker write fenced off, stuck lease recovered or escalated within the 5-minute SLO. | | |

### Implementation Phase 3

- GOAL-003: Implement end-to-end cancellation execution: observe, stop, unwind, release reservations, best-effort abort, and terminalize or escalate. Depends on GOAL-001, GOAL-002.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Add cancellation checkpoints in `workers/agent-runtime/src/devgateway_agent_runtime/dispatcher.py` and `executor.py`: check cancellation before claim, before side effects, between streamed chunks where supported, and before synthesis; fail closed on cancellation-check error. | | |
| TASK-015 | Create `workers/agent-runtime/src/devgateway_agent_runtime/cancellation_worker.py` that propagates `workflow_cancellation`, marks pending steps/delegations/tool calls cancelled, releases unused reservations, preserves completed side effects with audit evidence, and escalates ambiguous non-idempotent in-flight work to manual review. | | |
| TASK-016 | Add best-effort abort hooks to `executor.py` and `model_adapter.py` for in-flight model/tool calls where the adapter supports cancellation; record abort outcome as evidence. | | |
| TASK-017 | Add read-only cancellation acknowledgement handling in `apps/tool-broker/src/server.ts` so the broker reports cancellation state for in-flight discovery/call requests without enabling write tools. | | |
| TASK-018 | Update `apps/control-api/src/routes/tasks.ts` cancel route documentation and response to reflect asynchronous execution status (queued vs running vs waiting-for-approval) sourced from durable state, keeping the record-then-observe contract. | | |
| TASK-019 | Add Postgres-backed cancellation tests: queued cancellation releases reservations immediately; running cancellation stops future steps and attempts active abort; cancellation during approval wait terminalizes the approval; cancellation during outbox delivery loses no enqueued events; no double settlement. | | |

### Implementation Phase 4

- GOAL-004: Complete the human-approval lifecycle: durable pause/resume exactly once, expiry, and authorization. Depends on GOAL-001.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | Add `POST /api/approvals/{approval_request_id}/expire` (internal/system path) to `apps/control-api/src/routes/approvals.ts` and `expireApproval` to `apps/control-api/src/routes/agent-workflow-store.ts`, with fail-closed terminal semantics. | | |
| TASK-021 | Implement durable approval pause/resume in the runtime: on `waiting_for_approval`, persist a resume token and release the worker lease; on authorized unexpired decision, resume exactly once from persisted state. Add resume logic to `workers/agent-runtime/src/devgateway_agent_runtime/approvals.py` and the service loop. | | |
| TASK-022 | Create `workers/agent-runtime/src/devgateway_agent_runtime/approval_expiry_worker.py` that expires approvals past TTL by risk tier and drives the deterministic terminal/replanning policy. | | |
| TASK-023 | Define default approval TTL by risk tier in `packages/policy/src/*` (resolve open decision: low=72h, medium=24h, high=4h, internal-default) and enforce in expiry worker and approval creation. | | |
| TASK-024 | Add Postgres-backed approval tests: required-approval pause releases lease; authorized approve resumes exactly once; unauthorized/self-approval denied; model-claimed approval ignored; expiry fails closed; denial resumes/fails deterministically. | | |

### Implementation Phase 5

- GOAL-005: Deliver the event outbox with an idempotent, crash-safe delivery worker. Depends on GOAL-001.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-025 | Ensure outbox enqueue occurs in the same transaction as workflow state change inside `PostgresRuntimeRepository`, keyed by destination + source event idempotency key. | | |
| TASK-026 | Create `workers/agent-runtime/src/devgateway_agent_runtime/outbox_worker.py` that claims `workflow_outbox` rows under lease fencing, delivers to trace/audit/portal/eval destinations, retries with backoff, and dead-letters (or opens manual review) after exhaustion; reuse `outbox.py` decision helpers. | | |
| TASK-027 | Implement idempotent destination consumers for trace, audit, portal-notification, and eval-evidence sinks in `packages/observability/src/index.ts` (or a new outbox-consumers module) so duplicate at-least-once delivery is harmless. | | |
| TASK-028 | Add Postgres-backed outbox tests: state-change + enqueue atomicity; crash before delivery does not lose events; duplicate delivery is idempotent; dead-letter/manual-review after repeated failures; backlog observable. | | |

### Implementation Phase 6

- GOAL-006: Add budget cleanup so reservations cannot leak across retries, cancellation, approval waits, or crashes. Depends on GOAL-001, GOAL-003, GOAL-004.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | Create `workers/agent-runtime/src/devgateway_agent_runtime/budget_reaper.py` that detects orphaned reservations (expired lease, dead worker, abandoned workflow), reconciles them with audit events, and never double-releases. | | |
| TASK-030 | Enforce reservation lease/expiry semantics: approval waits hold a reservation only up to a configured TTL, then release or re-estimate on resume; add release-on-cancel in the cancellation worker; add retry settlement that reuses an existing reservation only when policy allows. | | |
| TASK-031 | Extend `apps/control-api/src/routes/budgets.ts` and `packages/observability/src/cost.ts` to surface held, released, settled, orphaned, and reconciled reservation states; reject settlement/release replay with conflicting bodies. | | |
| TASK-032 | Add Postgres-backed budget tests: worker crash leaves no permanently pending reservation undetected; long approval wait releases/re-estimates; retry settlement does not double-bill. | | |

### Implementation Phase 7

- GOAL-007: Replace metadata-only artifact handling with object-storage-backed lifecycle and ACL-safe signed access. Depends on GOAL-001.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-033 | Add an S3-compatible object-storage adapter `workers/agent-runtime/src/devgateway_agent_runtime/object_storage.py` and config in `packages/config/src/*` targeting MinIO locally and Railway Object Storage in production behind one interface (resolve open decision: support both behind the same interface). | | |
| TASK-034 | Store artifact bodies in object storage and only metadata/hash/object-ref/retention/sensitivity/ACL scopes in Postgres; verify hash after write and before signed access in `artifacts.py` + `artifact_lifecycle.py`. | | |
| TASK-035 | Implement signed-access issuance behind Control API only in `apps/control-api/src/routes/artifacts.ts`: ACL/auth check, short TTL, no signed URL or object body in any non-issuance response; lifecycle worker enforces retention/expiry/redaction/deletion/legal hold. | | |
| TASK-036 | Add orphan reconciliation for object-write-succeeded/DB-commit-failed and DB-metadata/object-missing split-brain cases. | | |
| TASK-037 | Add tests: no large body in Postgres; restricted/confidential access denied unless scope matches; expired/deleted/redacted artifacts cannot be signed or displayed; orphan reconciliation works. Update `infra/runbooks/backup-restore-plan.md` for artifact metadata + object recovery. | | |

### Implementation Phase 8

- GOAL-008: Add the missing Control API durable-control routes. Depends on GOAL-002, GOAL-003, GOAL-004.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-038 | Add `POST /api/workflows/{workflow_id}/retry` to `apps/control-api/src/routes/workflows.ts` with auth, role check, policy/registry pins, idempotency key, audit; reject conflicting idempotency replays. | | |
| TASK-039 | Add manual-review detail + resolve routes (`GET`/`POST /api/workflows/{workflow_id}/manual-review` or `/api/manual-review/{id}/resolve`) backed by `manual_review_item`. | | |
| TASK-040 | Add lease/stuck-work status route (`GET /api/workflows/{workflow_id}/leases` or `/api/operations/leases`) and outbox status route surfacing backlog/dead-letter counts, metadata-only. | | |
| TASK-041 | Register all new routes in `apps/control-api/src/server.ts` non-production only, update `apps/control-api/src/openapi/document.ts`, and extend `apps/control-api/src/routes/control-routes.test.ts` for auth/role/pin/idempotency/sanitization. | | |

### Implementation Phase 9

- GOAL-009: Add the admin portal operator surfaces for durable workflows. Depends on GOAL-004, GOAL-008.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-042 | Add an approval queue + decision route `apps/admin-portal/src/app/routes/approval-queue-view.tsx` showing required action, requester, risk tier, expiry, sanitized artifact metadata, and audit trail; approve/deny call Control API only. | | |
| TASK-043 | Add a durable-operations route `apps/admin-portal/src/app/routes/durable-operations-view.tsx` with retry/cancel/manual-review controls, stuck-lease/worker status, outbox backlog, and artifact lifecycle/signed-access status panels. | | |
| TASK-044 | Extend `apps/admin-portal/src/features/control-api-client.ts` with approval, retry, cancel, manual-review, lease-status, outbox-status, and artifact-lifecycle client methods; extend `operational-views.ts` view models. | | |
| TASK-045 | Add portal tests (`*.test.ts`) asserting the new surfaces render fail-closed auth state and never render raw prompts, artifact bodies, signed URLs, tokens, provider keys, or secret-like metadata. | | |

### Implementation Phase 10

- GOAL-010: Add durable eval suites, the ephemeral-Postgres chaos gate, and correct the validation evidence + exit decision. Depends on GOAL-001 through GOAL-009.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-046 | Add datasets `evals/datasets/durable-workflow.v0.1.json`, `evals/datasets/approval-gates.v0.1.json`, `evals/datasets/workflow-outbox.v0.1.json` and matching fixture folders under `evals/fixtures/`. | | |
| TASK-047 | Register the new suites in `scripts/eval-smoke.mjs` and `workers/eval-runner/src/devgateway_eval_runner/cli.py`; validate layout with `scripts/validate-eval-layout.mjs`. | | |
| TASK-048 | Define and document the Track 3 ephemeral-Postgres chaos gate command (process-kill/restart, stuck lease, outbox crash-before-delivery, approval resume) and wire it as the durability exit gate. | | |
| TASK-049 | Run all validation commands (schema check, db offline + database checks, runtime typecheck/test/build, control-api typecheck/test, admin-portal typecheck/test, eval smoke, durability chaos gate) and capture results. | | |
| TASK-050 | Rewrite `docs/governance/track-3-validation-evidence.md` to reflect true status per exit criterion (replace blanket "Complete"), record the new evidence, and produce an updated exit decision or explicit blocker list. | | |
| TASK-051 | Update `infra/railway/service-matrix.md`, `infra/railway/variable-matrix.md`, `infra/runbooks/production-runbook-backlog.md`, and `scripts/devgateway-dev.mjs` for the new worker profiles, readiness, metrics, and local launch. | | |

## 3. Alternatives

- **ALT-001**: Adopt Hatchet or Temporal now instead of hardening the custom runtime. Rejected for this remediation because the schemas, migration, and repository seams already exist; migrating mid-remediation would discard near-complete work. The Hatchet/Temporal trigger is retained as a fallback if the Phase 1–2 durability gates miss the six-week time-box (CON-004).
- **ALT-002**: Use `asyncpg` as the Postgres client. Rejected in favor of `psycopg` v3 because psycopg3 supports both sync and async, integrates cleanly with the existing disposable-Postgres tooling, and matches the `db:check:database` workflow already in the repo. `asyncpg` remains a viable swap behind `db.py`.
- **ALT-003**: Keep artifacts as metadata-only with bodies inline in Postgres. Rejected because it violates REQ-008 and the proposal's storage posture and does not scale; object storage behind one interface is required.
- **ALT-004**: Build a single monolithic worker process. Rejected in favor of separable worker profiles (dispatcher, lease sweeper, approval expiry, outbox, budget reaper, artifact lifecycle, cancellation) for independent restart and observability (GUD-002).
- **ALT-005**: Treat the existing fixture tests as sufficient durability evidence. Rejected by CON-003; durability must be proven against real ephemeral Postgres.

## 4. Dependencies

- **DEP-001**: `psycopg[binary,pool]` v3 added to `workers/agent-runtime/pyproject.toml`.
- **DEP-002**: A disposable/ephemeral Postgres instance reachable via `DATABASE_CHECK_URL` (or equivalent) for durability and chaos gates; runtime `OPERATIONAL_DATABASE_URL` is intentionally ignored by `db:check` per repo memory.
- **DEP-003**: An S3-compatible object store: MinIO locally (`infra/local/`) and Railway Object Storage in production.
- **DEP-004**: Existing Track 3 contracts and migration (`packages/schemas/schemas/agent/*`, `packages/shared-types/src/agent-workflow.ts`, `packages/db/migrations/0003_track_3_durable_workflows.sql`) remain the source of truth and may need additive forward-only migrations only.
- **DEP-005**: Better Auth admin/developer session or scoped service token for approval and durable-control routes.
- **DEP-006**: Existing eval runner (`workers/eval-runner`) and `scripts/eval-smoke.mjs` smoke harness.
- **DEP-007**: Track 0 governance approval and Track 1/2 production gates remain in force (CON-001).

## 5. Files

- **FILE-001**: `workers/agent-runtime/pyproject.toml` — add `postgres`/`test` extras and `psycopg` dependency.
- **FILE-002**: `workers/agent-runtime/src/devgateway_agent_runtime/db.py` — new async connection/pool + transaction factory.
- **FILE-003**: `workers/agent-runtime/src/devgateway_agent_runtime/postgres_repository.py` — implement full `RuntimeRepository` against Postgres.
- **FILE-004**: `workers/agent-runtime/src/devgateway_agent_runtime/service.py` — new long-running worker base loop + graceful shutdown.
- **FILE-005**: `workers/agent-runtime/src/devgateway_agent_runtime/cli.py` — add `postgres` and `service` modes.
- **FILE-006**: `workers/agent-runtime/src/devgateway_agent_runtime/lease_sweeper.py` — new stuck-lease recovery worker.
- **FILE-007**: `workers/agent-runtime/src/devgateway_agent_runtime/cancellation_worker.py` — new cancellation propagation worker.
- **FILE-008**: `workers/agent-runtime/src/devgateway_agent_runtime/approval_expiry_worker.py` — new approval TTL expiry worker.
- **FILE-009**: `workers/agent-runtime/src/devgateway_agent_runtime/outbox_worker.py` — new outbox delivery worker.
- **FILE-010**: `workers/agent-runtime/src/devgateway_agent_runtime/budget_reaper.py` — new orphaned-reservation reaper.
- **FILE-011**: `workers/agent-runtime/src/devgateway_agent_runtime/object_storage.py` — new S3-compatible adapter.
- **FILE-012**: `workers/agent-runtime/src/devgateway_agent_runtime/{dispatcher,executor,retry,leases,approvals,cancellation,artifact_lifecycle,model_adapter}.py` — wire decision helpers into execution.
- **FILE-013**: `workers/agent-runtime/tests/{conftest.py,postgres_durability_test.py,lease_retry_test.py}` — new ephemeral-Postgres harness + durability/chaos tests.
- **FILE-014**: `apps/control-api/src/routes/{workflows,approvals,artifacts,tasks,budgets,agent-workflow-store}.ts` — retry/manual-review/lease/outbox/expire/signed-access routes + store methods.
- **FILE-015**: `apps/control-api/src/server.ts`, `apps/control-api/src/openapi/document.ts`, `apps/control-api/src/routes/control-routes.test.ts` — register + document + test new routes.
- **FILE-016**: `apps/tool-broker/src/server.ts` — cancellation acknowledgement for in-flight read-only calls.
- **FILE-017**: `apps/admin-portal/src/app/routes/{approval-queue-view,durable-operations-view}.tsx` — new operator surfaces.
- **FILE-018**: `apps/admin-portal/src/features/{control-api-client,operational-views}.ts` (+ tests) — client methods + view models.
- **FILE-019**: `evals/datasets/{durable-workflow,approval-gates,workflow-outbox}.v0.1.json` + `evals/fixtures/*` — new suites.
- **FILE-020**: `scripts/eval-smoke.mjs`, `workers/eval-runner/src/devgateway_eval_runner/cli.py`, `scripts/validate-eval-layout.mjs` — register suites.
- **FILE-021**: `packages/policy/src/*` — approval TTL-by-risk-tier policy.
- **FILE-022**: `packages/config/src/*` — object-storage + worker config.
- **FILE-023**: `packages/observability/src/{index,cost}.ts` — idempotent outbox consumers + budget state.
- **FILE-024**: `infra/railway/{service-matrix,variable-matrix}.md`, `infra/runbooks/{production-runbook-backlog,backup-restore-plan}.md`, `scripts/devgateway-dev.mjs` — worker ops.
- **FILE-025**: `docs/governance/track-3-validation-evidence.md` — corrected status + exit decision.

## 6. Testing

- **TEST-001**: Postgres durability — workflow completes using Postgres only; in-progress workflow resumes after restart without restarting from the beginning (REQ-001).
- **TEST-002**: Lease/retry — transient retry with backoff, terminal validation failure, retry exhaustion, conflicting idempotency replay denial, stale-worker write fenced off, stuck lease recovered/escalated within SLO (REQ-004, REQ-005).
- **TEST-003**: Cancellation — queued/running/approval-wait/outbox-delivery cancellation, reservation release, no double settlement, ambiguous work to manual review (REQ-006).
- **TEST-004**: Approvals — pause releases lease, authorized resume exactly once, unauthorized/self/model-claimed denied, expiry fails closed, denial deterministic (REQ-002, REQ-003, SEC-002).
- **TEST-005**: Outbox — atomic enqueue, crash-before-delivery loses nothing, duplicate delivery idempotent, dead-letter after exhaustion (REQ-007).
- **TEST-006**: Budget — crash leaves no undetected pending reservation, approval-wait release/re-estimate, retry settlement no double-bill (budget cleanup).
- **TEST-007**: Artifact — no body in Postgres, ACL-denied signed access, expired/redacted artifacts unsignable, orphan reconciliation (REQ-008).
- **TEST-008**: Template versioning — new task pins immutable version; template update does not mutate active runs (REQ-009).
- **TEST-009**: Sanitization — no raw prompts/artifact bodies/signed URLs/tokens/provider keys/secret fields in API, portal, logs, outbox payloads (SEC-001).
- **TEST-010**: Control API — retry/manual-review/lease/outbox/expire routes enforce auth, role, pins, idempotency, audit (SEC-003).
- **TEST-011**: Eval suites — `durable-workflow`, `approval-gates`, `workflow-outbox`, and prompt-injection suites pass via `pnpm eval:smoke` (REQ-011).
- **TEST-012**: Ephemeral-Postgres chaos gate — process-kill/restart, stuck lease, outbox crash-before-delivery, approval resume run against real Postgres (REQ-012).

## 7. Risks & Assumptions

- **RISK-001**: Crash after external side effect before DB commit causes duplicate model/tool calls or double billing. Mitigation: persist idempotency refs and provider/gateway request IDs before/with dispatch; reconcile ambiguous states through manual review.
- **RISK-002**: Approval bypass via model text or stale refs. Mitigation: trusted Control API approval records only, approver role + policy-version checks, expiry fail-closed (SEC-002).
- **RISK-003**: Stale worker writes after lease recovery corrupt state. Mitigation: fencing tokens on all worker writes (REQ-005).
- **RISK-004**: Auto-retry of non-idempotent work causes duplicate side effects. Mitigation: retry classifier + manual-review fallback (REQ-004).
- **RISK-005**: Artifact leakage via signed URLs or portal. Mitigation: Control API-only signed access, ACL/sensitivity checks, short TTLs, redaction/expiry/legal-hold (REQ-008, SEC-001).
- **RISK-006**: Runtime scope exceeds the six-week time-box. Mitigation: evaluate Hatchet/Temporal trigger after Phase 2 if durability gates slip (CON-004).
- **RISK-007**: Object-storage adapter differences between MinIO and Railway cause environment drift. Mitigation: single interface + integration tests against MinIO locally.
- **ASSUMPTION-001**: The committed migration `0003_track_3_durable_workflows.sql` and Track 3 schemas are correct and require only additive forward-only changes.
- **ASSUMPTION-002**: An ephemeral Postgres and MinIO are available in CI/local for durability and artifact gates.
- **ASSUMPTION-003**: Production model/tool/retrieval/write-tool paths remain disabled; this remediation does not request production enablement.

## 8. Related Specifications / Further Reading

- `docs/impl-plan/track-3-durable-workflows-approvals.md`
- `docs/governance/track-3-validation-evidence.md`
- `docs/impl-plan/track-2-agent-orchestration-foundation.md`
- `docs/02-agent-workflows-tools.md`
- `docs/04-technology-roadmap-operations.md`
- `docs/governance/budget-scope-model.md`
- `docs/governance/gateway-policy-enforcement-contract.md`
- `docs/governance/observability-and-backup-plan.md`
- `docs/governance/railway-deployment-topology.md`
