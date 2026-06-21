import { describe, expect, it } from 'vitest';
import {
  controlApiProxy,
  createControlApiProxy,
  resolveControlApiBaseUrl,
  resolvePortalHost,
  resolvePortalPort,
} from '../../vite.config.js';

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

  it('allows hosted environments to override the Control API proxy target', () => {
    const proxy = createControlApiProxy('https://control-api.example.test');
    expect(proxy['/api'].target).toBe('https://control-api.example.test');
    expect(proxy['/readyz'].target).toBe('https://control-api.example.test');
  });

  it('resolves deploy-safe host, port, and Control API target from environment variables', () => {
    expect(resolveControlApiBaseUrl({ CONTROL_API_BASE_URL: 'https://control-api.example.test' })).toBe(
      'https://control-api.example.test',
    );
    expect(resolvePortalHost({ RAILWAY_ENVIRONMENT: 'development' })).toBe('0.0.0.0');
    expect(resolvePortalPort({ PORT: '43121' })).toBe(43121);
  });
});
