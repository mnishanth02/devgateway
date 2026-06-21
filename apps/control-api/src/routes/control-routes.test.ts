import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  toBifrostVirtualKeyMetadata,
  validateBifrostVirtualKeyMetadataShape,
  gatewayControlContractVersion,
  type CostEventRecord,
  type VirtualKeyRecord,
} from '../../../../packages/shared-types/src/gateway-control.ts';
import { getBundledSkillRegistrySnapshot, type SkillRegistrySnapshot } from '@devgateway/registry';

import {
  BUDGET_POLICIES_BASE_PATH,
  BUDGET_RESERVATIONS_BASE_PATH,
  BUDGET_RESERVATION_RELEASE_PATH,
  BUDGET_RESERVATION_SETTLE_PATH,
  BUDGET_SCOPES_BASE_PATH,
  BUDGET_SPEND_BASE_PATH,
  registerBudgetRoutes,
  type BudgetReservationRecord,
  type BudgetSpendInspection,
} from './budgets.ts';
import {
  COST_EVENTS_BASE_PATH,
  createInMemoryCostEventStore,
  registerCostEventRoutes,
} from './cost-events.ts';
import { AGENT_RUNS_BASE_PATH, registerAgentRunRoutes } from './agent-runs.ts';
import { createInMemoryAgentWorkflowStore } from './agent-workflow-store.ts';
import { TASK_ARTIFACTS_PATH, registerArtifactRoutes } from './artifacts.ts';
import { SKILLS_BASE_PATH, registerSkillRoutes } from './skills.ts';
import { TASKS_BASE_PATH, registerTaskRoutes } from './tasks.ts';
import {
  VIRTUAL_KEYS_BASE_PATH,
  registerVirtualKeyRoutes,
  type ControlRouteDefinition,
  type ControlRouteRequest,
} from './virtual-keys.ts';
import { WORKFLOWS_BASE_PATH, registerWorkflowRoutes } from './workflows.ts';

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

  it('accepts Track 2 route intents and budget scope types from the shared contract', async () => {
    const registrar = new CapturingRegistrar();
    registerVirtualKeyRoutes(registrar, { runtimeEnvironment: 'development' });

    const createReply = new CapturingReply();
    const createResult = (await route(registrar, 'POST', VIRTUAL_KEYS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: {
          ...validVirtualKeyBody(),
          budget_scope_type: 'workflow',
          scope_constraints: {
            ...(validVirtualKeyBody().scope_constraints as Record<string, unknown>),
            route_intents: ['agent_planning', 'sub_agent_execution', 'synthesis'],
          },
        },
      },
      createReply,
    )) as { virtual_key: VirtualKeyRecord };

    assert.equal(createReply.statusCode, 201);
    assert.equal(createResult.virtual_key.budget_scope_ref.budget_scope_type, 'workflow');
    assert.deepEqual(createResult.virtual_key.scope_constraints.route_intents, [
      'agent_planning',
      'sub_agent_execution',
      'synthesis',
    ]);
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

  it('reserves, settles, and releases Track 2 budget reservations idempotently', async () => {
    const registrar = new CapturingRegistrar();
    registerBudgetRoutes(registrar, { runtimeEnvironment: 'development' });
    const budgetScopeId = await createBudgetScopeForTest(registrar, {
      scope_type: 'tool_class',
      owner_id: 'code_interpreter',
      tenant_id: 'tenant_123',
      project_id: 'project_123',
      principal_id: 'principal_test',
      limits: { hard_cap_amount: 100 },
      policy_version: 'policy-budget-track2-v1',
    });
    const reserveBody = validBudgetReservationBody(budgetScopeId, {
      amount: 12.5,
      input_tokens: 1000,
      output_tokens: 2000,
      idempotency_key: 'idempotency_budget_reserve_primary',
      request_id: 'request_budget_reserve_primary',
      trace_id: 'trace_budget_lifecycle_primary',
    });

    const reserveReply = new CapturingReply();
    const reserveResult = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler(
      { headers: authHeaders(), body: reserveBody },
      reserveReply,
    )) as BudgetReservationEnvelope;
    const reserved = reserveResult.budget_reservation;

    assert.equal(reserveReply.statusCode, 201);
    assert.match(reserved.reservation_id, /^br_/u);
    assert.equal(reserved.status, 'reserved');
    assert.equal(reserved.budget_scope_id, budgetScopeId);
    assert.equal(reserved.workflow_run_id, 'workflow_run_budget_test');
    assert.equal(reserved.delegation_id, 'delegation_budget_test');
    assert.equal(reserved.tool_class, 'code_interpreter');
    assert.equal(reserved.cost_event_id, null);

    const afterReserve = await inspectBudgetScopeSpendForTest(registrar, budgetScopeId);
    assert.equal(afterReserve.reservation_state.reserved_amount, 12.5);
    assert.equal(afterReserve.reservation_state.reserved_input_tokens, 1000);
    assert.equal(afterReserve.reservation_state.reserved_output_tokens, 2000);
    assert.equal(afterReserve.reservation_state.reservation_count, 1);
    assert.equal(afterReserve.spend_state.actual_spend_amount, 0);

    const reserveReplayReply = new CapturingReply();
    const reserveReplay = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler(
      { headers: authHeaders(), body: reserveBody },
      reserveReplayReply,
    )) as BudgetReservationEnvelope;

    assert.equal(reserveReplayReply.statusCode, 201);
    assert.equal(reserveReplay.budget_reservation.reservation_id, reserved.reservation_id);
    assert.deepEqual((await inspectBudgetScopeSpendForTest(registrar, budgetScopeId)).reservation_state, afterReserve.reservation_state);

    const settleBody = validBudgetSettlementBody(budgetScopeId, {
      actual_amount: 10.25,
      actual_input_tokens: 900,
      actual_output_tokens: 1800,
      cost_event_id: 'cost_budget_settlement_primary',
      idempotency_key: 'idempotency_budget_settle_primary',
      request_id: 'request_budget_settle_primary',
      trace_id: 'trace_budget_settle_primary',
    });
    const settleReply = new CapturingReply();
    const settleResult = (await route(registrar, 'POST', BUDGET_RESERVATION_SETTLE_PATH).handler(
      { headers: authHeaders(), params: { reservation_id: reserved.reservation_id }, body: settleBody },
      settleReply,
    )) as BudgetReservationEnvelope;

    assert.equal(settleReply.statusCode, 200);
    assert.equal(settleResult.budget_reservation.status, 'settled');
    assert.equal(settleResult.budget_reservation.actual_amount, 10.25);
    assert.equal(settleResult.budget_reservation.actual_input_tokens, 900);
    assert.equal(settleResult.budget_reservation.actual_output_tokens, 1800);
    assert.equal(settleResult.budget_reservation.cost_event_id, 'cost_budget_settlement_primary');

    const afterSettle = await inspectBudgetScopeSpendForTest(registrar, budgetScopeId);
    assert.equal(afterSettle.spend_state.actual_spend_amount, 10.25);
    assert.equal(afterSettle.spend_state.actual_input_tokens, 900);
    assert.equal(afterSettle.spend_state.actual_output_tokens, 1800);
    assert.equal(afterSettle.spend_state.actual_request_count, 1);
    assert.equal(afterSettle.spend_state.last_cost_event_id, 'cost_budget_settlement_primary');
    assert.deepEqual(afterSettle.reservation_state, emptyReservationState());

    const settleReplayReply = new CapturingReply();
    const settleReplay = (await route(registrar, 'POST', BUDGET_RESERVATION_SETTLE_PATH).handler(
      { headers: authHeaders(), params: { reservation_id: reserved.reservation_id }, body: settleBody },
      settleReplayReply,
    )) as BudgetReservationEnvelope;

    assert.equal(settleReplayReply.statusCode, 200);
    assert.equal(settleReplay.budget_reservation.reservation_id, reserved.reservation_id);
    assert.deepEqual((await inspectBudgetScopeSpendForTest(registrar, budgetScopeId)).spend_state, afterSettle.spend_state);

    const releaseSettledReply = new CapturingReply();
    const releaseSettledResult = (await route(registrar, 'POST', BUDGET_RESERVATION_RELEASE_PATH).handler(
      {
        headers: authHeaders(),
        params: { reservation_id: reserved.reservation_id },
        body: validBudgetReleaseBody(budgetScopeId, {
          idempotency_key: 'idempotency_budget_release_settled',
          request_id: 'request_budget_release_settled',
          trace_id: 'trace_budget_release_settled',
        }),
      },
      releaseSettledReply,
    )) as ControlErrorEnvelope;

    assert.equal(releaseSettledReply.statusCode, 400);
    assert.equal(releaseSettledResult.error.code, 'invalid_request');
    assert.match(releaseSettledResult.error.message, /settled/u);

    const releaseReserve = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler({
      headers: authHeaders(),
      body: validBudgetReservationBody(budgetScopeId, {
        amount: 7,
        input_tokens: 300,
        output_tokens: 400,
        idempotency_key: 'idempotency_budget_reserve_release',
        request_id: 'request_budget_reserve_release',
        trace_id: 'trace_budget_reserve_release',
      }),
    })) as BudgetReservationEnvelope;
    assert.equal(releaseReserve.budget_reservation.status, 'reserved');
    assert.equal((await inspectBudgetScopeSpendForTest(registrar, budgetScopeId)).reservation_state.reserved_amount, 7);

    const releaseBody = validBudgetReleaseBody(budgetScopeId, {
      release_reason: 'provider_failed_before_execution',
      idempotency_key: 'idempotency_budget_release_unused',
      request_id: 'request_budget_release_unused',
      trace_id: 'trace_budget_release_unused',
    });
    const releaseReply = new CapturingReply();
    const releaseResult = (await route(registrar, 'POST', BUDGET_RESERVATION_RELEASE_PATH).handler(
      { headers: authHeaders(), params: { reservation_id: releaseReserve.budget_reservation.reservation_id }, body: releaseBody },
      releaseReply,
    )) as BudgetReservationEnvelope;

    assert.equal(releaseReply.statusCode, 200);
    assert.equal(releaseResult.budget_reservation.status, 'released');
    assert.equal(releaseResult.budget_reservation.release_reason, 'provider_failed_before_execution');

    const afterRelease = await inspectBudgetScopeSpendForTest(registrar, budgetScopeId);
    assert.deepEqual(afterRelease.spend_state, afterSettle.spend_state);
    assert.deepEqual(afterRelease.reservation_state, emptyReservationState());

    const releaseReplayReply = new CapturingReply();
    const releaseReplay = (await route(registrar, 'POST', BUDGET_RESERVATION_RELEASE_PATH).handler(
      { headers: authHeaders(), params: { reservation_id: releaseReserve.budget_reservation.reservation_id }, body: releaseBody },
      releaseReplayReply,
    )) as BudgetReservationEnvelope;

    assert.equal(releaseReplayReply.statusCode, 200);
    assert.equal(releaseReplay.budget_reservation.reservation_id, releaseReserve.budget_reservation.reservation_id);
    assert.deepEqual(await inspectBudgetScopeSpendForTest(registrar, budgetScopeId), afterRelease);
  });

  it('denies hard-cap exhaustion before creating a budget reservation', async () => {
    const registrar = new CapturingRegistrar();
    registerBudgetRoutes(registrar, { runtimeEnvironment: 'development' });
    const budgetScopeId = await createBudgetScopeForTest(registrar, {
      scope_type: 'workflow',
      owner_id: 'workflow_run_hard_cap',
      limits: { hard_cap_amount: 1 },
      policy_version: 'policy-budget-hardcap-v1',
    });

    const exhaustedReply = new CapturingReply();
    const exhausted = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: validBudgetReservationBody(budgetScopeId, {
          workflow_run_id: 'workflow_run_hard_cap',
          delegation_id: null,
          tool_class: null,
          amount: 2,
          idempotency_key: 'idempotency_budget_hardcap_denied',
          request_id: 'request_budget_hardcap_denied',
          trace_id: 'trace_budget_hardcap_denied',
          policy_version: 'policy-budget-hardcap-v1',
        }),
      },
      exhaustedReply,
    )) as ControlErrorEnvelope;

    assert.equal(exhaustedReply.statusCode, 402);
    assert.equal(exhausted.error.code, 'budget_exhausted');
    assert.equal(exhausted.error.denial_reason, 'budget');
    assert.equal(exhausted.error.retryable, false);
    assert.equal(exhausted.error.details?.budget_scope_id, budgetScopeId);
    assert.equal(exhausted.error.details?.requested_amount, 2);
    assert.deepEqual((await inspectBudgetScopeSpendForTest(registrar, budgetScopeId)).reservation_state, emptyReservationState());
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

  it('fails closed in production for budget reservation routes', async () => {
    const registrar = new CapturingRegistrar();
    registerBudgetRoutes(registrar, { runtimeEnvironment: 'production' });
    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: validBudgetReservationBody('bs_production_disabled'),
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 503);
    assert.equal(result.error.code, 'production_disabled_route');
    assert.equal(result.error.details?.route, 'budget-reservation-reserve');
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

describe('control API agent workflow routes', () => {
  it('creates, reads, and records cancellation requests for tasks', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const createReply = new CapturingReply();
    const createResult = (await route(registrar, 'POST', TASKS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: validTaskBody(),
      },
      createReply,
    )) as TaskEnvelope;

    assert.equal(createReply.statusCode, 201);
    assert.match(createResult.task.task_id, /^task_/u);
    assert.match(createResult.task.workflow_id, /^workflow_/u);
    assert.equal(createResult.task.workflow_run_id, createResult.task.workflow_id);
    assert.equal(createResult.task.status, 'queued');
    assert.equal(createResult.task.principal_id, 'principal_test');
    assert.equal(createResult.task.project_id, 'project_123');
    assert.equal(createResult.task.data_class, 'internal');
    assert.equal(createResult.task.budget_scope_id, 'budget_scope_track2');
    assert.equal(createResult.task.policy_version, 'policy-track2-v1');
    assert.equal(createResult.task.registry_version, 'registry-track2-v1');
    assert.equal(createResult.task.trace_id, 'trace_track2_test');
    assert.equal(createResult.task.request_id, 'request_track2_create');

    const getReply = new CapturingReply();
    const getResult = (await route(registrar, 'GET', `${TASKS_BASE_PATH}/:task_id`).handler(
      {
        headers: authHeaders(),
        params: { task_id: createResult.task.task_id },
      },
      getReply,
    )) as TaskEnvelope;

    assert.equal(getReply.statusCode, 200);
    assert.equal(getResult.task.task_id, createResult.task.task_id);
    assert.equal(getResult.task.status, 'queued');

    const cancelReply = new CapturingReply();
    const cancelResult = (await route(registrar, 'POST', `${TASKS_BASE_PATH}/:task_id/cancel`).handler(
      {
        headers: authHeaders(),
        params: { task_id: createResult.task.task_id },
        body: {
          request_id: 'request_track2_cancel',
          trace_id: 'trace_track2_cancel',
          policy_version: 'policy-track2-v1',
          registry_version: 'registry-track2-v1',
          cancellation_reason: 'operator-requested-test-cancel',
        },
      },
      cancelReply,
    )) as TaskCancelEnvelope;

    assert.equal(cancelReply.statusCode, 202);
    assert.equal(cancelResult.task.task_id, createResult.task.task_id);
    assert.equal(cancelResult.task.status, 'queued');
    assert.equal(cancelResult.cancellation_request.requested, true);
    assert.equal(cancelResult.cancellation_request.requested_by_principal_id, 'principal_test');
    assert.equal(cancelResult.cancellation_request.request_id, 'request_track2_cancel');
    assert.equal(cancelResult.cancellation_request.cancellation_reason, 'operator-requested-test-cancel');
  });

  it('returns artifact metadata only without bodies, signed URLs, prompts, or secrets', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', TASK_ARTIFACTS_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { task_id: 'task_demo_001' },
      },
      reply,
    )) as ArtifactListEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.count, 1);
    assert.equal(result.artifacts[0]?.artifact_id, 'artifact_demo_001');
    assert.equal(result.artifacts[0]?.signed_download_eligible, false);
    assert.equal(result.artifacts[0]?.storage_ref.object_path_ref, 'opaque-artifact-ref:artifact_demo_001');
    assertNoSensitiveControlPayload(result);
  });

  it('paginates workflow events with cursor and next_cursor', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const workflow = (await route(registrar, 'GET', `${WORKFLOWS_BASE_PATH}/:workflow_id`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { workflow_id: 'workflow_demo_001' },
    })) as WorkflowEnvelope;

    assert.equal(workflow.workflow.workflow_id, 'workflow_demo_001');
    assert.equal(workflow.workflow.principal_id, 'principal_demo');

    const firstPage = (await route(registrar, 'GET', `${WORKFLOWS_BASE_PATH}/:workflow_id/events`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { workflow_id: 'workflow_demo_001' },
      query: { limit: '1' },
    })) as WorkflowEventPageEnvelope;

    assert.equal(firstPage.events.length, 1);
    assert.equal(firstPage.events[0]?.sequence_number, 1);
    assert.equal(firstPage.next_cursor, '1');

    const secondPage = (await route(registrar, 'GET', `${WORKFLOWS_BASE_PATH}/:workflow_id/events`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { workflow_id: 'workflow_demo_001' },
      query: { cursor: firstPage.next_cursor, limit: 1 },
    })) as WorkflowEventPageEnvelope;

    assert.equal(secondPage.events.length, 1);
    assert.equal(secondPage.events[0]?.sequence_number, 2);
    assert.equal(secondPage.next_cursor, null);
  });

  it('returns sanitized agent-run metadata', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const result = (await route(registrar, 'GET', `${AGENT_RUNS_BASE_PATH}/:agent_run_id`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { agent_run_id: 'agent_run_demo_001' },
    })) as AgentRunEnvelope;

    assert.equal(result.agent_run.agent_run_id, 'agent_run_demo_001');
    assert.equal(result.agent_run.workflow_id, 'workflow_demo_001');
    assert.equal(result.agent_run.status, 'running');
    assert.deepEqual(result.agent_run.context_refs, [
      { ref_id: 'context_demo_001', ref_type: 'sanitized_context_ref', scope_ref: 'project_demo' },
    ]);
    assertNoSensitiveControlPayload(result);
  });

  it('hides Track 2 read resources from other principals or projects', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();
    const denialCases: readonly {
      readonly label: string;
      readonly method: 'GET';
      readonly url: string;
      readonly request: ControlRouteRequest;
    }[] = [
      {
        label: 'task',
        method: 'GET',
        url: `${TASKS_BASE_PATH}/:task_id`,
        request: { headers: authHeaders('principal_other'), params: { task_id: 'task_demo_001' } },
      },
      {
        label: 'task project',
        method: 'GET',
        url: `${TASKS_BASE_PATH}/:task_id`,
        request: { headers: authHeaders('principal_demo', 'project_other'), params: { task_id: 'task_demo_001' } },
      },
      {
        label: 'artifacts',
        method: 'GET',
        url: TASK_ARTIFACTS_PATH,
        request: { headers: authHeaders('principal_other'), params: { task_id: 'task_demo_001' } },
      },
      {
        label: 'workflow',
        method: 'GET',
        url: `${WORKFLOWS_BASE_PATH}/:workflow_id`,
        request: { headers: authHeaders('principal_other'), params: { workflow_id: 'workflow_demo_001' } },
      },
      {
        label: 'workflow events',
        method: 'GET',
        url: `${WORKFLOWS_BASE_PATH}/:workflow_id/events`,
        request: { headers: authHeaders('principal_other'), params: { workflow_id: 'workflow_demo_001' }, query: {} },
      },
      {
        label: 'agent run',
        method: 'GET',
        url: `${AGENT_RUNS_BASE_PATH}/:agent_run_id`,
        request: { headers: authHeaders('principal_other'), params: { agent_run_id: 'agent_run_demo_001' } },
      },
    ];

    for (const denialCase of denialCases) {
      const reply = new CapturingReply();
      const result = (await route(registrar, denialCase.method, denialCase.url).handler(
        denialCase.request,
        reply,
      )) as ControlErrorEnvelope;

      assert.equal(reply.statusCode, 404, denialCase.label);
      assert.equal(result.error.code, 'not_found', denialCase.label);
      assert.doesNotMatch(result.error.message, /demo_001/u, denialCase.label);
    }
  });

  it('lists non-production skill metadata and filters by project', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const allSkills = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler({
      headers: authHeaders(),
      query: {},
    })) as SkillListEnvelope;

    assert.equal(allSkills.count, 1);
    assert.equal(allSkills.skills[0]?.skill_definition_id, 'skill_demo_safe_research');
    assert.equal(allSkills.skills[0]?.rollout_policy.production_enabled, false);
    assert.equal(allSkills.skills[0]?.instruction_template_refs[0]?.ref_type, 'instruction_template_ref');
    assertNoSensitiveControlPayload(allSkills);

    const filtered = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler({
      headers: authHeaders(),
      query: { project_id: 'does_not_match' },
    })) as SkillListEnvelope;

    assert.equal(filtered.count, 0);
    assert.deepEqual(filtered.skills, []);
  });

  it('lists bundled registry-backed skills and filters by registry project and status without an injected store', async () => {
    const registrar = registerBundledSkillRoutesForTest();

    const allSkills = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler({
      headers: authHeaders(),
      query: {},
    })) as SkillListEnvelope;

    assert.ok(allSkills.count >= 2);
    const skillIds = allSkills.skills.map((skill) => skill.skill_definition_id);
    assert.ok(skillIds.includes('skill:devgateway/research-context-pack'));
    assert.ok(skillIds.includes('skill:devgateway/tool-call-summarizer'));
    assert.equal(skillIds.includes('skill_demo_safe_research'), false);
    assert.ok(allSkills.skills.every((skill) => skill.project_id === 'project:devgateway'));
    assert.ok(allSkills.skills.some((skill) => skill.status === 'draft'));
    assert.ok(allSkills.skills.some((skill) => skill.status === 'eval_ready'));
    assertNoSensitiveControlPayload(allSkills);
    assertNoRawSkillListPayload(allSkills);

    const projectFiltered = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler({
      headers: authHeaders(),
      query: { project_id: 'project:devgateway' },
    })) as SkillListEnvelope;

    assert.equal(projectFiltered.count, allSkills.count);
    assert.ok(projectFiltered.skills.every((skill) => skill.project_id === 'project:devgateway'));

    const draftFiltered = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler({
      headers: authHeaders(),
      query: { project_id: 'project:devgateway', status: 'draft' },
    })) as SkillListEnvelope;

    assert.equal(draftFiltered.count, 1);
    assert.equal(draftFiltered.skills[0]?.status, 'draft');
    assert.equal(draftFiltered.skills[0]?.skill_definition_id, 'skill:devgateway/research-context-pack');

    const evalReadyFiltered = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler({
      headers: authHeaders(),
      query: { project_id: 'project:devgateway', status: 'eval_ready' },
    })) as SkillListEnvelope;

    assert.equal(evalReadyFiltered.count, 1);
    assert.equal(evalReadyFiltered.skills[0]?.status, 'eval_ready');
    assert.equal(evalReadyFiltered.skills[0]?.skill_definition_id, 'skill:devgateway/tool-call-summarizer');
  });

  it('fails closed with stale_policy when the default skill registry snapshot is missing or stale', async () => {
    const missingRegistrar = registerBundledSkillRoutesForTest({ registrySnapshot: null });
    const missingReply = new CapturingReply();
    const missingResult = (await route(missingRegistrar, 'GET', SKILLS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        query: {},
      },
      missingReply,
    )) as ControlErrorEnvelope;

    assert.equal(missingReply.statusCode, 409);
    assert.equal(missingResult.error.code, 'stale_policy');
    assert.equal(missingResult.error.denial_reason, 'policy_stale');
    assert.equal(missingResult.error.details?.field, 'skill_registry_snapshot');
    assert.equal(missingResult.error.details?.reason, 'missing');

    const staleSnapshot = getBundledSkillRegistrySnapshot();
    staleSnapshot.freshness_expires_at = '2026-01-01T00:00:00.000Z';
    const staleRegistrar = registerBundledSkillRoutesForTest({ registrySnapshot: staleSnapshot });
    const staleReply = new CapturingReply();
    const staleResult = (await route(staleRegistrar, 'GET', SKILLS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        query: {},
      },
      staleReply,
    )) as ControlErrorEnvelope;

    assert.equal(staleReply.statusCode, 409);
    assert.equal(staleResult.error.code, 'stale_policy');
    assert.equal(staleResult.error.denial_reason, 'policy_stale');
    const staleIssues = staleResult.error.details?.issues;
    assert.ok(Array.isArray(staleIssues));
    assert.ok(
      staleIssues.some(
        (issue) =>
          isRecordForTest(issue) && issue.code === 'policy_stale' && issue.path === '$.freshness_expires_at',
      ),
      JSON.stringify(staleResult, null, 2),
    );
    assertNoSensitiveControlPayload(missingResult);
    assertNoSensitiveControlPayload(staleResult);
  });

  it('keeps the default skill route fail-closed in production without an injected store', async () => {
    const registrar = registerBundledSkillRoutesForTest({ runtimeEnvironment: 'production' });
    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        query: {},
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 503);
    assert.equal(result.error.code, 'production_disabled_route');
    assert.equal(result.error.denial_reason, 'route_disabled');
  });

  it('fails closed for missing auth and production Track 2 route access', async () => {
    const missingAuthRegistrar = registerAgentWorkflowRoutesForTest({ withAuth: false });
    const missingAuthReply = new CapturingReply();
    const missingAuthResult = (await route(missingAuthRegistrar, 'POST', TASKS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: validTaskBody(),
      },
      missingAuthReply,
    )) as { error: { code: string } };

    assert.equal(missingAuthReply.statusCode, 401);
    assert.equal(missingAuthResult.error.code, 'missing_auth');

    const productionRegistrar = registerAgentWorkflowRoutesForTest({ runtimeEnvironment: 'production' });
    const productionReply = new CapturingReply();
    const productionResult = (await route(productionRegistrar, 'GET', SKILLS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        query: {},
      },
      productionReply,
    )) as { error: { code: string } };

    assert.equal(productionReply.statusCode, 503);
    assert.equal(productionResult.error.code, 'production_disabled_route');
  });
});

