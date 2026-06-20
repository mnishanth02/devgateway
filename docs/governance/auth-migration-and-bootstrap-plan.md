# Better Auth Migration and Admin Bootstrap Plan

Status: Track 0 governance artifact  
Scope: Better Auth schema ownership, Drizzle migration reconciliation, human admin bootstrap, smoke-test prerequisites, and production auth gates  
Production capability: this document does not enable production authentication, provider-key access, break-glass access, or committed credentials.

## 1. Purpose and source requirements

This plan implements the Better Auth identity baseline and schema/migration conventions required by `docs\impl-plan\track-0-architecture-lock-implementation-setup.md` sections 9 and 11. The first release uses Better Auth OSS for human authentication and Operational Postgres for durable auth, tenancy, policy, workflow, audit, cost, and eval-gate data.

The locked ownership rule is:

- `packages\db` owns Operational Postgres schema definitions and Drizzle migrations.
- Better Auth CLI `generate` output is an input to the Drizzle-owned migration plan.
- Better Auth CLI `migrate` is not used against shared or production Operational Postgres when Drizzle owns the schema; it may be used only against disposable/shadow databases for comparison when explicitly approved.

## 2. Better Auth server configuration baseline

The future Better Auth runtime configuration must be implemented in the Control API/auth package, but its database schema is governed by `packages\db`.

Required config posture:

| Area | Track 0 decision |
|---|---|
| Database adapter | Use the Better Auth Drizzle adapter against the `packages\db` Operational Postgres Drizzle client/schema. |
| Secret | `BETTER_AUTH_SECRET` must be supplied by the environment, be strong, and never be committed. |
| URL/origins | `BETTER_AUTH_URL` and explicit trusted origins are required per environment. |
| CSRF/origin checks | Keep CSRF and origin checks enabled; test invalid origin denial. |
| Cookies | Use secure cookies in production. |
| Registration | Invite-only or admin-created users only; public self-sign-up must be denied by policy/hooks. |
| Audit hooks | User, session, account, invite, 2FA, admin-role, and bootstrap mutations emit immutable audit events. |
| Errors | Auth errors remain generic to prevent account enumeration. |
| 2FA | Admin users must enroll and verify TOTP before production, provider-key, or break-glass access. |

Better Auth plugin imports should use dedicated plugin paths where possible. Plugin schema re-run requirement: any plugin addition, removal, or schema option change requires re-running Better Auth CLI schema generation and reconciling the result into Drizzle migrations before merge.

## 3. Schema ownership and migration flow

Operational Postgres migration flow:

1. Define or update the Better Auth runtime config using the Drizzle adapter and current plugin set.
2. Run Better Auth CLI `generate --config <auth-config-path> --output <review-output>` in a local/review context to produce the expected Better Auth schema for the configured adapter and plugins.
3. Compare generated output against `packages\db` Drizzle schema definitions.
4. Reconcile differences into `packages\db` schema and a forward-only Drizzle migration.
5. Review generated SQL for table names, column names, indexes, unique constraints, foreign keys, `ON DELETE` behavior, timestamps, and plugin-specific tables/columns.
6. Run `pnpm db:check` or the available workspace validation against a disposable/shadow Postgres database before Track 0 exit.
7. Record migration evidence with the auth smoke-test evidence.

Rules:

- Generated Better Auth output is not the durable migration source of truth.
- Drizzle migrations in `packages\db` are the durable source for Operational Postgres.
- Never hand-apply Better Auth `migrate` output to production or shared development databases outside the Drizzle migration path.
- Every plugin schema change, especially `twoFactor`, `admin`, `organization`, `apiKey`, `bearer`, or future SSO/OIDC plugins, requires a fresh Better Auth CLI `generate` run and migration reconciliation.
- Extension operations such as UUID helpers remain approval-gated/user-run when required by the environment.

## 4. Model-name to table-name mapping convention

Better Auth configuration and plugins reason about adapter model names; Drizzle/Postgres reason about schema exports and physical table names. Do not confuse these layers.

| Better Auth adapter model | Drizzle table export | Physical table | Notes |
|---|---|---|---|
| `user` | `authUser` | `auth_user` | Human auth account profile only; platform authorization uses `principal`. |
| `session` | `authSession` | `auth_session` | Human browser/API sessions; not service-principal tokens. |
| `account` | `authAccount` | `auth_account` | OAuth/password credential linkage as supported by Better Auth. |
| `verification` | `authVerification` | `auth_verification` | Email verification, password reset, and short-lived verification records. |
| plugin model names | `auth<PluginModel>` | `auth_<plugin_model>` | Generated by Better Auth config/plugins, then normalized to singular snake_case physical tables. |

