export type AuthSmokeScenarioId =
  | 'auth-ok-health'
  | 'auth-origin-csrf-deny'
  | 'auth-invite-only-sign-up-deny'
  | 'auth-admin-sign-in-session-audit'
  | 'auth-sensitive-rate-limit-deny'
  | 'auth-admin-totp-production-gate-deny'
  | 'auth-session-revoke-invalidated-audit';

export type AuthSmokeFixtureMode = 'inert-fixture-plan';

export type AuthSmokeHttpMethod = 'GET' | 'POST' | 'DELETE';

export type AuthSmokeDecision = 'allow' | 'deny';

export type AuthSmokeErrorCode =
  | 'origin_not_trusted'
  | 'csrf_failed'
  | 'invite_required'
  | 'rate_limit'
  | 'totp_required'
  | 'session_revoked';

export type AuthSmokeAuditEventName =
  | 'auth.sign_in.succeeded'
  | 'auth.session.revoke_requested'
  | 'auth.policy.denied'
  | 'auth.rate_limit.denied';

export interface AuthSmokeRequestShape {
  readonly method: AuthSmokeHttpMethod;
  readonly path: string;
  readonly origin: 'trusted' | 'missing' | 'invalid' | 'not-applicable';
  readonly csrfToken: 'valid' | 'missing' | 'invalid' | 'not-applicable';
  readonly actor: 'anonymous' | 'invited-user' | 'uninvited-user' | 'admin' | 'admin-without-totp';
  readonly action?: 'health-check' | 'sign-up' | 'sign-in' | 'admin-sensitive' | 'provider-key' | 'session-revoke';
}

export interface AuthSmokeFixtureShape {
  readonly mode: AuthSmokeFixtureMode;
  readonly name: string;
  readonly prerequisites: readonly string[];
}

export interface AuthSmokeAuditExpectation {
  readonly required: boolean;
  readonly eventNames: readonly AuthSmokeAuditEventName[];
  readonly evidence: readonly string[];
}

export interface AuthSmokeExpectedOutcome {
  readonly decision: AuthSmokeDecision;
  readonly response: readonly string[];
  readonly errorCode?: AuthSmokeErrorCode;
  readonly session: 'created' | 'invalidated' | 'unchanged' | 'not-applicable';
  readonly genericAuthError: boolean;
  readonly accountEnumerationSafe: boolean;
  readonly postconditions?: readonly string[];
  readonly audit: AuthSmokeAuditExpectation;
}

export interface AuthSmokeScenario {
  readonly id: AuthSmokeScenarioId;
  readonly title: string;
  readonly requirement: string;
  readonly request: AuthSmokeRequestShape;
  readonly fixture: AuthSmokeFixtureShape;
  readonly expected: AuthSmokeExpectedOutcome;
}

export const authSmokePlanMetadata = {
  phase: '0.4',
  source: 'docs\\impl-plan\\track-0-architecture-lock-implementation-setup.md section 9',
  fixtureMode: 'inert-fixture-plan',
  executable: false,
  productionCapability: 'not-enabled',
  governancePlan: 'docs\\governance\\auth-smoke-test-plan.md',
} as const;

export const authSmokeGlobalPrerequisites = [
  'Better Auth configuration skeleton exists with trusted origins, CSRF/origin checks, secure-cookie policy, invite-only users, rate limiting, and admin TOTP production gate documented.',
  'Fixture-mode runner can seed invited, uninvited, admin, and admin-without-TOTP principals without sending email or enabling production auth.',
  'Fixture-mode runner can simulate trusted, missing, and invalid Origin headers plus valid, missing, and invalid CSRF tokens.',
  'Audit sink fake captures immutable event name, actor, decision, reason/error code, session identifier when present, request trace identifier, and timestamp.',
  'Rate-limit fixture uses deterministic counters so excess attempts are reproducible without Redis, database, or production traffic.',
] as const;