type OpaqueRefForTest = {
  readonly ref_id: string;
  readonly ref_type: string;
  readonly scope_ref: string;
};

type TaskEnvelope = {
  readonly task: {
    readonly task_id: string;
    readonly workflow_id: string;
    readonly workflow_run_id: string;
    readonly status: string;
    readonly principal_id: string;
    readonly project_id: string;
    readonly data_class: string;
    readonly budget_scope_id: string;
    readonly policy_version: string;
    readonly registry_version: string;
    readonly trace_id: string;
    readonly request_id: string;
  };
};

type TaskCancelEnvelope = {
  readonly task: TaskEnvelope['task'];
  readonly cancellation_request: {
    readonly requested: boolean;
    readonly requested_by_principal_id: string;
    readonly request_id: string;
    readonly cancellation_reason: string | null;
  };
};

type ArtifactListEnvelope = {
  readonly artifacts: readonly {
    readonly artifact_id: string;
    readonly signed_download_eligible: boolean;
    readonly storage_ref: {
      readonly object_path_ref: string;
    };
  }[];
  readonly count: number;
};

type WorkflowEventPageEnvelope = {
  readonly events: readonly {
    readonly sequence_number: number;
  }[];
  readonly next_cursor: string | null;
};

type WorkflowEnvelope = {
  readonly workflow: {
    readonly workflow_id: string;
    readonly principal_id: string;
  };
};

