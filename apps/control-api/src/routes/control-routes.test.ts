import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  toBifrostVirtualKeyMetadata,
  validateBifrostVirtualKeyMetadataShape,
  gatewayControlContractVersion,
  type CostEventRecord,
  type VirtualKeyRecord,
} from '../../../../packages/shared-types/src/gateway-control.ts';

import {
  BUDGET_POLICIES_BASE_PATH,
  BUDGET_SCOPES_BASE_PATH,
  BUDGET_SPEND_BASE_PATH,
  registerBudgetRoutes,
} from './budgets.ts';
import {
  COST_EVENTS_BASE_PATH,
  createInMemoryCostEventStore,
  registerCostEventRoutes,
} from './cost-events.ts';
import {
  VIRTUAL_KEYS_BASE_PATH,
  registerVirtualKeyRoutes,
  type ControlRouteDefinition,
} from './virtual-keys.ts';

describe('control API virtual key routes', () => {
  it('issues one-time placeholder secrets but never returns stored secret material from list', async () => {
    const registrar = new CapturingRegistrar();
    registerVirtualKeyRoutes(registrar, { runtimeEnvironment: 'development' });

    const createReply = new CapturingReply();
    const createResult = (await route(registrar, 'POST', VIRTUAL_KEYS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: validVirtualKeyBody(),
      },
      createReply,
    )) as Record<string, unknown>;

    assert.equal(createReply.statusCode, 201);
    assert.equal(typeof (createResult.one_time_secret as { value: unknown }).value, 'string');

    const listReply = new CapturingReply();
    const listResult = (await route(registrar, 'GET', VIRTUAL_KEYS_BASE_PATH).handler(
      { headers: authHeaders(), query: {} },
      listReply,
    )) as Record<string, unknown>;

    assert.equal(listReply.statusCode, 200);
    const serialized = JSON.stringify(listResult);
    assert.doesNotMatch(serialized, /one_time_secret|key_hash_ref|provider_key|provider_secret/i);
    assert.match(serialized, /key_prefix/);
  });

  it('denies rotation of a revoked key with a typed revoked_key error', async () => {
    const registrar = new CapturingRegistrar();
    registerVirtualKeyRoutes(registrar, { runtimeEnvironment: 'development' });
    const createResult = (await route(registrar, 'POST', VIRTUAL_KEYS_BASE_PATH).handler({
      headers: authHeaders(),
      body: validVirtualKeyBody(),
    })) as { virtual_key: { virtual_key_id: string } };
    const virtualKeyId = createResult.virtual_key.virtual_key_id;

    await route(registrar, 'POST', `${VIRTUAL_KEYS_BASE_PATH}/:virtual_key_id/revoke`).handler({
      headers: authHeaders(),
      params: { virtual_key_id: virtualKeyId },
      body: { revocation_reason: 'test-revocation' },
    });

    const rotateReply = new CapturingReply();
    const rotateResult = (await route(registrar, 'POST', `${VIRTUAL_KEYS_BASE_PATH}/:virtual_key_id/rotate`).handler(
      {
        headers: authHeaders(),
        params: { virtual_key_id: virtualKeyId },
        body: {
          policy_version: 'policy-v2',
          registry_version: 'registry-v2',
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      },
      rotateReply,
    )) as { error: { code: string; denial_reason: string } };

    assert.equal(rotateReply.statusCode, 403);
    assert.equal(rotateResult.error.code, 'revoked_key');
    assert.equal(rotateResult.error.denial_reason, 'route_disabled');
  });

  it('rejects expired and scope-cap-exceeding virtual key issuance', async () => {
    const registrar = new CapturingRegistrar();
    registerVirtualKeyRoutes(registrar, { runtimeEnvironment: 'development' });

    const expiredReply = new CapturingReply();
    const expired = (await route(registrar, 'POST', VIRTUAL_KEYS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: { ...validVirtualKeyBody(), expires_at: '2000-01-01T00:00:00.000Z' },
      },
      expiredReply,
    )) as { error: { code: string; message: string } };

    assert.equal(expiredReply.statusCode, 400);
    assert.equal(expired.error.code, 'invalid_request');
    assert.match(expired.error.message, /future/u);

    const capReply = new CapturingReply();
    const capExceeded = (await route(registrar, 'POST', VIRTUAL_KEYS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: {
          ...validVirtualKeyBody(),
          expires_at: '2099-01-01T00:00:00.000Z',
          scope_constraints: {
            ...(validVirtualKeyBody().scope_constraints as Record<string, unknown>),
            max_expires_at: '2030-01-01T00:00:00.000Z',
          },
        },
      },
      capReply,
    )) as { error: { code: string; message: string } };

    assert.equal(capReply.statusCode, 400);
    assert.equal(capExceeded.error.code, 'invalid_request');
    assert.match(capExceeded.error.message, /max_expires_at/u);
  });

  it('rejects expired and scope-cap-exceeding virtual key rotation', async () => {
    const registrar = new CapturingRegistrar();
    registerVirtualKeyRoutes(registrar, { runtimeEnvironment: 'development' });
    const createResult = (await route(registrar, 'POST', VIRTUAL_KEYS_BASE_PATH).handler({
      headers: authHeaders(),
      body: {
        ...validVirtualKeyBody(),
        expires_at: '2030-01-01T00:00:00.000Z',
        scope_constraints: {
          ...(validVirtualKeyBody().scope_constraints as Record<string, unknown>),
          max_expires_at: '2030-01-01T00:00:00.000Z',
        },
      },
    })) as { virtual_key: { virtual_key_id: string } };

    const expiredReply = new CapturingReply();
    const expired = (await route(registrar, 'POST', `${VIRTUAL_KEYS_BASE_PATH}/:virtual_key_id/rotate`).handler(
      {
        headers: authHeaders(),
        params: { virtual_key_id: createResult.virtual_key.virtual_key_id },
        body: {
          policy_version: 'policy-v2',
          registry_version: 'registry-v2',
          expires_at: '2000-01-01T00:00:00.000Z',
        },
      },
      expiredReply,
    )) as { error: { code: string; message: string } };

    assert.equal(expiredReply.statusCode, 400);
    assert.match(expired.error.message, /future/u);

    const capReply = new CapturingReply();
    const capExceeded = (await route(registrar, 'POST', `${VIRTUAL_KEYS_BASE_PATH}/:virtual_key_id/rotate`).handler(
      {
        headers: authHeaders(),
        params: { virtual_key_id: createResult.virtual_key.virtual_key_id },
        body: {
          policy_version: 'policy-v2',
          registry_version: 'registry-v2',
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      },
      capReply,
    )) as { error: { code: string; message: string } };

    assert.equal(capReply.statusCode, 400);
    assert.match(capExceeded.error.message, /max_expires_at/u);

    const overlapReply = new CapturingReply();
    const invalidOverlap = (await route(registrar, 'POST', `${VIRTUAL_KEYS_BASE_PATH}/:virtual_key_id/rotate`).handler(
      {
        headers: authHeaders(),
        params: { virtual_key_id: createResult.virtual_key.virtual_key_id },
        body: {
          policy_version: 'policy-v2',
          registry_version: 'registry-v2',
          expires_at: '2029-01-01T00:00:00.000Z',
          overlap_expires_at: 'not-a-date',
        },
      },
      overlapReply,
    )) as { error: { code: string; message: string } };

    assert.equal(overlapReply.statusCode, 400);
    assert.match(invalidOverlap.error.message, /overlap_expires_at/u);
  });

  it('exports Bifrost enforcement metadata without secret material or policy inference', () => {
    const metadata = toBifrostVirtualKeyMetadata(sampleVirtualKeyRecord());

    assert.equal(metadata.virtual_key_id, 'vk_test');
    assert.equal(metadata.key_fingerprint_sha256, 'a'.repeat(64));
    assert.equal(metadata.status, 'active');
    assert.equal(metadata.budget_scope_ref.budget_scope_id, 'bs_test');
    assert.equal(metadata.policy_version, 'policy-v1');
    assert.equal(metadata.registry_version, 'registry-v1');
    assert.deepEqual(metadata.policy_boundary.bifrost_must_not_infer, [
      'project_policy',
      'tool_policy',
      'approval_policy',
    ]);
    assert.deepEqual(validateBifrostVirtualKeyMetadataShape(metadata), []);
    assert.deepEqual(validateBifrostVirtualKeyMetadataShape({ apiKey: 'secret', nested: { providerKey: 'secret' } }), [
      { code: 'forbidden_secret_field', path: '$.apiKey', field: 'api_key' },
      { code: 'forbidden_secret_field', path: '$.nested.providerKey', field: 'provider_key' },
    ]);
    assert.doesNotMatch(JSON.stringify(metadata), /one_time_secret|key_hash_ref|provider_key|provider_secret|api_key/i);
  });
});

