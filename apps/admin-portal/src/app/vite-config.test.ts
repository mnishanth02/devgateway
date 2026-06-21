import { describe, expect, it } from 'vitest';
import { controlApiProxy } from '../../vite.config.js';

describe('admin portal Vite proxy config', () => {
  it('keeps /api same-origin auth proxy available for dev and preview', () => {
    expect(controlApiProxy['/api'].target).toBe('http://127.0.0.1:43100');
    expect(controlApiProxy['/api'].changeOrigin).toBe(true);
  });

  it('proxies every Control API surface the operational panels read', () => {
    for (const path of ['/healthz', '/readyz', '/openapi.json', '/registry', '/policy', '/bifrost'] as const) {
      expect(controlApiProxy[path].target).toBe('http://127.0.0.1:43100');
      expect(controlApiProxy[path].changeOrigin).toBe(true);
    }
  });
});
