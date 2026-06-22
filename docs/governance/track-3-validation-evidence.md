# Track 3 validation evidence

Status: Complete Track 3 evidence snapshot  
Scope: durable workflow, approval, outbox, cancellation, retry, manual-review, artifact lifecycle, workflow-template, Control API, runtime repository, and non-production browser-validation evidence. This document does not enable production model routes, provider keys, write tools, retrieval, memory, or production workflow dispatch.

## Track 3 implementation surfaces

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| JSON schemas | `packages\schemas\schemas\agent\approval-request.v0.1.schema.json`, `workflow-outbox.v0.1.schema.json`, `workflow-template.v0.1.schema.json`, `retry-policy.v0.1.schema.json`, `cancellation.v0.1.schema.json`, `manual-review.v0.1.schema.json`, `artifact-lifecycle.v0.1.schema.json` | Complete | New Track 3 contracts are cataloged in `packages\schemas\schemas\index.v0.1.json` and exported by `packages\schemas\src\index.ts`. |
| Shared contracts | `packages\shared-types\src\agent-workflow.ts` | Complete | Adds durable approval, outbox, cancellation, manual-review, artifact-lifecycle, workflow-template, and retry-policy records. |
| Database schema | `packages\db\src\schema\operational.ts` | Complete | Adds Track 3 tables and extensions for approvals, outbox, templates, cancellation, manual review, artifact lifecycle, retry/fencing, idempotency, and workflow state/event vocabulary. |
| Migration | `packages\db\migrations\0003_track_3_durable_workflows.sql`, `packages\db\migrations\meta\0003_snapshot.json`, `packages\db\migrations\meta\_journal.json` | Complete | Applies cleanly to a fresh disposable Postgres database and includes template-version immutability trigger enforcement. |
| DB invariant checks | `packages\db\src\check.ts` | Complete | Adds offline/database checks for Track 3 tables, constraints, idempotency operations, metadata-only storage posture, and existing-table Track 3 extensions. |
| Runtime contracts | `workers\agent-runtime\src\devgateway_agent_runtime\contracts.py` | Complete | Adds Track 3 contracts, nested retry-policy runtime shape, approval/outbox/cancellation/manual-review/artifact/template dataclasses, and safe state vocabulary bridges. |
| Runtime repository | `workers\agent-runtime\src\devgateway_agent_runtime\postgres_repository.py` | Complete | Adds Postgres-backed durable workflow operations with project scoping, lease fencing, idempotent replay validation, approval expiry, cancellation propagation, outbox delivery, artifact lifecycle, and template helpers. |
| Runtime helpers | `workers\agent-runtime\src\devgateway_agent_runtime\approvals.py`, `outbox.py`, `artifact_lifecycle.py`, `cancellation.py`, `retry.py`, `templates.py` | Complete | Pure fixture-safe helpers; no live provider calls or live dependency imports at module import time. |
| Runtime dispatcher | `workers\agent-runtime\src\devgateway_agent_runtime\dispatcher.py` | Complete | Checks cancellation before handler execution, fails closed on cancellation-check errors, and preserves fenced step completion behavior. |
| Control API approval routes | `apps\control-api\src\routes\approvals.ts` | Complete | Non-production approval list/read/approve/deny routes; approve/deny require explicit project scope and role/principal authorization. |
| Control API outbox routes | `apps\control-api\src\routes\outbox.ts` | Complete | Non-production outbox listing/status/read routes with metadata-only responses. |
| Control API artifact lifecycle routes | `apps\control-api\src\routes\artifacts.ts` | Complete | Adds lifecycle list/status and signed-access decision routes; never returns signed URLs or object bodies. |
| Control API template routes | `apps\control-api\src\routes\templates.ts` | Complete | Adds workflow-template/template-version listing and read routes with metadata-only response shape. |
| Shared Control API store/tests | `apps\control-api\src\routes\agent-workflow-store.ts`, `apps\control-api\src\routes\control-routes.test.ts` | Complete | Adds fixture state, visibility rules, policy pin checks, role-only approval support, artifact signed-access pin checks, and response sanitization tests. |
| Server mounting | `apps\control-api\src\server.ts` | Complete | Track 3 Control API routes are mounted outside production only; production remains fail-closed. |

## Key safety properties validated

| Property | Status | Evidence |
|---|---|---|
| Production fail-closed posture | Complete | Control API tests cover Track 3 route production-disabled responses; routes remain non-production only. |
| Metadata-only boundaries | Complete | Control API tests assert no raw payload bodies, object bodies, signed URLs, raw prompts/context, provider keys, API keys, access tokens, or refresh tokens in Track 3 responses. |
| Approval proof boundary | Complete | Runtime refuses to record `approved` approvals; approved decisions require Control API proof metadata. Control API blocks requester self-approval, stale policy pins, missing roles, missing project scope, and supports role-only approvals. |
| Project/tenant scoping | Complete | Runtime lookups and mutations are project-scoped; Control API mutations/read surfaces enforce principal/project visibility. Regression tests cover cross-principal/project denial and scoped mutation behavior. |
| Lease fencing | Complete | Runtime step and outbox mutations bind active lease id, owner, fencing token, project, expiry, and target resource before side effects. |
| Outbox retry safety | Complete | Stale `delivering` rows recover only when no valid active lease exists; exhausted rows dead-letter instead of retrying forever; ack/nack require `outbox:{outbox_id}` lease binding. |
| Cancellation safety | Complete | Cancellation records are project-scoped; completion and idempotency replays validate persisted records before returning. |
| Artifact lifecycle safety | Complete | Legal hold is computed from full locked history until explicit release; all post-terminal lifecycle events are rejected; signed-access decisions validate policy/registry pins and never return signed URLs. |
| Workflow template immutability | Complete | `workflow_template_version` mutation trigger rejects UPDATE/DELETE; DB checks verify trigger presence. |
| Retry contract alignment | Complete | JSON schema, shared TypeScript contract, Python runtime dataclasses, and retry decision logic align on nested `backoff_policy`, `timeout_policy`, and `failure_class_policies`. |

