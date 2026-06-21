import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadAuthEnv, validateAdminBootstrapPosture, validateAuthProductionPosture } from './auth-env.ts';

describe('auth environment config', () => {
  it('keeps admin bootstrap disabled by default with production fail-closed defaults', () => {
    const config = loadAuthEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.com',
      BETTER_AUTH_SECRET: 'production-secret-with-at-least-32-chars',
      BETTER_AUTH_TRUSTED_ORIGINS: 'https://app.example.com',
    });

    assert.equal(config.adminBootstrap.enabled, false);
    assert.equal(config.adminBootstrap.singleUse, true);
    assert.equal(config.adminBootstrap.tokenHashConfigured, false);
    assert.equal(config.rateLimit.storage, 'database');
    assert.deepEqual(Object.keys(config.rateLimit.sensitiveEndpointRules).sort(), [
      '/change-password',
      '/sign-in/email',
      '/sign-up/email',
      '/two-factor/verify-totp',
    ]);
    assert.deepEqual(validateAuthProductionPosture(config), []);
  });

  it('requires short TTL, single-use token hash, and production approval when bootstrap is enabled', () => {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const config = loadAuthEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.com',
      BETTER_AUTH_SECRET: 'production-secret-with-at-least-32-chars',
      BETTER_AUTH_TRUSTED_ORIGINS: 'https://app.example.com',
      AUTH_ADMIN_BOOTSTRAP_ENABLED: 'true',
      AUTH_ADMIN_BOOTSTRAP_EXPIRES_AT: expiresAt,
      AUTH_ADMIN_BOOTSTRAP_TOKEN_HASH: `sha256:${'a'.repeat(64)}`,
      AUTH_ADMIN_BOOTSTRAP_SINGLE_USE: 'true',
      AUTH_ADMIN_BOOTSTRAP_OPERATOR_APPROVAL: 'true',
    });

    assert.equal(config.adminBootstrap.enabled, true);
    assert.equal(config.adminBootstrap.tokenHashAlgorithm, 'sha256');
    assert.deepEqual(validateAdminBootstrapPosture(config), []);
  });

  it('rejects long-lived bootstrap windows', () => {
    assert.throws(
      () =>
        loadAuthEnv({
          NODE_ENV: 'development',
          AUTH_ADMIN_BOOTSTRAP_ENABLED: 'true',
          AUTH_ADMIN_BOOTSTRAP_EXPIRES_AT: new Date(Date.now() + 16 * 60 * 1000).toISOString(),
          AUTH_ADMIN_BOOTSTRAP_TOKEN_HASH: `sha256:${'b'.repeat(64)}`,
          AUTH_ADMIN_BOOTSTRAP_SINGLE_USE: 'true',
        }),
      /15 minutes or less/u,
    );
  });
});
