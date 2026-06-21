# 03 - Knowledge, Retrieval, and Evaluation

## Goal

Create a governed knowledge layer that understands repositories, docs, conversations, decisions,
requirements, APIs, ownership, and incidents, and exposes that knowledge to coding agents and
stakeholder views with citations and permission checks.

## Final index stack

| Need | First production choice | Reason |
|---|---|---|
| Knowledge metadata | Postgres | Shared transactional model, ACL joins, migrations, and operational simplicity. |
| Lexical retrieval | Postgres full-text search plus symbol/path tables | Enough for the first release and keeps ACL filtering in SQL. |
| Dense retrieval | pgvector in Knowledge Postgres | Avoids a separate vector service for the first release. |
| GraphRAG | **Self-hosted Neo4j Community** | Better fit for multi-hop traversal, dependency exploration, and knowledge graph queries. Postgres remains ACL/metadata source of truth. |
| Object snapshots | S3-compatible object storage | Stores source snapshots, artifacts, exports, and trace bundles. |
| Cache helper | Redis | Short-lived locks, queue helpers, and cache metadata. |

Qdrant, Zoekt, Tantivy, and OpenSearch are migration targets, not first-release dependencies.
Neo4j is included from the first production retrieval release, but only for graph traversal. ACL joins,
permission sync, chunk metadata, and transactional source-of-truth data remain in Postgres.

## Source connectors

| Source | Initial scope |
|---|---|
| GitHub repositories | Clone/mirror, default branch, PR refs, commit metadata, CODEOWNERS, workflows. |
| Markdown/docs | README, architecture docs, API docs, runbooks, ADRs, onboarding docs. |
| Issues/tickets | GitHub issues after repository connector, normalized into requirement/bug/decision entities. |
| Conversations | Agent task summaries, accepted decisions, resolved incidents, corrections. |
| Generated artifacts | Dependency maps, repo summaries, API catalogs, architecture summaries. |

GitHub is the only SCM in the first production release.

## Ingestion pipeline

1. Source connector detects change through webhook, scheduled sync, or manual import.
2. Fetch source snapshot into object storage.
3. Parse and classify documents/code.
4. Run secret, PII, and client-sensitive data scans.
5. Chunk with structure-aware metadata.
6. Build deterministic repo graph from Tree-sitter, LSP/SCIP, dependency manifests, import graphs, API route scanners, and schema introspection.
7. Run LLM entity/relation extraction only on unstructured text: Markdown docs, ADRs, tickets, PR descriptions, incidents, and conversation summaries.
8. Update Postgres full-text index and symbol/path tables.
9. Generate embeddings with the approved embedding model and update pgvector collections.
10. Update Neo4j graph nodes/edges and Postgres graph metadata tables.
11. Run quality checks and mark index version active after eval pass.

## ACL provenance chain

ACL filtering is backed by an authoritative permission graph:

1. GitHub App syncs repositories, teams, collaborators, CODEOWNERS, and repo visibility into `permission_grant`.
2. Platform roles add stakeholder/project grants but cannot exceed source restrictions for private repos.
3. Permission sync staleness causes default-deny for repo-aware retrieval.
4. Virtual keys bind to a principal; shared team keys are forbidden for retrieval.
5. Every `chunk`, `entity`, `relation`, `memory_item`, and `context_pack` stores source ACL scope and index version.
6. Every delegation rechecks ACLs when resolving `input_context_refs`.
7. Safety evals include cross-project, cross-principal, cache, and context-ref leak tests.

## Entity model

Representative entities:

- `Repository`
- `Branch`
- `File`
- `Module`
- `Symbol`
- `Function`
- `Class`
- `APIEndpoint`
- `Service`
- `DatabaseTable`
- `Requirement`
- `BusinessRule`
- `Decision`
- `Incident`
- `Owner`
- `Team`
- `Document`
- `MemoryItem`

Representative relations:

- `imports`
- `calls`
- `implements`
- `owns`
- `documents`
- `depends_on`
- `exposes`
- `satisfies_requirement`
- `changed_by`
- `decided_by`
- `supersedes`
- `conflicts_with`

## Retrieval pipelines

### General hybrid retrieval

1. Classify query intent and persona.
2. Generate lexical queries, semantic query, and graph starting points.
3. Retrieve candidates from full-text/symbol, pgvector, and graph tables.
4. Apply principal/project/team ACL filter before reranking or prompt assembly.
5. Rerank by relevance, freshness, source reliability, and persona fit.
6. Expand graph neighbors under the configured strategy when GraphRAG improves answer faithfulness.
7. Budget and compress candidates into the target model context window.
8. Assemble context pack with source citations and confidence/coverage notes.

Ranking signals:

- exact identifier/path/API matches
- semantic similarity
- graph centrality and distance
- source freshness
- ownership relevance
- accepted memory
- persona-specific answer needs

## Runtime retrieval controls

Retrieval must be switchable without code changes so application behavior and eval results can compare
hybrid-only retrieval against Neo4j-backed GraphRAG.

