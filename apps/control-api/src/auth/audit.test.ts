import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAuthDatabaseHooks, createTestAuthAuditEmitter, requireAuthAuditEmitter, type AuthAuditEmitter } from './audit.ts';
import { createControlAuthOptions } from './config.ts';

describe('auth audit emitter', () => {
  it('requires an explicit immutable emitter instead of falling back to noop', () => {
    assert.throws(() => requireAuthAuditEmitter(undefined), /AuthAuditEmitter is required/u);
  });

  it('records hook events through the explicit test emitter', async () => {
    const emitter = createTestAuthAuditEmitter();
    const hooks = createAuthDatabaseHooks(emitter);

    await hooks.user?.create?.before?.({ id: 'user_1' } as never, undefined as never);

    assert.equal(emitter.events.length, 1);
    assert.equal(emitter.events[0]?.name, 'auth.user.create_requested');
    assert.equal(emitter.events[0]?.immutable, true);
    assert.equal(emitter.events[0]?.schemaVersion, 'auth-audit.v1');
  });

  it('emits auth audit events before mutation commit so sink failures block actions', async () => {
    const failingEmitter: AuthAuditEmitter = {
      async emit() {
        throw new Error('audit sink unavailable');
      },
    };
    const hooks = createAuthDatabaseHooks(failingEmitter);

    await assert.rejects(
      () => hooks.session?.create?.before?.({ userId: 'user_1' } as never, undefined as never) as Promise<void>,
      /audit sink unavailable/u,
    );
  });

  it('requires an explicit database adapter for production Better Auth options', () => {
    assert.throws(
      () =>
        createControlAuthOptions(
          {
            runtimeEnvironment: 'production',
            betterAuthUrl: 'https://api.example.com',
            betterAuthSecretIsSet: true,
            trustedOrigins: ['https://app.example.com'],
            useSecureCookies: true,
            rateLimit: {
              enabled: true,
              windowSeconds: 10,
              maxRequests: 100,
              storage: 'database',
              sensitiveEndpointRules: {},
            },
            adminBootstrap: {
              enabled: false,
              expiresAt: undefined,
              maxTtlSeconds: 900,
              tokenHashConfigured: false,
              tokenHashAlgorithm: undefined,
              singleUse: true,
              consumed: false,
              productionOperatorApproval: false,
            },
            sensitiveActionTotp: {
              required: true,
              factor: 'totp',
              roles: ['admin'],
              actions: ['production-auth-enable', 'provider-key-read', 'provider-key-rotate', 'break-glass-token-mint'],
              freshSessionSeconds: 3600,
              beforeProductionEnablement: true,
            },
            servicePrincipals: {
              humanSessionAllowed: false,
              tokenKind: 'signed-service-token',
              betterAuthSessionAllowed: false,
              maxTokenTtlSeconds: 900,
            },
            genericAuthError: {
              code: 'AUTHENTICATION_FAILED',
              message: 'Authentication failed',
            },
          },
          { auditEmitter: createTestAuthAuditEmitter() },
        ),
      /requires an explicit Operational Postgres/u,
    );
  });
});
