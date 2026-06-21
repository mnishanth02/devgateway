# Break-glass provider access runbook

Status: Approved governance runbook under `mnishanth02-track0-approval-2026-06-21`.
Scope: emergency model-provider access only. This runbook does not grant credentials, enable production routes, or approve real provider use.

Break-glass design approval is required before Track 1 may enable gateway or model routes.

## Approval record

| Field | Value |
|---|---|
| Approval record ID | `mnishanth02-track0-approval-2026-06-21` |
| Approval timestamp | `2026-06-21T20:47:32.272+05:30` |
| Approver / accountable principal | `@mnishanth02` |
| Approved scope | Emergency-provider-access request fields, activation procedure, recovery checklist, degraded-mode tests, TTL cap, audit requirements, and provider-key rotation requirement. |
| Production enablement | Not enabled; every real activation remains incident-scoped and pending until its own required approvals are recorded. |

## Request fields

| Field | Required content |
|---|---|
| Trigger | Bifrost/gateway outage, provider-route failure, severe incident triage, or other documented emergency where normal gated provider access is unavailable. |
| Requester | Named internal user, team, project, trace or incident context, and business justification. |
| Approvers | Platform lead plus engineering lead; Platform security owner for all provider access; CTO/founder approval for production-impacting tools. |
| Approval status | Per-activation approval remains `pending` until all required incident-scoped approvals are recorded. Missing activation approval denies provider access. |
| Scope | Project, tenant, environment, route intent, data classes, allowed aliases, allowed operation types, and explicit exclusions. |
| Provider/model aliases allowed | Explicit alias allowlist for this activation only; default is none. Production aliases still require registry, policy, audit, budget, and eval gates. |
| Data classes allowed | `public`, `internal`, or `confidential` only when approved. `restricted` remains denied unless explicitly approved, scoped, and audited for this activation. |
| TTL | Maximum 4 hours. The emergency service principal and virtual key must expire automatically at or before the approved TTL. |
| Credential storage/access path | No real credentials in this file. Store emergency grants as application-encrypted Operational Postgres records and Railway secret references only; access is via audited Control API approval flow and short-lived Bifrost virtual key/service principal. |
| Audit event fields | Event ID, activation ID, incident ID, requester, approvers, approval status, project, environment, provider, model alias, data classes, scope, reason, policy version, registry version, TTL, service principal ID, credential reference ID, trace ID, decision, denial reason if any, key access timestamp, route disable timestamp, rotation evidence ID, and actor IP/user agent where available. |
| Restrictions | No repository retrieval cache. No side-effecting tools. No cache writes or reuse across principals/projects/ACL scopes. No credentials in tickets, chat, logs, docs, or prompts. |
| Recovery steps | Disable route/key, confirm normal gateway path health, verify audit completeness, rotate used provider keys, revoke service principal, close incident actions, and link post-incident report. |
| Provider-key rotation after use | Required for every activation before final closure, even if no suspicious use is detected. |
| Incident report linkage | Every request must link an incident record and post-incident report with activation ID and audit evidence. |

## Activation procedure

1. Open an incident record and assign an activation ID.
2. Record the trigger, requester, scope, aliases, data classes, TTL, and incident link.
3. Collect required activation approvals. Leave activation approval status as `pending` until incident-scoped approval evidence exists.
4. Security owner verifies data-class and alias scope. Restricted data remains denied unless explicitly allowed and audited.
5. Mint a short-lived emergency service principal and Bifrost virtual key through the Control API path only.
6. Execute only approved read-only provider calls within scope and TTL.
7. Emit immutable audit events for approval, key access, provider call allow/deny, and route disablement.
8. Recover normal routing, disable emergency access, rotate provider keys, and attach evidence to the incident report.

## Recovery checklist

- [ ] Emergency route and virtual key disabled.
- [ ] Service principal expired or revoked.
- [ ] Provider key rotated and rotation evidence recorded.
- [ ] Bifrost and normal gateway/model routes verified healthy.
- [ ] Audit events reviewed for requester, approvers, scope, aliases, data classes, TTL, credential access, denials, and recovery.
- [ ] Incident report linked and post-incident actions assigned.

## Track 1 degraded-mode tests to implement

| Test | Expected result |
|---|---|
| Bifrost unavailable triggers break-glass request path. | Normal provider path fails closed and creates/links a pending break-glass request instead of bypassing policy. |
| Service principal expires at TTL. | Emergency provider access is denied after TTL, with maximum TTL capped at 4 hours. |
| Missing approval denies provider access. | Provider access remains denied while approval status is `pending` or incomplete. |
| Restricted data remains denied unless explicitly allowed and audited. | Restricted data-class access is denied by default; any exception must include explicit scope, approvers, and immutable audit event fields. |
| Repository retrieval cache and side-effecting tools are blocked. | Break-glass route cannot read/write repo retrieval cache and cannot invoke side-effecting tools. |
| Provider-key use emits immutable audit events. | Key access and provider calls include required audit event fields and trace correlation. |
| Post-use provider-key rotation is required. | Activation cannot close until used provider keys are rotated and evidence is linked. |
| Route disabled after recovery. | Emergency route and virtual key are disabled after recovery and remain unusable. |
