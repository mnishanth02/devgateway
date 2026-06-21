import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminQueryClient } from './query-client.js';
import { createAdminRouter } from './router.js';
import type { BetterAuthAdminSession } from './auth-session.js';

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

const registryFixture = {
  registry_version: 'model-aliases.v0.1',
  production_enabled: false,
  snapshot: {
    production_posture: { production_enabled: false, production_route_allowed: false },
    model_aliases: [
      {
        alias: 'claude-fast',
        lifecycle_status: 'approved',
        production_gate: { production_route_allowed: false },
        eval_gate: { latest_gate_status: 'passing' },
        candidates: [
          {
            candidate_id: 'anthropic-claude',
            provider_id: 'anthropic',
            provider_region: 'us-east-1',
            model_id: 'claude-3-5-haiku',
            allowed_data_classes: ['public', 'internal'],
            manual_approval_gate: { status: 'pending' },
          },
        ],
      },
    ],
  },
};

describe('admin portal router and authenticated layout', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the Track 1 panels after a Better Auth admin session resolves', async () => {
    stubControlApi({ session: Response.json(sessionFixture) });
    renderRouter();

    expect(await screen.findByText('Mina Ops')).toBeTruthy();
    expect(screen.getByText('operator@example.test · admin')).toBeTruthy();
    expect(await screen.findByText('Gateway health / readiness')).toBeTruthy();
    expect(await screen.findByText('claude-fast')).toBeTruthy();
    expect(screen.getByText('Registry route posture')).toBeTruthy();
  });

  it('renders the local-dev preview when the Control API reports AUTH_NOT_CONFIGURED', async () => {
    stubControlApi({
      session: new Response(
        JSON.stringify({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    });
    renderRouter();

    expect(await screen.findByText('Local dev — unauthenticated preview')).toBeTruthy();
    expect(await screen.findByText('Gateway health / readiness')).toBeTruthy();
  });

  it('fails closed for authenticated non-admin sessions', async () => {
    stubControlApi({ session: Response.json({ ...sessionFixture, user: { ...sessionFixture.user, role: 'member' } }) });
    renderRouter();

    expect(await screen.findByText('No admin session found.')).toBeTruthy();
    expect(screen.queryByText('Registry route posture')).toBeNull();
  });

  it('fails closed when no Better Auth session is present', async () => {
    stubControlApi({ session: new Response(null, { status: 401 }) });
    renderRouter();

    expect(await screen.findByText('No admin session found.')).toBeTruthy();
    expect(screen.getByText('Authentication required')).toBeTruthy();
    expect(screen.queryByText('Registry route posture')).toBeNull();
  });
});

function renderRouter(): void {
  const queryClient = createAdminQueryClient();
  const router = createAdminRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function stubControlApi(overrides: { readonly session: Response }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/get-session')) return overrides.session.clone();
      if (url.includes('/healthz')) {
        return Response.json({ service: '@devgateway/control-api', status: 'ok', port: 43100 });
      }
      if (url.includes('/readyz')) {
        return Response.json({
          service: '@devgateway/control-api',
          status: 'ready',
          checks: { configuration: 'ok', productionRoutes: 'disabled' },
        });
      }
      if (url.includes('/registry/current')) return Response.json(registryFixture);
      if (url.includes('/bifrost/config/validation')) {
        return Response.json({ route_config_version: 'bifrost.model-aliases.v0.1.disabled', production_enabled: false, errors: [] });
      }
      if (url.includes('/openapi.json')) return Response.json({ paths: {} });
      if (url.includes('/api/virtual-keys') || url.includes('/api/budget-spend') || url.includes('/api/cost-events')) {
        return new Response(JSON.stringify({ error: { code: 'missing_auth', message: 'Authentication required' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
}
