# Track 3 - Durable Workflows and Approvals Implementation Plan

## 1. Executive summary

Track 3 builds the durable workflow and human-approval layer on top of the completed Track 2 agent orchestration foundation. The roadmap names Track 2 as **Agent orchestration foundation** and Track 3 as **Durable workflows and approvals**; the user request mentioned both, so this plan intentionally targets Track 3 rather than duplicating the existing Track 2 plan.

Track 2 is implemented in non-production foundation mode: schemas, operational tables, Control API task/workflow routes, fixture runtime, supervisor/sub-agent execution, budget reservation APIs, read-only Tool Broker, skill registry, trace UI, and Track 2 validation evidence exist. Track 3 must now convert the durable-runtime seams into enforced behavior: real Postgres-backed runtime execution, robust retries, lease fencing, cancellation execution, approval pause/resume, event outbox, object-storage artifact lifecycle, workflow templates, and long-running worker operation.

The independent reviews from Claude Opus 4.8, GPT-5.5, and Gemini 3.1 Pro converged on the same core risk: Track 2 has the contracts and table definitions, but durability is still mostly fixture/in-memory. Track 3 must not claim exit until crash/restart, approval resume, stuck-lease recovery, retry idempotency, outbox delivery, budget cleanup, and artifact lifecycle behavior are proven against real ephemeral Postgres and object storage adapters.

## 2. Source baseline

### 2.1 Track naming resolution

Authoritative roadmap scope:

| Track | Roadmap name | Roadmap build items |
|---|---|---|
| Track 2 | Agent orchestration foundation | Supervisor agent service, sub-agent executor, delegation schemas, task/artifact schemas, workflow runtime skeleton, task trace UI, read-only Tool Broker, skill registry skeleton. |
| Track 3 | Durable workflows and approvals | Retries, leases, idempotency, cancellation, approvals, event outbox, long-running background tasks, artifact storage, workflow templates. |

The separate plan file should therefore be this Track 3 document: `docs\impl-plan\track-3-durable-workflows-approvals.md`.

### 2.2 Completed Track 0 and Track 1 baseline

Track 0 is complete as a governance/setup phase and remains the safety baseline:

- Architecture and governance baseline are locked across `AI-Platform-Proposal.md`, `docs\01-system-architecture-and-interfaces.md`, `docs\02-agent-workflows-tools.md`, `docs\03-knowledge-retrieval-evaluation.md`, and `docs\04-technology-roadmap-operations.md`.
- Track 0 readiness validation records passing workspace, lint, typecheck, test, build, DB, registry, policy, and eval smoke gates.
- Track 0 governance exit is approved under `mnishanth02-track0-approval-2026-06-21`.
- Production model/tool/retrieval behavior remains separately gated and fail-closed.

Track 1 is implemented as a non-production gateway/control foundation:

- Control API exists with Fastify/OpenAPI and non-production virtual-key, budget, cost, registry, policy, and Bifrost configuration surfaces.
- Operational Postgres schema ownership exists in `packages\db`.
- Registry, policy, observability, cost, audit, and admin portal foundations exist.
- Gateway/model smoke, degraded-mode, and cache-scope evidence exist, but production provider routes and production model aliases remain disabled.

### 2.3 Completed Track 2 baseline

Track 2 is implemented in non-production foundation mode, with validation evidence in `docs\governance\track-2-validation-evidence.md`.

| Track 2 surface | Current state Track 3 can build on |
|---|---|
| Schemas/contracts | `packages\schemas\schemas\agent\*.schema.json` and `packages\shared-types\src\agent-workflow.ts` define workflow, agent, delegation, tool, skill, idempotency, artifact, and metadata-safety contracts. |
| Database schema | `packages\db\src\schema\operational.ts` defines `workflow_run`, `workflow_step`, `step_attempt`, `workflow_event`, `workflow_lease`, `workflow_idempotency_key`, `budget_reservation`, `task_artifact`, agent/delegation/tool/skill tables. |
| Control API | `apps\control-api\src\routes\tasks.ts`, `workflows.ts`, `artifacts.ts`, `agent-runs.ts`, `skills.ts`, and `budgets.ts` expose non-production workflow/task/budget metadata routes. |
| Runtime | `workers\agent-runtime\src\devgateway_agent_runtime\*` provides fixture-only contracts, in-memory repository, dispatcher, leases, idempotency, supervisor/sub-agent execution, and CLI smoke modes. |
| Tool Broker | `apps\tool-broker\src\server.ts` provides read-only discovery/call/MCP routes and deterministic denials for write/approval-bypass attempts. |
| Portal | `apps\admin-portal\src\app\routes\task-trace-view.tsx` and related feature files provide sanitized task trace UI. |
| Evals | `evals\datasets\agent-workflow.v0.1.json`, `tool-safety.v0.1.json`, and prompt-injection fixtures exist and run through fixture smoke. |

Track 2 formal production exit remains blocked by missing production-enabled model aliases, production Bifrost route evidence, and disposable DB-backed migration validation. Track 3 planning and non-production implementation can proceed, but production enablement still inherits those gates.

## 3. Model-review validation summary

| Reviewer | High-signal finding | Plan resolution |
|---|---|---|
| Claude Opus 4.8 | Track 3 needs real Postgres execution paths; `approval_request` and `workflow_outbox` are missing; `cancel_requested` has no consumer; stale lease recovery must distinguish idempotent vs non-idempotent work. | Make Postgres runtime repository, approval/outbox tables, cancellation executor, and manual-review lease recovery explicit early phases. |
| GPT-5.5 | Do not accept Track 3 until approval/outbox/state/API/schema gaps are closed and DB-backed durability is proven. | Add schema/API phases before runtime, then require ephemeral Postgres durability/eval gates. |
| Gemini 3.1 Pro | Crash-after-side-effect-before-commit, approval TTL, cancellation cleanup, artifact GC, template versioning, and outbox duplicate delivery are key edge cases. | Add side-effect idempotency/fencing, approval timeout policy, artifact lifecycle worker, immutable template versions, and idempotent outbox consumers. |

