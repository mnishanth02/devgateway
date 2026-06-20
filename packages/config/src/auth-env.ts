export type RuntimeEnvironment = 'development' | 'test' | 'production';

export type AuthRateLimitStorage = 'memory' | 'database' | 'secondary-storage';

export type AuthEnvValidationDecision = 'allow' | 'deny';

export type AuthSensitiveAction =
  | 'production-auth-enable'
  | 'provider-key-read'
  | 'provider-key-rotate'
  | 'break-glass-token-mint';

export interface AuthRateLimitPolicy {
  readonly enabled: true;
  readonly windowSeconds: number;
  readonly maxRequests: number;
  readonly storage: AuthRateLimitStorage;
  readonly sensitiveEndpointRules: Readonly<Record<string, AuthRateLimitRule>>;
}

export interface AuthRateLimitRule {
  readonly windowSeconds: number;
  readonly maxRequests: number;
}

export interface AuthTotpRequirement {
  readonly required: true;
  readonly factor: 'totp';
  readonly roles: readonly ['admin'];
  readonly actions: readonly AuthSensitiveAction[];
  readonly freshSessionSeconds: number;
  readonly beforeProductionEnablement: true;
}

export interface ServicePrincipalAuthPolicy {
  readonly humanSessionAllowed: false;
  readonly tokenKind: 'signed-service-token';
  readonly betterAuthSessionAllowed: false;
  readonly maxTokenTtlSeconds: number;
}

export interface GenericAuthErrorPolicy {
  readonly code: 'AUTHENTICATION_FAILED';
  readonly message: 'Authentication failed';
}

export interface AuthEnvConfig {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly betterAuthUrl: string | undefined;
  readonly betterAuthSecretIsSet: boolean;
  readonly trustedOrigins: readonly string[];
  readonly useSecureCookies: boolean;
  readonly rateLimit: AuthRateLimitPolicy;
  readonly sensitiveActionTotp: AuthTotpRequirement;
  readonly servicePrincipals: ServicePrincipalAuthPolicy;
  readonly genericAuthError: GenericAuthErrorPolicy;
}

export type AuthEnvInput = Readonly<Record<string, string | undefined>>;

export interface AuthEnvValidationScenario {
  readonly id: string;
  readonly title: string;
  readonly input: AuthEnvInput;
  readonly expected: {
    readonly decision: AuthEnvValidationDecision;
    readonly rateLimitStorage?: AuthRateLimitStorage;
    readonly errorIncludes?: string;
  };
}

const runtimeEnvironments = new Set<RuntimeEnvironment>(['development', 'test', 'production']);
const rateLimitStorages = new Set<AuthRateLimitStorage>(['memory', 'database', 'secondary-storage']);
const placeholderSecrets = new Set([
  'better-auth-secret-123456789',
  'changeme',
  'change-me',
  'dev-secret',
  'secret',
  'test-secret',
]);

export const authEnvValidationScenarios = [
  {
    id: 'development-rate-limit-memory-storage-allowed',
    title: 'Development may explicitly use in-memory rate-limit storage.',
    input: {
      NODE_ENV: 'development',
      BETTER_AUTH_RATE_LIMIT_STORAGE: 'memory',
    },
    expected: {
      decision: 'allow',
      rateLimitStorage: 'memory',
    },
  },
  {
    id: 'production-rate-limit-database-default',
    title: 'Production defaults to persistent database rate-limit storage.',
    input: {
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.com',
      BETTER_AUTH_SECRET: 'production-secret-with-at-least-32-chars',
      BETTER_AUTH_TRUSTED_ORIGINS: 'https://app.example.com',
    },
    expected: {
      decision: 'allow',
      rateLimitStorage: 'database',
    },
  },
  {
    id: 'production-rate-limit-memory-storage-denied',
    title: 'Production rejects explicit in-memory rate-limit storage.',
    input: {
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.com',
      BETTER_AUTH_SECRET: 'production-secret-with-at-least-32-chars',
      BETTER_AUTH_TRUSTED_ORIGINS: 'https://app.example.com',
      BETTER_AUTH_RATE_LIMIT_STORAGE: 'memory',
    },
    expected: {
      decision: 'deny',
      errorIncludes: 'development-only',
    },
  },
] as const satisfies readonly AuthEnvValidationScenario[];