describe('control API budget routes', () => {
  it('defines budget policy and inspects spend by project scope', async () => {
    const registrar = new CapturingRegistrar();
    registerBudgetRoutes(registrar, { runtimeEnvironment: 'development' });

    const createResult = (await route(registrar, 'POST', BUDGET_SCOPES_BASE_PATH).handler({
      headers: authHeaders(),
      body: {
        scope_type: 'project',
        owner_id: 'project_123',
        limits: { hard_cap_amount: 100 },
        policy_version: 'policy-budget-v1',
      },
    })) as { budget_scope: { budget_scope_id: string } };

    await route(registrar, 'POST', BUDGET_POLICIES_BASE_PATH).handler({
      headers: authHeaders(),
      body: {
        budget_scope_id: createResult.budget_scope.budget_scope_id,
        limits: { hard_cap_amount: 50, request_limit: 1000 },
        policy_version: 'policy-budget-v2',
        expected_current_policy_version: 'policy-budget-v1',
      },
    });

    const spendReply = new CapturingReply();
    const spendResult = (await route(registrar, 'GET', BUDGET_SPEND_BASE_PATH).handler(
      {
        headers: authHeaders(),
        query: { scope_type: 'project', owner_id: 'project_123' },
      },
      spendReply,
    )) as { spend: readonly { budget_scope_id: string; decision: string; policy_version: string }[] };

    assert.equal(spendReply.statusCode, 200);
    assert.equal(spendResult.spend.length, 1);
    assert.equal(spendResult.spend[0]?.decision, 'allow');
    assert.equal(spendResult.spend[0]?.policy_version, 'policy-budget-v2');
  });

  it('fails closed in production with production_disabled_route', async () => {
    const registrar = new CapturingRegistrar();
    registerBudgetRoutes(registrar, { runtimeEnvironment: 'production' });
    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', BUDGET_SPEND_BASE_PATH).handler(
      {
        headers: authHeaders(),
        query: { scope_type: 'org', owner_id: 'org_123' },
      },
      reply,
    )) as { error: { code: string } };

    assert.equal(reply.statusCode, 503);
    assert.equal(result.error.code, 'production_disabled_route');
  });
});

