import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAdminPortal, type AdminPortalRuntime } from './main.js';
import type { BetterAuthAdminSession } from './app/auth-session.js';

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

describe('admin portal bootstrap', () => {
  let runtime: AdminPortalRuntime | undefined;

  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    runtime?.unmount();
    runtime = undefined;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('mounts the router and query providers into the Vite root', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(sessionFixture)));
    const container = document.createElement('div');
    container.id = 'root';
    document.body.append(container);

    runtime = bootstrapAdminPortal(container);

    expect(await screen.findByText('Admin session verified')).toBeTruthy();
    expect(screen.getByText('Track 1 command board')).toBeTruthy();
  });
});
