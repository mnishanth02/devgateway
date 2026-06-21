import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adapterRegistry,
  createReadOnlyAdapterRegistry,
  executeToolCall,
  sanitizeToolMetadata,
  type ReadOnlyToolAdapter,
  type RepositoryMetadataResult,
} from './index.ts';

describe('read-only tool integration adapters', () => {
  it('allows fixture read-only repository metadata calls', async () => {
    const result = await executeToolCall<RepositoryMetadataResult>({
      toolId: 'repository.metadata.read',
      args: { sections: ['map', 'files', 'dependencies'], limit: 2 },
    });

    assert.equal(result.ok, true);
    assert.ok(adapterRegistry.definitions.length >= 4);
    assert.equal(adapterRegistry.definitions.every((definition) => definition.readOnly && definition.effect === 'read'), true);
    if (result.ok) {
      assert.equal(result.data.repository.repositoryId, 'devgateway-fixture');
      assert.ok(result.data.files);
      assert.equal(result.data.files.length, 2);
    }
  });

  it('returns typed malformed-args errors before adapter execution', async () => {
    let executions = 0;
    const validatingAdapter: ReadOnlyToolAdapter<{ readonly value: string }, { readonly value: string }> = {
      definition: {
        id: 'fixture.validation.read',
        name: 'Validation fixture',
        description: 'Always rejects args for test coverage.',
        effect: 'read',
        readOnly: true,
        externalNetworkAccess: false,
        outputContainsRawContent: false,
        argsSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: {} },
        resultShape: 'ValidationFixture',
      },
      validateArgs() {
        return {
          ok: false,
          error: {
            code: 'MALFORMED_ARGS',
            message: 'value is required.',
            retryable: false,
            toolId: 'fixture.validation.read',
            field: 'value',
          },
        };
      },
      execute() {
        executions += 1;
        return {
          ok: true,
          toolId: 'fixture.validation.read',
          data: { value: 'unexpected' },
          artifacts: [],
          metadata: {},
        };
      },
    };

    const registry = createReadOnlyAdapterRegistry([validatingAdapter]);
    const result = await registry.execute({ toolId: 'fixture.validation.read', args: {} });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'MALFORMED_ARGS');
      assert.equal(result.error.field, 'value');
    }
    assert.equal(executions, 0);
  });

  it('returns typed errors for unknown tools', async () => {
    const result = await executeToolCall({ toolId: 'unknown.read.tool', args: {} });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'UNKNOWN_TOOL');
    }
  });

  it('excludes deny-listed write tools and never invokes them', async () => {
    let writeExecutions = 0;
    const writeLikeAdapter: ReadOnlyToolAdapter<Record<string, never>, Record<string, never>> = {
      definition: {
        id: 'repo.write_file',
        name: 'Write-like adapter',
        description: 'A denied adapter id used to prove registry exclusion.',
        effect: 'read',
        readOnly: true,
        externalNetworkAccess: false,
        outputContainsRawContent: false,
        argsSchema: { type: 'object', additionalProperties: false, required: [], properties: {} },
        resultShape: 'Never',
      },
      validateArgs() {
        return { ok: true, value: {} };
      },
      execute() {
        writeExecutions += 1;
        return {
          ok: true,
          toolId: 'repo.write_file',
          data: {},
          artifacts: [],
          metadata: {},
        };
      },
    };

    const registry = createReadOnlyAdapterRegistry([writeLikeAdapter]);
    const result = await registry.execute({ toolId: 'repo.write_file', args: {} });

    assert.equal(registry.has('repo.write_file'), false);
    assert.deepEqual(registry.excludedDefinitions, [{ toolId: 'repo.write_file', reason: 'write-denied' }]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'WRITE_TOOL_DENIED');
    }
    assert.equal(writeExecutions, 0);
  });

  it('returns sanitized metadata and opaque refs only', async () => {
    const fakeSecret = ['Bearer', 'example-redacted-token'].join(' ');
    const metadata = sanitizeToolMetadata({
      providerKey: fakeSecret,
      rawContent: 'not returned',
      safeLabel: 'fixture-safe',
    });

    assert.deepEqual(metadata, { safeLabel: 'fixture-safe' });

    const docResult = await executeToolCall({
      toolId: 'documentation.lookup.approved',
      args: { query: fakeSecret, limit: 5 },
    });
    assert.equal(JSON.stringify(docResult).includes(fakeSecret), false);

    const artifactResult = await executeToolCall({
      toolId: 'eval.artifact.read',
      args: { artifactId: 'eval-run-001-gate' },
    });

    assert.equal(artifactResult.ok, true);
    const serialized = JSON.stringify(artifactResult);
    assert.equal(serialized.includes('rawContent'), false);
    assert.equal(serialized.includes('providerKey'), false);
    assert.equal(serialized.includes('opaque://eval-artifacts/fixture-evals/eval-run-001-gate'), true);
  });
});
