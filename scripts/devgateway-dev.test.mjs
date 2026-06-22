import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  DURABLE_WORKER_PROFILES,
  DURABLE_WORKER_REQUIRED_ENV,
  LOCAL_BIFROST_CONFIG_PATH,
  LOCAL_BIFROST_RUNTIME_CONFIG_PATH,
  LOCAL_BIFROST_IMAGE,
  LOCAL_BIFROST_POLICY_VERSION,
  LOCAL_BIFROST_ROUTE_CONFIG_VERSION,
  LOCAL_PORTS,
  decidePortAction,
  parseCli,
  renderLocalEnv,
  validateBifrostLocalEvidence,
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
      /Unknown profile "mobile". Expected one of: all, backend, deps, frontend, workers/u,
    );
  });

  it('parses the explicit workers profile without enabling it by default', () => {
    assert.deepEqual(parseCli(['dev', 'workers']), {
      command: 'dev',
      profile: 'workers',
      yes: false,
      extraArgs: [],
    });
  });

  it('accepts common help aliases', () => {
    assert.deepEqual(parseCli(['--help']), {
      command: 'help',
      profile: 'all',
      yes: false,
      extraArgs: [],
    });
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
    assert.match(env, /BIFROST_CONFIG_PATH=infra\/bifrost\/bifrost\.config\.example\.yaml/u);
    assert.match(env, /BIFROST_RUNTIME_CONFIG_PATH=infra\/bifrost\/config\.runtime\.example\.json/u);
    assert.match(env, /BIFROST_CONTAINER_CONFIG_PATH=\/app\/data\/config\.json/u);
    assert.match(env, /BIFROST_ROUTE_CONFIG_VERSION=bifrost\.model-aliases\.v0\.1\.provider-data-class-matrix\.v0\.1\.disabled/u);
    assert.match(env, /BIFROST_POLICY_VERSION=provider-data-class-matrix\.v0\.1/u);
    assert.match(env, /BIFROST_HEALTH_PATH=\/health/u);
    assert.match(env, /DEVGATEWAY_OPENAI_API_KEY_PLACEHOLDER=local-provider-key-placeholder/u);
    assert.match(env, /DEVGATEWAY_ANTHROPIC_API_KEY_PLACEHOLDER=local-provider-key-placeholder/u);
    assert.match(env, /DURABLE_WORKERS_ENABLED=false/u);
    assert.match(env, /WORKFLOW_WORKER_OWNER_ID=local-runtime-worker/u);
    assert.match(env, /OUTBOX_WORKER_OWNER_ID=local-outbox-worker/u);
    assert.match(env, /BUDGET_REAPER_ABANDONED_WORKFLOW_SECONDS=86400/u);
  });

  it('exports the documented local port map', () => {
    assert.equal(LOCAL_PORTS.controlApi, 43100);
    assert.equal(LOCAL_PORTS.adminPortal, 43101);
    assert.equal(LOCAL_PORTS.toolBroker, 43102);
    assert.equal(LOCAL_PORTS.bifrost, 43180);
    assert.equal(LOCAL_PORTS.operationalPostgres, 45432);
    assert.equal(LOCAL_PORTS.knowledgePostgres, 45433);
    assert.equal(LOCAL_PORTS.redis, 46379);
    assert.equal(LOCAL_PORTS.neo4jHttp, 47474);
    assert.equal(LOCAL_PORTS.neo4jBolt, 47687);
  });
});

describe('devgateway durable worker profile metadata', () => {
  it('documents the fail-closed local worker config contract', () => {
    assert.deepEqual(DURABLE_WORKER_REQUIRED_ENV, [
      'OPERATIONAL_DATABASE_URL',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_FORCE_PATH_STYLE',
      'BIFROST_BASE_URL',
    ]);
    assert.deepEqual(
      DURABLE_WORKER_PROFILES.map((profile) => profile.name),
      [
        'runtime-service',
        'lease-retry-sweeper',
        'cancellation-worker',
        'approval-expiry-worker',
        'outbox-worker',
        'budget-reaper',
        'artifact-lifecycle-worker',
      ],
    );
  });
});

