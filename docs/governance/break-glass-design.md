# Break-glass design

Status: Track 0.8 governance artifact; approval status pending.  
Production capability: this design is documentation only and contains no real credentials.

Break-glass design approval is a Track 0 exit requirement and must be complete before Track 1 enables gateway or model routes.

## Design goals

- Emergency provider access is temporary, scoped, auditable, and fail-closed.
- Human approval is mandatory before provider access, with CTO/founder approval for production-impacting tools.
- Break-glass cannot bypass repository ACLs, retrieval-cache restrictions, tool policy, provider data-class policy, eval gates, or audit immutability.

## Control model

| Area | Decision |
|---|---|
| Trigger | Use only for documented incidents such as Bifrost unavailability, gateway-route outage, provider-route failure, or severe incident triage. |
| Requester | A named internal principal must submit incident ID, project, environment, justification, aliases, data classes, and requested TTL. |
| Approvers | Platform lead plus engineering lead; Platform security owner for provider access; CTO/founder for production-impacting tools. |
| Approval status | Default `pending`. Provider access is denied until every required approval is recorded. |
| Scope | Activation is scoped to one incident, requester/team, project, environment, provider/model alias list, data-class list, operation class, TTL, and trace context. |
| Provider/model aliases allowed | Explicit allowlist per activation. Default empty. Aliases must still be present in the registry and subject to provider policy, budget, audit, and eval gates. |
| Data classes allowed | `public`, `internal`, and approved `confidential` may be requested. `restricted` is denied unless explicitly allowed by scope, approvers, and audit evidence. |
| TTL | Maximum 4 hours. Emergency service principal, virtual key, and access grant expire automatically at or before TTL. |
| Credential storage/access path | Store no credentials in docs or tickets. Store break-glass grants in application-encrypted Operational Postgres records and provider secret references in Railway variables. Access occurs only through Control API approval workflow, which mints a short-lived Bifrost virtual key/service principal. |
| Restrictions | No repo retrieval cache, no side-effecting tools, no cross-principal/project/ACL cache reuse, no credential disclosure in prompts/logs/chat, and no direct portal or agent access to provider keys. |
| Recovery | Disable route, revoke/expire principal, verify normal gateway health, review audit, rotate provider keys, and link the post-incident report. |
| Incident linkage | Every activation references incident ID, activation ID, audit trace IDs, provider-key rotation evidence, and post-incident report. |

## Audit event contract

Each break-glass event must be append-only and include:

- event ID and event type;
- activation ID and incident ID;
- requester, approver identities, approval status, and approval timestamps;
- project, tenant, environment, scope, route intent, provider, and model alias;
- allowed data classes and denied data classes;
- policy version, registry version, eval gate reference, and denial reason when denied;
- TTL, service principal ID, virtual key ID, credential reference ID, and credential access timestamp;
- trace ID, request ID, cost estimate where available, and actor IP/user agent where available;
- route disable timestamp, service-principal expiry/revocation timestamp, provider-key rotation evidence ID, and incident report link.

## Denial defaults

- Missing approval denies provider access.
- Expired TTL denies provider access.
- Missing alias allowlist denies provider access.
- Restricted data is denied unless explicitly allowed and audited for the activation.
- Repository retrieval cache is unavailable in break-glass mode.
- Side-effecting tools are unavailable in break-glass mode.
- Missing audit write denies provider access.
- Missing provider-key rotation evidence blocks activation closure.

## Required degraded-mode tests

| Scenario | Required assertion |
|---|---|
| Bifrost unavailable triggers break-glass request path. | Platform creates or links a pending break-glass request and fails closed; it does not silently route around Bifrost. |
| Service principal expires at TTL. | Access is denied after configured TTL, and any requested TTL above 4 hours is rejected. |
| Missing approval denies provider access. | Pending or incomplete approval status returns `approval_required` and no provider key is accessible. |
| Restricted data remains denied unless explicitly allowed and audited. | Restricted data requests are denied by default; approved exceptions include explicit scope, approvers, and audit fields. |
| Repo retrieval cache remains blocked. | Break-glass provider calls cannot read from or write to repository retrieval cache. |
| Side-effecting tools remain blocked. | Tool broker denies side-effecting tools during break-glass, including production-impacting tools without CTO/founder approval. |
| Provider-key use emits immutable audit events. | Key access, provider-call allow/deny, and route disable events include the audit event contract fields. |
| Post-use provider-key rotation required. | Activation cannot transition to closed until provider-key rotation evidence is recorded. |
| Route disabled after recovery. | Emergency route and virtual key are unusable after recovery. |

## Track 1 gate

Track 1 gateway/model route implementation must check this design before enabling any production route. The gate is blocked until approval status changes from `pending` to approved with approver names, incident/audit schema review, degraded-mode test implementation plan, and provider-key rotation procedure evidence.
