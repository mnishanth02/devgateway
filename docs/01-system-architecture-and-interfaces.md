# 01 - System Architecture and Interfaces

## Architecture principles

- Bifrost is the AI traffic gateway for model/provider calls.
- The Platform Tool Broker is the external MCP server and the only surface through which IDEs discover or execute tools.
- Agents request actions; deterministic policy services approve, deny, sandbox, and audit those actions.
- Retrieval applies ACLs before reranking, cache lookup, prompt assembly, tool execution, or user display.
- Synchronous `/v1/*` calls stay fast and streaming-compatible. Durable workflows run through portal/API or async MCP task tools.

## Service boundaries

| Service | Owns | Does not own |
|---|---|---|
| Bifrost Gateway | Provider API calls, virtual keys, budgets, rate limits, provider routing/fallback/load balancing, semantic cache hooks, Prometheus, OpenTelemetry. | Durable workflows, external MCP policy, human approvals, side-effecting tools, repository retrieval, long-term memory, portal UX. |
| API Gateway / Control API | OIDC session, portal APIs, admin APIs, model registry, policy registry, project configuration. | Raw provider calls except through Bifrost. |
| Platform Tool Broker / MCP | External MCP endpoint, tool registry, skill registry, MCP server registry, schema validation, risk tier, approvals, sandbox routing, durable tool-call state. | Trusting model-selected policies or bypassing platform approvals. |
| Agent Orchestrator | Parent agent runs, sub-agent delegation, task planning, result synthesis, trace and artifact linking. | Provider routing internals. |
| Durable Workflow Runtime | Persisted workflow state, retries, timeouts, cancellation, approvals, worker leases, event outbox. | LLM reasoning or tool policy decisions. |
| Knowledge Ingestion | GitHub clone/mirror, docs/conversation ingestion, chunking, entity extraction, graph construction. | Final answer generation. |
| Retrieval Orchestrator | Hybrid retrieval, GraphRAG, ACL filtering, reranking, context-pack assembly, citations. | Model execution. |
| Memory Service | Working, episodic, semantic, decision, and correction memory with retention policy. | Hidden ungoverned prompt state. |
| Evaluation Service | Datasets, eval runs, metric computation, regression gates, release blocking. | Production routing without policy approval. |
| Portal | Developer/admin/stakeholder experiences, dashboards, project knowledge views. | Direct unrestricted DB or provider access. |

## Core request flows

### Fast synchronous IDE chat / completion

1. Client calls `/v1/chat/completions` or `/v1/messages` with a principal-bound virtual key.
2. Bifrost validates key, budget, rate limit, model alias, provider policy, and data-class policy.
3. Semantic cache lookup is allowed only for cacheable requests with a matching ACL cache key.
4. Bifrost routes to the selected direct provider or hosted OSS provider.
5. Bifrost emits request metrics, traces, usage, fallback, and cache events.
6. Client receives a streaming or non-streaming response.

This path cannot wait for human approvals, long-running tools, or multi-step durable workflows.

### Durable repo-aware workflow

1. Portal/API creates a task, or an IDE calls `start_background_task` through MCP.
2. Control API authenticates the principal and creates `agent_run` and `workflow_run` records.
3. Supervisor plans retrieval, tools, approvals, and sub-agent delegations.
4. Retrieval Orchestrator builds ACL-filtered context packs with citations.
5. Tool Broker validates requested tools, risk tier, approval policy, and sandbox level.
6. Sub-agent executor calls Bifrost with the selected model alias and scoped budget.
7. Workflow runtime persists every step, attempt, result, artifact, event, approval, and failure.
8. Supervisor synthesizes the result with provenance, budget usage, and confidence.

### Stakeholder knowledge question

1. Portal sends persona, project, question, and permission scope.
2. Retrieval Orchestrator creates a persona-aware query plan.
3. ACL filtering removes forbidden sources before reranking and prompt assembly.
4. Agent uses a model alias selected by answer contract and policy.
5. Portal renders answer, citations, confidence/coverage notes, and allowed follow-up actions.

## API surface

| Surface | Required endpoints |
|---|---|
| OpenAI-compatible | `GET /v1/models`, `POST /v1/chat/completions`, SSE streaming, tool-call deltas. |
| Anthropic-compatible | `GET /v1/models`, `POST /v1/messages`, `POST /v1/messages/count_tokens`, Anthropic SSE events, header forwarding. |
| MCP | `POST /mcp` Streamable HTTP, `GET /mcp/sse`, and `POST /mcp/messages`. All tools are Tool-Broker-backed. |
| Tasks | `POST /api/tasks`, `GET /api/tasks/{id}`, `POST /api/tasks/{id}/cancel`, `GET /api/tasks/{id}/artifacts`. |
| Workflows | `GET /api/workflows/{id}`, `GET /api/workflows/{id}/events`, `POST /api/workflows/{id}/retry`. |
| Approvals | `GET /api/approvals`, `POST /api/approvals/{id}/approve`, `POST /api/approvals/{id}/deny`. |
| Knowledge | `POST /api/knowledge/query`, `GET /api/knowledge/sources`, `GET /api/knowledge/context-packs/{id}`. |
| Evals | `POST /api/evals/runs`, `GET /api/evals/runs/{id}`, `GET /api/evals/gates/{change_id}`. |
| Admin | `/api/admin/models`, `/api/admin/providers`, `/api/admin/policies`, `/api/admin/budgets`, `/api/admin/audit`. |
| Webhooks | GitHub push/PR/merge, provider status updates, eval completion, workflow event callbacks. |

All JSON APIs use OIDC session auth or service tokens, return typed error codes, support cursor pagination for list endpoints, and emit audit events for mutations.

