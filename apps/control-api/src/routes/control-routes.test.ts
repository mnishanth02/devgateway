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
import { createInMemoryAgentWorkflowStore, type ApprovalControlRecord } from './agent-workflow-store.ts';
import {
  ARTIFACT_LIFECYCLE_PATH,
  ARTIFACT_LIFECYCLE_STATUS_PATH,
  ARTIFACT_SIGNED_ACCESS_PATH,
  TASK_ARTIFACTS_PATH,
  registerArtifactRoutes,
} from './artifacts.ts';
import { SKILLS_BASE_PATH, registerSkillRoutes } from './skills.ts';
import { TASKS_BASE_PATH, registerTaskRoutes } from './tasks.ts';
import {
  VIRTUAL_KEYS_BASE_PATH,
  registerVirtualKeyRoutes,
  type ControlRouteDefinition,
  type ControlRouteRequest,
} from './virtual-keys.ts';
import { WORKFLOWS_BASE_PATH, registerWorkflowRoutes } from './workflows.ts';
import { APPROVALS_BASE_PATH, registerApprovalRoutes } from './approvals.ts';
import { OUTBOX_BASE_PATH, registerOutboxRoutes } from './outbox.ts';
import {
  WORKFLOW_TEMPLATE_VERSIONS_BASE_PATH,
  WORKFLOW_TEMPLATES_BASE_PATH,
  registerTemplateRoutes,
} from './templates.ts';

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

    const conflictingReplayReply = new CapturingReply();
    const conflictingReplay = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler(
      { headers: authHeaders(), body: { ...reserveBody, amount: 12.6 } },
      conflictingReplayReply,
    )) as ControlErrorEnvelope;

    assert.equal(conflictingReplayReply.statusCode, 400);
    assert.equal(conflictingReplay.error.code, 'invalid_request');

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

  it('denies inactive and limit-exceeding budget reservations', async () => {
    const registrar = new CapturingRegistrar();
    registerBudgetRoutes(registrar, { runtimeEnvironment: 'development' });
    const inactiveBudgetScopeId = await createBudgetScopeForTest(registrar, {
      scope_type: 'workflow',
      owner_id: 'workflow_run_inactive_budget',
      status: 'disabled',
      limits: { hard_cap_amount: 100 },
      policy_version: 'policy-budget-track2-v1',
    });

    const inactiveReply = new CapturingReply();
    const inactive = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: validBudgetReservationBody(inactiveBudgetScopeId, {
          workflow_run_id: 'workflow_run_inactive_budget',
          delegation_id: null,
          tool_class: null,
          idempotency_key: 'idempotency_budget_inactive_denied',
          request_id: 'request_budget_inactive_denied',
          trace_id: 'trace_budget_inactive_denied',
        }),
      },
      inactiveReply,
    )) as ControlErrorEnvelope;

    assert.equal(inactiveReply.statusCode, 400);
    assert.equal(inactive.error.code, 'invalid_request');
    assert.match(inactive.error.message, /must be active/u);

    const limitedBudgetScopeId = await createBudgetScopeForTest(registrar, {
      scope_type: 'workflow',
      owner_id: 'workflow_run_token_limit',
      limits: { input_token_limit: 5, request_limit: 1 },
      policy_version: 'policy-budget-track2-v1',
    });
    const tokenReply = new CapturingReply();
    const tokenLimit = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: validBudgetReservationBody(limitedBudgetScopeId, {
          workflow_run_id: 'workflow_run_token_limit',
          delegation_id: null,
          tool_class: null,
          input_tokens: 6,
          idempotency_key: 'idempotency_budget_token_limit_denied',
          request_id: 'request_budget_token_limit_denied',
          trace_id: 'trace_budget_token_limit_denied',
        }),
      },
      tokenReply,
    )) as ControlErrorEnvelope;

    assert.equal(tokenReply.statusCode, 400);
    assert.match(tokenLimit.error.message, /input_token_limit/u);

    await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler({
      headers: authHeaders(),
      body: validBudgetReservationBody(limitedBudgetScopeId, {
        workflow_run_id: 'workflow_run_token_limit',
        delegation_id: null,
        tool_class: null,
        input_tokens: 1,
        idempotency_key: 'idempotency_budget_request_limit_allowed',
        request_id: 'request_budget_request_limit_allowed',
        trace_id: 'trace_budget_request_limit_allowed',
      }),
    });

    const requestReply = new CapturingReply();
    const requestLimit = (await route(registrar, 'POST', BUDGET_RESERVATIONS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: validBudgetReservationBody(limitedBudgetScopeId, {
          workflow_run_id: 'workflow_run_token_limit',
          delegation_id: null,
          tool_class: null,
          input_tokens: 1,
          idempotency_key: 'idempotency_budget_request_limit_denied',
          request_id: 'request_budget_request_limit_denied',
          trace_id: 'trace_budget_request_limit_denied',
        }),
      },
      requestReply,
    )) as ControlErrorEnvelope;

    assert.equal(requestReply.statusCode, 400);
    assert.match(requestLimit.error.message, /request_limit/u);
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

  it('rejects idempotency-key task replays with different create inputs', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();
    await route(registrar, 'POST', TASKS_BASE_PATH).handler({
      headers: authHeaders(),
      body: validTaskBody(),
    });

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', TASKS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        body: { ...validTaskBody(), priority: 'low' },
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 409);
    assert.equal(result.error.code, 'invalid_state');
    assert.match(result.error.message, /idempotency_key replay/u);
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
    assert.equal(result.artifacts[0]?.storage_ref.ref_id, 'storage_ref_artifact_demo_001');
    assert.equal(result.artifacts[0]?.storage_ref.ref_type, 'artifact_storage_ref');
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
      headers: authHeaders('principal_demo', 'project_demo'),
      query: {},
    })) as SkillListEnvelope;

    assert.equal(allSkills.count, 1);
    assert.equal(allSkills.skills[0]?.skill_definition_id, 'skill_demo_safe_research');
    assert.equal(allSkills.skills[0]?.rollout_policy.production_enabled, false);
    assert.equal(allSkills.skills[0]?.instruction_template_refs[0]?.ref_type, 'instruction_template_ref');
    assertNoSensitiveControlPayload(allSkills);

    const filtered = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { project_id: 'does_not_match' },
    })) as SkillListEnvelope;

    assert.equal(filtered.count, 0);
    assert.deepEqual(filtered.skills, []);

    const mismatchedPrincipalReply = new CapturingReply();
    const mismatchedPrincipal = (await route(registrar, 'GET', SKILLS_BASE_PATH).handler(
      {
        headers: authHeaders(),
        query: { principal_id: 'principal_other' },
      },
      mismatchedPrincipalReply,
    )) as ControlErrorEnvelope;

    assert.equal(mismatchedPrincipalReply.statusCode, 403);
    assert.equal(mismatchedPrincipal.error.code, 'invalid_state');
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