## Final model and security review log

| Finding | Source | Resolution |
|---|---|---|
| Outbox `delivering` rows could hang after stale lease recovery. | Gemini 3.1 Pro | Claim recovery now checks absence of a valid active lease, and exhausted recovered rows are dead-lettered. |
| Runtime lease/resource mutations were not consistently project-scoped. | Security review | Runtime workflow, step, artifact, event, cancellation, approval, lease, and outbox paths now enforce project scoping and fenced target binding. |
| Approval decisions did not enforce approver roles. | Security review | `ControlRouteAuthContext.roles` added; approve/deny require required roles and block requester self-approval. |
| Approval/cancellation runtime writes were not fully project-scoped. | Security review | Approval decision, approval reads, cancellation reads/completion, and replay fallbacks now require project-scoped matching. |
| Approval mutations were project-scoped but role-only policies were unreachable. | GPT-5.5 | Approval mutations now separate explicit project-scope existence from role/principal authorization; role-only regression added. |
| Outbox ack/nack lease fencing was not tied to the target outbox row. | GPT-5.5 | Ack/nack now require `lease.resource_id === outbox:{outbox_id}` and SQL binds `workflow_outbox.outbox_id` to the lease key. |
| Artifact legal hold and terminal lifecycle could be bypassed. | GPT-5.5 | Runtime computes effective legal hold from ordered history under lock and rejects all post-terminal lifecycle events. |
| Cancellation idempotency conflicts could return an uninserted record. | GPT-5.5 | Conflict handling fetches scoped persisted records and compares replay fields; mismatches raise. |
| Approval request creation lacked idempotent replay handling. | GPT-5.5 | Approval inserts use `ON CONFLICT DO NOTHING`; scoped replay fetch validates persisted request identity before returning. |
| Signed artifact access ignored requested policy/registry pins. | GPT-5.5 | Signed-access route compares requested pins to artifact and latest lifecycle pins before eligibility decisions. |
| Retry JSON schema and Python runtime shape diverged. | GPT-5.5, Gemini 3.1 Pro | Retry schema and runtime now use nested backoff/timeout/failure-class policies with compatibility shims and tests. |
| Final focused review of all remediations. | GPT-5.5, Claude Opus 4.8, Gemini 3.1 Pro, security review | All final reviews reported no remaining blocking/high-confidence issues. |

## Validation commands

| Command | Result | Notes |
|---|---|---|
| `pnpm --filter @devgateway/schemas check` | Pass | Validated 31 schema JSON files and catalog references. |
| `pnpm --filter @devgateway/db db:check:offline` | Pass | Offline structural checks pass, including Track 3 table/constraint/event/idempotency/template checks. |
| Disposable Postgres check: create fresh DB, set `DATABASE_CHECK_URL`, run `pnpm --filter @devgateway/db db:check:database`, then drop DB | Pass | Connected to disposable Postgres, applied committed migration SQL, and validated DB runtime invariants. |
| `pnpm --filter @devgateway/agent-runtime test` | Pass | Ran 231 Python runtime tests. |
| `pnpm --filter @devgateway/agent-runtime typecheck` | Pass | `python -m compileall -q src tests`. |
| `pnpm --filter @devgateway/agent-runtime build` | Pass | `python -m compileall -q src`. |
| `pnpm --filter @devgateway/control-api test` | Pass | Ran 102 Control API tests, including approval/outbox/artifact/template Track 3 routes and server foundation coverage. |
| `pnpm --filter @devgateway/control-api typecheck` | Pass | `tsc --noEmit`. |

## Local application and browser validation

| Evidence area | Result | Notes |
|---|---|---|
| Local Control API/admin portal startup | Pass | Local services were restarted on `127.0.0.1:43100` and `127.0.0.1:43101`; OpenAPI contained the new Track 3 paths after restart. |
| Browser `/trace` validation | Pass | Browser validation confirmed the trace UI renders the fail-closed auth state and does not expose forbidden raw/signed/secret strings. |
| Screenshot artifact | Captured | `C:\Users\v-mnmurugan\.copilot\session-state\384a9fe2-c231-43f7-89a5-e402d4faf7c6\files\track3-trace-ui.png` |

## Exit decision

Track 3 durable workflows and approvals are implemented for the non-production DevGateway foundation. Contracts, migrations, runtime repository logic, Control API surfaces, local/browser behavior, and final adversarial/model review gates have completed with no remaining blocking or high-confidence findings.