## External endpoint shape

```text
https://gateway.company.internal
|-- GET  /v1/models
|-- POST /v1/chat/completions
|-- POST /v1/messages
|-- POST /v1/messages/count_tokens
|-- POST /mcp
|-- GET  /mcp/sse
`-- POST /mcp/messages
```

## IDE and client compatibility

Compatibility is validated during Track 1 smoke tests and recorded with a verification date.

| Tool/client | OpenAI-compatible URL | Anthropic-compatible URL | MCP | Gateway-compatible use |
|---|:---:|:---:|:---:|---|
| Continue | Yes | Yes | Yes | Model calls and tools. |
| Cline | Yes | Yes | Yes | Model calls and tools. |
| Kilo Code | Yes | Yes | Yes | Model calls and tools. |
| Claude Code | No | Yes | Yes | Anthropic path and tools. |
| Aider | Yes | Partial | No | OpenAI path for model calls. |
| Roo Code / related Cline lineage | Verify | Verify | Verify | Enable only after smoke tests pass. |
| Cursor | No | No | Yes | MCP tools only; proprietary model traffic is not routed. |
| Windsurf / Devin Desktop | No | No | Yes | MCP tools only; proprietary model traffic is not routed. |
| Generic OpenAI SDK clients | Yes | No | N/A | OpenAI-compatible model calls. |

## Anthropic Messages requirements

1. Forward `anthropic-beta` and `anthropic-version` headers unchanged.
2. Support Anthropic SSE events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`.
3. Preserve `tool_use` content blocks.
4. Accept `x-api-key` and `Authorization: Bearer`.
5. Accept/log Claude Code session headers where provided for attribution.
6. Return compatible model aliases from `GET /v1/models`.

## OpenAI Chat Completions requirements

1. Use `Authorization: Bearer` principal-bound virtual keys.
2. Support SSE streaming with `data: ...` chunks and `[DONE]`.
3. Support OpenAI-compatible `tool_calls` deltas.
4. Return OpenAI-compatible model aliases from `GET /v1/models`.
5. Support clients that pass full path URLs rather than base URLs.

## Canonical async MCP tools

| Tool | Purpose | Required behavior |
|---|---|---|
| `start_background_task` | Create a durable agent task. | Returns `task_id`, `workflow_id`, initial status, estimated budget, and artifact root. |
| `check_task_status` | Poll task state. | Returns state, progress summary, pending approvals, cost so far, and latest event timestamp. |
| `get_task_result` | Fetch final or partial result. | Returns synthesized answer, citations, artifacts, confidence, and failure detail when terminal. |
| `cancel_task` | Request cancellation. | Transitions cancellable workflows to `cancel_requested` and records requester/audit reason. |
| `list_task_artifacts` | List generated artifacts. | Returns artifact IDs, types, sizes, sensitivity labels, and signed download URLs when allowed. |

These tools are the only IDE contract for durable workflows. They bridge IDEs to long-running tasks without hiding workflow state inside a single chat-completion connection.

## Core data domains

| Domain | Representative entities |
|---|---|
| Identity/tenancy | `org`, `team`, `project`, `principal`, `role`, `permission_grant`, `virtual_key`. |
| Provider/model | `provider`, `model`, `model_alias`, `capability`, `price_snapshot`, `rate_limit`, `routing_policy`. |
| Agents/workflows | `agent_definition`, `agent_run`, `delegation`, `workflow_definition`, `workflow_run`, `workflow_step_run`, `task_artifact`. |
| Tools/MCP | `tool_definition`, `mcp_server`, `tool_policy`, `tool_call`, `approval_request`, `sandbox_run`. |
| Skills | `skill_definition`, `skill_version`, `skill_tool_bundle`, `skill_prompt`, `skill_eval_suite`, `skill_permission_policy`. |
| Knowledge | `knowledge_source`, `document`, `chunk`, `embedding`, `entity`, `relation`, `repo_symbol`, `api_endpoint`, `decision`. |
| Memory | `working_memory`, `episodic_summary`, `semantic_memory`, `decision_memory`, `memory_correction`, `retention_policy`. |
| Observability/evals | `request_log`, `trace_ref`, `eval_dataset`, `eval_case`, `eval_run`, `metric`, `cost_event`, `audit_event`. |

## Stateful storage split

- **Operational Postgres:** auth, virtual keys, policies, workflows, tasks, budgets, approvals, audit.
- **Knowledge Postgres:** sources, documents, chunks, entities, graph edges, pgvector, full-text index metadata.
- **Trace/eval tables:** request traces, eval results, cost events, and regression gates.
- **Object storage:** artifacts, source snapshots, generated docs, exports, trace bundles.
- **Redis:** short-lived queues, locks, cache helpers, and rate-limit helpers not owned by Bifrost.

## Security boundaries

- Microsoft Entra ID OIDC authenticates humans; service principals use signed service tokens.
- Bifrost enforces ingress virtual-key policy; platform policy service owns project/team/tool/data rules.
- Virtual keys are one-to-one with a human or service principal. Shared anonymous team keys are not allowed.
- GitHub App sync is the source for repository permissions, teams, collaborators, CODEOWNERS, and repo visibility.
- Permission sync staleness causes default-deny for repo-aware retrieval.
- Context references (`knowledge://`, `artifact://`, `memory://`) are rechecked against the delegation principal immediately before prompt assembly.
- Tool calls are risk-tiered, sandboxed, and audited.
- Human approvals are durable workflow states, not chat prompts.
- Retrieved content is tainted by default and cannot grant tool permission, widen scope, or approve actions.
- Provider keys are never surfaced to clients.
