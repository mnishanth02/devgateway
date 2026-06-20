# Provider Data-Class Policy

Status: Track 0.5 governance artifact  
Scope: provider/data-class routing policy shape, matrix schema, deterministic evaluation order, and fail-closed defaults  
Production capability: this document and the accompanying matrix do not enable any production provider, model alias, key, or route.

## Data classes and routing rules

| Data class | Routing rule |
|---|---|
| `public` | Any approved provider/model alias. |
| `internal` | Approved providers with acceptable retention/training terms. |
| `confidential` | Providers with DPA/ZDR or explicit company approval; traces redact sensitive snippets. |
| `restricted` | No external model calls; deterministic tooling or approved self-hosted route only. |

`restricted` data is external-model default-deny. The matrix can list deterministic tooling or self-hosted candidates, but self-hosted restricted routes still require explicit approval evidence before selection.

## Deterministic evaluation order

The policy evaluator and matrix use this exact order:

1. Resolve principal and project.
2. Resolve project data class and requested task/tool context.
3. Resolve requested model alias and provider candidate.
4. Check provider lifecycle and approval gate.
5. Check data-class allowlist, DPA/ZDR, retention/training, region, and trace storage policy.
6. Check eval gate status for alias/routing/prompt/tool/retrieval strategy.
7. Check budget/rate limit.
8. Check semantic-cache eligibility and ACL-scoped cache key requirements.
9. Select route or return a typed denial.

## Matrix and schema

- Matrix: `packages\policy\policies\provider-data-class-matrix.v0.1.json`
- Schema: `packages\schemas\schemas\policy\provider-policy.v0.1.schema.json`
- TypeScript contract: `packages\policy\src\data-class-policy.ts`

The matrix captures provider lifecycle, DPA/ZDR status, retention and training terms, region policy, trace storage policy, allowed and denied data classes, manual approval gates, eval-gate requirements, budget/rate-limit checks, semantic-cache ACL eligibility, and auditability requirements.

## Typed denials

Policy failures return the shared gateway denial codes: `budget`, `rate_limit`, `data_class`, `provider_lifecycle`, `eval_gate`, `policy_stale`, `route_disabled`, or `approval_required`.
