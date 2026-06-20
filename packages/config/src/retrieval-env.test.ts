import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadRetrievalEnv, retrievalEnvValidationScenarios } from './retrieval-env.ts';

describe('retrieval environment config', () => {
  it('defaults to day-one hybrid GraphRAG with production disabled', () => {
    const config = loadRetrievalEnv({ NODE_ENV: 'development' });

    assert.equal(config.productionEnabled, false);
    assert.equal(config.lexicalEnabled, true);
    assert.equal(config.embeddingsEnabled, true);
    assert.equal(config.rerankerEnabled, true);
    assert.equal(config.graphRagEnabled, true);
    assert.equal(config.neo4j.enabled, true);
    assert.equal(config.neo4j.uri, 'bolt://localhost:47687');
    assert.equal(config.contextBudget.budgeterEnabled, true);
    assert.equal(config.contextBudget.compressorEnabled, true);
    assert.equal(config.contextBudget.maxContextTokens, 24_000);
    assert.equal(config.contextBudget.maxSnippetTokens, 1_200);
    assert.equal(config.codeEmbeddingsEnabled, false);
    assert.deepEqual(config.evalStrategies, ['hybrid', 'hybrid_graph']);
  });

  it('allows hybrid-only comparison when GraphRAG and Neo4j are disabled together', () => {
    const config = loadRetrievalEnv({
      NODE_ENV: 'development',
      RETRIEVAL_GRAPH_RAG_ENABLED: 'false',
      RETRIEVAL_NEO4J_ENABLED: 'false',
      RETRIEVAL_EVAL_STRATEGIES: 'hybrid',
    });

    assert.equal(config.graphRagEnabled, false);
    assert.equal(config.neo4j.enabled, false);
    assert.deepEqual(config.evalStrategies, ['hybrid']);
  });

  it('fails closed when GraphRAG is enabled without Neo4j', () => {
    assert.throws(
      () =>
        loadRetrievalEnv({
          NODE_ENV: 'development',
          RETRIEVAL_GRAPH_RAG_ENABLED: 'true',
          RETRIEVAL_NEO4J_ENABLED: 'false',
        }),
      /RETRIEVAL_GRAPH_RAG_ENABLED=true requires RETRIEVAL_NEO4J_ENABLED=true/u,
    );
  });

  it('rejects production retrieval outside production NODE_ENV', () => {
    assert.throws(
      () =>
        loadRetrievalEnv({
          NODE_ENV: 'development',
          RETRIEVAL_PRODUCTION_ENABLED: 'true',
        }),
      /RETRIEVAL_PRODUCTION_ENABLED=true requires NODE_ENV=production/u,
    );
  });

  it('enforces first-release production retrieval guardrails', () => {
    assert.throws(
      () =>
        loadRetrievalEnv({
          NODE_ENV: 'production',
          RETRIEVAL_PRODUCTION_ENABLED: 'true',
          RETRIEVAL_CODE_EMBEDDINGS_ENABLED: 'true',
        }),
      /RETRIEVAL_CODE_EMBEDDINGS_ENABLED=true is not allowed for first production release/u,
    );
  });

  it('keeps scenario fixtures aligned with parser decisions', () => {
    for (const scenario of retrievalEnvValidationScenarios) {
      if (scenario.expected.decision === 'allow') {
        const config = loadRetrievalEnv(scenario.input);
        if (scenario.expected.evalStrategies) {
          assert.deepEqual(config.evalStrategies, scenario.expected.evalStrategies, scenario.id);
        }
      } else {
        assert.ok(scenario.expected.errorIncludes, `${scenario.id} must declare errorIncludes`);
        assert.throws(
          () => loadRetrievalEnv(scenario.input),
          new RegExp(scenario.expected.errorIncludes.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
          scenario.id,
        );
      }
    }
  });
});
