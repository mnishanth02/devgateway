# Eval Dataset Layout

Status: Track 0.7 governance artifact  
Scope: inert eval dataset and fixture layout for non-production skeleton suites  
Production capability: these files do not enable model routes, tools, retrieval, provider keys, or live calls.

## Directory convention

- `evals\datasets\<suite>.v0.1.json` stores one versioned dataset manifest per suite.
- `evals\fixtures\<suite>\*.json` stores inert synthetic fixture inputs referenced by dataset cases.
- ACL safety keeps its existing dedicated dataset/schema shape and is not modified by this layout update.

## Dataset manifest fields

Each non-ACL Track 0.7 manifest uses the same layout:

- `contract_version` and `dataset_version` are `0.1.0` for the initial skeleton.
- `dataset_id` ends in `.v0.1` and matches the filename stem.
- `suite` is a stable snake_case suite key.
- `schema_status` records that the current shared JSON Schema is ACL-specific and this is a layout stub until a generalized eval schema is added.
- `fixture_root` points at the matching `evals/fixtures/<suite>` directory.
- `inert_fixture_mode=true`, `no_live_external_calls=true`, and `production_enablement=false` are mandatory.
- `source_data_policy` must require synthetic-only inputs, no real customer data, no real repository data, no live external calls, and fixture review.
- `categories` must enumerate the skeleton coverage required for the suite.
- Every case must include `fixture_refs`, expected decisions/assertions, `artifact_refs`, required audit evidence, and tags.

## Fixture rules

Fixtures must be safe to run before any gateway, provider, retrieval, tool, or workflow implementation exists:

1. Use synthetic principals, projects, prompts, providers, chunks, costs, and traces only.
2. Do not include real customer content, repository content, secrets, provider payloads, or live endpoint URLs.
3. Keep all provider/model/tool/retrieval behavior simulated and explicitly marked non-production.
4. Include expected decisions and assertion text in both the fixture and dataset case so future runners can validate deterministic outcomes.
5. Use artifact references for expected gate results, traces, audit events, and suite-specific measurement outputs instead of writing production records.

## Initial non-ACL suites

| Suite | Dataset | Fixture root | Required skeleton coverage |
|---|---|---|---|
| Gateway/model smoke | `evals\datasets\gateway-model-smoke.v0.1.json` | `evals\fixtures\gateway-model-smoke` | Auth, streaming, usage attribution, fallback, error shape |
| Provider data policy | `evals\datasets\provider-data-policy.v0.1.json` | `evals\fixtures\provider-data-policy` | Public/internal/confidential/restricted data classes crossed with external standard, external DPA/ZDR, self-hosted, and deterministic provider classes |
| Retrieval recall | `evals\datasets\retrieval-recall.v0.1.json` | `evals\fixtures\retrieval-recall` | Placeholder known-answer and citation requirements |
| Retrieval strategy controls | `evals\datasets\retrieval-strategy-controls.v0.1.json` | `evals\fixtures\retrieval-strategy-controls` | Hybrid-only, hybrid+GraphRAG, invalid-toggle fail-closed, and context budget/compression fixtures |
| Faithfulness | `evals\datasets\faithfulness.v0.1.json` | `evals\fixtures\faithfulness` | Contradiction, unsupported claim, and insufficient-context abstention fixtures |
| Prompt injection / tainted context | `evals\datasets\prompt-injection-tainted-context.v0.1.json` | `evals\fixtures\prompt-injection-tainted-context` | Instruction override, permission widening, hidden approval, and tool-bypass attempts |
| Tool safety | `evals\datasets\tool-safety.v0.1.json` | `evals\fixtures\tool-safety` | Allowed/denied tool plans and approval-bypass checks |
| Agent workflow | `evals\datasets\agent-workflow.v0.1.json` | `evals\fixtures\agent-workflow` | Restart/resume, budget, delegation, and state persistence |
| Persona answers | `evals\datasets\persona-answers.v0.1.json` | `evals\fixtures\persona-answers` | Product, business, architecture, support, and executive answer contracts |
| Cost/latency | `evals\datasets\cost-latency.v0.1.json` | `evals\fixtures\cost-latency` | Cost attribution and gateway overhead measurement shape |

## Validation expectations

Until a generalized non-ACL eval schema exists, validation is layout-based:

- JSON parse every dataset and fixture.
- Confirm every dataset category has at least one case.
- Confirm every case has a fixture path under its declared fixture root, expected assertions, and artifact references.
- Run `pnpm workspace:validate` to preserve existing schema/catalog health.

Future work should add a generalized eval dataset JSON Schema and runner smoke command without changing the inert/no-production posture.
