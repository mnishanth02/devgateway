export const BETTER_AUTH_SESSION_ENDPOINT = '/api/auth/get-session';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SessionTimestamp = Date | string;

export interface BetterAuthAdminSession {
  readonly session: {
    readonly id: string;
    readonly userId: string;
    readonly expiresAt: SessionTimestamp;
    readonly createdAt?: SessionTimestamp;
    readonly updatedAt?: SessionTimestamp;
    readonly ipAddress?: string | null;
    readonly userAgent?: string | null;
  };
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified?: boolean;
    readonly image?: string | null;
    readonly role?: string | null;
  };
}

export interface FetchBetterAuthSessionOptions {
  readonly signal?: AbortSignal;
  readonly fetchImpl?: FetchLike;
}

export const AUTH_NOT_CONFIGURED_CODE = 'AUTH_NOT_CONFIGURED';

export class ControlAuthSessionError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'ControlAuthSessionError';
    this.status = status;
    this.code = code;
  }
}

export function isAuthNotConfiguredError(error: unknown): error is ControlAuthSessionError {
  return (
    error instanceof ControlAuthSessionError &&
    error.status === 503 &&
    error.code === AUTH_NOT_CONFIGURED_CODE
  );
}

export async function fetchBetterAuthSession(
  options: FetchBetterAuthSessionOptions = {},
): Promise<BetterAuthAdminSession | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    throw new Error('fetch is required to resolve the Better Auth admin session');
  }

  const init: RequestInit = {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
    },
  };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  const response = await fetchImpl(BETTER_AUTH_SESSION_ENDPOINT, init);
  if (response.status === 204 || response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new ControlAuthSessionError(
      response.status,
      code,
      `Better Auth session check failed with HTTP ${response.status}`,
    );
  }

  const payload = (await response.json()) as unknown;
  return parseBetterAuthSessionPayload(payload);
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.clone().json()) as unknown;
    if (payload !== null && typeof payload === 'object' && 'error' in payload) {
      const error = (payload as { error?: unknown }).error;
      if (error !== null && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function parseBetterAuthSessionPayload(payload: unknown): BetterAuthAdminSession | null {
  if (payload === null) return null;
  if (isBetterAuthSessionShape(payload) && !isBetterAuthAdminSession(payload)) return null;
  if (isBetterAuthAdminSession(payload)) return payload;

  if (isRecord(payload) && 'data' in payload) {
    const data = payload.data;
    if (data === null) return null;
    if (isBetterAuthSessionShape(data) && !isBetterAuthAdminSession(data)) return null;
    if (isBetterAuthAdminSession(data)) return data;
  }

  throw new Error('Better Auth session response did not match the expected session/user shape');
}

export function isBetterAuthAdminSession(value: unknown): value is BetterAuthAdminSession {
  return isBetterAuthSessionShape(value) && value.user.role === 'admin';
}

function isBetterAuthSessionShape(value: unknown): value is BetterAuthAdminSession {
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.user)) {
    return false;
  }

  return (
    typeof value.session.id === 'string' &&
    typeof value.session.userId === 'string' &&
    isTimestamp(value.session.expiresAt) &&
    typeof value.user.id === 'string' &&
    typeof value.user.name === 'string' &&
    typeof value.user.email === 'string'
  );
}

function isTimestamp(value: unknown): value is SessionTimestamp {
  return typeof value === 'string' || value instanceof Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
