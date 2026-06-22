import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadObjectStorageEnv, objectStorageEnvValidationScenarios } from './object-storage-env.ts';

describe('artifact object storage environment config', () => {
  it('targets local MinIO by default outside production', () => {
    const config = loadObjectStorageEnv({ NODE_ENV: 'development' });

    assert.equal(config.provider, 'minio');
    assert.equal(config.endpointUrl, 'http://127.0.0.1:9000');
    assert.equal(config.bucket, 'devgateway-artifacts');
    assert.equal(config.forcePathStyle, true);
    assert.equal(config.signedAccessTtlSeconds, 300);
  });

  it('allows deterministic memory adapter for tests', () => {
    const config = loadObjectStorageEnv({
      NODE_ENV: 'test',
      ARTIFACT_OBJECT_STORAGE_PROVIDER: 'memory',
      ARTIFACT_OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    });

    assert.equal(config.provider, 'memory');
  });

  it('fails closed in production unless Railway Object Storage and credentials are configured', () => {
    assert.throws(
      () => loadObjectStorageEnv({ NODE_ENV: 'production', ARTIFACT_OBJECT_STORAGE_PROVIDER: 'memory' }),
      /production requires ARTIFACT_OBJECT_STORAGE_PROVIDER=railway/u,
    );

    assert.throws(
      () =>
        loadObjectStorageEnv({
          NODE_ENV: 'production',
          ARTIFACT_OBJECT_STORAGE_PROVIDER: 'railway',
          ARTIFACT_OBJECT_STORAGE_ENDPOINT: 'https://s3.railway.app',
          ARTIFACT_OBJECT_STORAGE_BUCKET: 'devgateway-prod-artifacts',
        }),
      /ARTIFACT_OBJECT_STORAGE_ACCESS_KEY_ID/u,
    );
  });

  it('caps signed access TTL at 15 minutes', () => {
    assert.throws(
      () =>
        loadObjectStorageEnv({
          NODE_ENV: 'development',
          ARTIFACT_SIGNED_ACCESS_TTL_SECONDS: '901',
        }),
      /900 seconds or less/u,
    );
  });

  it('keeps scenario fixtures aligned with parser decisions', () => {
    for (const scenario of objectStorageEnvValidationScenarios) {
      if (scenario.expected.decision === 'allow') {
        const config = loadObjectStorageEnv(scenario.input);
        assert.equal(config.provider, scenario.expected.provider, scenario.id);
      } else {
        assert.ok(scenario.expected.errorIncludes, `${scenario.id} must declare errorIncludes`);
        assert.throws(
          () => loadObjectStorageEnv(scenario.input),
          new RegExp(scenario.expected.errorIncludes.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
          scenario.id,
        );
      }
    }
  });
});