Consensus: Track 3 must be treated as the durability hardening track, not a documentation refresh. The critical acceptance threshold is real restart/resume behavior without duplicate billing, duplicate tool/model side effects, leaked artifacts, or approval bypass.

## 4. Track 3 scope

### 4.1 In scope

1. Versioned Track 3 schemas and shared types for approval requests, workflow outbox events, retry policies, cancellation records, workflow templates, object-storage artifact lifecycle, manual-review records, and worker runtime leases.
2. Operational database migrations for `approval_request`, `workflow_outbox`, workflow templates/versions, durable retry policy/attempt metadata, cancellation records, artifact lifecycle actions, and any missing append-only or uniqueness constraints.
3. Postgres-backed runtime repository for the Python agent runtime, replacing fixture-only in-memory execution for durability tests.
4. Transactional workflow step claim, heartbeat, completion, retry, pause, resume, cancellation, and outbox enqueue behavior.
5. Robust retry policies with retryable/permanent error classification, exponential backoff, max attempts, jitter, timeout handling, and manual-review fallback for non-idempotent work.
6. Lease fencing and stuck-lease recovery using active lease uniqueness, fencing tokens, heartbeat thresholds, and recovery sweepers.
7. Human approval gates with durable pause/resume, approver authorization, TTL/expiry, denial, cancellation, audit, and portal/API surfaces.
8. Full cancellation execution: observe cancellation requests, stop safe work, unwind pending work, release reservations, record partial state, and mark non-interruptible work for manual review.
9. Full event outbox for trace, audit, notification, eval-evidence, and portal update events.
10. Object-storage-backed artifact lifecycle with hash verification, retention, expiry, redaction, legal hold, signed access through Control API only, and garbage collection.
11. Workflow templates with immutable versions, allowed steps/tools/models/approvals/retries/cancellation policy, and eval-gate references.
12. Long-running worker service posture for local/Railway profiles, readiness, metrics, graceful shutdown, and stuck-work monitors.
13. Admin portal approval queue, retry/cancel controls, stuck workflow views, outbox/lease status, and artifact lifecycle status.
14. Durable workflow eval suites and chaos tests against real ephemeral Postgres and object-storage-compatible adapters.
15. Track 3 validation evidence and exit decision document.

### 4.2 Out of scope

1. Production provider-key onboarding or production model-route enablement unless Track 1 production gates are separately satisfied.
2. Track 4 retrieval foundation, GitHub connector, Knowledge Postgres, GraphRAG, memory service, or context-pack production serving.
3. Write-capable/external side-effect tools beyond approval-flow simulation and deterministic fail-closed policy wiring.
4. Visual DAG authoring, cron scheduling, high-throughput event streaming, cross-region orchestration, and multi-tenant SaaS isolation.
5. Migrating to Hatchet or Temporal in this track unless migration triggers are met; Track 3 must, however, evaluate the six-week durable-runtime time-box and keep repository interfaces portable.
6. Raw provider-key access by agents, workers, Tool Broker, or portal.

## 5. Current Track 3 gaps to close

| Gap | Current evidence | Track 3 requirement |
|---|---|---|
| Postgres runtime execution | Python runtime uses `InMemoryRuntimeRepository`; Control API uses `InMemoryAgentWorkflowStore`. | Build a Postgres repository adapter and run durability tests against it. |
| Approval persistence | Approval refs/policies exist in contracts, but no `approval_request` table/API/worker. | Add durable approval request lifecycle and fail-closed workflow enforcement. |
| Event outbox | `workflow_event` exists, but no delivery outbox or consumer state. | Add `workflow_outbox` and idempotent at-least-once delivery. |
| Cancellation execution | `POST /api/tasks/{task_id}/cancel` records a request only. | Workers must observe, unwind, release reservations, and terminalize or manual-review work. |
| Retry policy | `max_attempts` and attempt rows exist, but robust retry/backoff is not enforced. | Implement retry classification, backoff, and manual-review behavior. |
| Lease recovery | Basic in-memory stale lease recovery exists. | Add fencing tokens and non-idempotent manual-review handling in Postgres. |
| Artifact lifecycle | Metadata fields exist; no object-storage adapter, GC, legal-hold, or signed-access service. | Implement lifecycle workers and signed access through Control API. |
| Workflow templates | Skill metadata exists; no durable workflow template/version model. | Add immutable template definitions and instantiation. |
| Durability evals | Existing fixture suites are synthetic and non-production. | Add ephemeral Postgres chaos/durability suites. |

## 6. Functionality-by-functionality implementation plan

### 6.1 Contract and schema lock

Goal: make durable workflow behavior explicit before changing runtime state machines.

Targets:

- `packages\schemas\schemas\agent\approval-request.v0.1.schema.json`
- `packages\schemas\schemas\agent\workflow-outbox.v0.1.schema.json`
- `packages\schemas\schemas\agent\workflow-template.v0.1.schema.json`
- `packages\schemas\schemas\agent\retry-policy.v0.1.schema.json`
- `packages\schemas\schemas\agent\cancellation.v0.1.schema.json`
- `packages\schemas\schemas\agent\manual-review.v0.1.schema.json`
- `packages\schemas\schemas\agent\artifact-lifecycle.v0.1.schema.json`
- `packages\schemas\schemas\index.v0.1.json`
- `packages\shared-types\src\agent-workflow.ts`
- `packages\shared-types\src\gateway-control.ts`

