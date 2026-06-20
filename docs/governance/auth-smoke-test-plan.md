# Auth Smoke Test Plan

Status: Track 0 governance and fixture-plan artifact  
Scope: Better Auth smoke-test skeleton for `apps\control-api`  
Production capability: this plan is inert and does not enable live auth behavior, Better Auth runtime behavior, production credentials, provider keys, or admin-sensitive access.

## Fixture mode

The initial suite runs in `inert-fixture-plan` mode. Scenario definitions in `apps\control-api\src\auth\auth-smoke-scenarios.ts` describe typed requests, fixtures, expected outcomes, generic error expectations, and audit evidence for a future executable runner. They are not route handlers, middleware, seeds, migrations, or production configuration.

Future executable tests should use only local fixtures/fakes:

- fixture principals: anonymous, invited user, uninvited user, admin, and admin without TOTP;
- fixture origin and CSRF states: trusted, missing, invalid, valid;
- fixture session store with deterministic session creation and revocation;
- fixture rate-limit counter for sensitive endpoints;
- fixture audit sink that captures append-only events and rejects mutation.

## Prerequisites before executable tests

1. Better Auth configuration skeleton documents trusted origins, CSRF/origin checks, secure cookies, invite-only users, rate limiting, admin TOTP gate, session lifecycle, and generic auth errors.
2. Auth schema and migration plan define users, accounts, sessions, invites, TOTP state, rate-limit state where persistent, and immutable audit event storage.
3. Admin bootstrap plan defines fixture-only admin setup and production bootstrap separation.
4. Test runner can execute without external auth providers, email delivery, Redis, production database, provider keys, or production secrets.
5. Audit assertions can verify event name, actor, decision, reason/error code, session identifier or fingerprint where applicable, trace identifier, and timestamp.

## Required scenario skeleton

| Scenario ID | Requirement | Fixture | Expected outcome | Audit evidence |
|---|---|---|---|---|
| `auth-ok-health` | `GET /api/auth/ok` returns `{ "status": "ok" }`. | Anonymous health-check request. | Allow; exact status body; no session/account mutation. | Audit not required; prove no credential or session disclosure. |
| `auth-origin-csrf-deny` | Missing/invalid origin denied by trusted-origin/CSRF policy. | Invalid or missing Origin with missing/invalid CSRF on a state-changing auth route. | Deny; no session cookie; typed `origin_not_trusted` or `csrf_failed`; generic external body. | `auth.policy.denied` with reason, origin classification, and trace identifier. |
| `auth-invite-only-sign-up-deny` | Invite-only sign-up blocks an uninvited user. | Trusted origin, valid CSRF, no active invite for submitted email. | Deny; no user/account/session created; typed `invite_required`; account-enumeration safe. | `auth.policy.denied` with redacted/hashed subject and trace identifier. |
| `auth-admin-sign-in-session-audit` | Valid admin sign-in creates a session and emits audit. | Invited, verified admin with fixture-only credentials. | Allow; session created; no credential secret returned. | `auth.sign_in.succeeded` with actor, session identifier/fingerprint, timestamp, and trace identifier. |
| `auth-sensitive-rate-limit-deny` | Sensitive endpoint rate limit denies excess attempts with typed error. | Counter preloaded to cross threshold on final attempt. | Deny; typed `rate_limit`; generic external body; no session mutation. | `auth.rate_limit.denied` with limit scope, threshold/reset metadata, and trace identifier. |
| `auth-admin-totp-production-gate-deny` | Admin without TOTP after production gate is denied from provider-key/admin-sensitive actions. | Production-gate fixture, valid admin credentials, no verified TOTP. | Deny before provider-key/admin-sensitive mutation; typed `totp_required`; account-enumeration safe. | `auth.policy.denied` with actor, action, reason, and trace identifier. |
| `auth-session-revoke-invalidated-audit` | Session revoke invalidates session and emits audit. | Active admin session in fixture session store. | Allow revoke; follow-up use of revoked session denied with typed `session_revoked`; generic external body. | `auth.session.revoked` with actor, revoked session fingerprint, timestamp, and trace identifier. |

## Generic auth error and account-enumeration expectations

All denial scenarios must keep user-facing auth responses generic. Tests should assert that responses do not reveal whether an email, account, invite, session, credential, or TOTP enrollment exists. Stable typed error codes may be available to tests, logs, and audit automation, but external messages should remain generic, for example `Authentication failed or request denied.`

Executable tests should compare unknown account, wrong credential, missing invite, missing/invalid origin, revoked session, and missing TOTP cases for compatible response shape and timing class where practical.

## Audit evidence requirements

Audit evidence is required for sign-in success, policy denial, rate-limit denial, and session revoke. Evidence must be append-only and include at minimum:

- event name;
- actor or redacted subject identifier;
- allow/deny decision;
- typed reason/error code;
- route/action;
- session identifier or fingerprint when a session is created, denied, or revoked;
- trace identifier;
- timestamp.

No smoke scenario should pass if a required audit event is missing, mutable, uncorrelated with the request trace, or exposes secrets.

## Non-goals

- No live Better Auth runtime enablement.
- No production route, cookie, provider key, TOTP enrollment, invite delivery, or admin bootstrap enablement.
- No migration ownership changes.
- No dependency on external services or production secrets.
