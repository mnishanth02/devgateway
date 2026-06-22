export * from './auth-env.js';
export * from './object-storage-env.js';
export * from './retrieval-env.js';

export const configPackage = {
  name: '@devgateway/config',
  status: 'auth-retrieval-object-storage-env-baseline',
} as const;