type AgentRunEnvelope = {
  readonly agent_run: {
    readonly agent_run_id: string;
    readonly workflow_id: string;
    readonly status: string;
    readonly context_refs: readonly OpaqueRefForTest[];
  };
};

type SkillListEnvelope = {
  readonly skills: readonly {
    readonly skill_definition_id: string;
    readonly status: string;
    readonly project_id: string;
    readonly rollout_policy: {
      readonly production_enabled: boolean;
    };
    readonly instruction_template_refs: readonly OpaqueRefForTest[];
  }[];
  readonly count: number;
};

type BudgetScopeEnvelope = {
  readonly budget_scope: {
    readonly budget_scope_id: string;
  };
};

type BudgetReservationEnvelope = {
  readonly budget_reservation: BudgetReservationRecord;
};

type BudgetSpendEnvelope = {
  readonly spend: BudgetSpendInspection;
};

type ControlErrorEnvelope = {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly denial_reason?: string;
    readonly retryable?: boolean;
    readonly details?: Readonly<Record<string, unknown>>;
  };
};

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

function authHeaders(principalId = 'principal_test', projectId?: string): Record<string, string> {
  return {
    ...(projectId === undefined ? {} : { 'x-devgateway-project-id': projectId }),
    'x-devgateway-principal-id': principalId,
    'x-devgateway-auth-subject': `subject_${principalId}`,
  };
}

