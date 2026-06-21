import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleBifrostConfigRoute, registerBifrostConfigRoutes } from './bifrost-config.ts';
import { currentPolicySnapshot, handlePolicyRoute, POLICY_CURRENT_PATH } from './policy.ts';
import { handleRegistryRoute, REGISTRY_CURRENT_PATH } from './registry.ts';
import type { SnapshotRoute } from './snapshot-common.ts';

const fixedNow = new Date('2026-06-20T12:00:00.000Z');

describe('registry and policy snapshot routes', () => {
  it('returns the current registry snapshot envelope with production disabled', async () => {
    const response = handleRegistryRoute(new Request(`http://control.local${REGISTRY_CURRENT_PATH}`), { now: fixedNow });
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.production_enabled, false);
    assert.equal(body.registry_version, 'model-aliases.v0.1');
    assert.equal((body.checksum as { checksum: string }).checksum.length, 64);
  });

  it('returns the current policy snapshot envelope with production disabled', async () => {
    const response = handlePolicyRoute(new Request(`http://control.local${POLICY_CURRENT_PATH}`), { now: fixedNow });
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.production_enabled, false);
    assert.equal(body.policy_version, 'provider-data-class-matrix.v0.1');
    assert.equal((body.checksum as { checksum: string }).checksum.length, 64);
  });

  it('fails closed when policy is missing', async () => {
    const response = handlePolicyRoute(new Request(`http://control.local${POLICY_CURRENT_PATH}`), { snapshot: null, now: fixedNow });
    const body = await response.json() as { error: { code: string; reason: string; fail_closed: boolean } };

    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'policy_missing');
    assert.equal(body.error.reason, 'policy_stale');
    assert.equal(body.error.fail_closed, true);
  });

  it('fails closed when the policy snapshot freshness has expired', async () => {
    const staleSnapshot = {
      ...currentPolicySnapshot,
      freshnessExpiresAt: '2026-01-01T00:00:00.000Z',
    };
    const response = handlePolicyRoute(new Request(`http://control.local${POLICY_CURRENT_PATH}`), {
      snapshot: staleSnapshot,
      now: fixedNow,
    });
    const body = await response.json() as { error: { code: string; reason: string } };

    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'policy_stale');
    assert.equal(body.error.reason, 'policy_stale');
  });

  it('fails closed for snapshot routes in production', async () => {
    const registryResponse = handleRegistryRoute(new Request(`http://control.local${REGISTRY_CURRENT_PATH}`), {
      runtimeEnvironment: 'production',
      now: fixedNow,
    });
    const policyResponse = handlePolicyRoute(new Request(`http://control.local${POLICY_CURRENT_PATH}`), {
      runtimeEnvironment: 'production',
      now: fixedNow,
    });

    assert.equal(registryResponse.status, 503);
    assert.equal(policyResponse.status, 503);
  });
});

describe('Bifrost config snapshot routes', () => {
  it('registers OpenAPI-compatible route metadata', () => {
    const routes: SnapshotRoute[] = [];
    registerBifrostConfigRoutes((route) => routes.push(route), { now: fixedNow });

    assert.deepEqual(routes.map((route) => route.schema.operationId), [
      'getCurrentBifrostConfigArtifact',
      'getBifrostConfigValidationReport',
    ]);
  });

  it('returns a validation report and blocks generated config until eval evidence exists', async () => {
    const reportResponse = handleBifrostConfigRoute(new Request('http://control.local/bifrost/config/validation'), { now: fixedNow });
    const report = await reportResponse.json() as { production_enabled: boolean; valid: boolean; errors: Array<{ error: { code: string } }> };

    assert.equal(reportResponse.status, 200);
    assert.equal(report.production_enabled, false);
    assert.equal(report.valid, false);
    assert.deepEqual(report.errors.map((entry) => entry.error.code), ['route_disabled', 'eval_gate_missing']);

    const artifactResponse = handleBifrostConfigRoute(new Request('http://control.local/bifrost/config/current'), { now: fixedNow });
    const artifactBody = await artifactResponse.json() as { error: { code: string; production_enabled: boolean; fail_closed: boolean } };

    assert.equal(artifactResponse.status, 409);
    assert.equal(artifactBody.error.code, 'route_disabled');
    assert.equal(artifactBody.error.production_enabled, false);
    assert.equal(artifactBody.error.fail_closed, true);
  });

  it('fails closed when the Bifrost registry snapshot is missing', async () => {
    const response = handleBifrostConfigRoute(new Request('http://control.local/bifrost/config/validation'), {
      registrySnapshot: null,
      now: fixedNow,
    });
    const body = await response.json() as { error: { code: string; reason: string } };

    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'policy_missing');
    assert.equal(body.error.reason, 'policy_stale');
  });
});