Required decisions:

| Contract | Required fields and rules |
|---|---|
| Approval request | `approval_request_id`, workflow/step/delegation/tool refs, requester, approver policy, required role, risk tier, action summary artifact ref, expiry, state, decision refs, audit refs, trace/request IDs. |
| Retry policy | Retryable failure classes, max attempts, backoff type, initial/max delay, jitter, timeout policy, idempotency requirement, non-idempotent fallback behavior. |
| Cancellation record | Requester, reason, propagation state, target workflow/step/delegation/tool/model refs, cancellation deadline, budget-release refs, terminal/manual-review refs. |
| Workflow outbox | Outbox ID, source event ref, destination kind, payload artifact/ref, delivery state, attempt count, next attempt time, idempotency key, last failure ref. |
| Workflow template | Template ID/version, allowed step graph, required approval policies, retry/cancel policies, allowed agents/tools/model aliases, eval gate refs, rollout state, owner. |
| Manual-review record | Reason, non-idempotent side-effect refs, owner/role, blocking state, safe actions, audit refs, resolution state. |
| Artifact lifecycle | Storage URI, checksum, retention, legal hold, signed-access eligibility, redaction/expiry/deletion state, lifecycle audit refs. |

Acceptance criteria:

- New schemas are cataloged and pass schema validation.
- All new contracts reject raw prompts, raw context, raw artifact bodies, signed URLs, provider keys, bearer tokens, and secret-like fields.
- Existing Track 2 schemas remain backward-compatible or receive explicit new versions.
- Approval cannot be represented as approved unless backed by a trusted approval artifact, approver principal, policy version, and audit event.
- Retry policy cannot auto-retry non-idempotent operations without a manual-review policy.

### 6.2 Operational database migration

Goal: persist the missing Track 3 entities and harden existing Track 2 tables for real durability.

Targets:

- `packages\db\src\schema\operational.ts`
- `packages\db\src\schema\index.ts`
- `packages\db\migrations\*`
- `packages\db\src\check.ts`
- `packages\db\src\seeds\non-production-fixtures.ts`

Tables and extensions:

| Change | Purpose |
|---|---|
| Add `approval_request` | Durable human approval state with requester, approver policy, decision, expiry, audit, workflow refs, and fail-closed state. |
| Add `workflow_outbox` | Transactional event publication for trace/audit/notification/eval/portal updates. |
| Add `workflow_template` and `workflow_template_version` | Immutable workflow definitions and rollout/eval-gate metadata. |
| Add `workflow_cancellation` | Cancellation propagation, cleanup, terminalization, and budget-release evidence. |
| Add `manual_review_item` | Safe handling for non-idempotent side effects, stuck leases, ambiguous external calls, and partial artifact writes. |
| Add `artifact_lifecycle_event` | Retention, expiry, redaction, deletion, legal-hold, and signed-access lifecycle evidence. |
| Extend `workflow_run` | Add template version refs, pause/resume state, cancellation status, manual-review status, and durable runtime version. |
| Extend `workflow_step` and `step_attempt` | Add retry policy refs, retry schedule, failure class, next attempt time, replay decision, external request refs, and fencing token. |
| Extend `workflow_lease` | Enforce fencing-token behavior, manual-review status, recovery reason, and sweep evidence. |
| Extend `workflow_idempotency_key` | Add approval, outbox, cancellation, retry, reservation release, artifact lifecycle, and template instantiation operations. |
| Extend `workflow_event` | Add event types for approval requested/approved/denied/expired, retry scheduled/executed/exhausted, outbox enqueued/delivered/failed, cancellation observed/completed, manual review opened/resolved, artifact lifecycle changed. |

Integrity rules:

- `approval_request` decisions are append/audit-linked; approval mutation after terminal state is denied.
- `workflow_outbox` idempotency keys are unique by destination and source event.
- Workflow templates are immutable by version; active runs keep the template version they were instantiated from.
- A stuck non-idempotent attempt must become `manual_review`, not auto-requeued.
- Cancellation release/settlement rows must be idempotent and cannot double-release.
- Outbox delivery can be at-least-once, but consumers must be idempotent.
- Artifact deletion must respect legal hold and retention policy.

Acceptance criteria:

- Offline DB checks validate table presence, indexes, enum/check constraints, active lease uniqueness, outbox idempotency, approval terminal-state rules, and artifact lifecycle constraints.
- Database-backed migration check passes against a disposable Postgres URL before Track 3 exit.
- A migration rollback is not required, but forward-only recovery notes are documented.

### 6.3 Postgres-backed runtime repository

Goal: replace fixture-only runtime durability with a real repository implementation while preserving the SQL-free runtime business interface.

Targets:

- `workers\agent-runtime\src\devgateway_agent_runtime\repositories.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\postgres_repository.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\dispatcher.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\cli.py`
- `workers\agent-runtime\tests\*`
- `workers\agent-runtime\pyproject.toml` or package dependency configuration if a Postgres client is needed

Repository behavior:

1. Claim executable steps with `SELECT ... FOR UPDATE SKIP LOCKED` or an equivalent transactional claim.
2. Create a lease with a fencing token in the same transaction as the claim.
3. Persist step attempts before side effects.
4. Persist trace context before dispatch.
5. Require idempotency records before model calls, tool calls, budget reservations, outbox events, and artifact writes.
6. Complete attempts, release leases, settle budgets, and enqueue outbox events transactionally where possible.
7. Reconstruct runtime state after process restart from Postgres only.

Acceptance criteria:

- Fixture in-memory repository remains for unit tests, but Track 3 durability tests run against Postgres.
- Crash/restart test proves an in-progress workflow resumes from persisted state and does not restart from the beginning.
- No SQL details leak into supervisor/sub-agent planning logic.
- Repository supports graceful shutdown without orphaning leases that cannot be recovered or reviewed.