describe('devgateway Bifrost local readiness', () => {
  it('accepts the fail-closed local Bifrost config evidence and placeholders', () => {
    const config = fixtureBifrostConfig();
    const env = fixtureBifrostEnv();

    assert.deepEqual(validateBifrostLocalEvidence({ env, config, runtimeConfig: fixtureBifrostRuntimeConfig() }), {
      ok: true,
      issues: [],
      routeConfigVersion: LOCAL_BIFROST_ROUTE_CONFIG_VERSION,
      policyVersion: LOCAL_BIFROST_POLICY_VERSION,
    });
  });

  it('fails closed when route, policy, registry, or provider-key evidence is stale or missing', () => {
    const config = fixtureBifrostConfig();
    const env = {
      ...fixtureBifrostEnv(),
      BIFROST_ROUTE_CONFIG_VERSION: 'stale',
      BIFROST_POLICY_VERSION: 'stale',
      OPENAI_API_KEY: 'sk-real-key-must-not-be-used-locally',
    };
    delete config.generated_from.registry.checksum;

    const validation = validateBifrostLocalEvidence({ env, config, runtimeConfig: fixtureBifrostRuntimeConfig() });

    assert.equal(validation.ok, false);
    assert.ok(validation.issues.some((issue) => issue.includes('BIFROST_ROUTE_CONFIG_VERSION')));
    assert.ok(validation.issues.some((issue) => issue.includes('BIFROST_POLICY_VERSION')));
    assert.ok(validation.issues.some((issue) => issue.includes('registry checksum')));
    assert.ok(validation.issues.some((issue) => issue.includes('OPENAI_API_KEY')));
  });

  it('fails closed when production provider keys, routes, or provisioning are enabled', () => {
    const config = fixtureBifrostConfig();
    config.production.provider_credentials_enabled = true;
    config.production.routes_enabled = true;
    config.production.provisioning_enabled = true;
    config.production_disabled_posture.provider_credentials_enabled = true;

    const validation = validateBifrostLocalEvidence({
      env: fixtureBifrostEnv(),
      config,
      runtimeConfig: fixtureBifrostRuntimeConfig(),
    });

    assert.equal(validation.ok, false);
    assert.ok(validation.issues.some((issue) => issue.includes('provider credentials disabled')));
    assert.ok(validation.issues.some((issue) => issue.includes('production routes disabled')));
    assert.ok(validation.issues.some((issue) => issue.includes('production provisioning disabled')));
  });

  it('pins the local compose Bifrost service to the approved digest and port', () => {
    const compose = readFileSync(new URL('../docker-compose.local.yml', import.meta.url), 'utf8');

    assert.match(compose, new RegExp(`image: ${escapeRegExp(LOCAL_BIFROST_IMAGE)}`, 'u'));
    assert.match(compose, /BIFROST_ADMIN_TOKEN: \$\{BIFROST_ADMIN_TOKEN\}/u);
    assert.match(compose, /BIFROST_CONFIG_PATH: \$\{BIFROST_CONTAINER_CONFIG_PATH:-\/app\/data\/config\.json\}/u);
    assert.match(compose, /infra\/bifrost\/config\.runtime\.example\.json:\/app\/data\/config\.json:ro/u);
    assert.match(compose, /BIFROST_ROUTE_CONFIG_VERSION: \$\{BIFROST_ROUTE_CONFIG_VERSION\}/u);
    assert.match(compose, /BIFROST_POLICY_VERSION: \$\{BIFROST_POLICY_VERSION\}/u);
    assert.match(compose, /DEVGATEWAY_OPENAI_API_KEY_PLACEHOLDER: \$\{DEVGATEWAY_OPENAI_API_KEY_PLACEHOLDER\}/u);
    assert.doesNotMatch(compose, /^\s+OPENAI_API_KEY:/mu);
    assert.doesNotMatch(compose, /:latest\b/u);
    const bifrostBlock = compose.split(/\r?\n  bifrost:\r?\n/u)[1]?.split(/\r?\n  prometheus:\r?\n/u)[0] ?? '';
    assert.doesNotMatch(bifrostBlock, /^\s+command: \[/mu);
    assert.match(compose, /"43180:8080"/u);
    assert.match(compose, /http:\/\/localhost:8080\/health/u);
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

function fixtureBifrostEnv() {
  return {
    BIFROST_CONFIG_PATH: LOCAL_BIFROST_CONFIG_PATH,
    BIFROST_RUNTIME_CONFIG_PATH: LOCAL_BIFROST_RUNTIME_CONFIG_PATH,
    BIFROST_CONTAINER_CONFIG_PATH: '/app/data/config.json',
    BIFROST_ROUTE_CONFIG_VERSION: LOCAL_BIFROST_ROUTE_CONFIG_VERSION,
    BIFROST_POLICY_VERSION: LOCAL_BIFROST_POLICY_VERSION,
    BIFROST_BREAK_GLASS_ENABLED: 'false',
    PRODUCTION_PROVISIONING_ENABLED: 'false',
    DEVGATEWAY_OPENAI_API_KEY_PLACEHOLDER: 'local-provider-key-placeholder',
    DEVGATEWAY_ANTHROPIC_API_KEY_PLACEHOLDER: 'local-provider-key-placeholder',
  };
}

function fixtureBifrostRuntimeConfig() {
  return {
    providers: {},
    governance: {
      auth_config: {
        is_enabled: false,
        disable_auth_on_inference: false,
      },
      virtual_keys: [],
      budgets: [],
      rate_limits: [],
      model_configs: [],
      routing_rules: [],
    },
    config_store: {
      enabled: true,
      type: 'sqlite',
      config: { path: '/app/data/config.db' },
    },
    logs_store: {
      enabled: true,
      type: 'sqlite',
      config: { path: '/app/data/logs.db' },
    },
  };
}

function fixtureBifrostConfig() {
  return {
    kind: 'bifrost_config',
    route_config_version: LOCAL_BIFROST_ROUTE_CONFIG_VERSION,
    generated_from: {
      registry: { checksum: { checksum: 'abc' } },
      policy: {
        version: LOCAL_BIFROST_POLICY_VERSION,
        checksum: { checksum: 'def' },
      },
    },
    registry: { validate_before_start: true },
    production: {
      provider_credentials_enabled: false,
      routes_enabled: false,
      provisioning_enabled: false,
    },
    production_disabled_posture: {
      provider_credentials_enabled: false,
    },
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