describe('control API approval routes', () => {
  it('lists pending fixture approvals with metadata-only response', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', APPROVALS_BASE_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        query: {},
      },
      reply,
    )) as ApprovalListEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.count, 1);
    assert.equal(result.approvals[0]?.approval_request_id, 'approval_request_demo_001');
    assert.equal(result.approvals[0]?.state, 'pending');
    assert.equal(result.approvals[0]?.workflow_id, 'workflow_demo_001');
    assert.equal(result.approvals[0]?.task_id, 'task_demo_001');
    assert.equal(result.approvals[0]?.risk_tier, 'medium');
    assert.equal(result.approvals[0]?.decision_ref, null);
    assertNoSensitiveControlPayload(result);
  });

  it('returns empty list when filtering by non-pending state with no matching approvals', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', APPROVALS_BASE_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        query: { state: 'approved' },
      },
      reply,
    )) as ApprovalListEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.count, 0);
    assert.deepEqual(result.approvals, []);
  });

  it('gets a single approval by id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${APPROVALS_BASE_PATH}/:approval_request_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { approval_request_id: 'approval_request_demo_001' },
      },
      reply,
    )) as ApprovalEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.approval.approval_request_id, 'approval_request_demo_001');
    assert.equal(result.approval.state, 'pending');
    assert.equal(result.approval.principal_id, 'principal_demo');
    assert.equal(result.approval.project_id, 'project_demo');
    assertNoSensitiveControlPayload(result);
  });

  it('approves a pending approval with trusted actor decision ref', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler(
      {
        headers: authHeaders('principal_approver', 'project_demo', ['approver']),
        params: { approval_request_id: 'approval_request_demo_001' },
        body: validApproveBody(),
      },
      reply,
    )) as ApprovalEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.approval.approval_request_id, 'approval_request_demo_001');
    assert.equal(result.approval.state, 'approved');
    assert.equal(result.approval.approver_principal_id, 'principal_approver');
    assert.ok(result.approval.decision_ref !== null);
    assert.equal(result.approval.decision_ref.decision, 'approved');
    assert.equal(result.approval.decision_ref.approver_principal_id, 'principal_approver');
    assert.match(result.approval.decision_ref.decision_id, /^decision_approve_/u);
    assertNoSensitiveControlPayload(result);
  });

  it('denies a pending approval with trusted actor decision ref', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/deny`).handler(
      {
        headers: authHeaders('principal_approver', 'project_demo', ['approver']),
        params: { approval_request_id: 'approval_request_demo_001' },
        body: validDenyBody(),
      },
      reply,
    )) as ApprovalEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.approval.state, 'denied');
    assert.equal(result.approval.approver_principal_id, 'principal_approver');
    assert.ok(result.approval.decision_ref !== null);
    assert.equal(result.approval.decision_ref.decision, 'denied');
    assertNoSensitiveControlPayload(result);
  });

  it('rejects approval decisions when the actor lacks the required approver role', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler(
      {
        headers: authHeaders('principal_approver', 'project_demo'),
        params: { approval_request_id: 'approval_request_demo_001' },
        body: validApproveBody(),
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 403);
    assert.equal(result.error.code, 'invalid_state');
    assert.match(result.error.message, /required approver role/u);
  });

  it('rejects approval decisions without an explicit project scope', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler(
      {
        headers: authHeaders('principal_approver', undefined, ['approver']),
        params: { approval_request_id: 'approval_request_demo_001' },
        body: validApproveBody(),
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 404);
    assert.equal(result.error.code, 'not_found');
  });

  it('allows required-role approval decisions when no required principal is pinned', async () => {
    const registrar = new CapturingRegistrar();
    const now = '2026-01-01T00:00:00.000Z';
    const roleOnlyApproval: ApprovalControlRecord = {
      contract_version: gatewayControlContractVersion,
      approval_request_id: 'approval_request_role_only_001',
      workflow_run_id: 'workflow_role_only_001',
      workflow_id: 'workflow_role_only_001',
      task_id: 'task_role_only_001',
      request_id: 'request_role_only_001',
      step_id: null,
      delegation_id: null,
      tool_call_id: null,
      requester_principal_id: 'principal_requester',
      approver_principal_id: null,
      required_role: 'approver',
      approver_policy: {
        required_role: 'approver',
        required_principal_ref: null,
        fallback_approver_ref: null,
        policy_version: 'policy-role-only-v1',
      },
      risk_tier: 'medium',
      action_summary_artifact_ref: {
        artifact_id: 'artifact_role_only_001',
        artifact_kind: 'trace_evidence',
        data_class: 'internal',
        sha256: 'a'.repeat(64),
        size_bytes: 64,
      },
      state: 'pending',
      decision_ref: null,
      expires_at: '2099-01-01T00:00:00.000Z',
      policy_ref: {
        policy_version: 'policy-role-only-v1',
        policy_decision_ref: 'policy_decision_role_only_001',
        evaluated_at: now,
      },
      audit_refs: [
        {
          audit_event_id: 'audit_role_only_approval_requested',
          audit_stream: 'control-api-test',
          recorded_at: now,
        },
      ],
      idempotency: {
        idempotency_key: 'idem-role-only-approval',
        scope: 'approval',
        dedupe_ref: 'approval_request_role_only_001',
        expires_at: '2099-01-01T00:00:00.000Z',
      },
      principal_id: 'principal_requester',
      project_id: 'project_demo',
      data_class: 'internal',
      budget_scope_id: 'budget_scope_role_only_001',
      policy_version: 'policy-role-only-v1',
      registry_version: 'registry-role-only-v1',
      trace_id: 'trace_role_only_001',
      trace_context_ref: {
        trace_context_id: 'trace_role_only_001',
        span_id: '0000000000000001',
        propagation_ref: 'traceparent-role-only-001',
      },
      created_at: now,
      updated_at: now,
    };
    registerApprovalRoutes(registrar, {
      runtimeEnvironment: 'development',
      store: createInMemoryAgentWorkflowStore({
        includeFixtures: false,
        initialState: { approvals: [roleOnlyApproval] },
      }),
      authenticate: async (request: ControlRouteRequest) => ({
        principalId: headerValueForTest(request.headers, 'x-devgateway-principal-id') ?? 'principal_test',
        authSubjectRef: headerValueForTest(request.headers, 'x-devgateway-auth-subject') ?? 'subject_test',
        roles: rolesHeaderValueForTest(request.headers, 'x-devgateway-roles') ?? [],
      }),
    });

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler(
      {
        headers: authHeaders('principal_role_approver', 'project_demo', ['approver']),
        params: { approval_request_id: 'approval_request_role_only_001' },
        body: {
          ...validApproveBody(),
          policy_version: 'policy-role-only-v1',
          registry_version: 'registry-role-only-v1',
        },
      },
      reply,
    )) as ApprovalEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.approval.state, 'approved');
    assert.equal(result.approval.approver_principal_id, 'principal_role_approver');
  });

  it('rejects approval transition on already-terminal state (approved immutability)', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();
    await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler({
      headers: authHeaders('principal_approver', 'project_demo', ['approver']),
      params: { approval_request_id: 'approval_request_demo_001' },
      body: validApproveBody(),
    });

    const reapproveReply = new CapturingReply();
    const reapprove = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler(
      {
        headers: authHeaders('principal_approver', 'project_demo', ['approver']),
        params: { approval_request_id: 'approval_request_demo_001' },
        body: validApproveBody(),
      },
      reapproveReply,
    )) as ControlErrorEnvelope;

    assert.equal(reapproveReply.statusCode, 409);
    assert.equal(reapprove.error.code, 'invalid_state');
    assert.match(reapprove.error.message, /terminal state/u);
  });

  it('fails closed with stale_policy on policy version mismatch', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { approval_request_id: 'approval_request_demo_001' },
        body: { ...validApproveBody(), policy_version: 'wrong-policy-v999' },
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 409);
    assert.equal(result.error.code, 'stale_policy');
    assert.equal(result.error.denial_reason, 'policy_stale');
  });

  it('hides approvals from other principals (cross-principal denial returns 404)', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();
    const itemDenialCases = [
      {
        label: 'get approval other principal',
        method: 'GET' as const,
        url: `${APPROVALS_BASE_PATH}/:approval_request_id`,
        request: { headers: authHeaders('principal_other'), params: { approval_request_id: 'approval_request_demo_001' } },
      },
      {
        label: 'approve other principal',
        method: 'POST' as const,
        url: `${APPROVALS_BASE_PATH}/:approval_request_id/approve`,
        request: {
          headers: authHeaders('principal_other'),
          params: { approval_request_id: 'approval_request_demo_001' },
          body: validApproveBody(),
        },
      },
      {
        label: 'deny other principal',
        method: 'POST' as const,
        url: `${APPROVALS_BASE_PATH}/:approval_request_id/deny`,
        request: {
          headers: authHeaders('principal_other'),
          params: { approval_request_id: 'approval_request_demo_001' },
          body: validDenyBody(),
        },
      },
    ];

    for (const denialCase of itemDenialCases) {
      const reply = new CapturingReply();
      const result = (await route(registrar, denialCase.method, denialCase.url).handler(
        denialCase.request,
        reply,
      )) as ControlErrorEnvelope;

      assert.equal(reply.statusCode, 404, denialCase.label);
      assert.equal(result.error.code, 'not_found', denialCase.label);
    }

    const listReply = new CapturingReply();
    const listResult = (await route(registrar, 'GET', APPROVALS_BASE_PATH).handler(
      { headers: authHeaders('principal_other'), query: {} },
      listReply,
    )) as ApprovalListEnvelope;
    assert.equal(listReply.statusCode, 200);
    assert.equal(listResult.count, 0);
  });

  it('fails closed in production with production_disabled_route', async () => {
    const registrar = new CapturingRegistrar();
    registerApprovalRoutes(registrar, { runtimeEnvironment: 'production' });

    const listReply = new CapturingReply();
    const listResult = (await route(registrar, 'GET', APPROVALS_BASE_PATH).handler(
      { headers: authHeaders(), query: {} },
      listReply,
    )) as ControlErrorEnvelope;

    assert.equal(listReply.statusCode, 503);
    assert.equal(listResult.error.code, 'production_disabled_route');

    const approveReply = new CapturingReply();
    const approveResult = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler(
      {
        headers: authHeaders(),
        params: { approval_request_id: 'approval_request_demo_001' },
        body: validApproveBody(),
      },
      approveReply,
    )) as ControlErrorEnvelope;

    assert.equal(approveReply.statusCode, 503);
    assert.equal(approveResult.error.code, 'production_disabled_route');
  });

  it('rejects approve/deny body with missing required fields', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const missingPolicyReply = new CapturingReply();
    const missingPolicy = (await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { approval_request_id: 'approval_request_demo_001' },
        body: { request_id: 'req', trace_id: 'trace' },
      },
      missingPolicyReply,
    )) as ControlErrorEnvelope;

    assert.equal(missingPolicyReply.statusCode, 400);
    assert.equal(missingPolicy.error.code, 'invalid_request');
  });

  it('response contains no raw, signed, or secret fields', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const listResult = await route(registrar, 'GET', APPROVALS_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: {},
    });

    const approveResult = await route(registrar, 'POST', `${APPROVALS_BASE_PATH}/:approval_request_id/approve`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { approval_request_id: 'approval_request_demo_001' },
      body: validApproveBody(),
    });

    assertNoSensitiveControlPayload(listResult);
    assertNoSensitiveControlPayload(approveResult);
  });
});

describe('control API outbox routes', () => {
  it('lists fixture outbox records with metadata-only response', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        query: {},
      },
      reply,
    )) as OutboxListEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.count, 1);
    assert.equal(result.outboxes[0]?.outbox_id, 'outbox_demo_001');
    assert.equal(result.outboxes[0]?.delivery_state, 'pending');
    assert.equal(result.outboxes[0]?.destination_kind, 'portal_update');
    assert.equal(result.outboxes[0]?.workflow_id, 'workflow_demo_001');
    assert.equal(result.outboxes[0]?.principal_id, 'principal_demo');
    assert.equal(result.outboxes[0]?.project_id, 'project_demo');
    assertNoSensitiveControlPayload(result);
  });

  it('filters outbox records by workflow_id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const matched = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { workflow_id: 'workflow_demo_001' },
    })) as OutboxListEnvelope;

    const unmatched = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { workflow_id: 'workflow_does_not_exist' },
    })) as OutboxListEnvelope;

    assert.equal(matched.count, 1);
    assert.equal(matched.outboxes[0]?.outbox_id, 'outbox_demo_001');
    assert.equal(unmatched.count, 0);
    assert.deepEqual(unmatched.outboxes, []);
  });

  it('filters outbox records by delivery_state', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const pending = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { delivery_state: 'pending' },
    })) as OutboxListEnvelope;

    const delivered = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { delivery_state: 'delivered' },
    })) as OutboxListEnvelope;

    assert.equal(pending.count, 1);
    assert.equal(delivered.count, 0);
  });

  it('filters outbox records by destination_kind', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const portalUpdate = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { destination_kind: 'portal_update' },
    })) as OutboxListEnvelope;

    const trace = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { destination_kind: 'trace' },
    })) as OutboxListEnvelope;

    assert.equal(portalUpdate.count, 1);
    assert.equal(trace.count, 0);
  });

  it('returns outbox status summary with counts by state and destination', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/status`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        query: {},
      },
      reply,
    )) as OutboxStatusEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.status.total, 1);
    assert.equal(result.status.failed_count, 0);
    assert.equal(result.status.dead_lettered_count, 0);
    assert.equal(result.status.counts_by_state.pending, 1);
    assert.equal(result.status.counts_by_destination.portal_update, 1);
    assertNoSensitiveControlPayload(result);
  });

  it('returns empty status for unmatched workflow_id filter', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const result = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/status`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { workflow_id: 'workflow_does_not_exist' },
    })) as OutboxStatusEnvelope;

    assert.equal(result.status.total, 0);
    assert.equal(result.status.failed_count, 0);
    assert.deepEqual(result.status.counts_by_state, {});
    assert.deepEqual(result.status.counts_by_destination, {});
  });

  it('gets a single outbox record by id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/:outbox_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { outbox_id: 'outbox_demo_001' },
      },
      reply,
    )) as OutboxEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.outbox.outbox_id, 'outbox_demo_001');
    assert.equal(result.outbox.delivery_state, 'pending');
    assert.equal(result.outbox.destination_kind, 'portal_update');
    assert.equal(result.outbox.workflow_id, 'workflow_demo_001');
    assert.equal(result.outbox.principal_id, 'principal_demo');
    assertNoSensitiveControlPayload(result);
  });

  it('returns 404 for unknown outbox_id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/:outbox_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { outbox_id: 'outbox_does_not_exist' },
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 404);
    assert.equal(result.error.code, 'not_found');
  });

  it('hides outbox records from other principals (cross-principal denial returns empty list / 404)', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const listReply = new CapturingReply();
    const listResult = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler(
      { headers: authHeaders('principal_other'), query: {} },
      listReply,
    )) as OutboxListEnvelope;

    assert.equal(listReply.statusCode, 200);
    assert.equal(listResult.count, 0);

    const statusReply = new CapturingReply();
    const statusResult = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/status`).handler(
      { headers: authHeaders('principal_other'), query: {} },
      statusReply,
    )) as OutboxStatusEnvelope;

    assert.equal(statusReply.statusCode, 200);
    assert.equal(statusResult.status.total, 0);

    const getReply = new CapturingReply();
    const getResult = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/:outbox_id`).handler(
      {
        headers: authHeaders('principal_other'),
        params: { outbox_id: 'outbox_demo_001' },
      },
      getReply,
    )) as ControlErrorEnvelope;

    assert.equal(getReply.statusCode, 404, 'get outbox other principal');
    assert.equal(getResult.error.code, 'not_found', 'get outbox other principal');
    assert.doesNotMatch(getResult.error.message, /demo_001/u, 'get outbox other principal');
  });

  it('hides outbox records when project_id header does not match', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/:outbox_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_other'),
        params: { outbox_id: 'outbox_demo_001' },
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 404);
    assert.equal(result.error.code, 'not_found');
  });

  it('fails closed in production with production_disabled_route', async () => {
    const registrar = new CapturingRegistrar();
    registerOutboxRoutes(registrar, { runtimeEnvironment: 'production' });

    const listReply = new CapturingReply();
    const listResult = (await route(registrar, 'GET', OUTBOX_BASE_PATH).handler(
      { headers: authHeaders(), query: {} },
      listReply,
    )) as ControlErrorEnvelope;

    assert.equal(listReply.statusCode, 503);
    assert.equal(listResult.error.code, 'production_disabled_route');

    const statusReply = new CapturingReply();
    const statusResult = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/status`).handler(
      { headers: authHeaders(), query: {} },
      statusReply,
    )) as ControlErrorEnvelope;

    assert.equal(statusReply.statusCode, 503);
    assert.equal(statusResult.error.code, 'production_disabled_route');

    const getReply = new CapturingReply();
    const getResult = (await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/:outbox_id`).handler(
      {
        headers: authHeaders(),
        params: { outbox_id: 'outbox_demo_001' },
      },
      getReply,
    )) as ControlErrorEnvelope;

    assert.equal(getReply.statusCode, 503);
    assert.equal(getResult.error.code, 'production_disabled_route');
  });

  it('response contains no raw payload bodies, signed URLs, or forbidden fields', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const listResult = await route(registrar, 'GET', OUTBOX_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: {},
    });

    const statusResult = await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/status`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: {},
    });

    const getResult = await route(registrar, 'GET', `${OUTBOX_BASE_PATH}/:outbox_id`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { outbox_id: 'outbox_demo_001' },
    });

    assertNoSensitiveControlPayload(listResult);
    assertNoSensitiveControlPayload(statusResult);
    assertNoSensitiveControlPayload(getResult);
  });
});