function headerValueForTest(
  headers: ControlRouteRequest['headers'],
  name: string,
): string | undefined {
  const value =
    headers instanceof Headers
      ? headers.get(name)
      : headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.trim() !== '' ? first : undefined;
}

async function createBudgetScopeForTest(
  registrar: CapturingRegistrar,
  body: Readonly<Record<string, unknown>>,
): Promise<string> {
  const result = (await route(registrar, 'POST', BUDGET_SCOPES_BASE_PATH).handler({
    headers: authHeaders(),
    body,
  })) as BudgetScopeEnvelope;

  assert.match(result.budget_scope.budget_scope_id, /^bs_/u);
  return result.budget_scope.budget_scope_id;
}

async function inspectBudgetScopeSpendForTest(
  registrar: CapturingRegistrar,
  budgetScopeId: string,
): Promise<BudgetSpendInspection> {
  const result = (await route(registrar, 'GET', `${BUDGET_SCOPES_BASE_PATH}/:budget_scope_id/spend`).handler({
    headers: authHeaders(),
    params: { budget_scope_id: budgetScopeId },
  })) as BudgetSpendEnvelope;

  return result.spend;
}

function validBudgetReservationBody(
  budgetScopeId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    budget_scope_id: budgetScopeId,
    workflow_run_id: 'workflow_run_budget_test',
    delegation_id: 'delegation_budget_test',
    tool_class: 'code_interpreter',
    model_alias: 'claude-fast',
    currency: 'USD',
    amount: 1,
    input_tokens: 10,
    output_tokens: 20,
    idempotency_key: 'idempotency_budget_reserve_test',
    request_id: 'request_budget_reserve_test',
    trace_id: 'trace_budget_reserve_test',
    policy_version: 'policy-budget-track2-v1',
    ...overrides,
  };
}

