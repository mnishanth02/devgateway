# 02 - Agent Workflows, Tools, and Skills

## Goal

Enable a primary agent to delegate work to specialized sub-agents and tools while preserving state,
budget, policy, provenance, and human control.

## Runtime split

| Layer | Final decision |
|---|---|
| Model/provider execution | Bifrost model aliases. |
| Durable workflow runtime | Custom Postgres-backed runtime for the first production release. |
| Workflow migration target | Hatchet OSS for simpler task orchestration or Temporal OSS for complex durable execution when migration triggers are met. |
| Agent graph implementation | Custom orchestrator using explicit workflow states and delegation records. |
| Tool execution | Platform Tool Broker owns policy, approvals, sandboxing, durable tool state, and external MCP. |
| Agent memory | Governed Memory Service backed by platform stores and retrieval. |
| Messaging | Postgres-backed task mailbox with `SKIP LOCKED` workers; Redis supports locks and short-lived queues. |

## Agent roles

| Agent | Responsibility | Model alias |
|---|---|---|
| Supervisor | Task decomposition, delegation, synthesis, user interaction, policy-aware planning. | `devgateway/orchestrator` |
| Reasoning specialist | Complex plans, trade-off analysis, architecture review. | `devgateway/deep-reasoning` |
| Code review specialist | Review diffs, find bugs/security issues, propose fixes. | `devgateway/code-review` |
| Large-context analyst | Analyze large docs/repos/context packs and summarize. | `devgateway/large-context` |
| Fast executor | Cheap high-volume code/document tasks. | `devgateway/fast` |
| Retrieval planner | Query decomposition, source selection, context-pack construction. | `devgateway/retrieval-planner` |
| Tool executor | Runs approved deterministic tools. | Non-LLM worker where possible |

Concrete provider/model candidates live only in the model registry in `docs\04-technology-roadmap-operations.md`.

## Delegation contract

Every sub-agent delegation is structured and versioned:

```json
{
  "delegation_id": "del_123",
  "parent_agent_run_id": "run_456",
  "task_type": "code_review",
  "model_alias": "devgateway/code-review",
  "input_context_refs": ["artifact://diff/789", "knowledge://repo-map/api"],
  "allowed_tools": ["repo.read", "tests.run.readonly"],
  "disallowed_tools": ["filesystem.write", "network.external"],
  "budget": { "max_input_tokens": 250000, "max_output_tokens": 20000, "max_cost_usd": 1.50 },
  "timeout_seconds": 900,
  "output_schema": "schemas/agent/code_review_result.v1.json",
  "approval_policy": "auto_read_only_human_for_write",
  "provenance_required": true
}
```