export function loadAuthEnv(input: AuthEnvInput): AuthEnvConfig {
  const runtimeEnvironment = parseRuntimeEnvironment(input.NODE_ENV);
  const betterAuthUrl = parseBetterAuthUrl(input.BETTER_AUTH_URL, runtimeEnvironment);
  const betterAuthSecretIsSet = parseBetterAuthSecret(input.BETTER_AUTH_SECRET, runtimeEnvironment);
  const trustedOrigins = parseTrustedOrigins(input.BETTER_AUTH_TRUSTED_ORIGINS, runtimeEnvironment);

  if (runtimeEnvironment === 'production' && trustedOrigins.length === 0) {
    throw new Error('BETTER_AUTH_TRUSTED_ORIGINS must be set in production');
  }

  return {
    runtimeEnvironment,
    betterAuthUrl,
    betterAuthSecretIsSet,
    trustedOrigins,
    useSecureCookies: parseSecureCookieDecision(input.BETTER_AUTH_SECURE_COOKIES, runtimeEnvironment),
    rateLimit: {
      enabled: true,
      windowSeconds: parsePositiveInteger(input.BETTER_AUTH_RATE_LIMIT_WINDOW_SECONDS, 10, 'BETTER_AUTH_RATE_LIMIT_WINDOW_SECONDS'),
      maxRequests: parsePositiveInteger(input.BETTER_AUTH_RATE_LIMIT_MAX, 100, 'BETTER_AUTH_RATE_LIMIT_MAX'),
      storage: parseRateLimitStorage(input.BETTER_AUTH_RATE_LIMIT_STORAGE, runtimeEnvironment),
      sensitiveEndpointRules: {
        '/api/auth/sign-in/email': { windowSeconds: 60, maxRequests: 5 },
        '/api/auth/sign-up/email': { windowSeconds: 60, maxRequests: 3 },
        '/api/auth/change-password': { windowSeconds: 60, maxRequests: 3 },
        '/api/auth/two-factor/verify-totp': { windowSeconds: 60, maxRequests: 5 },
      },
    },
    sensitiveActionTotp: {
      required: true,
      factor: 'totp',
      roles: ['admin'],
      actions: ['production-auth-enable', 'provider-key-read', 'provider-key-rotate', 'break-glass-token-mint'],
      freshSessionSeconds: 60 * 60,
      beforeProductionEnablement: true,
    },
    servicePrincipals: {
      humanSessionAllowed: false,
      tokenKind: 'signed-service-token',
      betterAuthSessionAllowed: false,
      maxTokenTtlSeconds: 15 * 60,
    },
    genericAuthError: {
      code: 'AUTHENTICATION_FAILED',
      message: 'Authentication failed',
    },
  };
}

export function parseTrustedOrigins(raw: string | undefined, runtimeEnvironment: RuntimeEnvironment): readonly string[] {
  if (!raw?.trim()) return [];

  const origins = new Set<string>();
  for (const part of raw.split(',')) {
    const candidate = part.trim();
    if (!candidate) continue;
    origins.add(normalizeTrustedOrigin(candidate, runtimeEnvironment));
  }
  return [...origins].sort();
}

function parseRuntimeEnvironment(raw: string | undefined): RuntimeEnvironment {
  const value = raw ?? 'development';
  if (!runtimeEnvironments.has(value as RuntimeEnvironment)) {
    throw new Error(`NODE_ENV must be one of: ${[...runtimeEnvironments].join(', ')}`);
  }
  return value as RuntimeEnvironment;
}

function parseBetterAuthUrl(raw: string | undefined, runtimeEnvironment: RuntimeEnvironment): string | undefined {
  if (!raw?.trim()) {
    if (runtimeEnvironment === 'production') {
      throw new Error('BETTER_AUTH_URL must be set in production');
    }
    return undefined;
  }

  const url = parseHttpUrl(raw, 'BETTER_AUTH_URL', runtimeEnvironment);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('BETTER_AUTH_URL must not include credentials, query, or fragment');
  }
  return url.toString().replace(/\/$/u, '');
}

function parseBetterAuthSecret(raw: string | undefined, runtimeEnvironment: RuntimeEnvironment): boolean {
  if (!raw) {
    if (runtimeEnvironment === 'production') {
      throw new Error('BETTER_AUTH_SECRET must be set in production');
    }
    return false;
  }

  const secret = raw.trim();
  if (secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  }
  if (placeholderSecrets.has(secret.toLowerCase())) {
    throw new Error('BETTER_AUTH_SECRET must not use a placeholder value');
  }
  return true;
}

function normalizeTrustedOrigin(raw: string, runtimeEnvironment: RuntimeEnvironment): string {
  if (raw.includes('*')) {
    return normalizeWildcardOrigin(raw, runtimeEnvironment);
  }

  const url = parseHttpUrl(raw, 'BETTER_AUTH_TRUSTED_ORIGINS', runtimeEnvironment);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Trusted origin ${raw} must be an origin only`);
  }
  return url.origin;
}

function normalizeWildcardOrigin(raw: string, runtimeEnvironment: RuntimeEnvironment): string {
  const wildcardPattern = /^(?:(https?):\/\/)?\*\.[a-z0-9][a-z0-9.-]*(?::\d{1,5})?$/iu;
  const match = wildcardPattern.exec(raw);
  if (!match) {
    throw new Error(`Trusted wildcard origin ${raw} is invalid`);
  }
  const protocol = match[1]?.toLowerCase();
  if (runtimeEnvironment === 'production' && protocol === 'http') {
    throw new Error(`Trusted wildcard origin ${raw} must use https in production`);
  }
  return raw;
}

function parseHttpUrl(raw: string, name: string, runtimeEnvironment: RuntimeEnvironment): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
  if (runtimeEnvironment === 'production' && url.protocol !== 'https:') {
    throw new Error(`${name} must use https in production`);
  }
  return url;
}

function parseSecureCookieDecision(raw: string | undefined, runtimeEnvironment: RuntimeEnvironment): boolean {
  if (runtimeEnvironment === 'production') return true;
  if (raw === undefined) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error('BETTER_AUTH_SECURE_COOKIES must be "true" or "false"');
}

function parseRateLimitStorage(raw: string | undefined, runtimeEnvironment: RuntimeEnvironment): AuthRateLimitStorage {
  if (raw === undefined) return runtimeEnvironment === 'production' ? 'database' : 'memory';
  if (!rateLimitStorages.has(raw as AuthRateLimitStorage)) {
    throw new Error(`BETTER_AUTH_RATE_LIMIT_STORAGE must be one of: ${[...rateLimitStorages].join(', ')}`);
  }
  const storage = raw as AuthRateLimitStorage;
  if (runtimeEnvironment === 'production' && storage === 'memory') {
    throw new Error('BETTER_AUTH_RATE_LIMIT_STORAGE=memory is development-only; use database or secondary-storage in production');
  }
  return storage;
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number.parseInt(raw, 10);
}
