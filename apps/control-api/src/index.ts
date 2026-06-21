import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.ts';

export * from './auth/index.ts';
export * from './openapi/index.ts';
export * from './policies/index.ts';
export * from './policies/control-errors.ts';
export * from './routes/auth.ts';
export * from './routes/budgets.ts';
export * from './routes/cost-events.ts';
export * from './routes/virtual-keys.ts';
export * from './routes/bifrost-config.ts';
export * from './routes/policy.ts';
export * from './routes/registry.ts';
export * from './routes/snapshot-common.ts';
export * from './server.ts';

export const control_apiPackage = {
  name: '@devgateway/control-api',
  status: 'fastify-openapi-auth-foundation',
} as const;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
}
