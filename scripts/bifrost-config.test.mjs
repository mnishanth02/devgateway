import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBifrostConfig,
  buildBifrostConfigReport,
  buildFromFiles,
  main,
  validateBifrostConfig,
} from './bifrost-config.mjs';

test('generates fail-closed Bifrost config with snapshot evidence', async () => {
  const { config, report } = await buildFromFiles({ now: '2026-06-20T12:00:00.000Z' });

  assert.equal(config.production_disabled_posture.production_enabled, false);
  assert.equal(config.production.provider_credentials_enabled, false);
  assert.equal(config.generated_from.registry.version, 'model-aliases.v0.1');
  assert.equal(config.generated_from.policy.version, 'provider-data-class-matrix.v0.1');
  assert.match(config.generated_from.registry.checksum.checksum, /^[a-f0-9]{64}$/);
  assert.match(config.generated_from.policy.checksum.checksum, /^[a-f0-9]{64}$/);
  assert.ok(config.provider_route_candidates.length > 0);
  assert.equal(report.valid, true);
});

test('rejects unsupported denial reasons', async () => {
  const { config } = await buildFromFiles({ now: '2026-06-20T12:00:00.000Z' });
  const mutated = clone(config);
  mutated.production.denial_reason = 'unsupported';

  const validation = await validateFromConfig(mutated);

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'unsupported_denial_reason'));
});

test('rejects route/provider drift from loaded snapshots', async () => {
  const { config } = await buildFromFiles({ now: '2026-06-20T12:00:00.000Z' });
  const mutated = clone(config);
  mutated.provider_route_candidates[0].provider_id = 'drifted-provider';

  const validation = await validateFromConfig(mutated);

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'route_provider_drift'));
});

test('rejects missing routes and full candidate metadata drift', async () => {
  const { config } = await buildFromFiles({ now: '2026-06-20T12:00:00.000Z' });
  const missingRoutes = clone(config);
  missingRoutes.routes = [];
  assert.equal((await validateFromConfig(missingRoutes)).ok, false);

  const candidateDrift = clone(config);
  candidateDrift.provider_route_candidates[0].model_id = 'drifted-model';
  candidateDrift.provider_route_candidates[0].wire_format = 'drifted-wire-format';
  candidateDrift.provider_route_candidates[0].effective_allowed_data_classes = ['restricted'];
  candidateDrift.provider_route_candidates[0].gate_evidence = { forged: true };

  const validation = await validateFromConfig(candidateDrift);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'route_provider_drift'));
});

test('rejects registry candidates whose provider or alias is missing from policy', async () => {
  const { registry, policy } = await importSnapshots();
  const mutatedRegistry = clone(registry);
  mutatedRegistry.model_aliases[0].candidates[0].provider_id = 'unknown-provider';
  const config = buildBifrostConfig({ registry: mutatedRegistry, policy });

  const validation = validateBifrostConfig({
    config,
    registry: mutatedRegistry,
    policy,
    now: new Date('2026-06-20T12:00:00.000Z'),
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.message.includes('policy_provider_missing')));
});

test('rejects production-enabled routes without matching gate evidence', async () => {
  const { config } = await buildFromFiles({ now: '2026-06-20T12:00:00.000Z' });
  const mutated = clone(config);
  mutated.routes[0].enabled = true;
  mutated.routes[0].production_enabled = true;

  const validation = await validateFromConfig(mutated);

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'production_gate'));
});

test('allows non-production local route toggles without production gate evidence', async () => {
  const { config } = await buildFromFiles({ now: '2026-06-20T12:00:00.000Z' });
  const mutated = clone(config);
  mutated.routes[0].enabled = true;
  mutated.routes[0].production_enabled = false;

  assert.equal((await validateFromConfig(mutated)).ok, true);
});

test('rejects every production and credential enablement flag', async () => {
  const { config } = await buildFromFiles({ now: '2026-06-20T12:00:00.000Z' });
  const mutated = clone(config);
  mutated.production.routes_enabled = true;
  mutated.production.provisioning_enabled = true;
  mutated.production_disabled_posture.route_provisioning_enabled = true;
  const providerId = Object.keys(mutated.providers)[0];
  mutated.providers[providerId].enabled = true;
  mutated.providers[providerId].credentials.configured = true;
  mutated.providers[providerId].credentials.environment_variable = 'OPENAI_API_KEY';

  const validation = await validateFromConfig(mutated);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.filter((issue) => issue.code === 'production_gate').length >= 4);
});

test('validate command requires an explicit config artifact', async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await main(['validate']);
    assert.equal(result, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('generate command fails closed on stale snapshots before writing config', async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const report = await main(['generate', '--now', '2099-01-01T00:00:00.000Z']);
    assert.equal(report.valid, false);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('rejects snapshots older than max staleness even before freshness deadline', async () => {
  const { registry, policy } = await importSnapshots();
  const config = buildBifrostConfig({ registry, policy });

  const validation = validateBifrostConfig({
    config,
    registry,
    policy,
    now: new Date('2026-06-20T08:00:00.000Z'),
    maxStalenessSeconds: '300',
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.message.includes('BIFROST_POLICY_MAX_STALENESS_SECONDS')));
});

test('report records provider candidates and production disabled posture', async () => {
  const { registry, policy } = await importSnapshots();
  const config = buildBifrostConfig({ registry, policy });
  const validation = validateBifrostConfig({ config, registry, policy, now: new Date('2026-06-20T12:00:00.000Z') });
  const report = buildBifrostConfigReport({ config, registry, policy, validation });

  assert.equal(report.production_enabled, false);
  assert.equal(report.production_disabled_posture.provider_credentials_enabled, false);
  assert.ok(report.provider_route_candidates.length > 0);
  assert.equal(report.registry.freshness_deadline, '2026-12-31T00:00:00.000Z');
  assert.equal(report.policy.freshness_deadline, '2026-12-31T00:00:00.000Z');
});

async function validateFromConfig(config) {
  const { registry, policy } = await importSnapshots();
  return validateBifrostConfig({ config, registry, policy, now: new Date('2026-06-20T12:00:00.000Z') });
}

async function importSnapshots() {
  const { loadSnapshots } = await import('./bifrost-config.mjs');
  return loadSnapshots();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
