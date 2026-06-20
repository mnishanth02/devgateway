# ACL safety eval fixtures

This Phase 0.6 fixture suite defines inert ACL safety cases using `packages\schemas\schemas\eval\eval-case.v0.1.schema.json`. The dataset is `evals\datasets\acl-safety.v0.1.json` with fixture payloads under `evals\fixtures\acl-safety\`.

## Safety posture

- Fixtures are synthetic only and contain no real repository data.
- Cases require `no_live_external_calls: true` and `production_retrieval_behavior: false`.
- The suite documents expected decisions and audit evidence only; it does not implement production retrieval.

## Required categories

| Category | Case | Expected result | Required audit evidence |
|---|---|---|---|
| Cross-project leak prevention | `acl-safety-cross-project-deny` | Deny project-beta candidate for a project-alpha request. | trace, principal, project, decision, ACL scope, index version, denial reason, rejected candidate id. |
| Cross-principal leak prevention | `acl-safety-cross-principal-deny` | Deny same-project CODEOWNER-scoped content for a reader principal. | trace, principal, project, decision, ACL scope, index version, denial reason, rejected candidate id. |
| Semantic cache ACL-scope leak prevention | `acl-safety-semantic-cache-scope-deny` | Deny cache hit when project or ACL scope differs. | trace, principal, project, decision, ACL scope, index version, cache key, denial reason. |
| Context-ref leak prevention | `acl-safety-context-ref-deny` | Deny opaque context ref expansion before body/title/citation disclosure. | trace, principal, project, decision, ACL scope, index version, context ref, denial reason. |
| Stale permission sync default-deny | `acl-safety-stale-sync-default-deny` | Deny before retrieval when sync staleness exceeds SLO. | trace, principal, project, decision, ACL scope, index version, sync version, staleness, denial reason. |
| ACL recheck before prompt assembly | `acl-safety-prompt-assembly-recheck-pass` | Pass only after dropping revoked context and assembling prompt with authorized content. | trace, principal, project, decision, ACL scope, index version, recheck decision, candidate ids. |

## Validation

Run `pnpm workspace:validate` to validate schema catalog integrity. Inspect the dataset categories with a JSON check to ensure all six required categories are present before wiring any eval runner.
