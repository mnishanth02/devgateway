import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOCAL_PORTS,
  decidePortAction,
  parseCli,
  renderLocalEnv,
} from './devgateway-dev.mjs';

describe('devgateway local launcher CLI parsing', () => {
  it('parses setup command without a profile', () => {
    assert.deepEqual(parseCli(['setup']), {
      command: 'setup',
      profile: 'all',
      yes: false,
      extraArgs: [],
    });
  });

  it('parses backend dev profile', () => {
    assert.deepEqual(parseCli(['dev', 'backend']), {
      command: 'dev',
      profile: 'backend',
      yes: false,
      extraArgs: [],
    });
  });

  it('rejects unknown profiles with a helpful message', () => {
    assert.throws(
      () => parseCli(['dev', 'mobile']),
      /Unknown profile "mobile". Expected one of: all, backend, deps, frontend/u,
    );
  });

  it('requires --yes for reset confirmation parsing', () => {
    assert.deepEqual(parseCli(['reset', '--yes']), {
      command: 'reset',
      profile: 'all',
      yes: true,
      extraArgs: [],
    });
  });
});

describe('devgateway local env rendering', () => {
  it('renders stable high ports for first-clone local development', () => {
    const env = renderLocalEnv();

    assert.match(env, /BETTER_AUTH_URL=http:\/\/localhost:43100/u);
    assert.match(env, /BETTER_AUTH_TRUSTED_ORIGINS=http:\/\/localhost:43100,http:\/\/localhost:43101/u);
    assert.match(env, /OPERATIONAL_DATABASE_URL=postgresql:\/\/devgateway:devgateway@localhost:45432\/devgateway_operational/u);
    assert.match(env, /KNOWLEDGE_DATABASE_URL=postgresql:\/\/devgateway:devgateway@localhost:45433\/devgateway_knowledge/u);
    assert.match(env, /RETRIEVAL_GRAPH_RAG_ENABLED=true/u);
    assert.match(env, /RETRIEVAL_NEO4J_ENABLED=true/u);
    assert.match(env, /RETRIEVAL_CONTEXT_BUDGETER_ENABLED=true/u);
    assert.match(env, /RETRIEVAL_CONTEXT_COMPRESSOR_ENABLED=true/u);
    assert.match(env, /RETRIEVAL_CODE_EMBEDDINGS_ENABLED=false/u);
    assert.match(env, /RETRIEVAL_EVAL_STRATEGIES=hybrid,hybrid_graph/u);
    assert.match(env, /NEO4J_URI=bolt:\/\/localhost:47687/u);
    assert.match(env, /REDIS_URL=redis:\/\/localhost:46379\/0/u);
    assert.match(env, /S3_ENDPOINT=http:\/\/localhost:49000/u);
    assert.match(env, /BIFROST_BASE_URL=http:\/\/localhost:43180/u);
  });

  it('exports the documented local port map', () => {
    assert.equal(LOCAL_PORTS.controlApi, 43100);
    assert.equal(LOCAL_PORTS.adminPortal, 43101);
    assert.equal(LOCAL_PORTS.toolBroker, 43102);
    assert.equal(LOCAL_PORTS.operationalPostgres, 45432);
    assert.equal(LOCAL_PORTS.knowledgePostgres, 45433);
    assert.equal(LOCAL_PORTS.redis, 46379);
    assert.equal(LOCAL_PORTS.neo4jHttp, 47474);
    assert.equal(LOCAL_PORTS.neo4jBolt, 47687);
  });
});

describe('devgateway safe port ownership decisions', () => {
  it('uses a free port', () => {
    assert.deepEqual(decidePortAction({ port: 43100, busyPid: null, recordedProcess: null }), {
      action: 'use',
      reason: 'port 43100 is free',
    });
  });

  it('cleans a busy port only when it belongs to the recorded DevGateway process', () => {
    assert.deepEqual(
      decidePortAction({
        port: 43100,
        busyPid: 1234,
        recordedProcess: {
          pid: 1234,
          command: 'pnpm --filter @devgateway/control-api dev',
          profile: 'backend',
        },
      }),
      {
        action: 'cleanup',
        pid: 1234,
        reason: 'port 43100 is held by a previous DevGateway backend process',
      },
    );
  });

  it('blocks unknown processes instead of killing unrelated applications', () => {
    assert.deepEqual(
      decidePortAction({
        port: 43100,
        busyPid: 9876,
        recordedProcess: null,
      }),
      {
        action: 'block',
        pid: 9876,
        reason: 'port 43100 is busy by an unknown process; refusing to kill unrelated work',
      },
    );
  });
});