describe('control API artifact lifecycle routes', () => {
  it('lists lifecycle events for fixture artifact with metadata-only response', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', ARTIFACT_LIFECYCLE_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { artifact_id: 'artifact_demo_001' },
      },
      reply,
    )) as ArtifactLifecycleListEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.count, 1);
    assert.equal(result.events[0]?.lifecycle_event_id, 'lifecycle_event_artifact_demo_001_1');
    assert.equal(result.events[0]?.artifact_id, 'artifact_demo_001');
    assert.equal(result.events[0]?.action, 'created');
    assert.equal(result.events[0]?.state, 'active');
    assert.equal(result.events[0]?.legal_hold, false);
    assert.equal(result.events[0]?.redacted, false);
    assert.equal(result.events[0]?.deletion_scheduled_at, null);
    assert.equal(result.events[0]?.signed_access_eligibility.eligible, false);
    assert.equal(result.events[0]?.signed_access_eligibility.requires_approval, true);
    assertNoSensitiveControlPayload(result);
  });

  it('returns lifecycle status summary for fixture artifact', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', ARTIFACT_LIFECYCLE_STATUS_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { artifact_id: 'artifact_demo_001' },
      },
      reply,
    )) as ArtifactLifecycleStatusEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.status.artifact_id, 'artifact_demo_001');
    assert.equal(result.status.latest_state, 'active');
    assert.equal(result.status.latest_action, 'created');
    assert.equal(result.status.legal_hold, false);
    assert.equal(result.status.redacted, false);
    assert.equal(result.status.deletion_scheduled_at, null);
    assert.equal(result.status.event_count, 1);
    assert.equal(result.status.signed_access_eligibility.eligible, false);
    assert.equal(result.status.signed_access_eligibility.requires_approval, true);
    assert.equal(result.status.signed_access_eligibility.max_signed_duration_seconds, 900);
    assertNoSensitiveControlPayload(result);
  });

  it('returns signed-access denial metadata without signed URL for approval-required artifact', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', ARTIFACT_SIGNED_ACCESS_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { artifact_id: 'artifact_demo_001' },
        body: validArtifactSignedAccessBody(),
      },
      reply,
    )) as ArtifactSignedAccessDecisionEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.decision.artifact_id, 'artifact_demo_001');
    assert.equal(result.decision.decision, 'approval_required');
    assert.equal(result.decision.eligible, false);
    assert.equal(result.decision.requires_approval, true);
    assert.equal(result.decision.max_signed_duration_seconds, 900);
    // Must not contain signed URL, object body, or credentials
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /signed_url|object_body|provider_key|provider_token|api_key/i);
    assertNoSensitiveControlPayload(result);
  });

  it('fails closed for signed-access policy or registry pin mismatch', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'POST', ARTIFACT_SIGNED_ACCESS_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { artifact_id: 'artifact_demo_001' },
        body: { ...validArtifactSignedAccessBody(), policy_version: 'wrong-policy-v999' },
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 409);
    assert.equal(result.error.code, 'stale_policy');
    assert.equal(result.error.denial_reason, 'policy_stale');
  });

  it('hides lifecycle from other principals (cross-principal denial returns 404 or empty)', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();
    const denialCases = [
      {
        label: 'lifecycle list other principal',
        method: 'GET' as const,
        url: ARTIFACT_LIFECYCLE_PATH,
        request: { headers: authHeaders('principal_other'), params: { artifact_id: 'artifact_demo_001' } },
      },
      {
        label: 'lifecycle status other principal',
        method: 'GET' as const,
        url: ARTIFACT_LIFECYCLE_STATUS_PATH,
        request: { headers: authHeaders('principal_other'), params: { artifact_id: 'artifact_demo_001' } },
      },
      {
        label: 'signed-access other principal',
        method: 'POST' as const,
        url: ARTIFACT_SIGNED_ACCESS_PATH,
        request: {
          headers: authHeaders('principal_other'),
          params: { artifact_id: 'artifact_demo_001' },
          body: validArtifactSignedAccessBody(),
        },
      },
      {
        label: 'lifecycle list project mismatch',
        method: 'GET' as const,
        url: ARTIFACT_LIFECYCLE_PATH,
        request: { headers: authHeaders('principal_demo', 'project_other'), params: { artifact_id: 'artifact_demo_001' } },
      },
      {
        label: 'lifecycle status project mismatch',
        method: 'GET' as const,
        url: ARTIFACT_LIFECYCLE_STATUS_PATH,
        request: { headers: authHeaders('principal_demo', 'project_other'), params: { artifact_id: 'artifact_demo_001' } },
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

  it('returns 404 for unknown artifact_id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    for (const [method, url] of [
      ['GET' as const, ARTIFACT_LIFECYCLE_PATH],
      ['GET' as const, ARTIFACT_LIFECYCLE_STATUS_PATH],
    ] as const) {
      const reply = new CapturingReply();
      const result = (await route(registrar, method, url).handler(
        {
          headers: authHeaders('principal_demo', 'project_demo'),
          params: { artifact_id: 'artifact_does_not_exist' },
        },
        reply,
      )) as ControlErrorEnvelope;

      assert.equal(reply.statusCode, 404, `${method} ${url}`);
      assert.equal(result.error.code, 'not_found', `${method} ${url}`);
    }

    const postReply = new CapturingReply();
    const postResult = (await route(registrar, 'POST', ARTIFACT_SIGNED_ACCESS_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { artifact_id: 'artifact_does_not_exist' },
        body: validArtifactSignedAccessBody(),
      },
      postReply,
    )) as ControlErrorEnvelope;

    assert.equal(postReply.statusCode, 404, 'POST signed-access unknown artifact');
    assert.equal(postResult.error.code, 'not_found', 'POST signed-access unknown artifact');
  });

  it('fails closed in production with production_disabled_route', async () => {
    const registrar = new CapturingRegistrar();
    registerArtifactRoutes(registrar, { runtimeEnvironment: 'production' });

    for (const [method, url] of [
      ['GET' as const, ARTIFACT_LIFECYCLE_PATH],
      ['GET' as const, ARTIFACT_LIFECYCLE_STATUS_PATH],
      ['POST' as const, ARTIFACT_SIGNED_ACCESS_PATH],
    ] as const) {
      const reply = new CapturingReply();
      const result = (await route(registrar, method, url).handler(
        {
          headers: authHeaders(),
          params: { artifact_id: 'artifact_demo_001' },
          ...(method === 'POST' ? { body: validArtifactSignedAccessBody() } : {}),
        },
        reply,
      )) as ControlErrorEnvelope;

      assert.equal(reply.statusCode, 503, `${method} ${url} should be disabled in production`);
      assert.equal(result.error.code, 'production_disabled_route', `${method} ${url}`);
    }
  });

  it('rejects signed-access request body with forbidden fields', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const forbiddenReply = new CapturingReply();
    const forbiddenResult = (await route(registrar, 'POST', ARTIFACT_SIGNED_ACCESS_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { artifact_id: 'artifact_demo_001' },
        body: { ...validArtifactSignedAccessBody(), signed_url: 'https://evil.example.com/secret' },
      },
      forbiddenReply,
    )) as ControlErrorEnvelope;

    assert.equal(forbiddenReply.statusCode, 400);
    assert.equal(forbiddenResult.error.code, 'invalid_request');

    const extraFieldReply = new CapturingReply();
    const extraFieldResult = (await route(registrar, 'POST', ARTIFACT_SIGNED_ACCESS_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { artifact_id: 'artifact_demo_001' },
        body: { ...validArtifactSignedAccessBody(), provider_key: 'sk-secret-key' },
      },
      extraFieldReply,
    )) as ControlErrorEnvelope;

    assert.equal(extraFieldReply.statusCode, 400);
    assert.equal(extraFieldResult.error.code, 'invalid_request');
  });

  it('lifecycle and signed-access responses contain no signed URLs, object bodies, or secrets', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const lifecycleResult = await route(registrar, 'GET', ARTIFACT_LIFECYCLE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { artifact_id: 'artifact_demo_001' },
    });

    const statusResult = await route(registrar, 'GET', ARTIFACT_LIFECYCLE_STATUS_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { artifact_id: 'artifact_demo_001' },
    });

    const decisionResult = await route(registrar, 'POST', ARTIFACT_SIGNED_ACCESS_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { artifact_id: 'artifact_demo_001' },
      body: validArtifactSignedAccessBody(),
    });

    assertNoSensitiveControlPayload(lifecycleResult);
    assertNoSensitiveControlPayload(statusResult);
    assertNoSensitiveControlPayload(decisionResult);
  });
});