Adapter convention:

- Prefer canonical Better Auth model names (`user`, `session`, `account`, `verification`) in config.
- Pass an explicit Drizzle adapter schema map so canonical Better Auth model names point to the Drizzle exports backed by `auth_*` physical tables.
- Keep Drizzle property names aligned with Better Auth field names while mapping physical columns to snake_case, such as `userId` -> `user_id`.
- Use Better Auth `modelName`, `fields`, or plugin `schema` options only when the explicit adapter schema map cannot express the mapping cleanly.
- Any non-default model/field mapping must be documented beside the migration and revalidated with Better Auth CLI `generate`.

Physical naming remains consistent with section 11: singular snake_case tables and columns, explicit foreign-key delete behavior, indexed FK columns, `TIMESTAMPTZ` for time values, `TEXT` plus CHECK constraints for statuses, and JSONB only for flexible metadata.

## 5. Human principal and service-principal split

Better Auth sessions are for human users only. Service principals for workers, tools, gateways, registry sync, eval runners, or CI automation must use signed service tokens, not Better Auth human sessions.

Required distinction:

- Human Better Auth `auth_user` records map to platform `principal` rows with actor type `user`.
- Service principal rows use actor type `service` and are authenticated with signed service tokens.
- Service tokens must include issuer, subject, audience, key ID, expiry, scope/project claims, and trace correlation metadata.
- Service tokens must be short-lived, rotated, auditable, and denied from human-only admin/session flows.
- No worker or service may create a Better Auth browser session to bypass policy.

## 6. Initial admin bootstrap plan

Bootstrap is disabled by default and must remain impossible without an explicit env gate. No committed credentials are allowed for bootstrap, admin users, provider-key access, or break-glass access.

Required environment posture:

| Variable/setting | Required behavior |
|---|---|
| `AUTH_ADMIN_BOOTSTRAP_ENABLED` | Defaults to `false`; only `true` enables bootstrap routes/scripts. |
| `AUTH_ADMIN_BOOTSTRAP_EXPIRES_AT` or TTL | Required when enabled; recommended maximum TTL is 15 minutes. |
| `AUTH_ADMIN_BOOTSTRAP_TOKEN_HASH` or equivalent | Store only a hash/fingerprint of an out-of-band bootstrap secret; never commit raw credentials. |
| `AUTH_ADMIN_BOOTSTRAP_SINGLE_USE` | Required `true`; successful bootstrap permanently consumes the token. |
| `BETTER_AUTH_SECRET` | Required and environment-supplied before any bootstrap action. |

Bootstrap flow:

1. Operator explicitly enables the bootstrap gate in the target environment with a short TTL and single-use token.
2. Bootstrap checks that no active admin already exists, or requires a separate break-glass approval if an admin exists.
3. Bootstrap creates exactly one initial human admin account or admin invite.
4. The admin must set their own password through an invite/password-reset flow; no default password or committed credential is allowed.
5. Bootstrap emits an immutable audit event such as `auth.admin_bootstrap.created` with actor, environment, target user, TTL, trace ID, and token fingerprint.
6. Bootstrap consumes the token, disables the gate, and records `auth.admin_bootstrap.consumed`.
7. Subsequent users are invite-only or admin-created, with audit events for invite creation, acceptance, role assignment, and deactivation.

Recommended safeguards:

- Implement bootstrap as a one-shot route or script that refuses to run in production unless both the env gate and an explicit operator approval marker are present.
- Refuse bootstrap when TTL is expired, token was already used, auth schema is not current, or audit emission fails.
- Do not store bootstrap passwords, provider keys, or break-glass credentials in code, docs, tests, fixtures, or migrations.

## 7. Admin TOTP 2FA production gate

Admin TOTP 2FA is mandatory before production-sensitive actions.

Required production gates:

- Admin users must have Better Auth `twoFactor` plugin schema migrated and TOTP verified before production access.
- Provider-key read/write, provider route enablement, production model alias enablement, break-glass approval/use, and bootstrap override require a TOTP-verified admin and a fresh sensitive-action session.
- Backup codes must be generated, encrypted at rest, shown once, and audited when regenerated or used.
- Trusted-device behavior must be reviewed before production; provider-key and break-glass actions should require fresh TOTP even on trusted devices unless a security owner approves otherwise.
- The auth smoke suite must include "admin without TOTP after production gate is denied."

