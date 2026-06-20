import type { AuthEnvConfig } from '@devgateway/config';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { createAuthDatabaseHooks, type AuthAuditEmitter } from './audit.js';

export const AUTH_BASE_PATH = '/api/auth';

export interface ControlAuthRuntimeBindings {
  readonly database?: BetterAuthOptions['database'];
  readonly secondaryStorage?: BetterAuthOptions['secondaryStorage'];
  readonly explicitBaseURL?: string;
  readonly explicitSecret?: string;
  readonly auditEmitter?: AuthAuditEmitter;
}

export type ControlAuth = ReturnType<typeof betterAuth>;

export function createControlAuthOptions(
  env: AuthEnvConfig,
  bindings: ControlAuthRuntimeBindings = {},
): BetterAuthOptions {
  const options: BetterAuthOptions = {
    appName: 'DevGateway',
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [...env.trustedOrigins],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      freshAge: env.sensitiveActionTotp.freshSessionSeconds,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
        strategy: 'jwe',
        version: 'auth-baseline-v1',
      },
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: 'cookie',
    },
    rateLimit: {
      enabled: env.rateLimit.enabled,
      window: env.rateLimit.windowSeconds,
      max: env.rateLimit.maxRequests,
      storage: env.rateLimit.storage,
      customRules: Object.fromEntries(
        Object.entries(env.rateLimit.sensitiveEndpointRules).map(([path, rule]) => [
          path,
          { window: rule.windowSeconds, max: rule.maxRequests },
        ]),
      ),
    },
    advanced: {
      useSecureCookies: env.useSecureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      defaultCookieAttributes: {
        sameSite: 'lax',
      },
      ipAddress: {
        ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
        disableIpTracking: false,
        ipv6Subnet: 64,
      },
    },
    plugins: [
      twoFactor({
        issuer: 'DevGateway',
        skipVerificationOnEnable: false,
        allowPasswordless: false,
        twoFactorCookieMaxAge: 10 * 60,
        trustDeviceMaxAge: 0,
      }),
    ],
    databaseHooks: createAuthDatabaseHooks(bindings.auditEmitter),
  };

  if (bindings.database !== undefined) {
    options.database = bindings.database;
  }
  if (bindings.secondaryStorage !== undefined) {
    options.secondaryStorage = bindings.secondaryStorage;
  }
  if (env.betterAuthUrl === undefined && bindings.explicitBaseURL !== undefined) {
    options.baseURL = validateExplicitBaseURL(bindings.explicitBaseURL, env.runtimeEnvironment);
  }
  if (!env.betterAuthSecretIsSet && bindings.explicitSecret !== undefined) {
    options.secret = validateExplicitSecret(bindings.explicitSecret);
  }

  return options;
}

export function createControlAuth(env: AuthEnvConfig, bindings: ControlAuthRuntimeBindings = {}): ControlAuth {
  return betterAuth(createControlAuthOptions(env, bindings));
}

function validateExplicitBaseURL(raw: string, runtimeEnvironment: AuthEnvConfig['runtimeEnvironment']): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('explicitBaseURL must be an absolute http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('explicitBaseURL must use http or https');
  }
  if (runtimeEnvironment === 'production' && url.protocol !== 'https:') {
    throw new Error('explicitBaseURL must use https in production');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('explicitBaseURL must not include credentials, query, or fragment');
  }
  return url.toString().replace(/\/$/u, '');
}

function validateExplicitSecret(raw: string): string {
  const secret = raw.trim();
  if (secret.length < 32) {
    throw new Error('explicitSecret must be at least 32 characters');
  }
  return secret;
}