describe('control API workflow template routes', () => {
  it('lists fixture templates with metadata-only response', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', WORKFLOW_TEMPLATES_BASE_PATH).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        query: {},
      },
      reply,
    )) as WorkflowTemplateListEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.count, 1);
    assert.equal(result.templates[0]?.template_id, 'template_demo_001');
    assert.equal(result.templates[0]?.rollout_state, 'approved');
    assert.equal(result.templates[0]?.rollout_policy.production_enabled, false);
    assert.equal(result.templates[0]?.current_version_id, 'template_version_demo_001_v1');
    assertNoSensitiveControlPayload(result);
  });

  it('gets a single template by id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { template_id: 'template_demo_001' },
      },
      reply,
    )) as WorkflowTemplateEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.template.template_id, 'template_demo_001');
    assert.equal(result.template.rollout_state, 'approved');
    assertNoSensitiveControlPayload(result);
  });

  it('returns 404 for unknown template_id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { template_id: 'template_does_not_exist' },
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 404);
    assert.equal(result.error.code, 'not_found');
  });

  it('filters templates by rollout_state', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const approved = (await route(registrar, 'GET', WORKFLOW_TEMPLATES_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { rollout_state: 'approved' },
    })) as WorkflowTemplateListEnvelope;

    const draft = (await route(registrar, 'GET', WORKFLOW_TEMPLATES_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { rollout_state: 'draft' },
    })) as WorkflowTemplateListEnvelope;

    assert.equal(approved.count, 1);
    assert.equal(approved.templates[0]?.rollout_state, 'approved');
    assert.equal(draft.count, 0);
    assert.deepEqual(draft.templates, []);
  });

  it('filters templates by project_id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const matched = (await route(registrar, 'GET', WORKFLOW_TEMPLATES_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { project_id: 'project_demo' },
    })) as WorkflowTemplateListEnvelope;

    const unmatched = (await route(registrar, 'GET', WORKFLOW_TEMPLATES_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: { project_id: 'project_does_not_match' },
    })) as WorkflowTemplateListEnvelope;

    assert.equal(matched.count, 1);
    assert.equal(unmatched.count, 0);
  });

  it('lists template versions with metadata-only response', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id/versions`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { template_id: 'template_demo_001' },
        query: {},
      },
      reply,
    )) as WorkflowTemplateVersionListEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.count, 2);
    const ids = result.versions.map((v) => v.template_version_id);
    assert.ok(ids.includes('template_version_demo_001_v1'));
    assert.ok(ids.includes('template_version_demo_001_v2_draft'));
    assertNoSensitiveControlPayload(result);
  });

  it('filters template versions by rollout_state', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const approvedVersions = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id/versions`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { template_id: 'template_demo_001' },
      query: { rollout_state: 'approved' },
    })) as WorkflowTemplateVersionListEnvelope;

    const draftVersions = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id/versions`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { template_id: 'template_demo_001' },
      query: { rollout_state: 'draft' },
    })) as WorkflowTemplateVersionListEnvelope;

    assert.equal(approvedVersions.count, 1);
    assert.equal(approvedVersions.versions[0]?.rollout_state, 'approved');
    assert.equal(draftVersions.count, 1);
    assert.equal(draftVersions.versions[0]?.rollout_state, 'draft');
  });

  it('returns 404 for unknown template_id on version list', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id/versions`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { template_id: 'template_does_not_exist' },
        query: {},
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 404);
    assert.equal(result.error.code, 'not_found');
  });

  it('gets a single template version by template_version_id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATE_VERSIONS_BASE_PATH}/:template_version_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { template_version_id: 'template_version_demo_001_v1' },
      },
      reply,
    )) as WorkflowTemplateVersionEnvelope;

    assert.equal(reply.statusCode, 200);
    assert.equal(result.version.template_version_id, 'template_version_demo_001_v1');
    assert.equal(result.version.template_id, 'template_demo_001');
    assert.equal(result.version.rollout_state, 'approved');
    assert.equal(result.version.allowed_model_aliases[0], 'default-safe-model-alias');
    assertNoSensitiveControlPayload(result);
  });

  it('returns 404 for unknown template_version_id', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const reply = new CapturingReply();
    const result = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATE_VERSIONS_BASE_PATH}/:template_version_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_demo'),
        params: { template_version_id: 'template_version_does_not_exist' },
      },
      reply,
    )) as ControlErrorEnvelope;

    assert.equal(reply.statusCode, 404);
    assert.equal(result.error.code, 'not_found');
  });

  it('hides templates from other principals (cross-principal denial returns 404 or empty list)', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const listReply = new CapturingReply();
    const listResult = (await route(registrar, 'GET', WORKFLOW_TEMPLATES_BASE_PATH).handler(
      { headers: authHeaders('principal_other'), query: {} },
      listReply,
    )) as WorkflowTemplateListEnvelope;

    assert.equal(listReply.statusCode, 200);
    assert.equal(listResult.count, 0);
    assert.deepEqual(listResult.templates, []);

    const getReply = new CapturingReply();
    const getResult = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id`).handler(
      {
        headers: authHeaders('principal_other'),
        params: { template_id: 'template_demo_001' },
      },
      getReply,
    )) as ControlErrorEnvelope;

    assert.equal(getReply.statusCode, 404);
    assert.equal(getResult.error.code, 'not_found');
    assert.doesNotMatch(getResult.error.message, /demo_001/u);

    const versionGetReply = new CapturingReply();
    const versionGetResult = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATE_VERSIONS_BASE_PATH}/:template_version_id`).handler(
      {
        headers: authHeaders('principal_other'),
        params: { template_version_id: 'template_version_demo_001_v1' },
      },
      versionGetReply,
    )) as ControlErrorEnvelope;

    assert.equal(versionGetReply.statusCode, 404);
    assert.equal(versionGetResult.error.code, 'not_found');
  });

  it('hides templates when project_id header does not match', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const getReply = new CapturingReply();
    const getResult = (await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id`).handler(
      {
        headers: authHeaders('principal_demo', 'project_other'),
        params: { template_id: 'template_demo_001' },
      },
      getReply,
    )) as ControlErrorEnvelope;

    assert.equal(getReply.statusCode, 404);
    assert.equal(getResult.error.code, 'not_found');
  });

  it('fails closed in production with production_disabled_route', async () => {
    const registrar = new CapturingRegistrar();
    registerTemplateRoutes(registrar, { runtimeEnvironment: 'production' });

    for (const [method, url, params] of [
      ['GET' as const, WORKFLOW_TEMPLATES_BASE_PATH, {}],
      ['GET' as const, `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id`, { template_id: 'template_demo_001' }],
      ['GET' as const, `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id/versions`, { template_id: 'template_demo_001' }],
      ['GET' as const, `${WORKFLOW_TEMPLATE_VERSIONS_BASE_PATH}/:template_version_id`, { template_version_id: 'template_version_demo_001_v1' }],
    ] as const) {
      const reply = new CapturingReply();
      const result = (await route(registrar, method, url).handler(
        { headers: authHeaders(), query: {}, params },
        reply,
      )) as ControlErrorEnvelope;

      assert.equal(reply.statusCode, 503, `${method} ${url} should be production_disabled`);
      assert.equal(result.error.code, 'production_disabled_route', `${method} ${url}`);
    }
  });

  it('template and version responses contain no raw step graphs, tool bodies, prompts, or secrets', async () => {
    const registrar = registerAgentWorkflowRoutesForTest();

    const listResult = await route(registrar, 'GET', WORKFLOW_TEMPLATES_BASE_PATH).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      query: {},
    });

    const getResult = await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { template_id: 'template_demo_001' },
    });

    const versionsResult = await route(registrar, 'GET', `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id/versions`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { template_id: 'template_demo_001' },
      query: {},
    });

    const versionGetResult = await route(registrar, 'GET', `${WORKFLOW_TEMPLATE_VERSIONS_BASE_PATH}/:template_version_id`).handler({
      headers: authHeaders('principal_demo', 'project_demo'),
      params: { template_version_id: 'template_version_demo_001_v1' },
    });

    assertNoSensitiveControlPayload(listResult);
    assertNoSensitiveControlPayload(getResult);
    assertNoSensitiveControlPayload(versionsResult);
    assertNoSensitiveControlPayload(versionGetResult);
  });
});

type WorkflowTemplateForTest = {
  readonly template_id: string;
  readonly rollout_state: string;
  readonly current_version_id: string;
  readonly rollout_policy: {
    readonly production_enabled: boolean;
  };
};

type WorkflowTemplateEnvelope = {
  readonly template: WorkflowTemplateForTest;
};

type WorkflowTemplateListEnvelope = {
  readonly templates: readonly WorkflowTemplateForTest[];
  readonly count: number;
};

type WorkflowTemplateVersionForTest = {
  readonly template_version_id: string;
  readonly template_id: string;
  readonly rollout_state: string;
  readonly allowed_model_aliases: readonly string[];
};

type WorkflowTemplateVersionEnvelope = {
  readonly version: WorkflowTemplateVersionForTest;
};

type WorkflowTemplateVersionListEnvelope = {
  readonly versions: readonly WorkflowTemplateVersionForTest[];
  readonly count: number;
};

type OpaqueRefForTest = {
  readonly ref_id: string;
  readonly ref_type: string;
  readonly scope_ref: string;
};

type ArtifactSignedAccessEligibilityForTest = {
  readonly eligible: boolean;
  readonly requires_approval: boolean;
  readonly max_signed_duration_seconds: number | null;
};

type ArtifactLifecycleEventForTest = {
  readonly lifecycle_event_id: string;
  readonly artifact_id: string;
  readonly action: string;
  readonly state: string;
  readonly legal_hold: boolean;
  readonly redacted: boolean;
  readonly deletion_scheduled_at: string | null;
  readonly signed_access_eligibility: ArtifactSignedAccessEligibilityForTest;
};

type ArtifactLifecycleListEnvelope = {
  readonly events: readonly ArtifactLifecycleEventForTest[];
  readonly count: number;
};

type ArtifactLifecycleStatusEnvelope = {
  readonly status: {
    readonly artifact_id: string;
    readonly latest_state: string | null;
    readonly latest_action: string | null;
    readonly legal_hold: boolean;
    readonly redacted: boolean;
    readonly deletion_scheduled_at: string | null;
    readonly event_count: number;
    readonly signed_access_eligibility: ArtifactSignedAccessEligibilityForTest;
  };
};

type ArtifactSignedAccessDecisionEnvelope = {
  readonly decision: {
    readonly artifact_id: string;
    readonly decision: string;
    readonly decision_reason: string;
    readonly eligible: boolean;
    readonly requires_approval: boolean;
    readonly max_signed_duration_seconds: number | null;
  };
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
      readonly ref_id: string;
      readonly ref_type: string;
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

type ApprovalDecisionRefForTest = {
  readonly decision_id: string;
  readonly decision: string;
  readonly approver_principal_id: string;
} | null;

type ApprovalEnvelope = {
  readonly approval: {
    readonly approval_request_id: string;
    readonly workflow_id: string;
    readonly task_id: string;
    readonly state: string;
    readonly risk_tier: string;
    readonly principal_id: string;
    readonly project_id: string;
    readonly policy_version: string;
    readonly registry_version: string;
    readonly approver_principal_id: string | null;
    readonly decision_ref: ApprovalDecisionRefForTest;
  };
};

type ApprovalListEnvelope = {
  readonly approvals: readonly ApprovalEnvelope['approval'][];
  readonly count: number;
};

type OutboxRecordForTest = {
  readonly outbox_id: string;
  readonly workflow_id: string;
  readonly delivery_state: string;
  readonly destination_kind: string;
  readonly principal_id: string;
  readonly project_id: string;
};

type OutboxEnvelope = {
  readonly outbox: OutboxRecordForTest;
};

type OutboxListEnvelope = {
  readonly outboxes: readonly OutboxRecordForTest[];
  readonly count: number;
};

type OutboxStatusEnvelope = {
  readonly status: {
    readonly counts_by_state: Readonly<Record<string, number>>;
    readonly counts_by_destination: Readonly<Record<string, number>>;
    readonly failed_count: number;
    readonly dead_lettered_count: number;
    readonly total: number;
  };
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

function authHeaders(principalId = 'principal_test', projectId?: string, roles: readonly string[] = []): Record<string, string> {
  return {
    ...(projectId === undefined ? {} : { 'x-devgateway-project-id': projectId }),
    ...(roles.length === 0 ? {} : { 'x-devgateway-roles': roles.join(',') }),
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

function rolesHeaderValueForTest(headers: ControlRouteRequest['headers'], name: string): readonly string[] | undefined {
  const value = headerValueForTest(headers, name);
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role !== '');
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
          authenticate: async (request: ControlRouteRequest) => {
            const roles = rolesHeaderValueForTest(request.headers, 'x-devgateway-roles');
            return {
              principalId: headerValueForTest(request.headers, 'x-devgateway-principal-id') ?? 'principal_test',
              authSubjectRef: headerValueForTest(request.headers, 'x-devgateway-auth-subject') ?? 'subject_test',
              ...(roles === undefined ? {} : { roles }),
            };
          },
        };

  registerTaskRoutes(registrar, routeOptions);
  registerArtifactRoutes(registrar, routeOptions);
  registerWorkflowRoutes(registrar, routeOptions);
  registerAgentRunRoutes(registrar, routeOptions);
  registerSkillRoutes(registrar, routeOptions);
  registerApprovalRoutes(registrar, routeOptions);
  registerOutboxRoutes(registrar, routeOptions);
  registerTemplateRoutes(registrar, routeOptions);
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
      principalId: 'principal:skill-registry-admin',
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

function validApproveBody(): Record<string, unknown> {
  return {
    request_id: 'request_approval_approve',
    trace_id: 'trace_approval_approve',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
  };
}

function validDenyBody(): Record<string, unknown> {
  return {
    request_id: 'request_approval_deny',
    trace_id: 'trace_approval_deny',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
  };
}

function validArtifactSignedAccessBody(): Record<string, unknown> {
  return {
    request_id: 'request_artifact_signed_access',
    trace_id: 'trace_artifact_signed_access',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
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
