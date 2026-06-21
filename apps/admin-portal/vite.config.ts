import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const controlApiTarget = {
  target: 'http://127.0.0.1:43100',
  changeOrigin: true,
  secure: false,
} as const;

export const controlApiProxy = {
  '/api': controlApiTarget,
  '/healthz': controlApiTarget,
  '/readyz': controlApiTarget,
  '/openapi.json': controlApiTarget,
  '/registry': controlApiTarget,
  '/policy': controlApiTarget,
  '/bifrost': controlApiTarget,
} as const;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 43101,
    strictPort: true,
    proxy: controlApiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 43101,
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
