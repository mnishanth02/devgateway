import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const defaultControlApiBaseUrl = 'http://127.0.0.1:43100';
const defaultPortalPort = 43101;

export function resolveControlApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.CONTROL_API_BASE_URL?.trim() || defaultControlApiBaseUrl;
}

export function resolvePortalHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOST?.trim() || (env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
}

export function resolvePortalPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT?.trim();
  if (!raw) return defaultPortalPort;

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535. Received: ${raw}`);
  }
  return port;
}

export function createControlApiProxy(target = resolveControlApiBaseUrl()) {
  return {
    '/api': {
      target,
      changeOrigin: true,
      secure: false,
    },
    '/healthz': {
      target,
      changeOrigin: true,
      secure: false,
    },
    '/readyz': {
      target,
      changeOrigin: true,
      secure: false,
    },
    '/openapi.json': {
      target,
      changeOrigin: true,
      secure: false,
    },
    '/registry': {
      target,
      changeOrigin: true,
      secure: false,
    },
    '/policy': {
      target,
      changeOrigin: true,
      secure: false,
    },
    '/bifrost': {
      target,
      changeOrigin: true,
      secure: false,
    },
  } as const;
}

export const controlApiProxy = createControlApiProxy();

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: resolvePortalHost(),
    port: resolvePortalPort(),
    strictPort: true,
    proxy: controlApiProxy,
  },
  preview: {
    host: resolvePortalHost(),
    port: resolvePortalPort(),
    strictPort: true,
    proxy: controlApiProxy,
  },
  test: {
    environment: 'jsdom',
    css: true,
    include: ['src/app/**/*.test.ts', 'src/app/**/*.test.tsx', 'src/features/**/*.test.ts', 'src/main.test.tsx'],
    restoreMocks: true,
    clearMocks: true,
  },
});