### 6.4 Retry policy and failure classification

Goal: make failed steps explainable and retryable without duplicate side effects or double billing.

Targets:

- `workers\agent-runtime\src\devgateway_agent_runtime\retry.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\dispatcher.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\contracts.py`
- `apps\control-api\src\routes\workflows.ts`
- `packages\shared-types\src\agent-workflow.ts`

Failure classes:

| Failure class | Default behavior |
|---|---|
| Transient provider/network timeout before external request accepted | Retry with backoff if idempotency reservation exists. |
| Bifrost/provider returned request ID but commit failed | Reconcile using provider/gateway request ID; do not blindly repeat. |
| Tool adapter transient failure before execution | Retry if tool policy marks operation idempotent/read-only. |
| Validation failure | Terminal failure or replan; no automatic identical retry. |
| Budget denial | Stop, replan within remaining budget, or request approval; no unreserved execution. |
| Policy denial | Terminal denied unless policy version changed through trusted update. |
| Non-idempotent/unknown side effect | Manual review. |
| Worker crash with active lease | Recover by fencing token and idempotency state. |

API behavior:

- `POST /api/workflows/{workflow_id}/retry` retries a terminal or failed step only when the caller is authorized and policy allows retry.
- Retry requests create audit events and idempotency records.
- Conflicting retry bodies with the same idempotency key are rejected.

Acceptance criteria:

- Retryable failure schedules retry with bounded exponential backoff and jitter.
- Non-idempotent side-effect ambiguity opens manual review instead of retrying.
- Retry exhaustion stores typed terminal failure evidence and remains visible in trace UI.
- Budget reservation, model/tool call, cost event, audit event, artifact write, and outbox publish cannot double-apply on retry.

### 6.5 Lease fencing and stuck-lease recovery

Goal: recover stuck work safely and within the first-release SLO without corrupting state.

Targets:

- `workers\agent-runtime\src\devgateway_agent_runtime\leases.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\lease_sweeper.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\dispatcher.py`
- `packages\db\src\schema\operational.ts`

Rules:

1. Every lease has a monotonically increasing fencing token.
2. Every state write from a worker must include the current fencing token.
3. Heartbeats extend lease expiry only for the current owner/token.
4. Expired leases are not automatically retried unless the latest attempt is idempotent or known pre-side-effect.
5. Ambiguous side-effect state opens manual review.
6. Stuck lease recovery emits workflow events, audit refs, and outbox events.

Acceptance criteria:

- A stale worker cannot write after a newer fencing token owns the work.
- Stuck leases are recovered or marked manual review within 5 minutes in tests.
- Lease recovery preserves enough evidence for trace UI: owner, token, expiry, last heartbeat, recovery decision, and next action.

### 6.6 Cancellation execution

Goal: turn Track 2's cancellation request recording into safe cancellation behavior.

Targets:

- `apps\control-api\src\routes\tasks.ts`
- `apps\control-api\src\routes\workflows.ts`
- `workers\agent-runtime\src\devgateway_agent_runtime\cancellation.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\dispatcher.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\executor.py`
- `apps\tool-broker\src\server.ts`

Flow:

1. User/admin requests cancellation through Control API.
2. Control API records `workflow_cancellation` and `cancel_requested` event with audit refs.
3. Dispatcher checks cancellation before claiming, before side effects, between streaming chunks where supported, and before synthesis.
4. Pending steps/delegations/tool calls are marked cancelled.
5. Active model/tool calls receive best-effort abort if supported by adapter.
6. Reserved but unused budgets are released.
7. Completed side effects are preserved with audit evidence, not rolled back silently.
8. Ambiguous non-idempotent in-flight work becomes manual review.
9. Workflow terminalizes as `cancelled`, `failed`, or `manual_review_required`.

Acceptance criteria:

- Cancellation of queued workflow is immediate and releases reservations.
- Cancellation of running workflow stops future steps and attempts best-effort active abort.
- Cancellation during approval wait terminalizes the approval request.
- Cancellation during outbox delivery does not lose already-enqueued audit/trace events.
- Cancellation response remains sanitized and never exposes raw prompts/artifacts/provider keys.

### 6.7 Human approval gates

Goal: pause workflows durably for human decisions and resume safely.

Targets:

- `apps\control-api\src\routes\approvals.ts`
- `apps\control-api\src\server.ts`
- `apps\control-api\src\openapi\document.ts`
- `workers\agent-runtime\src\devgateway_agent_runtime\approvals.py`
- `packages\policy\src\*`
- `apps\admin-portal\src\app\routes\*`
- `apps\admin-portal\src\features\control-api-client.ts`

Endpoints:

| Endpoint | Behavior |
|---|---|
| `GET /api/approvals` | Lists pending/decided approvals visible to caller by principal/project/role. |
| `GET /api/approvals/{approval_request_id}` | Returns sanitized approval context and artifact metadata. |
| `POST /api/approvals/{approval_request_id}/approve` | Records trusted approval decision if caller is authorized and approval is pending/unexpired. |
| `POST /api/approvals/{approval_request_id}/deny` | Records denial with reason and resumes/fails workflow according to policy. |
| `POST /api/approvals/{approval_request_id}/expire` | Internal/system path for TTL expiry. |

Approval rules:

- Model-supplied approval claims are ignored.
- Approval decisions require Better Auth admin/developer session or scoped service token with explicit role.
- Approval context uses artifact refs and summaries, not raw unrestricted payloads.
- Expired approvals fail closed.
- Approval decisions are immutable terminal records linked to audit events.
- Approval of write/external/dangerous actions remains out of production until tool policy and eval gates allow those actions.

Acceptance criteria:

