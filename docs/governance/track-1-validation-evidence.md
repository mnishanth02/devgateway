# Track 1 validation evidence

Status: Track 1 evidence snapshot for degraded-mode, cache-scope, and client compatibility checks  
Scope: inert fixtures, layout validation, and manual-smoke notes only. No production route, provider key, retrieval cache, or client integration is enabled by this document.

## Phase 1.7 degraded-mode and cache evidence

| Evidence area | Artifact | Status | Notes |
|---|---|---|---|
| Break-glass degraded-mode cases | `evals\datasets\degraded-mode.v0.1.json` and `evals\fixtures\degraded-mode\*.json` | Fixture coverage added | Covers Bifrost unavailable pending request/fail closed, TTL expiry, missing approval, restricted data denial, repo retrieval cache blocked, side-effecting tools blocked, provider-key audit, post-use rotation evidence, and route disabled after recovery. |
| Semantic cache pre-enablement leak gate | `acl-safety-semantic-cache-preenablement-deny` in `evals\datasets\acl-safety.v0.1.json` | Fixture coverage added | Explicitly denies semantic cache lookup/write and cache-existence probing until scope isolation, ACL hash binding, and audit fields are enabled. |
| Existing semantic cache scope mismatch | `acl-safety-semantic-cache-scope-deny` | Present | Continues to deny cross-project/cross-ACL semantic cache reuse. |
| Manual client smoke | Table below | Not run in this environment | Notes are compatibility/evidence prerequisites only; they do not claim live client execution. |

## Break-glass degraded-mode fixture checklist

| Scenario | Case ID | Required evidence |
|---|---|---|
| Bifrost unavailable pending request/fail closed | `degraded-mode-bifrost-unavailable-pending-request` | Pending request/activation linkage, fail-closed denial, no provider credential exposure. |
| TTL expiry | `degraded-mode-ttl-expiry-deny` | TTL cap rejection, expired principal denial, expiry audit. |
| Missing approval | `degraded-mode-missing-approval-deny` | `approval_required`, missing approver roles, no provider-key access. |
| Restricted data denied | `degraded-mode-restricted-data-deny` | Denied restricted data class unless explicitly scoped, approved, and audited. |
| Repo retrieval cache blocked | `degraded-mode-repo-retrieval-cache-blocked` | No cache read/write/existence disclosure in break-glass mode. |
| Side-effecting tools blocked | `degraded-mode-side-effecting-tools-blocked` | Tool broker denial and no adapter execution. |
| Provider-key audit | `degraded-mode-provider-key-audit` | Append-only key-access/provider-call/route-disable events with credential reference, not raw key. |
| Post-use rotation evidence | `degraded-mode-post-use-rotation-required` | Closure blocked until provider-key rotation evidence ID is linked. |
| Emergency route disabled after recovery | `degraded-mode-route-disabled-after-recovery` | Route disabled, virtual key/service principal revoked or expired, post-recovery use denied. |

## Manual client smoke notes

Manual client smoke was not executed for Phase 1.7 in this non-interactive environment. The statuses below are therefore support expectations/prerequisites to verify later, not proof of live compatibility.

| Client lineage | Current evidence status | Compatibility notes to verify before marking supported |
|---|---|---|
| Continue | Not run; expected partial/supportable via OpenAI-compatible gateway configuration | Verify custom base URL/model alias, bearer virtual key handling, streaming response shape, generic denial body display, and trace/request ID capture. |
| Cline | Not run; expected partial/supportable via OpenAI-compatible provider settings | Verify model alias routing, tool-denial rendering, auth failure behavior, and no retry that bypasses gateway policy. |
| Kilo Code | Not run; expected partial/supportable if its provider settings accept OpenAI-compatible base URL/key | Verify request headers, streaming, model listing assumptions, and policy-denial UX. |
| Aider | Not run; expected partial/supportable through OpenAI-compatible API environment/options | Verify base URL/key/model configuration, non-streaming and streaming paths, retry behavior on fail-closed denials, and no local cache leak. |
| Claude Code | Not run; unsupported until an approved Anthropic-compatible or gateway-compatible configuration path is documented | Verify whether custom base URL/proxy mode is supported, how auth headers are supplied, and whether denials preserve audit trace IDs. |
| Roo lineage | Not run; expected partial/supportable for variants that expose OpenAI-compatible provider configuration | Verify variant-specific provider settings, tool-call denial display, streaming, and request ID propagation. |

A client row may be changed to `verified` only after recording date/time, client version, configuration used, fixture/provider mode, result, trace ID, and any unsupported behavior. Partial or unsupported outcomes must stay explicit.

## Validation commands

- `pnpm eval:smoke` validates the ACL fixture-mode runner, including the semantic cache pre-enablement case.
- `pnpm workspace:validate` validates root tooling, eval dataset/fixture layout, and schema package checks.

