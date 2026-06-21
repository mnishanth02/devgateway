export * from './server.js';
export * from './auth/sensitive-action-guards.js';
export * from './app/auth-session.js';
export * from './app/query-client.js';
export * from './app/router.js';

export const admin_portalPackage = {
  name: '@devgateway/admin-portal',
  status: 'phase-1-6-portal-shell',
  features: ['sensitive-action-guards', 'vite-react-shell'] as const,
} as const;
