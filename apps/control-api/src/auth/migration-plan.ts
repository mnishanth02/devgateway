export const authSchemaMigrationPlan = {
  ownerPackage: '@devgateway/db',
  generator: 'Better Auth CLI output reconciled into Drizzle migrations',
  database: 'Operational Postgres',
  productionMigrationEnabledByDefault: false,
  requiredSteps: [
    'Generate Better Auth schema after plugin changes.',
    'Review Better Auth model names before mapping to physical table names.',
    'Reconcile generated auth tables into packages\\db Drizzle migrations.',
    'Validate against a disposable or shadow Postgres database before production.',
  ],
  approvalGates: ['schema-owner-review', 'security-review', 'track-0-readiness-gate'],
} as const;
