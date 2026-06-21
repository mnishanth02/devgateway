# Initial Model Aliases

Status: Track 1.3 registry artifact
Scope: initial disabled model-alias posture with non-production provider-candidate metadata for `packages\registry`
Production capability: this document and registry data do not enable any production route, provider key, fallback, or Bifrost production configuration.

## Purpose

This artifact records the first model aliases from `docs\impl-plan\track-0-architecture-lock-implementation-setup.md` section 7. Every alias starts disabled for production so Track 1 cannot route production keys until registry validation, provider policy, eval gates, and required approvals exist.

The source data is `packages\registry\registry\model-aliases.v0.1.json`; TypeScript consumers can use `packages\registry\src\initial-aliases.ts`.

## Locked initial aliases

| Alias | Purpose | Production posture | Eval placeholder |
|---|---|---|---|
| `devgateway/orchestrator` | Supervisor, task decomposition, and synthesis. | Disabled lifecycle, `production_gate.production_enabled=false`, OpenAI/Anthropic non-production candidate metadata, no live routes, no production route. | `agent_orchestration_v0_placeholder` |
| `devgateway/deep-reasoning` | Architecture and high-complexity planning. | Disabled lifecycle, `production_gate.production_enabled=false`, OpenAI/Anthropic non-production candidate metadata, no live routes, no production route. | `deep_reasoning_v0_placeholder` |
| `devgateway/code-review` | Diff review plus bug and security finding. | Disabled lifecycle, `production_gate.production_enabled=false`, OpenAI/Anthropic non-production candidate metadata, no live routes, no production route. | `code_review_v0_placeholder` |
| `devgateway/large-context` | Large documents, repositories, and context packs. | Disabled lifecycle, `production_gate.production_enabled=false`, OpenAI/Anthropic non-production candidate metadata, no live routes, no production route; any future Google Vertex route is manual-approval gated. | `large_context_v0_placeholder` |
| `devgateway/fast` | Low-cost high-volume tasks. | Disabled lifecycle, `production_gate.production_enabled=false`, OpenAI/Anthropic non-production candidate metadata, no live routes, no production route. | `fast_tasks_v0_placeholder` |
| `devgateway/retrieval-planner` | Query planning and context-pack construction. | Disabled lifecycle, `production_gate.production_enabled=false`, OpenAI/Anthropic non-production candidate metadata, no live routes, no production route. | `retrieval_planning_v0_placeholder` |

## Required disabled posture

Each initial alias must keep all of these values until a later approved production-enablement change supplies a matching passing gate result:

1. `lifecycle_status=disabled`.
2. `production_gate.production_enabled=false` and `production_gate.production_route_allowed=false`.
3. `production_gate.gate_result_ref=null`; there are no passing gate-result references.
4. `candidates` may include non-production OpenAI/Anthropic metadata only; there are no provider keys, provider credentials, production Bifrost route targets, or live production gateway routes.
5. `eval_gate.latest_gate_status=not_run` and `eval_gate.gate_result_ref=null`.
6. `routing.tier=disabled` and `routing.fallback_aliases=[]`.

## Future enablement gate

Disabled entries may be used only as registry placeholders and non-production route metadata. Production enablement requires a separate change that adds verified policy eligibility, pricing, limits, eval suite versions, approvals, and a matching passing gate-result reference. A future `devgateway/large-context` Google Vertex candidate additionally requires explicit manual approval before it can be configured.