| Control | Default | Rule |
|---|---|---|
| `RETRIEVAL_PRODUCTION_ENABLED` | `false` | Production retrieval stays disabled until eval gates pass and an approved release intentionally enables it. |
| `RETRIEVAL_LEXICAL_ENABLED` | `true` | Required for first production retrieval; exact symbol/path/error matching is not replaced by embeddings or GraphRAG. |
| `RETRIEVAL_EMBEDDINGS_ENABLED` | `true` | Required for first production retrieval; semantic retrieval complements lexical and graph retrieval. |
| `RETRIEVAL_RERANKER_ENABLED` | `true` | Required for first production retrieval to reduce noisy candidate context. |
| `RETRIEVAL_GRAPH_RAG_ENABLED` | `true` | Day-one GraphRAG path; can be disabled in development/evals for hybrid-only comparison. |
| `RETRIEVAL_NEO4J_ENABLED` | `true` | Day-one Neo4j traversal store; GraphRAG enabled while Neo4j is disabled fails closed. |
| `RETRIEVAL_CONTEXT_BUDGETER_ENABLED` | `true` | Required before production retrieval so prompt assembly is budgeted. |
| `RETRIEVAL_CONTEXT_COMPRESSOR_ENABLED` | `true` | Required before production retrieval so large context packs are compressed safely. |
| `RETRIEVAL_CODE_EMBEDDINGS_ENABLED` | `false` | Deferred until code-search evals prove material benefit. |
| `RETRIEVAL_EVAL_STRATEGIES` | `hybrid,hybrid_graph` | Eval runner compares explicit strategy IDs. |

Strategy IDs:

| Strategy | Meaning |
|---|---|
| `hybrid` | Lexical + general embeddings + reranker + budget/compression; no GraphRAG or Neo4j traversal. |
| `hybrid_graph` | Hybrid retrieval plus Neo4j-backed GraphRAG candidates and graph provenance. |
| `hybrid_graph_shadow` | Runs GraphRAG side-by-side for eval/trace evidence without using graph candidates in the final answer. |

Fail-closed rules:

- `RETRIEVAL_GRAPH_RAG_ENABLED=true` with `RETRIEVAL_NEO4J_ENABLED=false` is invalid.
- Production retrieval cannot be enabled outside `NODE_ENV=production`.
- Production retrieval requires lexical, embeddings, reranker, GraphRAG, Neo4j, context budgeter, and context compressor to remain enabled.
- Code-specific embeddings remain disabled in the first production release.

## Context budgeter and compressor

The Retrieval Orchestrator owns context reduction before any model call:

1. Merge lexical, vector, graph, memory, and persona-specific candidates.
2. Apply principal/project/team ACL filters before budgeting or compression.
3. Deduplicate overlapping chunks, snippets, graph paths, and memory items.
4. Allocate token budget by task type, persona, model context window, source reliability, freshness, and citation need.
5. Compress low-risk prose, summaries, and repeated metadata first; preserve exact code, API signatures, policy text, and cited facts when they are answer-critical.
6. Preserve citation IDs, ACL scope hash, source reference, index version, graph node/edge provenance, retrieval strategy ID, and taint markers.
7. Emit trace fields for `retrieval_strategy_id`, `context_budget_policy_id`, `context_compression_run_id`, `context_pack_tokens`, dropped-candidate reasons, and required-citation coverage.

### Code question pipeline

- Prefer exact lexical matches for symbols, filenames, routes, table names, and errors.
- Use repo graph for callers, callees, imports, dependencies, owners, and tests.
- Use embeddings for conceptual explanations and similar implementations.
- Include relevant snippets and graph paths, not whole files.
- Cite file path, symbol, commit/index version, and line/range when available.

### Business/product question pipeline

- Start from requirements, docs, ADRs, API catalogs, incidents, and domain glossary.
- Link to implementation symbols/services through graph relations.
- Answer in product/business language with optional technical appendix links.

### Architecture question pipeline

- Retrieve service map, dependencies, ADRs, runbooks, APIs, ownership, deployment notes.
- Use graph traversal for dependency and impact analysis.
- Prefer current decisions and mark superseded sources explicitly.

### Conversation memory pipeline

- Summarize task outcomes before promoting to durable memory.
- Prefer decisions, outcomes, incidents, and corrections over raw chat.
- Attach scope: repo, project, team, or global.
- Include retention, expiry, and correction workflow.

## GraphRAG design

GraphRAG is implemented from the beginning through Neo4j plus Postgres metadata:

- Neo4j stores graph nodes/edges for traversal and multi-hop expansion.
- Postgres stores authoritative ACL scope, source reference, project, index version, and metadata for
  every graph node/edge ID.
- Neo4j node/edge properties include `project_id`, `acl_scope_hash`, `source_ref`, and `index_version`
  so traversal can be prefiltered and post-validated.
- Deterministic code edges come from parsers and indexers.
- LLM-extracted edges are limited to unstructured docs, tickets, incidents, and conversation summaries.
- Graph expansion is used only when it improves eval scores for multi-hop questions.
- Every graph answer preserves provenance to source chunks and graph edges.