function validBudgetSettlementBody(
  budgetScopeId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    budget_scope_id: budgetScopeId,
    workflow_run_id: 'workflow_run_budget_test',
    delegation_id: 'delegation_budget_test',
    tool_class: 'code_interpreter',
    model_alias: 'claude-fast',
    currency: 'USD',
    actual_amount: 1,
    actual_input_tokens: 10,
    actual_output_tokens: 20,
    cost_event_id: 'cost_budget_settlement_test',
    idempotency_key: 'idempotency_budget_settle_test',
    request_id: 'request_budget_settle_test',
    trace_id: 'trace_budget_settle_test',
    policy_version: 'policy-budget-track2-v1',
    ...overrides,
  };
}

function validBudgetReleaseBody(
  budgetScopeId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    budget_scope_id: budgetScopeId,
    workflow_run_id: 'workflow_run_budget_test',
    delegation_id: 'delegation_budget_test',
    tool_class: 'code_interpreter',
    model_alias: 'claude-fast',
    currency: 'USD',
    release_reason: 'unused_reservation',
    idempotency_key: 'idempotency_budget_release_test',
    request_id: 'request_budget_release_test',
    trace_id: 'trace_budget_release_test',
    policy_version: 'policy-budget-track2-v1',
    ...overrides,
  };
}

