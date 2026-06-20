# Schema and Migration Conventions

Status: Track 0 governance artifact  
Scope: database schema naming, ownership, migration, seed, credential, ACL, audit, and retention conventions  
Production capability: this document does not create databases, migrations, credentials, extensions, or production tables.

## 1. Purpose

These conventions lock the Phase 0.4 database baseline before schema implementation. They prevent drift between TypeScript services, Python workers, eval runners, retrieval/indexing systems, and future graph/context-pack stores.

## 2. Naming and column conventions

| Concern | Convention |
|---|---|
| Table names | Use singular `snake_case` names, for example `project`, `audit_event`, and `workflow_run`. |
| Column names | Use singular `snake_case` names. Avoid overloaded generic names when a domain-specific name is clearer. |
| Internal relational IDs | Use `BIGINT GENERATED ALWAYS AS IDENTITY` for internal primary keys and internal foreign keys. |
| Public opaque IDs | Use UUIDv7 or prefixed opaque text IDs when IDs leave the database boundary. Do not expose internal BIGINT IDs in public APIs, URLs, logs intended for users, or external webhooks. |
| Time values | Use `TIMESTAMPTZ` for all instants. Do not use timestamp without time zone for event, lifecycle, billing, eval, audit, credential, or retention fields. |
| Status fields | Use `TEXT` plus explicit `CHECK` constraints for status/state fields instead of custom Postgres ENUMs. |
| Foreign keys | Every FK must declare explicit `ON DELETE` behavior and have an index on the referencing column or column set. |
| JSON data | Use `JSONB` only for flexible metadata, provider payload snapshots, non-authoritative details, and trace context. Core relational fields, policy decisions, ACL facts, lifecycle state, and query predicates must be modeled as columns. |
| Migrations | Migrations are forward-only by default, reversible only where safe, and reviewed before deployment. |
| Seeds | Bootstrap/admin seeds are separate from test fixtures. Test fixtures must not be required for environment bootstrap. |

## 3. Migration ownership lock

| Store/domain | Owner and tool |
|---|---|
| Operational Postgres | Owned by TypeScript `packages\db` using Drizzle migrations for auth, tenancy, policy, workflow, audit, cost, and eval-gate tables. |
| Better Auth tables | Owned through the `packages\db` Operational Postgres migration plan. Better Auth CLI/config output must be reconciled into Drizzle-owned migrations with documented table naming and mapping. |
| Knowledge Postgres | Python retrieval/indexing domains may use Alembic only after an independent approval records that knowledge schemas are separately owned. Without that approval, knowledge schemas consume generated contracts from `packages\db`. |
| Python workers | Consume generated schema contracts and typed query/data-access boundaries. They must not run independent migrations unless explicitly approved. |
| pgvector, UUID helpers, and other extensions | Extension policy must be explicit. `CREATE EXTENSION`, upgrade, and privileged extension operations are approval-gated and user/operator-run when required by the environment. |

`db:check` should validate migrations against a disposable or shadow Postgres database before Track 0 exit.

## 4. Credential storage convention

Provider keys, break-glass credentials, and other sensitive operational credentials must be stored as ciphertext plus non-secret metadata only. The application-level encryption key is supplied through Railway variables and must not be committed, logged, embedded in fixtures, or copied into documentation.

Credential tables should store only fields such as:

- `id` as internal `BIGINT GENERATED ALWAYS AS IDENTITY`;
- public UUIDv7 or prefixed opaque credential ID;
- owner scope columns such as `project_id`, `provider_id`, or environment;
- encrypted ciphertext;
- encryption metadata such as key ID/version, algorithm, nonce/IV reference, created time, rotated time, and disabled time;
- safe fingerprint or last-used metadata where needed for operations.

Raw provider keys and break-glass secret material must never be persisted in plaintext columns, JSONB metadata, logs, audit detail, snapshots, test fixtures, or generated TypeScript/Python contracts.

## 5. Tenant, ACL, and retrieval-safety columns

Knowledge, memory, graph metadata, and context-pack tables must include tenant and ACL fields sufficient to prove safe retrieval before prompt assembly, cache reuse, tool execution, or display.

Required columns for these domains:

| Column | Purpose |
|---|---|
| `project_id` | Internal FK to the owning project/tenant boundary. |
| `acl_scope_hash` | Stable hash of the access-control scope used for retrieval, cache, and context isolation. |
| Source reference | Source identifier such as `source_ref`, `repository_ref`, `document_ref`, or an equivalent domain-specific FK/reference. |
| `index_version` | Version of the index, embedding, graph extraction, or context-pack build that produced the row. |

These columns apply to tables such as `knowledge_source`, `document`, `chunk`, `embedding`, `entity`, `relation`, `repo_symbol`, `api_endpoint`, `decision`, `retrieval_strategy_run`, `context_budget_policy`, `context_compression_run`, `context_pack`, `context_pack_item`, `working_memory`, `episodic_summary`, `semantic_memory`, `decision_memory`, graph metadata tables, and context-pack tables.

## 6. Audit immutability

Audit records are append-only, immutable, actor-scoped, and request-correlated. Immutability must be enforced by the database, not only by application convention.

Production audit tables must use one or both controls:

1. DB roles where normal runtime roles can `INSERT` into `audit_event` but cannot `UPDATE` or `DELETE`.
2. Triggers that reject `UPDATE` and `DELETE` on immutable audit tables.

Audit rows should include actor/principal context, project context, request or trace correlation, policy/registry versions where relevant, decision/action, outcome, and created `TIMESTAMPTZ`.

## 7. High-volume retention and partitioning candidates

High-volume append-only tables need retention, archive, partitioning candidate assessment, and indexes before production. Initial candidates are:

- `audit_event`;
- `request_log`;
- `workflow_event`;
- `cost_event`;
- `eval_run`.

For each candidate, the owning migration must document expected write rate, retention period, archive/export behavior, partitioning strategy if selected, and query-driving indexes.

## 8. Initial schema domain map

| Domain | Representative tables |
|---|---|
| Identity/tenancy | `org`, `team`, `project`, `principal`, `role`, `permission_grant`, `virtual_key`. |
| Provider/model | `provider`, `model`, `model_alias`, `capability`, `price_snapshot`, `rate_limit`, `routing_policy`. |
| Agents/workflows | `agent_definition`, `agent_run`, `delegation`, `workflow_definition`, `workflow_run`, `workflow_step`, `step_attempt`, `workflow_event`, `workflow_outbox`, `workflow_lease`, `task_artifact`. |
| Tools/MCP/skills | `tool_definition`, `mcp_server`, `tool_policy`, `tool_call`, `approval_request`, `sandbox_run`, `skill_definition`, `skill_version`. |
| Knowledge | `knowledge_source`, `document`, `chunk`, `embedding`, `entity`, `relation`, `repo_symbol`, `api_endpoint`, `decision`, `retrieval_strategy_run`, `context_budget_policy`, `context_compression_run`, `context_pack`, `context_pack_item`. |
| Memory | `working_memory`, `episodic_summary`, `semantic_memory`, `decision_memory`, `memory_correction`, `retention_policy`. |
| Observability/evals | `request_log`, `trace_ref`, `eval_dataset`, `eval_case`, `eval_run`, `metric`, `cost_event`, `audit_event`. |

## 9. Review checklist

- Do table and column names use singular `snake_case`?
- Are internal IDs `BIGINT GENERATED ALWAYS AS IDENTITY` and public IDs UUIDv7 or prefixed opaque IDs?
- Are all time instants `TIMESTAMPTZ`?
- Are statuses `TEXT` with `CHECK` constraints?
- Does every FK declare explicit `ON DELETE` behavior and have a supporting index?
- Is JSONB limited to flexible metadata rather than core relational fields?
- Are migrations forward-only by default and owned by the approved migration owner?
- Are bootstrap/admin seeds separated from test fixtures?
- Are provider keys and break-glass credentials ciphertext plus metadata only, encrypted with application key material from Railway variables?
- Do knowledge, memory, graph, and context-pack tables include `project_id`, `acl_scope_hash`, source reference, and `index_version`?
- Are audit tables immutable by DB roles and/or triggers?
- Do high-volume tables have retention, archive, partitioning candidate, and index decisions before production?
