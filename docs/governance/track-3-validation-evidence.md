# Track 3 validation evidence

Status: Conditional / live-infrastructure gates blocked  
Last updated: 2026-06-22  
Scope: Track 3 durable workflow, approval, outbox, cancellation, retry, manual-review, artifact lifecycle, workflow-template, Control API, runtime repository, admin portal, and validation evidence. This document does not enable production model routes, provider keys, write tools, retrieval, memory, or production workflow dispatch.

## Evidence posture

Track 3 remediation is implemented and validated with fixture, unit, typecheck, offline database, eval-smoke, browser, model-review, and security-review evidence. Formal Track 3 exit is **not** claimed because this session did not have a disposable live Postgres URL or live object-store environment. Live Postgres durability, chaos/restart behavior, database trigger execution, and object-store body lifecycle rehearsal remain blocked by environment, not by a known product failure.

## Implementation surfaces

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| JSON schemas | `packages\schemas\schemas\agent\approval-request.v0.1.schema.json`, `workflow-outbox.v0.1.schema.json`, `workflow-template.v0.1.schema.json`, `retry-policy.v0.1.schema.json`, `cancellation.v0.1.schema.json`, `manual-review.v0.1.schema.json`, `artifact-lifecycle.v0.1.schema.json` | Implemented / fixture-validated | Track 3 contracts are cataloged and exported. |
| Shared contracts | `packages\shared-types\src\agent-workflow.ts` | Implemented / typechecked | Durable approval, outbox, cancellation, manual-review, artifact-lifecycle, workflow-template, and retry-policy records are shared. |
| Database schema and migration | `packages\db\src\schema\operational.ts`, `packages\db\migrations\0003_track_3_durable_workflows.sql` | Implemented / offline-validated; live DB blocked | Offline structural checks pass. Disposable Postgres migration/invariant execution was not run in this session because no database URL was configured. |
| Runtime contracts and repository | `workers\agent-runtime\src\devgateway_agent_runtime\contracts.py`, `postgres_repository.py` | Implemented / unit-validated; live DB blocked | Runtime tests pass. Postgres durability tests collected 27 cases but skipped without a DB URL. |
| Runtime workers/helpers | `approvals.py`, `outbox.py`, `artifact_lifecycle.py`, `cancellation.py`, `retry.py`, `templates.py`, worker/reaper modules | Implemented / unit-validated | Includes approval expiry, outbox delivery, cancellation, lease sweeping, budget reaping, retry/manual-review routing, and artifact lifecycle helpers. |
| Runtime dispatcher/service | `dispatcher.py`, `service.py`, `executor.py` | Implemented / unit-validated | Cancellation checks, fenced completion, retry routing, rollback robustness, and service error handling are covered by runtime tests. |
| Control API Track 3 routes | `apps\control-api\src\routes\approvals.ts`, `outbox.ts`, `artifacts.ts`, `templates.ts` | Implemented / test-validated | Non-production-only routes with project scope, authorization, policy pins, metadata-only responses, and signed-access decisions without signed URLs. |
| Admin portal durable views | `apps\admin-portal\src\app\routes\approval-queue-view.tsx`, `durable-operations-view.tsx`, trace/home routes | Implemented / test- and browser-validated | Browser evidence covers `/`, `/trace`, `/approvals`, and `/durable-operations`. |
| Observability/config/tool-broker support | `packages\observability`, `packages\config`, `apps\tool-broker` | Implemented / test-validated | Tests cover audit/trace helpers, object-storage env validation, and approval-bypass/tool safety boundaries. |
| Eval datasets | `evals\datasets\durable-workflow.v0.1.json`, `approval-gates.v0.1.json`, `workflow-outbox.v0.1.json` | Fixture-validated | Fixture smoke runs Track 3 eval suites with no live provider calls. |

## Final validation command evidence

Commands were run from `C:\Users\v-mnmurugan\projects\nishanth\devgateway` on 2026-06-22.

