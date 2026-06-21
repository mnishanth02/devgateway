import { describe, expect, it } from 'vitest';
import {
  BETTER_AUTH_SESSION_ENDPOINT,
  ControlAuthSessionError,
  fetchBetterAuthSession,
  isAuthNotConfiguredError,
  parseBetterAuthSessionPayload,
  type BetterAuthAdminSession,
} from './auth-session.js';

const sessionFixture: BetterAuthAdminSession = {
  session: {
    id: 'session_1',
    userId: 'user_1',
    expiresAt: '2026-06-21T08:00:00.000Z',
  },
  user: {
    id: 'user_1',
    name: 'Mina Ops',
    email: 'operator@example.test',
    role: 'admin',
  },
};

describe('Better Auth admin session parsing', () => {
  it('accepts the Better Auth session/user shape directly or under data', () => {
    expect(parseBetterAuthSessionPayload(sessionFixture)).toEqual(sessionFixture);
    expect(parseBetterAuthSessionPayload({ data: sessionFixture })).toEqual(sessionFixture);
    expect(parseBetterAuthSessionPayload({ data: null })).toBeNull();
  });

  it('rejects non-admin Better Auth sessions', () => {
    expect(parseBetterAuthSessionPayload({ ...sessionFixture, user: { ...sessionFixture.user, role: 'member' } })).toBeNull();
  });

  it('fetches the session endpoint with cookies and no cache bypass', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const session = await fetchBetterAuthSession({
      fetchImpl: async (input, init) => {
        calls.push([input, init]);
        return Response.json(sessionFixture);
      },
    });

    expect(session).toEqual(sessionFixture);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(BETTER_AUTH_SESSION_ENDPOINT);
    expect(calls[0]?.[1]?.credentials).toBe('include');
    expect(calls[0]?.[1]?.cache).toBe('no-store');
  });

  it('fails closed when the session endpoint returns unauthorized', async () => {
    await expect(
      fetchBetterAuthSession({
        fetchImpl: async () => new Response(null, { status: 401 }),
      }),
    ).resolves.toBeNull();
  });

  it('surfaces a typed AUTH_NOT_CONFIGURED error so local dev can detect it', async () => {
    const error = await fetchBetterAuthSession({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ControlAuthSessionError);
    expect(isAuthNotConfiguredError(error)).toBe(true);
    expect((error as ControlAuthSessionError).status).toBe(503);
  });

  it('does not treat a generic 500 as auth-not-configured', async () => {
    const error = await fetchBetterAuthSession({
      fetchImpl: async () => new Response(null, { status: 500 }),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ControlAuthSessionError);
    expect(isAuthNotConfiguredError(error)).toBe(false);
  });
});