- Workflow enters `waiting_for_approval` and releases worker lease while preserving resume token.
- Approval resumes exactly once and only from the persisted workflow state.
- Denial/expiry/cancellation follow deterministic terminal or replanning policy.
- Portal approval queue shows required action, requester, risk tier, expiry, sanitized artifacts, and audit trail.
- Prompt-injection fixtures prove text cannot create or satisfy approval.

### 6.8 Event outbox and notifications

Goal: make workflow-side effects observable and deliverable without losing events on process crash.

Targets:

- `packages\db\src\schema\operational.ts`
- `workers\agent-runtime\src\devgateway_agent_runtime\outbox.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\outbox_worker.py`
- `packages\observability\src\index.ts`
- `apps\control-api\src\routes\workflows.ts`

Outbox destinations:

- Trace event stream.
- Audit sink.
- Portal notification/update stream.
- Eval evidence writer.
- Optional future webhook/Slack/email integrations, disabled by default.

Delivery rules:

- Enqueue outbox records in the same transaction as workflow state changes.
- Use idempotency key per destination and source event.
- Support at-least-once delivery with idempotent consumers.
- Failed delivery retries with backoff and then manual review/dead-letter state.
- Audit-critical outbox failures fail closed for production behavior.

Acceptance criteria:

- Crash after state update but before delivery does not lose event.
- Delivery retry does not duplicate trace/audit/notification effects.
- Outbox backlog and failure state are visible through Control API and portal.

### 6.9 Artifact storage and lifecycle

Goal: move from metadata-only artifact records to governed object-storage lifecycle behavior.

Targets:

- `apps\control-api\src\routes\artifacts.ts`
- `workers\agent-runtime\src\devgateway_agent_runtime\artifacts.py`
- `packages\config\src\*`
- `infra\railway\variable-matrix.md`
- `infra\runbooks\backup-restore-plan.md`
- `apps\admin-portal\src\features\operational-views.ts`

Behavior:

1. Store large artifact bodies in S3-compatible object storage.
2. Persist only metadata, hashes, object refs, retention, sensitivity, and ACL scopes in Postgres.
3. Verify hash after write and before signed access.
4. Generate signed access only through Control API after auth/ACL checks.
5. Apply retention, expiry, redaction, deletion, and legal hold through lifecycle worker.
6. Reconcile artifact metadata when object write succeeds but DB commit/outbox delivery fails.
7. Record lifecycle events and audit refs.

Acceptance criteria:

- No large artifact payloads are stored in Postgres.
- Restricted/confidential artifact access is denied unless caller scope matches.
- Expired/deleted/redacted artifacts cannot be signed or displayed.
- Orphaned object and orphaned metadata reconciliation is tested.
- Backup/restore plan covers artifact metadata and object storage recovery expectations.

### 6.10 Workflow templates

Goal: make durable workflows reproducible, versioned, gated, and safe to evolve.

Targets:

- `packages\registry\registry\workflow-templates.v0.1.json` or DB-backed template seed.
- `packages\registry\src\*`
- `packages\schemas\schemas\agent\workflow-template.v0.1.schema.json`
- `apps\control-api\src\routes\workflows.ts`
- `apps\control-api\src\routes\tasks.ts`
- `workers\agent-runtime\src\devgateway_agent_runtime\templates.py`

Template fields:

- Template ID and immutable version.
- Owner and rollout status.
- Allowed workflow states and step graph.
- Allowed agents, skills, tool refs, model aliases, and data classes.
- Approval policies by risk tier/action.
- Retry, timeout, cancellation, and manual-review policies.
- Budget policy defaults and max caps.
- Eval suite and gate refs.
- Artifact retention defaults.

Acceptance criteria:

- Task creation instantiates a specific template version and stores that version on the workflow run.
- Updating a template creates a new version and does not mutate active workflows.
- Template validation fails on unknown tools/models/schemas, production rollout without gate evidence, or approval policy gaps.

### 6.11 Long-running worker service posture

Goal: make runtime workers operable as long-running services while preserving local development safety.

Targets:

- `workers\agent-runtime\src\devgateway_agent_runtime\cli.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\service.py`
- `scripts\devgateway-dev.mjs`
- `infra\railway\service-matrix.md`
- `infra\railway\variable-matrix.md`
- `infra\runbooks\production-runbook-backlog.md`

Service capabilities:

- Worker profiles: dispatcher, lease sweeper, approval expiry worker, outbox worker, artifact lifecycle worker.
- Readiness checks for DB, object storage, registry/policy freshness, and audit sink.
- Graceful shutdown that stops claiming new work, heartbeats/finishes safe in-flight work, and releases/marks leases.
- Metrics for queue depth, lease age, stuck lease count, retry count, approval wait time, outbox backlog, artifact lifecycle failures, cancellation latency.
- Fail-closed production mode if audit, policy, registry, or DB durability is unavailable.

Acceptance criteria:

- `pnpm local:dev` can start the worker profile in non-production mode.
- Worker shutdown/restart smoke proves no lost workflow state.
- Readiness fails if required durable dependencies are missing in production-like mode.

### 6.12 Control API and portal surfaces

Goal: expose durable workflow controls and visibility without direct DB access.

Targets:

- `apps\control-api\src\routes\approvals.ts`
- `apps\control-api\src\routes\workflows.ts`
- `apps\control-api\src\routes\tasks.ts`
- `apps\control-api\src\routes\artifacts.ts`
- `apps\control-api\src\openapi\document.ts`
- `apps\admin-portal\src\features\control-api-client.ts`
- `apps\admin-portal\src\features\operational-views.ts`
- `apps\admin-portal\src\app\routes\task-trace-view.tsx`
- `apps\admin-portal\src\app\routes\operations-home.tsx`
- `apps\admin-portal\src\styles\portal.css`