| Command | Result | Evidence |
|---|---|---|
| `pnpm --filter @devgateway/agent-runtime test` | Pass | Exit 0; `Ran 252 tests in 0.938s`; `OK`. |
| `pnpm --filter @devgateway/agent-runtime typecheck` | Pass | Exit 0; `python -m compileall -q src tests`. |
| `pnpm --filter @devgateway/agent-runtime test:durable:postgres` | Skipped by environment | Exit 0; `27 skipped in 0.27s`; no Postgres URL configured. |
| `pnpm --filter @devgateway/db db:check:offline` | Pass | Exit 0; all Track 2/3 offline structural checks `[PASS]`; database-connectivity note: no database URL configured, offline checks only. |
| `pnpm --filter @devgateway/control-api typecheck` | Pass | Exit 0; `tsc --noEmit`. |
| `pnpm --filter @devgateway/control-api test` | Pass | Exit 0; `tests 111`, `pass 111`, `skipped 0`, `duration_ms 14388.4602`. |
| `pnpm --filter @devgateway/admin-portal typecheck` | Pass | Exit 0; `tsc --noEmit`. |
| `pnpm --filter @devgateway/admin-portal test` | Pass | Exit 0; Node tests `tests 9`, `pass 9`, `skipped 0`; Vitest `Test Files 6 passed (6)`, `Tests 33 passed (33)`. |
| `pnpm --filter @devgateway/tool-broker typecheck` | Pass | Exit 0; `tsc --noEmit`. |
| `pnpm --filter @devgateway/tool-broker test` | Pass | Exit 0; `tests 15`, `pass 15`, `skipped 0`, `duration_ms 495.8667`. |
| `pnpm --filter @devgateway/config typecheck` | Pass | Exit 0; `tsc --noEmit`. |
| `pnpm --filter @devgateway/config test` | Pass | Exit 0; `tests 14`, `pass 14`, `skipped 0`, `duration_ms 358.3331`. |
| `pnpm --filter @devgateway/observability typecheck` | Pass | Exit 0; `tsc --noEmit`. |
| `pnpm --filter @devgateway/observability test` | Pass | Exit 0; `tests 29`, `pass 29`, `skipped 0`, `duration_ms 337.5837`. |
| `node scripts/validate-eval-layout.mjs` | Pass | Exit 0; `Eval dataset layout validation passed (15 datasets, 94 fixtures).` |
| `pnpm eval:smoke` | Pass | Exit 0; fixture-mode eval smoke ran the configured suites, including Track 3 durable-workflow, approval-gates, and workflow-outbox suites; sample final suite reported `pass: true`, `total_cases: 4`, `passed_cases: 4`, `failed_cases: 0`, `live_provider_calls: 0`. |
| `pnpm test:durable:chaos` | Blocked by missing live DB URL | Exit 2 by design; message: `Track 3 chaos gate requires a disposable Postgres URL via DATABASE_CHECK_URL or AGENT_RUNTIME_POSTGRES_TEST_URL.` This is recorded as live-infra blocked, not a product failure. |

## Browser validation evidence

| Surface | Result | Evidence |
|---|---|---|
| `/` home | Pass | `.devgateway\ui-browser-validation\home.png`; local browser validation completed. |
| `/trace` | Pass | `.devgateway\ui-browser-validation\trace.png`, `trace.snapshot.txt`; fail-closed/auth-safe trace state rendered without forbidden raw/signed/secret strings. |
| `/approvals` | Pass | `.devgateway\ui-browser-validation\approvals.png`, `approvals.snapshot.txt`; approval queue rendered fixture-safe metadata. |
| `/durable-operations` | Pass | `.devgateway\ui-browser-validation\durable.png`, `durable.snapshot.txt`; durable operations rendered metadata without raw artifact bodies, signed URLs, provider keys, tokens, or secret strings. |
| Local service logs | Captured | `.devgateway\ui-browser-validation\control-api.out.log`, `control-api.err.log`, `admin-portal.out.log`, `admin-portal.err.log`, `page-evidence.js`. |

## Review outcomes and remediation evidence

