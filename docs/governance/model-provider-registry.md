# Model Provider Registry

Status: Track 0 governance artifact  
Scope: model alias/provider registry schema, source-of-truth conventions, and production-disabled posture  
Production capability: this document and schema do not enable any production model, provider, alias, route, key, or fallback.

## 1. Purpose

The model/provider registry is the source of truth for stable model aliases, provider candidates, routing eligibility, data-class constraints, price metadata, rate limits, eval gate state, and provider posture. Bifrost configuration must be generated from or validated against a registry snapshot rather than hand-maintained as production truth.

## 2. Versioned schema

The Track 0.5 registry contract is `0.1.0` and is represented by:

- JSON Schema: `packages\schemas\schemas\registry\model-provider-registry.v0.1.schema.json`
- TypeScript conventions: `packages\registry\src\schema.ts`
- Catalog entry: `packages\schemas\schemas\index.v0.1.json`

Registry snapshots include `registry_version`, creation/freshness timestamps, a top-level production posture, and `model_aliases`.

## 3. Required alias declarations

Every model alias record must declare:

- alias name and purpose;
- lifecycle status: `experimental`, `approved`, `deprecated`, or `disabled`;
- explicit production gate with `production_enabled=false` and `production_route_allowed=false`;
- eval suite/version, latest gate status, optional gate-result reference, and evaluation time;
- routing tier and fallback aliases;
- provider candidates; disabled aliases may explicitly carry an empty candidate list until provider candidates are separately approved.

Every provider candidate under an alias must declare:

- candidate ID, provider ID, provider control plane, provider region, and model ID;
- wire format: OpenAI Chat Completions, Anthropic Messages, or provider-native translated through Bifrost;
- tokenizer/counting source and optional count-tokens endpoint;
- context window and maximum output token limit;
- input, output, cache-read, cache-write, batch-input, and batch-output price points with timestamp/source;
- tool-call support and schema dialect;
- structured-output support and validation strategy;
- streaming support and event format;
- data residency, allowed data classes, retention/training/DPA/ZDR posture;
- rate limits;
- manual approval gate state.

## 4. Cloud-backed manual approval gate

Candidates with provider control plane `azure`, `aws`, `gcp`, or `vertex` must carry a manual approval gate with `required=true`. A pending or approved manual gate does not enable production routing; it only records the human-control-plane review state required before a later production gate can be considered.

## 5. Production-disabled default

The v0.1 schema intentionally requires top-level and per-alias production gates to remain disabled:

- `production_enabled` is constrained to `false`.
- `production_route_allowed` is constrained to `false`.
- gate-result references may be recorded for evidence, but cannot by themselves enable a route in this schema version.

Initial aliases, policy matrices, denial taxonomy, validators, and production-enablement logic are owned by separate Track 0.5 work items. This artifact only defines the registry schema and conventions.

## 6. Validation expectations

Track 0 readiness should validate schema/catalog health with `pnpm workspace:validate` and registry package types with `pnpm --filter @devgateway/registry typecheck`. Later registry validators must reject any production-enabled alias, fallback route, tool, prompt template, retrieval strategy, skill, or index version unless it references a matching passing gate-result record.