function emptyReservationState(): BudgetSpendInspection['reservation_state'] {
  return {
    reserved_amount: 0,
    reserved_input_tokens: 0,
    reserved_output_tokens: 0,
    reservation_count: 0,
  };
}

function registerAgentWorkflowRoutesForTest(
  options: { readonly runtimeEnvironment?: 'development' | 'production'; readonly withAuth?: boolean } = {},
): CapturingRegistrar {
  const registrar = new CapturingRegistrar();
  const store = createInMemoryAgentWorkflowStore();
  const runtimeEnvironment = options.runtimeEnvironment ?? 'development';
  const routeOptions =
    options.withAuth === false
      ? { runtimeEnvironment, store }
      : {
          runtimeEnvironment,
          store,
          authenticate: async (request: ControlRouteRequest) => ({
            principalId: headerValueForTest(request.headers, 'x-devgateway-principal-id') ?? 'principal_test',
            authSubjectRef: headerValueForTest(request.headers, 'x-devgateway-auth-subject') ?? 'subject_test',
          }),
        };

  registerTaskRoutes(registrar, routeOptions);
  registerArtifactRoutes(registrar, routeOptions);
  registerWorkflowRoutes(registrar, routeOptions);
  registerAgentRunRoutes(registrar, routeOptions);
  registerSkillRoutes(registrar, routeOptions);
  return registrar;
}