export const genericAuthFailureExpectations = {
  appliesToScenarioIds: [
    'auth-origin-csrf-deny',
    'auth-invite-only-sign-up-deny',
    'auth-sensitive-rate-limit-deny',
    'auth-admin-totp-production-gate-deny',
    'auth-session-revoke-invalidated-audit',
  ],
  externalMessage: 'Authentication failed or request denied.',
  accountEnumerationSafe: true,
  requirements: [
    'Do not reveal whether an email, invite, account, session, or TOTP enrollment exists.',
    'Return stable typed error codes for policy/audit automation while keeping user-facing auth errors generic.',
    'Use the same external shape and timing class for unknown account, wrong credential, missing invite, and revoked session cases where practical.',
  ],
} as const;

export const authSmokeScenarios = [
  {
    id: 'auth-ok-health',
    title: 'GET /api/auth/ok health probe',
    requirement: 'GET /api/auth/ok returns { "status": "ok" }.',
    request: {
      method: 'GET',
      path: '/api/auth/ok',
      origin: 'not-applicable',
      csrfToken: 'not-applicable',
      actor: 'anonymous',
      action: 'health-check',
    },
    fixture: {
      mode: 'inert-fixture-plan',
      name: 'auth-health-no-session',
      prerequisites: ['Control API exposes a non-sensitive auth readiness route in test/fixture mode only.'],
    },
    expected: {
      decision: 'allow',
      response: ['{ "status": "ok" }'],
      session: 'not-applicable',
      genericAuthError: false,
      accountEnumerationSafe: true,
      audit: {
        required: false,
        eventNames: [],
        evidence: ['No session, account, or credential state is created or disclosed by the health probe.'],
      },
    },
  },
  {
    id: 'auth-origin-csrf-deny',
    title: 'Missing/invalid origin denied by trusted-origin/CSRF policy',
    requirement: 'Missing/invalid origin denied by trusted-origin/CSRF policy.',
    request: {
      method: 'POST',
      path: '/api/auth/sign-in/email',
      origin: 'invalid',
      csrfToken: 'missing',
      actor: 'anonymous',
      action: 'sign-in',
    },
    fixture: {
      mode: 'inert-fixture-plan',
      name: 'invalid-origin-missing-csrf',
      prerequisites: ['Trusted-origin allowlist contains only fixture-approved origins.', 'CSRF enforcement is enabled for state-changing auth routes.'],
    },
    expected: {
      decision: 'deny',
      response: ['Generic auth denial body.', 'No Set-Cookie session header.'],
      errorCode: 'origin_not_trusted',
      session: 'unchanged',
      genericAuthError: true,
      accountEnumerationSafe: true,
      audit: {
        required: true,
        eventNames: ['auth.policy.denied'],
        evidence: ['denial reason is origin_not_trusted or csrf_failed', 'origin classification', 'trace identifier'],
      },
    },
  },
  {
    id: 'auth-invite-only-sign-up-deny',
    title: 'Invite-only sign-up rejects uninvited user',
    requirement: 'Invite-only sign-up: uninvited user cannot create account.',
    request: {
      method: 'POST',
      path: '/api/auth/sign-up/email',
      origin: 'trusted',
      csrfToken: 'valid',
      actor: 'uninvited-user',
      action: 'sign-up',
    },
    fixture: {
      mode: 'inert-fixture-plan',
      name: 'uninvited-sign-up',
      prerequisites: ['Invite registry fixture has no active invite for the submitted email.', 'User table fixture has no preexisting account for the submitted email.'],
    },
    expected: {
      decision: 'deny',
      response: ['Generic auth denial body.', 'No user/account/session row is created.'],
      errorCode: 'invite_required',
      session: 'unchanged',
      genericAuthError: true,
      accountEnumerationSafe: true,
      audit: {
        required: true,
        eventNames: ['auth.policy.denied'],
        evidence: ['denial reason invite_required', 'hashed or redacted subject identifier', 'trace identifier'],
      },
    },
  },
  {
    id: 'auth-admin-sign-in-session-audit',
    title: 'Valid admin sign-in creates session and audit event',
    requirement: 'Valid admin sign-in: session created and audit event emitted.',
    request: {
      method: 'POST',
      path: '/api/auth/sign-in/email',
      origin: 'trusted',
      csrfToken: 'valid',
      actor: 'admin',
      action: 'sign-in',
    },
    fixture: {
      mode: 'inert-fixture-plan',
      name: 'valid-admin-sign-in',
      prerequisites: ['Admin fixture account is invited, active, verified, and uses fixture-only credentials.', 'Session store fake starts empty for the admin principal.'],
    },
    expected: {
      decision: 'allow',
      response: ['Session cookie or session token is issued by the future runtime.', 'No credential secret is returned.'],
      session: 'created',
      genericAuthError: false,
      accountEnumerationSafe: true,
      audit: {
        required: true,
        eventNames: ['auth.sign_in.succeeded'],
        evidence: ['admin actor identifier', 'created session identifier or fingerprint', 'trace identifier', 'timestamp'],
      },
    },
  },
  {
    id: 'auth-sensitive-rate-limit-deny',
    title: 'Sensitive endpoint rate limit denies excess attempts with typed error',
    requirement: 'Sensitive endpoint rate limit: excess attempts denied with typed error.',
    request: {
      method: 'POST',
      path: '/api/auth/sign-in/email',
      origin: 'trusted',
      csrfToken: 'valid',
      actor: 'anonymous',
      action: 'sign-in',
    },
    fixture: {
      mode: 'inert-fixture-plan',
      name: 'sensitive-route-rate-limit-exceeded',
      prerequisites: ['Rate-limit counter fixture is preloaded to one attempt below the sensitive endpoint threshold.', 'Final attempt crosses the threshold deterministically.'],
    },
    expected: {
      decision: 'deny',
      response: ['Typed error code rate_limit is available to tests and audit.', 'User-facing body remains generic.'],
      errorCode: 'rate_limit',
      session: 'unchanged',
      genericAuthError: true,
      accountEnumerationSafe: true,
      audit: {
        required: true,
        eventNames: ['auth.rate_limit.denied'],
        evidence: ['limit key or hashed actor/ip scope', 'threshold', 'retry-after or reset metadata', 'trace identifier'],
      },
    },
  },
  {
    id: 'auth-admin-totp-production-gate-deny',
    title: 'Admin without TOTP denied after production gate for provider-key/admin-sensitive actions',
    requirement: 'Admin without TOTP after production gate: denied from provider-key/admin-sensitive actions.',
    request: {
      method: 'POST',
      path: '/api/admin/provider-keys',
      origin: 'trusted',
      csrfToken: 'valid',
      actor: 'admin-without-totp',
      action: 'provider-key',
    },
    fixture: {
      mode: 'inert-fixture-plan',
      name: 'production-gate-admin-without-totp',
      prerequisites: ['Production gate fixture is enabled only inside the inert test plan.', 'Admin fixture has valid credentials and no verified TOTP enrollment.'],
    },
    expected: {
      decision: 'deny',
      response: ['Provider-key/admin-sensitive action is denied before mutation.', 'User-facing body remains generic or step-up-required without account enumeration.'],
      errorCode: 'totp_required',
      session: 'unchanged',
      genericAuthError: true,
      accountEnumerationSafe: true,
      audit: {
        required: true,
        eventNames: ['auth.policy.denied'],
        evidence: ['denial reason totp_required', 'admin actor identifier', 'action provider-key/admin-sensitive', 'trace identifier'],
      },
    },
  },
  {
    id: 'auth-session-revoke-invalidated-audit',
    title: 'Session revoke invalidates session and emits audit event',
    requirement: 'Session revoke: session invalidated and audit event emitted.',
    request: {
      method: 'POST',
      path: '/api/auth/session/revoke',
      origin: 'trusted',
      csrfToken: 'valid',
      actor: 'admin',
      action: 'session-revoke',
    },
    fixture: {
      mode: 'inert-fixture-plan',
      name: 'admin-session-revoke',
      prerequisites: ['Session store fake contains one active admin session.', 'Audit sink fake starts empty and rejects update/delete operations.'],
    },
    expected: {
      decision: 'allow',
      response: ['Session revoke returns a generic success body and does not expose credential state.'],
      session: 'invalidated',
      genericAuthError: false,
      accountEnumerationSafe: true,
      postconditions: ['Follow-up use of the revoked session is denied with typed session_revoked and a generic external body.'],
      audit: {
        required: true,
        eventNames: ['auth.session.revoke_requested'],
        evidence: ['revoked session identifier or fingerprint', 'admin actor identifier', 'trace identifier', 'timestamp'],
      },
    },
  },
] as const satisfies readonly AuthSmokeScenario[];