| Review | Outcome | Remediations / evidence |
|---|---|---|
| Basic pre-review checks | Passed before final review | Eval layout, eval smoke, agent-runtime/control-api/admin-portal/tool-broker/config/observability tests and typechecks passed; Postgres durability skipped without DB URL; chaos gate clearly required DB URL. |
| UI browser validation | Passed | `/`, `/trace`, `/approvals`, and `/durable-operations` validated with evidence under `.devgateway\ui-browser-validation\`. |
| Adversarial security review | No vulnerabilities found | Final security review reported no high-confidence vulnerabilities after Track 3 remediation. |
| GPT-5.5 code review | Findings remediated | Fixed replay decision vocabulary, approval event type mapping, and retry `next_attempt_at` claim predicate; remediation validation passed agent-runtime test/typecheck and `db:check:offline`. |
| Gemini 3.1 Pro review | Findings remediated | Fixed artifact signed-access HMAC, object-key traversal, runtime retry/manual-review routing and `BaseException` handling, worker rollback robustness, retry backoff bounds, and delimiter-safe approval/outbox keys; remediation validation passed agent-runtime/control-api/observability test/typecheck. |
| Claude Opus 4.8 review | Finding remediated | Approval expiry budget reaping is scoped to the expired workflow and no longer performs project-wide `ttl=0` release; remediation validation passed agent-runtime test/typecheck. Targeted Postgres regression was skipped without DB URL. |

## Track 3 exit criteria status

| # | Criterion | Current status |
|---:|---|---|
| 1 | Track 0 governance approval remains recorded and production capability remains separately gated. | Satisfied by existing governance posture; no production enablement added by Track 3. |
| 2 | Track 1/2 production blockers are still fail-closed or explicitly resolved by separate evidence. | Satisfied for this scope; Control API Track 3 routes remain non-production-only and fail closed in production tests. |
| 3 | Workflow state survives worker process restart using Postgres-backed runtime state. | Implemented and test-authored; live evidence blocked because Postgres durability tests skipped without DB URL and chaos gate was not live-run. |
| 4 | Approval request pauses workflow durably and releases worker lease. | Implemented and unit/fixture-validated; live Postgres proof blocked. |
| 5 | Approval decision resumes exactly once when authorized, unexpired, and audited. | Implemented and unit/fixture-validated; live restart/chaos proof blocked. |
| 6 | Approval denial/expiry/cancellation fail closed according to policy. | Implemented and unit/API-validated; live Postgres expiry/cancellation rehearsal remains blocked. |
| 7 | Failed retryable steps are explainable and retryable with bounded backoff. | Implemented and unit-validated; Gemini backoff-bound finding remediated. |
| 8 | Non-idempotent or ambiguous side effects open manual review instead of auto-retry. | Implemented and unit-validated; retry/manual-review routing finding remediated. |
| 9 | Stuck lease recovery test passes and stale worker writes are fenced off. | Implemented and unit/fixture-validated; live chaos proof blocked. |
| 10 | Cancellation execution stops queued/future work, best-effort aborts active work, releases unused reservations, and preserves audit evidence. | Implemented and unit/API-validated; live long-running worker rehearsal remains blocked. |
| 11 | Workflow outbox delivers trace/audit/portal/eval events idempotently and survives crash before delivery. | Implemented and unit/API/eval-validated; live crash-before-delivery chaos proof blocked. |
| 12 | Artifact lifecycle uses object storage for bodies, enforces ACL/signed-access/retention/legal-hold rules, and reconciles orphaned writes. | Metadata/ACL/signed-access logic implemented and API/browser-validated; live object-store body lifecycle/orphan reconciliation remains blocked. |
| 13 | Workflow templates are immutable by version and active runs remain pinned to their original template version. | Implemented and offline/API-validated; live database trigger execution blocked without disposable Postgres. |
| 14 | Long-running worker service readiness, shutdown, metrics, and runbooks are in place. | Implemented and unit/observability-validated; live service rehearsal not run. |
| 15 | Durable workflow, approval, retry, lease, cancellation, outbox, artifact, budget, template, and prompt-injection eval suites pass. | Fixture eval smoke passed, including Track 3 durable-workflow, approval-gates, and workflow-outbox suites with `live_provider_calls: 0`. |
| 16 | No raw prompts, raw artifact bodies, provider keys, raw virtual keys, signed URLs, tokens, or secret fields are exposed in logs, portal, APIs, outbox payloads, or metadata. | Satisfied by API/admin tests, browser validation, and final security review. |
| 17 | Database-backed migration/invariant validation passes against disposable Postgres. | Blocked. Offline DB checks pass, but no `DATABASE_CHECK_URL`/`AGENT_RUNTIME_POSTGRES_TEST_URL` was configured for live database validation. |
| 18 | Track 3 validation evidence records commands, chaos tests, model reviews, browser checks, and any remaining production blockers. | Satisfied by this document. |

## Exit decision and blockers

Decision: **Conditional approval for implemented/offline/fixture/browser-validated Track 3 remediation; formal Track 3 exit remains blocked on live-infrastructure gates.**

Blockers before unconditional Track 3 exit:

1. Configure a disposable Postgres URL in `DATABASE_CHECK_URL` or `AGENT_RUNTIME_POSTGRES_TEST_URL` and rerun `pnpm --filter @devgateway/agent-runtime test:durable:postgres` expecting live execution instead of 27 skips.
2. With the same disposable Postgres environment, rerun `pnpm test:durable:chaos` expecting the restart/lease/outbox/approval chaos subset to pass instead of the current exit-2 environment gate.
3. Run database-backed migration/invariant validation against disposable Postgres, including Track 3 trigger/enforcement checks, rather than offline structural validation only.
4. Run a disposable object-storage lifecycle rehearsal for artifact body writes, ACL/signed-access, retention/legal-hold, and orphan reconciliation. The current evidence validates metadata/signed-access decisions but not live object-store behavior.

No remaining offline/unit/typecheck/browser/model-review/security-review blocker is known from this final validation pass.