describe('control API cost event routes', () => {
  it('inspects cost event stream by trace and request id', async () => {
    const event = sampleCostEvent();
    const store = createInMemoryCostEventStore([event]);
    const registrar = new CapturingRegistrar();
    registerCostEventRoutes(registrar, { runtimeEnvironment: 'development', store });

    const traceResult = (await route(registrar, 'GET', `${COST_EVENTS_BASE_PATH}/traces/:trace_id`).handler({
      headers: authHeaders(),
      params: { trace_id: event.trace_id },
    })) as { count: number; cost_events: readonly CostEventRecord[] };

    const requestResult = (await route(registrar, 'GET', COST_EVENTS_BASE_PATH).handler({
      headers: authHeaders(),
      query: { request_id: event.request_id },
    })) as { count: number; cost_events: readonly CostEventRecord[] };

    assert.equal(traceResult.count, 1);
    assert.equal(requestResult.count, 1);
    assert.equal(requestResult.cost_events[0]?.cost_event_id, event.cost_event_id);
  });
});

class CapturingRegistrar {
  readonly routes: ControlRouteDefinition[] = [];

  route(routeDefinition: ControlRouteDefinition): void {
    this.routes.push(routeDefinition);
  }
}

class CapturingReply {
  statusCode = 200;

  code(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }
}

function route(registrar: CapturingRegistrar, method: 'GET' | 'POST', url: string): ControlRouteDefinition {
  const match = registrar.routes.find((candidate) => candidate.method === method && candidate.url === url);
  assert.ok(match, `Missing route ${method} ${url}`);
  return match;
}

function authHeaders(): Record<string, string> {
  return {
    'x-devgateway-principal-id': 'principal_test',
    'x-devgateway-auth-subject': 'subject_test',
  };
}

