export const nonProductionFixtureSeed = {
  id: 'non-production-fixtures',
  purpose: 'Fixture metadata for development, local smoke tests, and disposable environments only.',
  productionAllowed: false,
  autoRunAtBoot: false,
  storesPlaintextCredentials: false,
  storesProviderKeys: false,
  fixtureClasses: ['demo_org', 'demo_project', 'disabled_provider_candidate', 'policy_snapshot_stub'],
} as const;

export type NonProductionFixtureSeed = typeof nonProductionFixtureSeed;