Schemas are stored in the implementation repository under `schemas\agent\`, versioned with semantic
suffixes, and validated before a sub-agent result can be synthesized.

## Workflow runtime v1 scope

The first release runtime includes:

- Postgres tables for `workflow_run`, `workflow_step`, `step_attempt`, `approval_request`, `workflow_event`, `workflow_outbox`, and `workflow_lease`.
- Worker dispatch through Postgres `SKIP LOCKED`.
- Idempotency keys for every step, tool call, provider call, and artifact write.
- Lease/heartbeat-based worker recovery.
- Retry policy with max attempts, exponential backoff, timeout, and typed terminal failure.
- Durable approval waits represented as database state.
- Cancellation from portal/API/MCP.
- Event outbox for notifications and trace emission.
- Artifact references stored durably with object-storage backing.
- Restart/resume test suite before production enablement.

The first release runtime excludes visual DAG authoring, cron scheduling, cross-region workers,
multi-tenant SaaS isolation, and high-throughput event streaming.

## Workflow migration triggers

The custom runtime remains valid only while it stays small and reliable. Migration to Hatchet OSS or
Temporal OSS is mandatory when any one of these conditions is met:

| Trigger | Threshold |
|---|---|
| Build time-box missed | Restart/resume, approval pause/resume, cancellation, and retry tests are not passing within six implementation weeks. |
| Workflow complexity | More than 20 workflow definitions or more than 50 distinct step types are required. |
| Throughput | More than 10,000 workflow steps/day for two consecutive weeks. |
| Reliability | Workflow timeout, stuck lease, or resume-after-restart SLO is breached in two production incidents. |
| Worker model | Cross-language worker orchestration becomes a hard product requirement. |
| Visibility | Debugging workflow state requires a dedicated workflow UI beyond the platform trace view. |

Hatchet OSS is the migration target for task/workflow simplicity. Temporal OSS is the target for
complex durable execution, long-running timers, and mature workflow visibility.

## Workflow states

| State | Meaning |
|---|---|
| `created` | Task accepted and persisted. |
| `planning` | Supervisor is decomposing task and requesting context. |
| `waiting_for_context` | Retrieval/index/tool preconditions are pending. |
| `delegating` | Sub-agent tasks are being created. |
| `running` | One or more workflow steps are executing. |
| `waiting_for_approval` | Human action is required. |
| `cancel_requested` | Cancellation was requested and workers are unwinding safely. |
| `synthesizing` | Parent agent is merging outputs. |
| `completed` | Final result was produced and stored. |
| `failed` | Terminal failure with typed cause. |
| `cancelled` | Workflow was cancelled by user/admin/system policy. |

## Budget enforcement

Bifrost budgets are virtual-key scoped; workflow budgets require platform-level accounting:

1. Reserve budget at workflow level before sub-agent creation.
2. Allocate budget to each delegation and tool class.
3. Estimate spend before each model/tool call using model registry pricing and token counts.
4. Execute provider calls through the correct Bifrost model alias.
5. Settle actual spend after Bifrost returns usage.
6. Stop, replan, or request approval when reserved budget is exhausted.
7. Record spend by workflow, delegation, model alias, provider, tool, project, and user.

## Model adapter contract

Each model alias declares:

- supported wire format
- tool-call mode and schema dialect
- structured-output mode and validation strategy
- context and output limits
- tokenizer/counting source
- streaming behavior
- citation/provenance requirements
- fallback-compatible aliases
- provider data-policy constraints
- eval gate status
- lifecycle status

## Tool and MCP policy

### Risk tiers

| Tier | Examples | Policy |
|---|---|---|
| Read-only | repo search, docs lookup, issue read, dependency map. | Auto-approve within scoped projects. |
| Low-risk write | draft docs, create branch artifact, format generated content. | Auto or human approval by project policy. |
| Code-changing | apply patch, run tests with writes, generate migration files. | Human approval or trusted developer mode. |
| External side effect | send Slack/email, create ticket, deploy, mutate DB. | Human approval, audit, allowlist, and sandbox policy. |
| Dangerous | delete data, rotate secrets, production deploy. | Admin approval and break-glass controls. |

### Sandbox levels

- **No sandbox needed:** pure retrieval, summarization, static planning.
- **Read-only workspace:** code search, static analysis, dependency map.
- **Ephemeral worktree:** patch generation, tests, linting, temporary artifacts.
- **Network-isolated sandbox:** untrusted code execution and model-generated scripts.
- **Privileged operator:** rare, human-approved infrastructure actions.

## Skills model

A skill is a versioned bundle of prompts, tools, MCP servers, model aliases, eval suites, input/output
schemas, rollout status, and approval policies. Skills are deployable policy-controlled units.

Representative fields:

- `skill_definition`
- `skill_version`
- `allowed_model_aliases`
- `tool_bundle`
- `prompt_templates`
- `input_schema`
- `output_schema`
- `approval_policy`
- `eval_suite`
- `owner`
- `rollout_status`

Skill rollout lifecycle:

| Status | Meaning |
|---|---|
| `draft` | Authored but not usable outside owner testing. |
| `eval_ready` | Has schemas, tool policy, and eval cases. |
| `approved` | Passed gates and can be enabled for projects. |
| `limited_rollout` | Enabled for selected teams/projects. |
| `production` | Available under policy. |
| `disabled` | Not discoverable or executable. |

## Prompt-injection and tainted-context controls

- Retrieved repo/docs/issues/chat content is tainted unless source policy marks it trusted.
- Retrieved content cannot define system instructions, widen permissions, select tools, or approve actions.
- Tool plans are verified by deterministic policy services before execution.
- Write/external-side-effect tools require stricter approvals when tainted content influenced the plan.
- Read and write scopes are separated; read-only context never grants write authority.
- Network egress from sandboxes is denied by default and allowlisted per tool.
- Tool outputs are treated as tainted when they include untrusted external or repository content.

## Agent-to-agent communication

Use explicit messages rather than hidden prompt state:

- `delegation.created`
- `delegation.progress`
- `delegation.result`
- `delegation.failed`
- `artifact.created`
- `approval.requested`
- `memory.proposed`

Messages reference artifacts and memory by ID and do not duplicate large blobs.

## Failure handling

| Failure | Required behavior |
|---|---|
| Model failure | Retry through Bifrost fallback when policy allows; otherwise preserve error and let supervisor replan. |
| Tool failure | Classify as transient, permanent, or policy-denied; policy denial is surfaced. |
| Sub-agent low confidence | Escalate to stronger model alias or decompose differently. |
| Budget exceeded | Stop or request approval; never use an ungoverned key. |
| Context contradiction | Surface conflicting sources and request narrower provenance. |
| Approval timeout | Pause workflow durably and notify requester/admin. |
| Worker lease lost | Requeue idempotent step or mark non-idempotent step for manual review. |

## Metrics

- task completion rate
- sub-agent success rate
- mean steps per workflow
- cost per accepted task
- model escalation rate
- tool denial rate
- approval wait time
- hallucinated citation rate
- retry/fallback frequency
- user correction/regeneration rate
- stuck workflow count
- worker lease recovery count