function validVirtualKeyBody(): Record<string, unknown> {
  return {
    principal_id: 'principal_test',
    principal_type: 'service_account',
    project_id: 'project_123',
    tenant_id: 'tenant_123',
    org_id: 'org_123',
    budget_scope_id: 'bs_test',
    budget_scope_type: 'virtual_key',
    environment: 'development',
    scope_constraints: {
      route_intents: ['chat'],
      data_classes: ['internal'],
      model_aliases: ['default-chat'],
      provider_candidates: ['provider-placeholder'],
      max_expires_at: '2099-01-01T00:00:00.000Z',
    },
    policy_version: 'policy-v1',
    registry_version: 'registry-v1',
    expires_at: '2099-01-01T00:00:00.000Z',
  };
}

function sampleVirtualKeyRecord(): VirtualKeyRecord {
  return {
    contract_version: gatewayControlContractVersion,
    virtual_key_id: 'vk_test',
    external_key_id: 'ext_vk_test',
    key_prefix: 'dg_vk_test',
    key_fingerprint_sha256: 'a'.repeat(64),
    key_hash_ref: 'secret-hash-ref-not-exported',
    status: 'active',
    production_posture: {
      production_enabled: false,
      success_fallback_allowed: false,
      fail_closed_without_policy: true,
    },
    principal_binding: {
      principal_id: 'principal_test',
      principal_type: 'service_account',
      auth_subject_ref: 'subject_test',
    },
    project_binding: {
      project_id: 'project_123',
      tenant_id: 'tenant_123',
      org_id: 'org_123',
      team_ids: [],
      environment: 'development',
    },
    scope_constraints: {
      route_intents: ['chat'],
      data_classes: ['internal'],
      model_aliases: ['default-chat'],
      provider_candidates: ['provider-placeholder'],
      max_expires_at: '2099-01-01T00:00:00.000Z',
    },
    budget_scope_ref: {
      budget_scope_id: 'bs_test',
      budget_scope_type: 'virtual_key',
    },
    policy_version: 'policy-v1',
    registry_version: 'registry-v1',
    issued_at: '2026-06-20T00:00:00.000Z',
    not_before: null,
    expires_at: '2099-01-01T00:00:00.000Z',
    rotation: {
      rotation_state: 'not_scheduled',
      rotated_from_virtual_key_id: null,
      rotated_to_virtual_key_id: null,
      rotation_due_at: null,
    },
    revocation: {
      revoked_at: null,
      revoked_by_principal_id: null,
      revocation_reason: null,
    },
    audit_correlation: {
      created_audit_event_id: 'audit_created',
      last_audit_event_id: null,
      trace_id: 'trace_test',
    },
    created_at: '2026-06-20T00:00:00.000Z',
    updated_at: '2026-06-20T00:00:00.000Z',
  };
}

function sampleCostEvent(): CostEventRecord {
  return {
    contract_version: gatewayControlContractVersion,
    cost_event_id: 'ce_test',
    event_type: 'actual',
    trace_id: 'trace_test',
    request_id: 'req_test',
    virtual_key_id: 'vk_test',
    budget_scope_id: 'bs_test',
    principal_id: 'principal_test',
    project_id: 'project_123',
    environment: 'development',
    route_intent: 'chat',
    data_class: 'internal',
    model_alias: 'default-chat',
    provider_id: 'provider-placeholder',
    provider_model_id: 'provider-model-placeholder',
    gateway_attempt: 1,
    fallback_attempt: 0,
    attempt_status: 'succeeded',
    currency: 'USD',
    usage_source: 'provider_reported',
    decision: 'allow',
    estimated: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      cost_amount: 0.001,
      unit_cost_basis: 'per_million_tokens',
      source: 'registry_estimate',
    },
    actual: {
      input_tokens: 11,
      output_tokens: 21,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      cost_amount: 0.0011,
      unit_cost_basis: 'per_million_tokens',
      source: 'provider_reported',
    },
    aggregation_targets: {
      tenant_id: 'tenant_123',
      org_id: 'org_123',
      team_id: null,
      project_id: 'project_123',
      principal_id: 'principal_test',
      virtual_key_id: 'vk_test',
      budget_scope_id: 'bs_test',
      model_alias: 'default-chat',
      provider_id: 'provider-placeholder',
      environment: 'development',
      route_intent: 'chat',
      data_class: 'internal',
      reset_period_start: '2026-06-01T00:00:00.000Z',
      reset_period_end: '2026-07-01T00:00:00.000Z',
    },
    policy_version: 'policy-v1',
    registry_version: 'registry-v1',
    occurred_at: '2026-06-20T00:00:00.000Z',
    recorded_at: '2026-06-20T00:00:01.000Z',
  };
}