## 8. Session expiry, refresh, and rate-limit storage decisions

These decisions are locked as Track 0 defaults but must be validated before production:

| Area | Track 0 default | Production validation required |
|---|---|---|
| Session expiry | Start from Better Auth default human session duration unless security review sets a shorter admin duration. | Validate global `session.expiresIn`, admin-sensitive fresh-session age, idle behavior, revocation latency, and user experience. |
| Session refresh | Start from Better Auth default refresh/update behavior. | Validate `session.updateAge`, cookie cache max age, and whether custom session fields require DB refetch. |
| Session persistence | Operational Postgres remains authoritative for human sessions. | If Redis/secondary storage is introduced, explicitly decide whether `session.storeSessionInDatabase` is required and test revoke/list-session behavior. |
| Rate-limit storage | Production must use persistent `database` or `secondary-storage`; memory storage is development-only. | Validate storage choice under Railway topology, restart behavior, sign-in/sign-up/2FA limits, and typed `rate_limit` denials. |
| Secondary storage | Redis-compatible storage is preferred for short-lived counters/verification data if provisioned. | Validate key prefixing, TTLs, failure behavior, and whether auth fails closed for sensitive endpoints. |

No production auth deployment is approved until session expiry/refresh and rate-limit storage evidence is recorded.

## 9. Auth schema migration checklist

- [ ] Better Auth config path is documented for CLI `generate`.
- [ ] Current plugin list is recorded, including `twoFactor` when admin 2FA is enabled.
- [ ] Better Auth CLI `generate` output is reviewed against `packages\db` Drizzle schema.
- [ ] Physical table names follow singular snake_case and the `auth_*` auth-table prefix.
- [ ] Adapter model names are explicitly mapped to Drizzle exports and not confused with physical table names.
- [ ] Plugin schema output has been regenerated after every plugin/schema change.
- [ ] Drizzle migration includes indexes, unique constraints, FK indexes, and explicit `ON DELETE` behavior.
- [ ] Audit-event writes are available before bootstrap/admin/session mutations are allowed.
- [ ] Disposable/shadow Postgres validation passes before shared database migration.
- [ ] Migration evidence links to auth smoke-test results.

## 10. Auth smoke-test prerequisites

Before the auth smoke-test skeleton can run, the environment must provide:

- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
- Explicit trusted origins for the test client/API origin.
- Migrated Better Auth tables in Operational Postgres through `packages\db` Drizzle migrations.
- Invite/admin-created user policy enabled; public sign-up denied.
- Admin bootstrap disabled by default, or enabled only in a single-use TTL-scoped test fixture.
- Audit-event table and auth audit hooks available.
- Persistent rate-limit storage decision configured for production-like smoke tests.
- TOTP plugin schema present for admin production-gate tests.
- Service-principal signed-token fixture separate from Better Auth human sessions.

Smoke tests from section 9 must cover:

| Test | Expected result |
|---|---|
| `GET /api/auth/ok` | Returns `{ "status": "ok" }`. |
| Missing/invalid origin | Denied by trusted-origin/CSRF policy. |
| Invite-only sign-up | Uninvited user cannot create account. |
| Valid admin sign-in | Session created and audit event emitted. |
| Sensitive endpoint rate limit | Excess attempts denied with typed error. |
| Admin without TOTP after production gate | Denied from provider-key/admin-sensitive actions. |
| Session revoke | Session invalidated and audit event emitted. |

## 11. Review and blocking gates

Track 1 auth implementation remains blocked until:

1. Better Auth schema output is reconciled into `packages\db` Drizzle migrations.
2. Admin bootstrap is disabled by default and proven single-use/TTL-scoped when explicitly enabled.
3. Invite-only/admin-created user flow is enforced.
4. Auth audit events are immutable and request-correlated.
5. Admin TOTP 2FA is required for production/provider-key/break-glass access.
6. Service principals use signed service tokens instead of Better Auth human sessions.
7. Session expiry/refresh and rate-limit storage decisions are validated for production.
8. Auth smoke-test prerequisites are met and smoke evidence is recorded.

This plan is a governance and migration artifact only. It must not be interpreted as approval to enable production authentication, provider-key access, or break-glass access.