Control API additions:

- Approval list/detail/approve/deny/expire routes.
- Workflow retry route.
- Workflow manual-review detail/resolve route.
- Outbox status route.
- Lease/stuck-work status route.
- Artifact signed-access request route.
- Workflow template list/detail route.

Portal additions:

- Approval queue and decision panel.
- Retry/cancel/manual-review controls.
- Stuck lease and worker status panel.
- Outbox delivery/backlog panel.
- Artifact lifecycle and signed-access status.
- Template version and policy summary in task trace.

Acceptance criteria:

- UI calls Control API only.
- All mutation routes require auth, role checks, policy/registry freshness, idempotency keys, and audit.
- Portal never renders raw prompts, raw artifact bodies, signed URLs, tokens, provider keys, or secret-like metadata.

### 6.13 Budget cleanup and long-wait accounting

Goal: prevent orphaned reservations and stale cost state across retries, cancellations, approvals, and crashes.

Targets:

- `apps\control-api\src\routes\budgets.ts`
- `packages\observability\src\cost.ts`
- `workers\agent-runtime\src\devgateway_agent_runtime\budget_reaper.py`
- `packages\db\src\schema\operational.ts`

Rules:

- Workflow/delegation/tool reservations have explicit lease/expiry semantics.
- Approval waits can hold a reservation only up to a configured TTL; then release or re-estimate on resume.
- Cancellation releases unused reservations.
- Retry uses existing reservation only when policy allows; otherwise it reserves anew and links attempts.
- Orphaned reservations are detected and reconciled by a reaper with audit events.

Acceptance criteria:

- Worker crash cannot leave reservations permanently pending without detection.
- Settlement/release replay with conflicting body is rejected.
- Portal can show held, released, settled, orphaned, and reconciled budget states.

### 6.14 Eval, chaos, and validation expansion

Goal: make Track 3 exit criteria executable and regression-safe.

Targets:

- `evals\datasets\durable-workflow.v0.1.json`
- `evals\fixtures\durable-workflow\*.json`
- `evals\datasets\approval-gates.v0.1.json`
- `evals\fixtures\approval-gates\*.json`
- `evals\datasets\workflow-outbox.v0.1.json`
- `evals\fixtures\workflow-outbox\*.json`
- `scripts\eval-smoke.mjs`
- `workers\eval-runner\src\devgateway_eval_runner\cli.py`
- `docs\governance\track-3-validation-evidence.md`

Required test suites:

| Suite | Required cases |
|---|---|
| Durable workflow | Process restart after claim, after model/tool response, after DB commit, before outbox delivery; resume without duplicate side effects. |
| Lease recovery | Stale lease reclaims idempotent pre-side-effect work; ambiguous non-idempotent work opens manual review; stale worker write rejected by fencing token. |
| Retry policy | Transient retry, terminal validation failure, retry exhaustion, backoff scheduling, conflicting idempotency replay denial. |
| Cancellation | Queued cancellation, running cancellation, approval-wait cancellation, cancellation during outbox delivery, budget release. |
| Approvals | Approval required pause, authorized approve, unauthorized deny, expiry fail-closed, model-claimed approval ignored, denial resumes/fails deterministically. |
| Outbox | At-least-once delivery, duplicate delivery idempotency, dead-letter/manual-review after repeated failures. |
| Artifact lifecycle | Object write/DB commit split-brain reconciliation, signed access ACL denial, expiry/redaction/legal-hold behavior. |
| Budget lifecycle | Orphaned reservation reaper, long approval wait release/re-estimate, retry settlement without double billing. |
| Template versioning | New task binds immutable template version; template update does not mutate active workflow. |

Validation commands:

| Command | Track 3 expectation |
|---|---|
| `pnpm workspace:validate` | Root tooling, schema catalog, eval layout, and generated artifacts remain valid. |
| `pnpm --filter @devgateway/schemas check` | New Track 3 schemas are cataloged and validate. |
| `pnpm --filter @devgateway/db typecheck` | Drizzle schema/check changes typecheck. |
| `pnpm --filter @devgateway/db db:check:offline` | Structural checks for Track 3 tables and invariants pass. |
| `pnpm --filter @devgateway/db db:check:database` | Disposable Postgres migration/invariant checks pass before exit. |
| `pnpm --filter @devgateway/control-api typecheck` and `test` | Approval/retry/cancel/artifact/template/outbox routes and auth/ACL behavior pass. |
| `pnpm --filter @devgateway/agent-runtime typecheck` and `test` | Runtime service, Postgres repository, retry, cancellation, approval, lease, outbox, artifact workers pass. |
| `pnpm --filter @devgateway/admin-portal typecheck` and `test` | Approval queue, retry/cancel controls, and trace panels pass. |
| `pnpm eval:smoke` | Track 3 fixture suites are included or a documented Track 3 smoke command runs them. |
| Ephemeral Postgres chaos command | Process-kill/restart, stuck lease, outbox, and approval resume tests run against real Postgres. |

## 7. Implementation phases

### Phase 3.0 - Readiness checkpoint

Deliverables:

1. Confirm this Track 3 plan is the source plan and Track 2 will not be duplicated.
2. Confirm Track 0 approval record remains valid.
3. Confirm Track 1 and Track 2 production gates remain disabled/fail-closed.
4. Define Track 3 as non-production implementation until database-backed durability, object storage, approvals, and production alias dependencies pass.

Acceptance criteria:

- No production model/tool/retrieval/approval/write-tool path is enabled by planning.
- Track 3 blockers are recorded in the validation evidence document.

### Phase 3.1 - Contract and schema lock

Deliverables:

1. Approval, outbox, retry, cancellation, template, manual-review, and artifact-lifecycle schemas.
2. Shared TypeScript/Python contract updates.
3. Negative fixtures for forged approvals, missing approver, unknown template version, non-idempotent auto-retry, raw secret metadata, and signed URL leakage.

Acceptance criteria:

- Schema catalog passes.
- Existing Track 2 contract tests remain green.
- Approval and outbox state cannot be represented without required audit/trace/policy refs.

### Phase 3.2 - Database migration and invariant checks

Deliverables:

1. Track 3 tables and table extensions.
2. Forward-only migration.
3. Offline DB invariant checks.
4. Disposable Postgres migration/invariant check path.
5. Non-production fixture seed updates.

Acceptance criteria:

- Migration applies cleanly to ephemeral Postgres.
- DB checks validate approval/outbox/template/retry/cancellation/artifact invariants.
- Event/outbox/idempotency uniqueness is enforced mechanically.

### Phase 3.3 - Postgres runtime repository

Deliverables:

1. Postgres repository adapter.
2. Transactional claim/heartbeat/complete/retry/pause/resume APIs behind repository interface.
3. Ephemeral Postgres test harness.
4. CLI/service profile for DB-backed worker smoke.

Acceptance criteria:

- Runtime can complete a simple workflow using Postgres only.
- Process restart resumes from persisted state.
- In-memory repository remains fixture-only and cannot satisfy Track 3 exit.

### Phase 3.4 - Retry and lease hardening

Deliverables:

1. Retry policy evaluator.
2. Backoff scheduler.
3. Lease fencing writes.
4. Stuck-lease sweeper.
5. Manual-review fallback for ambiguous work.

Acceptance criteria:

- Stuck lease recovery test passes.
- Stale worker writes are rejected.
- Failed steps are explainable and retryable according to policy.

### Phase 3.5 - Cancellation execution

Deliverables:

1. Cancellation propagation worker.
2. Dispatcher and executor cancellation checkpoints.
3. Budget release on cancellation.
4. Tool/model abort hooks where supported.
5. Cancellation trace/portal evidence.

Acceptance criteria:

- Queued/running/waiting workflows cancel safely.
- Non-interruptible or ambiguous work becomes manual review.
- No double settlement or hidden side effects occur.

### Phase 3.6 - Human approvals

Deliverables:

1. `approval_request` lifecycle repository and Control API routes.
2. Approval wait/resume worker behavior.
3. Approval TTL expiry worker.
4. Portal approval queue and decision UI.
5. Policy evaluator updates for approver roles and risk tiers.

Acceptance criteria:

- Workflow pauses/resumes safely.
- Unauthorized or model-claimed approval fails closed.
- Approval expiry and denial are deterministic and audited.

### Phase 3.7 - Event outbox

Deliverables:

1. Outbox enqueue in workflow transactions.
2. Outbox delivery worker with retry/dead-letter/manual-review behavior.
3. Idempotent consumers for trace/audit/portal/eval destinations.
4. Outbox backlog observability.

Acceptance criteria:

- State change and outbox enqueue are atomic.
- Crash before delivery does not lose events.
- Duplicate delivery is harmless.

### Phase 3.8 - Artifact lifecycle

Deliverables:

1. Object-storage adapter.
2. Artifact write/read/signing API through Control API.
3. Lifecycle worker for retention/expiry/redaction/deletion/legal hold.
4. Orphan reconciliation.
5. Portal artifact lifecycle display.

Acceptance criteria:

- Artifact body storage is object-storage-backed.
- Signed access is ACL-safe and short-lived.
- Lifecycle events are audited and recoverable.

### Phase 3.9 - Workflow templates

Deliverables:

1. Template and template-version persistence.
2. Template validation.
3. Task creation from template version.
4. Template visibility in Control API and portal.
5. Gate/rollout checks.

Acceptance criteria:

- Active workflow runs are pinned to immutable template versions.
- Template rollout cannot become production without gate refs.

### Phase 3.10 - Long-running worker service and operations

Deliverables:

1. Worker service command/profile.
2. Local launcher integration.
3. Railway service/variable matrix updates.
4. Runbook updates for stuck leases, approvals, outbox backlog, artifact lifecycle failures, and restore.
5. Metrics and readiness checks.

Acceptance criteria:

- Local worker starts and reports readiness.
- Production-like mode fails closed when DB/audit/policy/registry/object storage is missing.
- Operational runbooks cover common failure modes.

### Phase 3.11 - Evals, chaos validation, and exit review

Deliverables:

1. Durable workflow and approval eval suites.
2. Ephemeral Postgres chaos/restart tests.
3. Browser/portal validation for approval and stuck workflow UI.
4. Model/security/adversarial review.
5. `docs\governance\track-3-validation-evidence.md`.
6. Formal exit decision or blocker list.

Acceptance criteria:

- Workflow survives process restart.
- Approval pauses/resumes safely.
- Failed steps are explainable and retryable.
- Stuck lease recovery passes.
- Cancellation, outbox delivery, artifact lifecycle, and template versioning gates pass.
- Remaining production blockers are explicit and fail-closed.

## 8. Dependency order and parallelization

Strict order:

1. Phase 3.0 readiness checkpoint.
2. Phase 3.1 schema/contract lock.
3. Phase 3.2 DB migration and invariants.
4. Phase 3.3 Postgres runtime repository.

Parallel-safe after Phase 3.2:

- Approval API/portal shell can proceed once approval schema is locked.
- Outbox worker can proceed once outbox table/schema exists.
- Artifact storage adapter can proceed once artifact lifecycle schema is locked.
- Template registry/API can proceed once template schema is locked.
- Evals/fixtures can proceed as soon as contracts are stable.
- Lease/retry/cancellation work can proceed in parallel after repository claim/attempt APIs are stable.

