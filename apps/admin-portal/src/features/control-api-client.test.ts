import { describe, expect, it, vi } from 'vitest';
import {
  CONTROL_API_SNAPSHOT_ENDPOINTS,
  fetchControlApiResult,
  fetchOperationalSnapshot,
} from './control-api-client.js';

describe('control API client', () => {
  it('returns parsed body for 2xx responses and sends credentials', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ status: 'ok' }));
    const result = await fetchControlApiResult('/healthz', { fetchImpl });

    expect(result).toMatchObject({ ok: true, status: 200, path: '/healthz', body: { status: 'ok' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe('include');
    expect(fetchImpl.mock.calls[0]?.[1]?.cache).toBe('no-store');
  });

  it('maps fail-closed responses to a typed error without a body', async () => {
    const result = await fetchControlApiResult('/api/virtual-keys', {
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'missing_auth', message: 'Authentication required' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.body).toBeNull();
    expect(result.error).toBe('missing_auth: Authentication required');
  });

  it('reports offline status when fetch throws', async () => {
    const result = await fetchControlApiResult('/readyz', {
      fetchImpl: async () => {
        throw new Error('connection refused');
      },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe('connection refused');
  });

  it('assembles a snapshot result for every control API endpoint key', async () => {
    const snapshot = await fetchOperationalSnapshot({
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/api/')) return new Response(null, { status: 401 });
        return Response.json({ ok: true });
      },
    });

    for (const key of Object.keys(CONTROL_API_SNAPSHOT_ENDPOINTS) as Array<keyof typeof CONTROL_API_SNAPSHOT_ENDPOINTS>) {
      expect(snapshot[key]).toBeDefined();
      expect(snapshot[key].path).toBe(CONTROL_API_SNAPSHOT_ENDPOINTS[key]);
    }
    expect(snapshot.virtualKeys.status).toBe(401);
    expect(snapshot.registry.ok).toBe(true);
  });
});