Fallback to typed Postgres graph tables is allowed only if Neo4j self-hosting on Railway proves too
heavy operationally. Otherwise Neo4j Community is the first graph traversal engine.

## Embeddings and reranking

| Component | First production choice | Rule |
|---|---|---|
| General docs + mixed code/text embeddings | `BAAI/bge-m3` | Baseline embedding model for all first-release indexes. |
| Reranker | `BAAI/bge-reranker-v2-m3` | Rerank top 20-50 candidates to control latency. |
| Code-specific embedding | Not enabled in first release | Activate only after evals show a material code-search improvement. |

Embedding collections are versioned. Model replacement uses dual-write, backfill, shadow eval, alias cutover,
rollback retention for 14-30 days, and garbage collection after successful cutover.

## Semantic cache safety

Semantic cache is disabled by default for repo-aware answers until cache-safety evals pass.

Cache key formula:

```text
hash(
  normalized_prompt,
  model_alias,
  provider_data_class,
  principal_id,
  project_id,
  acl_scope_hash,
  retrieval_index_version,
  tool_policy_version,
  prompt_template_version
)
```

Non-cacheable responses:

- responses with approval state
- responses containing secrets or detected sensitive data
- responses generated from restricted projects
- responses with tool outputs from external systems
- responses where ACL sync is stale
- responses with user-specific private memory

Cache leak tests must prove zero cross-principal, cross-project, and stale-ACL reuse.

## Persona-specific context packs

| Persona view | Context emphasis |
|---|---|
| Technical | code snippets, symbols, APIs, dependencies, tests, errors. |
| Product | requirements, workflows, user-visible behavior, API capabilities. |
| Business | domain concepts, rules, operational impact, stakeholder language. |
| Architecture | services, dependencies, ADRs, deployment, risk, ownership. |
| Executive | summary, status, risks, impact, confidence, decisions needed. |
| Support | symptoms, known issues, logs/runbooks, mitigations, customer-safe explanations. |

## Persona answer contracts

| Persona | Required sources | Answer format | Acceptance metric |
|---|---|---|---|
| Product | requirements, APIs, user flows, ADRs | behavior summary + linked implementation | usefulness rating >= 4/5 and citation support >= 95% |
| Business | business rules, process docs, requirements | non-code explanation + risk/impact | low-jargon score >= 4/5 and traceability >= 90% |
| Architecture | service graph, ADRs, dependencies | architecture map + trade-offs | dependency/decision recall >= 85% |
| Support | incidents, runbooks, APIs, known issues | safe customer-facing explanation + internal notes | resolution usefulness >= 4/5 and zero confidential leakage |
| Executive | summaries, risks, milestones, ownership | brief with confidence and decisions needed | clarity >= 4/5 and no unnecessary code detail |

## Evaluation gates

No production model alias, routing policy, retrieval strategy, prompt template, tool, skill, or index change
ships without an eval run and gate decision.

| Gate | Minimum dataset | Blocking thresholds |
|---|---|---|
| Gateway/model smoke | 25 requests per enabled client/protocol | 100% auth, streaming, usage attribution, fallback, and error-shape pass. |
| Provider data policy | All data classes x approved providers | 100% denial for disallowed class/provider/region combinations. |
| Retrieval recall | 100 known-answer repo/doc questions | recall@10 >= 85%, MRR >= 0.70, citation support >= 95%. |
| Retrieval strategy controls | Hybrid-only, hybrid+GraphRAG, shadow, and invalid-toggle fixtures | GraphRAG/Neo4j toggles are honored, invalid combinations fail closed, and strategy traces are complete. |
| GraphRAG quality | 50 multi-hop repo/doc/business questions | hybrid_graph outperforms or matches hybrid on approved multi-hop questions; graph provenance support >= 95%. |
| Context pack budget/compression | 50 over-budget context-pack cases | 100% within token budget, required citations/provenance preserved, no ACL or taint-marker loss. |
| Faithfulness | 50 adversarial and contradiction cases | unsupported-claim rate <= 2%, contradiction surfaced in >= 90% of conflict cases. |
| ACL safety | Cross-project/principal/cache/context-ref suite | zero leaks and zero stale-permission exposures. |
| Tool safety | 50 allowed/denied tool-plan cases | 100% denial for disallowed side effects and zero approval bypasses. |
| Agent workflow | 30 representative tasks | task success >= 80%, no lost state after restart, budget enforcement 100%. |
| Persona answers | 20 cases per stakeholder persona | average usefulness >= 4/5, citation support >= 95%, zero confidential leakage. |
| Cost/latency | Track 1 and Track 4 workloads | p95 gateway overhead <= 250 ms; cost attribution coverage 100%. |

Severity rules:

- Any ACL leak, provider-policy violation, secret exposure, approval bypass, or lost workflow state blocks release.
- Any regression above 5% in recall, faithfulness, task success, or cost-per-accepted-task requires owner approval.
- Eval datasets are owned by platform engineering with named reviewers from engineering, product, and support.