Final integration order:

1. Runtime repository.
2. Retry/lease hardening.
3. Cancellation.
4. Approvals.
5. Outbox.
6. Artifact lifecycle.
7. Templates.
8. Portal and operations.
9. Evals and exit validation.

## 9. Track 3 exit criteria

Track 3 exits only when all criteria below pass:

1. Track 0 governance approval remains recorded and production capability remains separately gated.
2. Track 1/2 production blockers are still fail-closed or explicitly resolved by separate evidence.
3. Workflow state survives worker process restart using Postgres-backed runtime state.
4. Approval request pauses workflow durably and releases worker lease.
5. Approval decision resumes exactly once when authorized, unexpired, and audited.
6. Approval denial/expiry/cancellation fail closed according to policy.
7. Failed retryable steps are explainable and retryable with bounded backoff.
8. Non-idempotent or ambiguous side effects open manual review instead of auto-retry.
9. Stuck lease recovery test passes and stale worker writes are fenced off.
10. Cancellation execution stops queued/future work, best-effort aborts active work, releases unused reservations, and preserves audit evidence.
11. Workflow outbox delivers trace/audit/portal/eval events idempotently and survives crash before delivery.
12. Artifact lifecycle uses object storage for bodies, enforces ACL/signed-access/retention/legal-hold rules, and reconciles orphaned writes.
13. Workflow templates are immutable by version and active runs remain pinned to their original template version.
14. Long-running worker service readiness, shutdown, metrics, and runbooks are in place.
15. Durable workflow, approval, retry, lease, cancellation, outbox, artifact, budget, template, and prompt-injection eval suites pass.
16. No raw prompts, raw artifact bodies, provider keys, raw virtual keys, signed URLs, tokens, or secret fields are exposed in logs, portal, APIs, outbox payloads, or metadata.
17. Database-backed migration/invariant validation passes against disposable Postgres.
18. Track 3 validation evidence records commands, chaos tests, model reviews, browser checks, and any remaining production blockers.

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| In-memory durability gap persists | Track 3 could falsely claim durable behavior. | Require Postgres-backed execution and ephemeral Postgres chaos tests before exit. |
| Crash after external side effect before DB commit | Duplicate model/tool calls or double billing. | Store idempotency refs and provider/gateway request IDs before/with dispatch; reconcile ambiguous states through manual review. |
| Approval bypass | Model text or stale refs could authorize unsafe action. | Trusted Control API approval records only; expire approvals; verify approver roles and policy versions. |
| Stale worker writes after lease recovery | Corrupted workflow state. | Enforce fencing tokens on all worker writes. |
| Auto-retry of non-idempotent work | Duplicate side effects. | Retry classifier and manual-review fallback. |
| Outbox duplicate delivery | Duplicate notifications or audit writes. | At-least-once outbox plus idempotent destination keys. |
| Orphaned reservations | Budget locked or inaccurate spend. | Budget reaper, expiry semantics, cancellation release, and reconciliation events. |
| Artifact leakage | Sensitive data exposed via signed URLs or portal. | Control API-only signed access, sensitivity/ACL checks, short TTLs, redaction/expiry/legal-hold enforcement. |
| Template mutation drift | Active workflows change behavior mid-flight. | Immutable template versions stored on workflow runs. |
| Runtime scope exceeds six-week time-box | Custom runtime becomes too complex. | Track migration triggers from `docs\02-agent-workflows-tools.md`; revisit Hatchet/Temporal if durable tests miss time-box or complexity thresholds. |
| Production gates remain blocked | Track 3 implementation may complete but production release cannot. | Separate non-production Track 3 implementation completion from formal production release blockers. |

## 11. Open decisions before implementation

1. Which Postgres client/library should the Python runtime use for async worker claims and tests?
2. Should the first Track 3 object-storage adapter target MinIO local S3 compatibility only, Railway Object Storage, or both behind the same interface?
3. What is the default approval TTL by risk tier for internal rollout?
4. Which actions are allowed to pause for approval in Track 3 while write/external side-effect tools remain production-disabled?
5. What manual-review owner role receives stuck non-idempotent workflow items?
6. What exact command should become the Track 3 ephemeral Postgres chaos gate?
7. At what date or implementation-week count should the Hatchet/Temporal migration trigger be evaluated for this track?

## 12. Planning review sources

Primary repository sources reviewed:

- `docs\04-technology-roadmap-operations.md`
- `docs\02-agent-workflows-tools.md`
- `docs\impl-plan\track-0-architecture-lock-implementation-setup.md`
- `docs\impl-plan\track-1-gateway-control-foundation.md`
- `docs\impl-plan\track-2-agent-orchestration-foundation.md`
- `docs\governance\track-0-readiness-validation.md`
- `docs\governance\track-1-validation-evidence.md`
- `docs\governance\track-2-validation-evidence.md`
- `apps\control-api\src\routes\tasks.ts`
- `apps\control-api\src\routes\workflows.ts`
- `apps\control-api\src\routes\agent-workflow-store.ts`
- `apps\tool-broker\src\server.ts`
- `apps\admin-portal\src\app\routes\task-trace-view.tsx`
- `workers\agent-runtime\src\devgateway_agent_runtime\contracts.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\dispatcher.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\memory.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\leases.py`
- `workers\agent-runtime\src\devgateway_agent_runtime\idempotency.py`
- `packages\db\src\schema\operational.ts`
- `packages\shared-types\src\agent-workflow.ts`
- `evals\datasets\agent-workflow.v0.1.json`
- `evals\datasets\tool-safety.v0.1.json`

Independent planning/review inputs:

- Claude Opus 4.8 Track 3 review.
- GPT-5.5 Track 3 review.
- Gemini 3.1 Pro Track 3 review.
