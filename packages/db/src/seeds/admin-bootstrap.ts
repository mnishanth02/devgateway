export const adminBootstrapSeed = {
  id: 'admin-bootstrap',
  purpose: 'Create exactly one initial admin invite or account through an explicit, gated bootstrap flow.',
  environmentGate: 'AUTH_ADMIN_BOOTSTRAP_ENABLED',
  enabledByDefault: false,
  singleUseRequired: true,
  ttlRequired: true,
  storesPlaintextCredentials: false,
  storesProviderKeys: false,
  requiresOperatorSuppliedSecretHash: true,
  auditEvents: ['auth.admin_bootstrap.created', 'auth.admin_bootstrap.consumed'],
} as const;

export type AdminBootstrapSeed = typeof adminBootstrapSeed;