function registerBundledSkillRoutesForTest(
  options: {
    readonly runtimeEnvironment?: 'development' | 'production';
    readonly registrySnapshot?: SkillRegistrySnapshot | null;
  } = {},
): CapturingRegistrar {
  const registrar = new CapturingRegistrar();
  registerSkillRoutes(registrar, {
    runtimeEnvironment: options.runtimeEnvironment ?? 'development',
    now: new Date('2026-06-21T10:31:00.000Z'),
    ...(options.registrySnapshot === undefined ? {} : { registrySnapshot: options.registrySnapshot }),
    authenticate: async () => ({
      principalId: 'principal_test',
      authSubjectRef: 'subject_test',
    }),
  });
  return registrar;
}

function validTaskBody(): Record<string, unknown> {
  return {
    task_type: 'analysis',
    principal_id: 'principal_test',
    project_id: 'project_123',
    data_class: 'internal',
    budget_scope_id: 'budget_scope_track2',
    policy_version: 'policy-track2-v1',
    registry_version: 'registry-track2-v1',
    trace_id: 'trace_track2_test',
    request_id: 'request_track2_create',
    objective_ref: {
      ref_id: 'objective_track2_test',
      ref_type: 'objective_ref',
      scope_ref: 'project_123',
    },
    input_context_refs: [
      {
        ref_id: 'context_track2_test',
        ref_type: 'sanitized_context_ref',
        scope_ref: 'project_123',
      },
    ],
    priority: 'high',
    workflow_version: 'workflow.track2.test.v1',
    idempotency_key: 'idempotency_track2_test',
  };
}

function assertNoSensitiveControlPayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(
    serialized,
    /object[_-]?body|signed[_-]?url|raw[_-]?(prompt|context)|provider[_-]?(key|token|secret)|api[_-]?key|token|secret/i,
  );
}

function assertNoRawSkillListPayload(value: unknown): void {
  const forbiddenField = /^(prompt|prompt_body|prompt_template|raw_prompt|content|raw_content|secret|secrets|provider_key|providerKey|api_key|token|access_token|refresh_token|provider_token)$/u;
  const secretLikeValue = /(?:sk-[A-Za-z0-9_-]{12,}|authorization:\s*bearer|bearer\s+[A-Za-z0-9._-]{20,}|provider[_-]?key|prompt body|raw prompt)/iu;

  walkPayloadForForbiddenFields(value, '$');

  function walkPayloadForForbiddenFields(node: unknown, path: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walkPayloadForForbiddenFields(item, `${path}[${index}]`));
      return;
    }
    if (isRecordForTest(node)) {
      for (const [key, child] of Object.entries(node)) {
        assert.equal(forbiddenField.test(key), false, `forbidden skill payload field at ${path}.${key}`);
        walkPayloadForForbiddenFields(child, `${path}.${key}`);
      }
      return;
    }
    if (typeof node === 'string') {
      assert.doesNotMatch(node, secretLikeValue, `forbidden skill payload value at ${path}`);
    }
  }
}

function isRecordForTest(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
