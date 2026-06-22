import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  budgetScopeTypes,
  gatewayControlContractVersion,
  type BudgetLimits,
  type BudgetResetPeriod,
  type BudgetScopeRecord,
  type BudgetScopeRef,
  type BudgetScopeStatus,
  type BudgetScopeType,
  type EnvironmentName,
} from '../../../../packages/shared-types/src/gateway-control.ts';

import {
  budgetExhaustedControlError,
  isControlDeniedError,
  missingAuthControlError,
  productionDisabledRouteControlError,
  stalePolicyControlError,
  toControlDeniedErrorBody,
} from '../policies/control-errors.ts';
import type {
  ControlRouteAuthContext,
  ControlRouteDefinition,
  ControlRouteReply,
  ControlRouteRequest,
} from './virtual-keys.ts';

export const BUDGET_SCOPES_BASE_PATH = '/api/budget-scopes' as const;
export const BUDGET_POLICIES_BASE_PATH = '/api/budget-policies' as const;
export const BUDGET_SPEND_BASE_PATH = '/api/budget-spend' as const;
export const BUDGET_RESERVATIONS_BASE_PATH = '/api/budget-reservations' as const;
export const BUDGET_RESERVATION_GET_PATH = `${BUDGET_RESERVATIONS_BASE_PATH}/:reservation_id` as const;
export const BUDGET_RESERVATION_SETTLE_PATH = `${BUDGET_RESERVATIONS_BASE_PATH}/:reservation_id/settle` as const;
export const BUDGET_RESERVATION_RELEASE_PATH = `${BUDGET_RESERVATIONS_BASE_PATH}/:reservation_id/release` as const;

export interface BudgetRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export interface BudgetRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: BudgetStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export interface BudgetStore {
  defineScope(input: DefineBudgetScopeRequest, actor: ControlRouteAuthContext): Promise<BudgetScopeRecord>;
  applyPolicy(input: DefineBudgetPolicyRequest, actor: ControlRouteAuthContext): Promise<BudgetScopeRecord>;
  getScope(budgetScopeId: string): Promise<BudgetScopeRecord | null>;
  inspectSpend(filter: BudgetSpendFilter): Promise<BudgetSpendInspection[]>;
  reserve(input: ReserveBudgetReservationRequest, actor: ControlRouteAuthContext): Promise<BudgetReservationRecord>;
  getReservation(reservationId: string): Promise<BudgetReservationRecord | null>;
  settle(
    reservationId: string,
    input: SettleBudgetReservationRequest,
    actor: ControlRouteAuthContext,
  ): Promise<BudgetReservationRecord>;
  release(
    reservationId: string,
    input: ReleaseBudgetReservationRequest,
    actor: ControlRouteAuthContext,
  ): Promise<BudgetReservationRecord>;
}

export interface DefineBudgetScopeRequest {
  readonly scope_type: BudgetScopeType;
  readonly owner_id: string;
  readonly tenant_id?: string | null | undefined;
  readonly project_id?: string | null | undefined;
  readonly principal_id?: string | null | undefined;
  readonly virtual_key_id?: string | null | undefined;
  readonly parent_scope_ref?: BudgetScopeRef | null | undefined;
  readonly status?: BudgetScopeStatus | undefined;
  readonly currency?: string | undefined;
  readonly limits?: BudgetLimitsInput | undefined;
  readonly reset_period?: BudgetResetPeriod | undefined;
  readonly period_started_at?: string | undefined;
  readonly period_ends_at?: string | null | undefined;
  readonly timezone?: string | undefined;
  readonly policy_version: string;
}

export interface DefineBudgetPolicyRequest {
  readonly budget_scope_id: string;
  readonly currency?: string | undefined;
  readonly limits: BudgetLimitsInput;
  readonly reset_period?: BudgetResetPeriod | undefined;
  readonly period_started_at?: string | undefined;
  readonly period_ends_at?: string | null | undefined;
  readonly timezone?: string | undefined;
  readonly policy_version: string;
  readonly expected_current_policy_version?: string | undefined;
}

export type BudgetReservationStatus = 'reserved' | 'settled' | 'released';
export type BudgetReservationLifecycleState = 'held' | 'released' | 'settled' | 'orphaned' | 'reconciled';

export interface ReserveBudgetReservationRequest {
  readonly budget_scope_id: string;
  readonly workflow_run_id: string;
  readonly delegation_id?: string | null | undefined;
  readonly tool_class?: string | null | undefined;
  readonly model_alias?: string | null | undefined;
  readonly currency: string;
  readonly amount: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly idempotency_key: string;
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
}

export interface SettleBudgetReservationRequest {
  readonly budget_scope_id: string;
  readonly workflow_run_id: string;
  readonly delegation_id?: string | null | undefined;
  readonly tool_class?: string | null | undefined;
  readonly model_alias?: string | null | undefined;
  readonly currency: string;
  readonly actual_amount: number;
  readonly actual_input_tokens: number;
  readonly actual_output_tokens: number;
  readonly cost_event_id: string;
  readonly idempotency_key: string;
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
}

export interface ReleaseBudgetReservationRequest {
  readonly budget_scope_id: string;
  readonly workflow_run_id: string;
  readonly delegation_id?: string | null | undefined;
  readonly tool_class?: string | null | undefined;
  readonly model_alias?: string | null | undefined;
  readonly currency: string;
  readonly release_reason: string;
  readonly reconciliation_state?: Extract<BudgetReservationLifecycleState, 'orphaned' | 'reconciled'> | undefined;
  readonly idempotency_key: string;
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
}

export interface BudgetReservationRecord {
  readonly contract_version: typeof gatewayControlContractVersion;
  readonly reservation_id: string;
  readonly budget_scope_id: string;
  readonly workflow_run_id: string;
  readonly delegation_id: string | null;
  readonly tool_class: string | null;
  readonly model_alias: string | null;
  readonly currency: string;
  readonly reserved_amount: number;
  readonly reserved_input_tokens: number;
  readonly reserved_output_tokens: number;
  readonly status: BudgetReservationStatus;
  readonly lifecycle_state: BudgetReservationLifecycleState;
  readonly reconciliation_state: Extract<BudgetReservationLifecycleState, 'orphaned' | 'reconciled'> | null;
  readonly idempotency_key: string;
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly actual_amount: number | null;
  readonly actual_input_tokens: number | null;
  readonly actual_output_tokens: number | null;
  readonly cost_event_id: string | null;
  readonly settlement_idempotency_key: string | null;
  readonly settlement_request_id: string | null;
  readonly settlement_trace_id: string | null;
  readonly settled_at: string | null;
  readonly release_reason: string | null;
  readonly release_idempotency_key: string | null;
  readonly release_request_id: string | null;
  readonly release_trace_id: string | null;
  readonly released_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BudgetSpendFilter {
  readonly budget_scope_id?: string | undefined;
  readonly scope_type?: BudgetScopeType | undefined;
  readonly owner_id?: string | undefined;
  readonly project_id?: string | undefined;
  readonly principal_id?: string | undefined;
  readonly virtual_key_id?: string | undefined;
}

export interface BudgetLimitsInput {
  readonly hard_cap_amount?: number | null | undefined;
  readonly soft_cap_amount?: number | null | undefined;
  readonly input_token_limit?: number | null | undefined;
  readonly output_token_limit?: number | null | undefined;
  readonly request_limit?: number | null | undefined;
}

export interface BudgetSpendInspection {
  readonly budget_scope_id: string;
  readonly scope_type: BudgetScopeType;
  readonly owner_id: string;
  readonly status: BudgetScopeStatus;
  readonly currency: string;
  readonly limits: BudgetLimits;
  readonly spend_state: BudgetScopeRecord['spend_state'];
  readonly reservation_state: BudgetScopeRecord['reservation_state'];
  readonly period: BudgetScopeRecord['period'];
  readonly policy_version: string;
  readonly decision: 'allow' | 'deny';
  readonly denial_reason: 'budget' | null;
}

class BudgetRouteValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'invalid_request';

  constructor(message: string) {
    super(message);
    this.name = 'BudgetRouteValidationError';
  }
}

export class InMemoryBudgetStore implements BudgetStore {
  readonly #scopes = new Map<string, BudgetScopeRecord>();
  readonly #reservations = new Map<string, BudgetReservationRecord>();
  readonly #reservationIdempotencyKeys = new Map<string, string>();
  readonly #settlementIdempotencyKeys = new Map<string, string>();
  readonly #releaseIdempotencyKeys = new Map<string, string>();

  constructor(initialScopes: readonly BudgetScopeRecord[] = []) {
    for (const scope of initialScopes) {
      this.#scopes.set(scope.budget_scope_id, scope);
    }
  }

  async defineScope(input: DefineBudgetScopeRequest, actor: ControlRouteAuthContext): Promise<BudgetScopeRecord> {
    assertNoForbiddenSecretFields(input);
    assertPolicyVersion(input.policy_version);
    assertBudgetScopeType(input.scope_type);
    assertNonEmptyString(input.owner_id, 'owner_id');
    const now = new Date().toISOString();
    const budgetScopeId = `bs_${randomUUID()}`;
    const record: BudgetScopeRecord = {
      contract_version: gatewayControlContractVersion,
      budget_scope_id: budgetScopeId,
      external_budget_scope_id: `ext_${budgetScopeId}`,
      scope_type: input.scope_type,
      status: input.status ?? 'active',
      production_posture: {
        production_enabled: false,
        success_fallback_allowed: false,
        fail_closed_on_missing_scope: true,
      },
      owner_ref: {
        owner_type: input.scope_type,
        owner_id: input.owner_id,
        tenant_id: input.tenant_id ?? null,
        project_id: input.project_id ?? (input.scope_type === 'project' ? input.owner_id : null),
        principal_id: input.principal_id ?? (input.scope_type === 'principal' ? input.owner_id : null),
        virtual_key_id: input.virtual_key_id ?? (input.scope_type === 'virtual_key' ? input.owner_id : null),
      },
      parent_scope_ref: input.parent_scope_ref ?? null,
      inheritance: {
        inherits_parent_limit: input.parent_scope_ref !== undefined && input.parent_scope_ref !== null,
        rolls_up_to_parent: input.parent_scope_ref !== undefined && input.parent_scope_ref !== null,
        child_scope_types: childScopeTypesFor(input.scope_type),
      },
      period: {
        reset_period: input.reset_period ?? 'monthly',
        period_started_at: input.period_started_at ?? now,
        period_ends_at: input.period_ends_at ?? null,
        timezone: input.timezone ?? 'UTC',
      },
      currency: input.currency ?? 'USD',
      limits: normalizeLimits(input.limits ?? {}),
      spend_state: {
        actual_spend_amount: 0,
        actual_input_tokens: 0,
        actual_output_tokens: 0,
        actual_request_count: 0,
        last_cost_event_id: null,
      },
      reservation_state: {
        reserved_amount: 0,
        reserved_input_tokens: 0,
        reserved_output_tokens: 0,
        reservation_count: 0,
      },
      rate_limit_interaction: {
        rate_limit_scope_id: null,
        rate_limit_denial_reason: 'rate_limit',
        shared_window: false,
        enforce_budget_before_rate_limit: true,
      },
      denial_semantics: {
        denial_reason: 'budget',
        hard_cap_action: 'deny',
        soft_cap_action: 'warn',
        reservation_failure_action: 'deny',
      },
      policy_version: input.policy_version,
      created_at: now,
      updated_at: now,
    };
    void actor;
    assertBudgetHeadroom(record);
    this.#scopes.set(record.budget_scope_id, record);
    return record;
  }

  async applyPolicy(input: DefineBudgetPolicyRequest, actor: ControlRouteAuthContext): Promise<BudgetScopeRecord> {
    assertNoForbiddenSecretFields(input);
    assertNonEmptyString(input.budget_scope_id, 'budget_scope_id');
    assertPolicyVersion(input.policy_version);
    const existing = this.#scopes.get(input.budget_scope_id);
    if (existing === undefined) {
      throw new BudgetRouteValidationError(`Unknown budget_scope_id: ${input.budget_scope_id}`);
    }
    if (
      input.expected_current_policy_version !== undefined &&
      input.expected_current_policy_version !== existing.policy_version
    ) {
      throw stalePolicyControlError({
        budget_scope_id: input.budget_scope_id,
        expected_current_policy_version: input.expected_current_policy_version,
        actual_policy_version: existing.policy_version,
      });
    }
    const updated: BudgetScopeRecord = {
      ...existing,
      currency: input.currency ?? existing.currency,
      limits: normalizeLimits({ ...existing.limits, ...input.limits }),
      period: {
        reset_period: input.reset_period ?? existing.period.reset_period,
        period_started_at: input.period_started_at ?? existing.period.period_started_at,
        period_ends_at: input.period_ends_at ?? existing.period.period_ends_at,
        timezone: input.timezone ?? existing.period.timezone,
      },
      policy_version: input.policy_version,
      updated_at: new Date().toISOString(),
    };
    void actor;
    assertBudgetHeadroom(updated);
    this.#scopes.set(updated.budget_scope_id, updated);
    return updated;
  }

  async reserve(input: ReserveBudgetReservationRequest, actor: ControlRouteAuthContext): Promise<BudgetReservationRecord> {
    assertNoForbiddenSecretFields(input);
    assertReservationRequest(input);
    const idempotentReservation = this.#getReservationForIdempotencyKey(
      this.#reservationIdempotencyKeys,
      input.idempotency_key,
      'reservation',
    );
    if (idempotentReservation !== null) {
      assertReservationReplayMatches(input, idempotentReservation);
      return idempotentReservation;
    }

    const scope = this.#getExistingScope(input.budget_scope_id);
    assertScopeAcceptsReservation(scope, input);
    assertBudgetHeadroomForReservation(scope, input);

    const now = new Date().toISOString();
    const reservationId = `br_${randomUUID()}`;
    const reservation: BudgetReservationRecord = {
      contract_version: gatewayControlContractVersion,
      reservation_id: reservationId,
      budget_scope_id: input.budget_scope_id,
      workflow_run_id: input.workflow_run_id,
      delegation_id: input.delegation_id ?? null,
      tool_class: input.tool_class ?? null,
      model_alias: input.model_alias ?? null,
      currency: input.currency,
      reserved_amount: input.amount,
      reserved_input_tokens: input.input_tokens,
      reserved_output_tokens: input.output_tokens,
      status: 'reserved',
      lifecycle_state: 'held',
      reconciliation_state: null,
      idempotency_key: input.idempotency_key,
      request_id: input.request_id,
      trace_id: input.trace_id,
      policy_version: input.policy_version,
      actual_amount: null,
      actual_input_tokens: null,
      actual_output_tokens: null,
      cost_event_id: null,
      settlement_idempotency_key: null,
      settlement_request_id: null,
      settlement_trace_id: null,
      settled_at: null,
      release_reason: null,
      release_idempotency_key: null,
      release_request_id: null,
      release_trace_id: null,
      released_at: null,
      created_at: now,
      updated_at: now,
    };
    const updatedScope: BudgetScopeRecord = {
      ...scope,
      reservation_state: {
        reserved_amount: scope.reservation_state.reserved_amount + input.amount,
        reserved_input_tokens: scope.reservation_state.reserved_input_tokens + input.input_tokens,
        reserved_output_tokens: scope.reservation_state.reserved_output_tokens + input.output_tokens,
        reservation_count: scope.reservation_state.reservation_count + 1,
      },
      updated_at: now,
    };
    void actor;
    this.#scopes.set(updatedScope.budget_scope_id, updatedScope);
    this.#reservations.set(reservation.reservation_id, reservation);
    this.#reservationIdempotencyKeys.set(input.idempotency_key, reservation.reservation_id);
    return reservation;
  }

  async settle(
    reservationId: string,
    input: SettleBudgetReservationRequest,
    actor: ControlRouteAuthContext,
  ): Promise<BudgetReservationRecord> {
    assertNoForbiddenSecretFields(input);
    assertSettlementRequest(input);
    const idempotentReservationId = this.#settlementIdempotencyKeys.get(input.idempotency_key);
    if (idempotentReservationId !== undefined) {
      assertIdempotencyKeyMatchesReservation(idempotentReservationId, reservationId, 'settlement');
      const replayedReservation = this.#getExistingReservation(reservationId);
      assertReservationMutationMatches(input, replayedReservation);
      assertSettlementReplayMatches(input, replayedReservation);
      return replayedReservation;
    }

    const reservation = this.#getExistingReservation(reservationId);
    assertReservationIsReserved(reservation, 'settle');
    assertReservationMutationMatches(input, reservation);
    const scope = this.#getExistingScope(reservation.budget_scope_id);
    assertSettlementWithinReservation(input, reservation);

    const now = new Date().toISOString();
    const updatedScope: BudgetScopeRecord = {
      ...scope,
      spend_state: {
        actual_spend_amount: scope.spend_state.actual_spend_amount + input.actual_amount,
        actual_input_tokens: scope.spend_state.actual_input_tokens + input.actual_input_tokens,
        actual_output_tokens: scope.spend_state.actual_output_tokens + input.actual_output_tokens,
        actual_request_count: scope.spend_state.actual_request_count + 1,
        last_cost_event_id: input.cost_event_id,
      },
      reservation_state: releaseReservationState(scope.reservation_state, reservation),
      updated_at: now,
    };
    const updatedReservation: BudgetReservationRecord = {
      ...reservation,
      status: 'settled',
      lifecycle_state: 'settled',
      reconciliation_state: reservation.reconciliation_state,
      actual_amount: input.actual_amount,
      actual_input_tokens: input.actual_input_tokens,
      actual_output_tokens: input.actual_output_tokens,
      cost_event_id: input.cost_event_id,
      settlement_idempotency_key: input.idempotency_key,
      settlement_request_id: input.request_id,
      settlement_trace_id: input.trace_id,
      settled_at: now,
      updated_at: now,
    };
    void actor;
    this.#scopes.set(updatedScope.budget_scope_id, updatedScope);
    this.#reservations.set(updatedReservation.reservation_id, updatedReservation);
    this.#settlementIdempotencyKeys.set(input.idempotency_key, updatedReservation.reservation_id);
    return updatedReservation;
  }

  async release(
    reservationId: string,
    input: ReleaseBudgetReservationRequest,
    actor: ControlRouteAuthContext,
  ): Promise<BudgetReservationRecord> {
    assertNoForbiddenSecretFields(input);
    assertReleaseRequest(input);
    const idempotentReservationId = this.#releaseIdempotencyKeys.get(input.idempotency_key);
    if (idempotentReservationId !== undefined) {
      assertIdempotencyKeyMatchesReservation(idempotentReservationId, reservationId, 'release');
      const replayedReservation = this.#getExistingReservation(reservationId);
      assertReservationMutationMatches(input, replayedReservation);
      assertReleaseReplayMatches(input, replayedReservation);
      return replayedReservation;
    }

    const reservation = this.#getExistingReservation(reservationId);
    assertReservationIsReserved(reservation, 'release');
    assertReservationMutationMatches(input, reservation);
    const scope = this.#getExistingScope(reservation.budget_scope_id);

    const now = new Date().toISOString();
    const updatedScope: BudgetScopeRecord = {
      ...scope,
      reservation_state: releaseReservationState(scope.reservation_state, reservation),
      updated_at: now,
    };
    const updatedReservation: BudgetReservationRecord = {
      ...reservation,
      status: 'released',
      lifecycle_state: input.reconciliation_state ?? 'released',
      reconciliation_state: input.reconciliation_state ?? null,
      release_reason: input.release_reason,
      release_idempotency_key: input.idempotency_key,
      release_request_id: input.request_id,
      release_trace_id: input.trace_id,
      released_at: now,
      updated_at: now,
    };
    void actor;
    this.#scopes.set(updatedScope.budget_scope_id, updatedScope);
    this.#reservations.set(updatedReservation.reservation_id, updatedReservation);
    this.#releaseIdempotencyKeys.set(input.idempotency_key, updatedReservation.reservation_id);
    return updatedReservation;
  }

  async getScope(budgetScopeId: string): Promise<BudgetScopeRecord | null> {
    return this.#scopes.get(budgetScopeId) ?? null;
  }

  async getReservation(reservationId: string): Promise<BudgetReservationRecord | null> {
    return this.#reservations.get(reservationId) ?? null;
  }

  async inspectSpend(filter: BudgetSpendFilter): Promise<BudgetSpendInspection[]> {
    return [...this.#scopes.values()]
      .filter((scope) => filter.budget_scope_id === undefined || scope.budget_scope_id === filter.budget_scope_id)
      .filter((scope) => filter.scope_type === undefined || scope.scope_type === filter.scope_type)
      .filter((scope) => filter.owner_id === undefined || scope.owner_ref.owner_id === filter.owner_id)
      .filter((scope) => filter.project_id === undefined || scope.owner_ref.project_id === filter.project_id)
      .filter((scope) => filter.principal_id === undefined || scope.owner_ref.principal_id === filter.principal_id)
      .filter((scope) => filter.virtual_key_id === undefined || scope.owner_ref.virtual_key_id === filter.virtual_key_id)
      .map(toSpendInspection);
  }

  #getExistingScope(budgetScopeId: string): BudgetScopeRecord {
    const scope = this.#scopes.get(budgetScopeId);
    if (scope === undefined) {
      throw new BudgetRouteValidationError(`Unknown budget_scope_id: ${budgetScopeId}`);
    }
    return scope;
  }

  #getExistingReservation(reservationId: string): BudgetReservationRecord {
    const reservation = this.#reservations.get(reservationId);
    if (reservation === undefined) {
      throw new BudgetRouteValidationError(`Unknown reservation_id: ${reservationId}`);
    }
    return reservation;
  }

  #getReservationForIdempotencyKey(
    index: ReadonlyMap<string, string>,
    idempotencyKey: string,
    operation: string,
  ): BudgetReservationRecord | null {
    const reservationId = index.get(idempotencyKey);
    if (reservationId === undefined) return null;
    const reservation = this.#reservations.get(reservationId);
    if (reservation === undefined) {
      throw new BudgetRouteValidationError(`${operation} idempotency_key references an unknown reservation.`);
    }
    return reservation;
  }
}

export function createInMemoryBudgetStore(initialScopes: readonly BudgetScopeRecord[] = []): BudgetStore {
  return new InMemoryBudgetStore(initialScopes);
}

export function registerBudgetRoutes(registrar: BudgetRouteRegistrar, options: BudgetRouteOptions = {}): void {
  const store = options.store ?? createInMemoryBudgetStore();

  registrar.route({
    method: 'POST',
    url: BUDGET_SCOPES_BASE_PATH,
    schema: defineBudgetScopeSchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-scope-define');
        const actor = await authenticateBudgetRequest(request, options);
        return respond(reply, 201, { budget_scope: await store.defineScope(asDefineBudgetScopeRequest(request.body), actor) });
      }),
  });

  registrar.route({
    method: 'POST',
    url: BUDGET_POLICIES_BASE_PATH,
    schema: defineBudgetPolicySchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-policy-define');
        const actor = await authenticateBudgetRequest(request, options);
        return respond(reply, 200, { budget_scope: await store.applyPolicy(asDefineBudgetPolicyRequest(request.body), actor) });
      }),
  });

  registrar.route({
    method: 'POST',
    url: BUDGET_RESERVATIONS_BASE_PATH,
    schema: reserveBudgetReservationSchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-reservation-reserve');
        const actor = await authenticateBudgetRequest(request, options);
        return respond(reply, 201, {
          budget_reservation: await store.reserve(asReserveBudgetReservationRequest(request.body), actor),
        });
      }),
  });

  registrar.route({
    method: 'POST',
    url: BUDGET_RESERVATION_SETTLE_PATH,
    schema: settleBudgetReservationSchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-reservation-settle');
        const actor = await authenticateBudgetRequest(request, options);
        return respond(reply, 200, {
          budget_reservation: await store.settle(
            getBudgetReservationIdParam(request.params),
            asSettleBudgetReservationRequest(request.body),
            actor,
          ),
        });
      }),
  });

  registrar.route({
    method: 'POST',
    url: BUDGET_RESERVATION_RELEASE_PATH,
    schema: releaseBudgetReservationSchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-reservation-release');
        const actor = await authenticateBudgetRequest(request, options);
        return respond(reply, 200, {
          budget_reservation: await store.release(
            getBudgetReservationIdParam(request.params),
            asReleaseBudgetReservationRequest(request.body),
            actor,
          ),
        });
      }),
  });

  registrar.route({
    method: 'GET',
    url: BUDGET_RESERVATION_GET_PATH,
    schema: getBudgetReservationSchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-reservation-get');
        await authenticateBudgetRequest(request, options);
        const record = await store.getReservation(getBudgetReservationIdParam(request.params));
        if (record === null) throw new BudgetRouteValidationError('Unknown reservation_id.');
        return respond(reply, 200, { budget_reservation: record });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${BUDGET_SCOPES_BASE_PATH}/:budget_scope_id`,
    schema: getBudgetScopeSchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-scope-get');
        await authenticateBudgetRequest(request, options);
        const record = await store.getScope(getBudgetScopeIdParam(request.params));
        if (record === null) throw new BudgetRouteValidationError('Unknown budget_scope_id.');
        return respond(reply, 200, { budget_scope: record });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${BUDGET_SCOPES_BASE_PATH}/:budget_scope_id/spend`,
    schema: getBudgetScopeSpendSchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-scope-spend');
        await authenticateBudgetRequest(request, options);
        const spend = await store.inspectSpend({ budget_scope_id: getBudgetScopeIdParam(request.params) });
        if (spend.length === 0) throw new BudgetRouteValidationError('Unknown budget_scope_id.');
        return respond(reply, 200, { spend: spend[0] });
      }),
  });

  registrar.route({
    method: 'GET',
    url: BUDGET_SPEND_BASE_PATH,
    schema: inspectBudgetSpendSchema,
    handler: async (request, reply) =>
      handleKnownBudgetRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'budget-spend-inspect');
        await authenticateBudgetRequest(request, options);
        return respond(reply, 200, { spend: await store.inspectSpend(asBudgetSpendFilter(request.query)) });
      }),
  });
}

function toSpendInspection(scope: BudgetScopeRecord): BudgetSpendInspection {
  const exhausted = isBudgetExhausted(scope);
  return {
    budget_scope_id: scope.budget_scope_id,
    scope_type: scope.scope_type,
    owner_id: scope.owner_ref.owner_id,
    status: scope.status,
    currency: scope.currency,
    limits: scope.limits,
    spend_state: scope.spend_state,
    reservation_state: scope.reservation_state,
    period: scope.period,
    policy_version: scope.policy_version,
    decision: exhausted ? 'deny' : 'allow',
    denial_reason: exhausted ? 'budget' : null,
  };
}

function assertBudgetHeadroom(scope: BudgetScopeRecord): void {
  if (isBudgetExhausted(scope)) {
    throw budgetExhaustedControlError({
      budget_scope_id: scope.budget_scope_id,
      hard_cap_amount: scope.limits.hard_cap_amount,
      actual_spend_amount: scope.spend_state.actual_spend_amount,
      reserved_amount: scope.reservation_state.reserved_amount,
      reset_period: scope.period.reset_period,
      policy_version: scope.policy_version,
    });
  }
}

function isBudgetExhausted(scope: BudgetScopeRecord): boolean {
  return (
    scope.limits.hard_cap_amount !== null &&
    scope.spend_state.actual_spend_amount + scope.reservation_state.reserved_amount > scope.limits.hard_cap_amount
  );
}

function assertBudgetHeadroomForReservation(scope: BudgetScopeRecord, input: ReserveBudgetReservationRequest): void {
  const hardCapAmount = scope.limits.hard_cap_amount;
  if (hardCapAmount !== null) {
    const committedAmount = scope.spend_state.actual_spend_amount + scope.reservation_state.reserved_amount;
    if (committedAmount + input.amount > hardCapAmount) {
      throw budgetExhaustedControlError({
        budget_scope_id: scope.budget_scope_id,
        hard_cap_amount: hardCapAmount,
        actual_spend_amount: scope.spend_state.actual_spend_amount,
        reserved_amount: scope.reservation_state.reserved_amount,
        requested_amount: input.amount,
        remaining_amount: Math.max(0, hardCapAmount - committedAmount),
        reset_period: scope.period.reset_period,
        policy_version: scope.policy_version,
      });
    }
  }
  assertReservationLimit(scope, 'input_token_limit', scope.spend_state.actual_input_tokens, scope.reservation_state.reserved_input_tokens, input.input_tokens ?? 0);
  assertReservationLimit(
    scope,
    'output_token_limit',
    scope.spend_state.actual_output_tokens,
    scope.reservation_state.reserved_output_tokens,
    input.output_tokens ?? 0,
  );
  assertReservationLimit(scope, 'request_limit', scope.spend_state.actual_request_count, scope.reservation_state.reservation_count, 1);
}

function assertScopeAcceptsReservation(scope: BudgetScopeRecord, input: ReserveBudgetReservationRequest): void {
  if (scope.status !== 'active') {
    throw new BudgetRouteValidationError(`budget_scope_id ${scope.budget_scope_id} must be active to reserve budget.`);
  }
  if (scope.currency !== input.currency) {
    throw new BudgetRouteValidationError(
      `currency must match budget scope currency ${scope.currency} for budget_scope_id: ${scope.budget_scope_id}`,
    );
  }
  if (scope.policy_version !== input.policy_version) {
    throw stalePolicyControlError({
      budget_scope_id: scope.budget_scope_id,
      expected_policy_version: scope.policy_version,
      actual_policy_version: input.policy_version,
    });
  }
}

function assertReservationLimit(
  scope: BudgetScopeRecord,
  limitName: 'input_token_limit' | 'output_token_limit' | 'request_limit',
  actual: number,
  reserved: number,
  requested: number,
): void {
  const limit = scope.limits[limitName];
  if (limit === null) return;
  if (actual + reserved + requested > limit) {
    throw new BudgetRouteValidationError(
      `${limitName} exceeded for budget_scope_id ${scope.budget_scope_id}: requested reservation would exceed ${limit}.`,
    );
  }
}

function assertReservationRequest(input: ReserveBudgetReservationRequest): void {
  assertReservationIdentity(input);
  assertNonNegativeAmount(input.amount, 'amount');
  assertNonNegativeInteger(input.input_tokens, 'input_tokens');
  assertNonNegativeInteger(input.output_tokens, 'output_tokens');
}

function assertSettlementRequest(input: SettleBudgetReservationRequest): void {
  assertReservationIdentity(input);
  assertNonNegativeAmount(input.actual_amount, 'actual_amount');
  assertNonNegativeInteger(input.actual_input_tokens, 'actual_input_tokens');
  assertNonNegativeInteger(input.actual_output_tokens, 'actual_output_tokens');
  assertNonEmptyString(input.cost_event_id, 'cost_event_id');
}

function assertReleaseRequest(input: ReleaseBudgetReservationRequest): void {
  assertReservationIdentity(input);
  assertNonEmptyString(input.release_reason, 'release_reason');
}

function assertReservationIdentity(
  input: ReserveBudgetReservationRequest | SettleBudgetReservationRequest | ReleaseBudgetReservationRequest,
): void {
  assertNonEmptyString(input.budget_scope_id, 'budget_scope_id');
  assertNonEmptyString(input.workflow_run_id, 'workflow_run_id');
  assertOptionalNonEmptyString(input.delegation_id, 'delegation_id');
  assertOptionalNonEmptyString(input.tool_class, 'tool_class');
  assertOptionalNonEmptyString(input.model_alias, 'model_alias');
  assertCurrency(input.currency);
  assertNonEmptyString(input.idempotency_key, 'idempotency_key');
  assertNonEmptyString(input.request_id, 'request_id');
  assertNonEmptyString(input.trace_id, 'trace_id');
  assertPolicyVersion(input.policy_version);
}

function assertReservationReplayMatches(
  input: ReserveBudgetReservationRequest,
  reservation: BudgetReservationRecord,
): void {
  const matches =
    reservation.budget_scope_id === input.budget_scope_id &&
    reservation.workflow_run_id === input.workflow_run_id &&
    reservation.delegation_id === optionalStringToNull(input.delegation_id) &&
    reservation.tool_class === optionalStringToNull(input.tool_class) &&
    reservation.model_alias === optionalStringToNull(input.model_alias) &&
    reservation.currency === input.currency &&
    reservation.reserved_amount === input.amount &&
    reservation.reserved_input_tokens === input.input_tokens &&
    reservation.reserved_output_tokens === input.output_tokens &&
    reservation.request_id === input.request_id &&
    reservation.trace_id === input.trace_id &&
    reservation.policy_version === input.policy_version;
  if (!matches) {
    throw new BudgetRouteValidationError('reservation idempotency_key was already used with different reservation inputs.');
  }
}

function assertReservationMutationMatches(
  input: SettleBudgetReservationRequest | ReleaseBudgetReservationRequest,
  reservation: BudgetReservationRecord,
): void {
  if (
    reservation.budget_scope_id !== input.budget_scope_id ||
    reservation.workflow_run_id !== input.workflow_run_id ||
    reservation.delegation_id !== optionalStringToNull(input.delegation_id) ||
    reservation.tool_class !== optionalStringToNull(input.tool_class) ||
    reservation.model_alias !== optionalStringToNull(input.model_alias) ||
    reservation.currency !== input.currency
  ) {
    throw new BudgetRouteValidationError('reservation mutation body does not match the reserved budget identity.');
  }
  if (reservation.policy_version !== input.policy_version) {
    throw stalePolicyControlError({
      budget_scope_id: reservation.budget_scope_id,
      reservation_id: reservation.reservation_id,
      expected_policy_version: reservation.policy_version,
      actual_policy_version: input.policy_version,
    });
  }
}

function assertSettlementWithinReservation(
  input: SettleBudgetReservationRequest,
  reservation: BudgetReservationRecord,
): void {
  if (input.actual_amount > reservation.reserved_amount) {
    throw new BudgetRouteValidationError('actual_amount must not exceed the reserved_amount without an approved adjustment.');
  }
  if (input.actual_input_tokens > reservation.reserved_input_tokens) {
    throw new BudgetRouteValidationError('actual_input_tokens must not exceed reserved_input_tokens without an approved adjustment.');
  }
  if (input.actual_output_tokens > reservation.reserved_output_tokens) {
    throw new BudgetRouteValidationError('actual_output_tokens must not exceed reserved_output_tokens without an approved adjustment.');
  }
}

function assertSettlementReplayMatches(
  input: SettleBudgetReservationRequest,
  reservation: BudgetReservationRecord,
): void {
  if (
    reservation.status !== 'settled' ||
    reservation.actual_amount !== input.actual_amount ||
    reservation.actual_input_tokens !== input.actual_input_tokens ||
    reservation.actual_output_tokens !== input.actual_output_tokens ||
    reservation.cost_event_id !== input.cost_event_id ||
    reservation.settlement_request_id !== input.request_id ||
    reservation.settlement_trace_id !== input.trace_id
  ) {
    throw new BudgetRouteValidationError('settlement idempotency_key was already used with different settlement inputs.');
  }
}

function assertReleaseReplayMatches(
  input: ReleaseBudgetReservationRequest,
  reservation: BudgetReservationRecord,
): void {
  if (
    reservation.status !== 'released' ||
    reservation.release_reason !== input.release_reason ||
    reservation.release_request_id !== input.request_id ||
    reservation.release_trace_id !== input.trace_id ||
    reservation.reconciliation_state !== (input.reconciliation_state ?? null)
  ) {
    throw new BudgetRouteValidationError('release idempotency_key was already used with different release inputs.');
  }
}

function assertReservationIsReserved(reservation: BudgetReservationRecord, operation: 'settle' | 'release'): void {
  if (reservation.status !== 'reserved') {
    throw new BudgetRouteValidationError(
      `Cannot ${operation} reservation_id ${reservation.reservation_id} because it is ${reservation.status}.`,
    );
  }
}

function assertIdempotencyKeyMatchesReservation(
  idempotentReservationId: string,
  reservationId: string,
  operation: 'settlement' | 'release',
): void {
  if (idempotentReservationId !== reservationId) {
    throw new BudgetRouteValidationError(`${operation} idempotency_key is already bound to a different reservation_id.`);
  }
}

function releaseReservationState(
  state: BudgetScopeRecord['reservation_state'],
  reservation: BudgetReservationRecord,
): BudgetScopeRecord['reservation_state'] {
  return {
    reserved_amount: subtractReservedValue(state.reserved_amount, reservation.reserved_amount, 'reserved_amount'),
    reserved_input_tokens: subtractReservedValue(
      state.reserved_input_tokens,
      reservation.reserved_input_tokens,
      'reserved_input_tokens',
    ),
    reserved_output_tokens: subtractReservedValue(
      state.reserved_output_tokens,
      reservation.reserved_output_tokens,
      'reserved_output_tokens',
    ),
    reservation_count: Math.max(0, state.reservation_count - 1),
  };
}

function subtractReservedValue(current: number, reserved: number, field: string): number {
  const next = current - reserved;
  if (next < -Number.EPSILON) {
    throw new BudgetRouteValidationError(`Budget reservation_state is inconsistent for ${field}.`);
  }
  return next <= 0 ? 0 : next;
}

async function authenticateBudgetRequest(
  request: ControlRouteRequest,
  options: BudgetRouteOptions,
): Promise<ControlRouteAuthContext> {
  if (options.authenticate !== undefined) {
    return options.authenticate(request);
  }
  const principalId = getHeaderValue(request.headers, 'x-devgateway-principal-id');
  if (principalId === undefined || principalId.trim() === '') {
    throw missingAuthControlError({ header: 'x-devgateway-principal-id' });
  }
  return {
    principalId,
    authSubjectRef: getHeaderValue(request.headers, 'x-devgateway-auth-subject') ?? principalId,
  };
}

function assertRouteEnabledOutsideProduction(options: BudgetRouteOptions, route: string): void {
  if ((options.runtimeEnvironment ?? process.env.NODE_ENV) === 'production') {
    throw productionDisabledRouteControlError({
      route,
      store: 'in_memory_placeholder',
      contract: 'budget routes require approved DB-backed ledger enforcement before production',
    });
  }
}

function asDefineBudgetScopeRequest(body: unknown): DefineBudgetScopeRequest {
  return defineBudgetScopeRequestSchema.parse(body);
}

function asDefineBudgetPolicyRequest(body: unknown): DefineBudgetPolicyRequest {
  return defineBudgetPolicyRequestSchema.parse(body);
}

function asReserveBudgetReservationRequest(body: unknown): ReserveBudgetReservationRequest {
  return reserveBudgetReservationRequestSchema.parse(body);
}

function asSettleBudgetReservationRequest(body: unknown): SettleBudgetReservationRequest {
  return settleBudgetReservationRequestSchema.parse(body);
}

function asReleaseBudgetReservationRequest(body: unknown): ReleaseBudgetReservationRequest {
  return releaseBudgetReservationRequestSchema.parse(body);
}

function asBudgetSpendFilter(query: unknown): BudgetSpendFilter {
  if (query === undefined) return {};
  const filter = budgetSpendFilterSchema.parse(query);
  if (filter.scope_type !== undefined) assertBudgetScopeType(filter.scope_type);
  return filter;
}

function getBudgetScopeIdParam(params: unknown): string {
  assertObject(params, 'route params');
  const value = (params as Readonly<Record<string, unknown>>).budget_scope_id;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BudgetRouteValidationError('budget_scope_id route parameter is required.');
  }
  return value;
}

function getBudgetReservationIdParam(params: unknown): string {
  assertObject(params, 'route params');
  const value = (params as Readonly<Record<string, unknown>>).reservation_id;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BudgetRouteValidationError('reservation_id route parameter is required.');
  }
  return value;
}

function assertPolicyVersion(policyVersion: unknown): asserts policyVersion is string {
  if (typeof policyVersion !== 'string' || policyVersion.trim() === '') {
    throw stalePolicyControlError({ field: 'policy_version' });
  }
}

function assertBudgetScopeType(value: unknown): asserts value is BudgetScopeType {
  if (typeof value !== 'string' || !(budgetScopeTypes as readonly string[]).includes(value)) {
    throw new BudgetRouteValidationError(`scope_type must be one of ${budgetScopeTypes.join(', ')}.`);
  }
}

function normalizeLimits(input: BudgetLimitsInput): BudgetLimits {
  return {
    hard_cap_amount: input.hard_cap_amount ?? null,
    soft_cap_amount: input.soft_cap_amount ?? null,
    input_token_limit: input.input_token_limit ?? null,
    output_token_limit: input.output_token_limit ?? null,
    request_limit: input.request_limit ?? null,
  };
}

function childScopeTypesFor(scopeType: BudgetScopeType): readonly BudgetScopeType[] {
  switch (scopeType) {
    case 'org':
      return ['team', 'project', 'principal', 'virtual_key', 'workflow', 'delegation', 'tool_class'];
    case 'team':
      return ['project', 'principal', 'virtual_key', 'workflow', 'delegation', 'tool_class'];
    case 'project':
      return ['principal', 'virtual_key', 'workflow', 'delegation', 'tool_class'];
    case 'principal':
      return ['virtual_key', 'workflow', 'delegation', 'tool_class'];
    case 'virtual_key':
      return ['workflow', 'delegation', 'tool_class'];
    case 'workflow':
      return ['delegation', 'tool_class'];
    case 'delegation':
      return ['tool_class'];
    case 'tool_class':
      return [];
  }
}

function assertNoForbiddenSecretFields(value: unknown, path = 'body'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/provider.*(key|secret|token)|api[_-]?key|raw[_-]?secret|virtual[_-]?key[_-]?secret/i.test(key)) {
      throw new BudgetRouteValidationError(`Forbidden secret-bearing field is not accepted: ${path}.${key}`);
    }
    assertNoForbiddenSecretFields(nested, `${path}.${key}`);
  }
}

function assertCurrency(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/u.test(value)) {
    throw new BudgetRouteValidationError('currency must be an ISO 4217 uppercase currency code.');
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BudgetRouteValidationError(`${field} is required.`);
  }
}

function assertOptionalNonEmptyString(value: unknown, field: string): void {
  if (value === null || value === undefined) return;
  assertNonEmptyString(value, field);
}

function assertNonNegativeAmount(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BudgetRouteValidationError(`${field} must be a non-negative finite number.`);
  }
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BudgetRouteValidationError(`${field} must be a non-negative integer.`);
  }
}

function optionalStringToNull(value: string | null | undefined): string | null {
  return value ?? null;
}

function assertObject(value: unknown, label: string): asserts value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BudgetRouteValidationError(`${label} must be an object.`);
  }
}

function getHeaderValue(
  headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (typeof direct === 'string') return direct;
  return direct?.[0];
}

async function handleKnownBudgetRouteErrors(
  reply: ControlRouteReply | undefined,
  action: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    if (isControlDeniedError(error)) {
      return respond(reply, error.statusCode, toControlDeniedErrorBody(error));
    }
    if (error instanceof BudgetRouteValidationError) {
      return respond(reply, error.statusCode, { error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return respond(reply, 400, { error: { code: 'invalid_request', message: z.prettifyError(error) } });
    }
    throw error;
  }
}

function respond<T>(reply: ControlRouteReply | undefined, statusCode: number, body: T): T {
  reply?.code(statusCode);
  return body;
}

const budgetScopeResponseSchema = z
  .object({
    budget_scope_id: z.string(),
    scope_type: z.string(),
    status: z.string(),
    owner_ref: z.record(z.string(), z.unknown()),
    limits: z.record(z.string(), z.unknown()),
    spend_state: z.record(z.string(), z.unknown()),
    reservation_state: z.record(z.string(), z.unknown()),
    policy_version: z.string(),
  })
  .passthrough();

const nonEmptyStringSchema = z.string().min(1);
const currencySchema = z.string().regex(/^[A-Z]{3}$/u);
const amountSchema = z.number().min(0);
const tokenCountSchema = z.number().int().min(0);
const budgetScopeTypeSchema = z.enum(budgetScopeTypes);
const budgetScopeStatusSchema = z.enum(['draft', 'active', 'disabled', 'archived']);
const budgetResetPeriodSchema = z.enum(['none', 'daily', 'weekly', 'monthly', 'rolling_24h', 'rolling_7d', 'rolling_30d']);
const budgetLimitsSchema = z
  .object({
    hard_cap_amount: z.number().min(0).nullable().optional(),
    soft_cap_amount: z.number().min(0).nullable().optional(),
    input_token_limit: z.number().int().min(0).nullable().optional(),
    output_token_limit: z.number().int().min(0).nullable().optional(),
    request_limit: z.number().int().min(0).nullable().optional(),
  })
  .strict();
const budgetScopeRefSchema = z
  .object({
    budget_scope_id: z.string().min(1),
    budget_scope_type: budgetScopeTypeSchema,
  })
  .strict();
const defineBudgetScopeRequestSchema = z
  .object({
    scope_type: budgetScopeTypeSchema,
    owner_id: z.string().min(1),
    tenant_id: z.string().min(1).nullable().optional(),
    project_id: z.string().min(1).nullable().optional(),
    principal_id: z.string().min(1).nullable().optional(),
    virtual_key_id: z.string().min(1).nullable().optional(),
    parent_scope_ref: budgetScopeRefSchema.nullable().optional(),
    status: budgetScopeStatusSchema.optional(),
    currency: currencySchema.optional(),
    limits: budgetLimitsSchema.optional(),
    reset_period: budgetResetPeriodSchema.optional(),
    period_started_at: z.string().min(1).optional(),
    period_ends_at: z.string().min(1).nullable().optional(),
    timezone: z.string().min(1).optional(),
    policy_version: z.string().min(1),
  })
  .strict();
const defineBudgetPolicyRequestSchema = z
  .object({
    budget_scope_id: z.string().min(1),
    currency: currencySchema.optional(),
    limits: budgetLimitsSchema,
    reset_period: budgetResetPeriodSchema.optional(),
    period_started_at: z.string().min(1).optional(),
    period_ends_at: z.string().min(1).nullable().optional(),
    timezone: z.string().min(1).optional(),
    policy_version: z.string().min(1),
    expected_current_policy_version: z.string().min(1).optional(),
  })
  .strict();
const budgetReservationIdentityRequestSchema = {
  budget_scope_id: nonEmptyStringSchema,
  workflow_run_id: nonEmptyStringSchema,
  delegation_id: nonEmptyStringSchema.nullable().optional(),
  tool_class: nonEmptyStringSchema.nullable().optional(),
  model_alias: nonEmptyStringSchema.nullable().optional(),
  currency: currencySchema,
  idempotency_key: nonEmptyStringSchema,
  request_id: nonEmptyStringSchema,
  trace_id: nonEmptyStringSchema,
  policy_version: nonEmptyStringSchema,
} as const;
const reserveBudgetReservationRequestSchema = z
  .object({
    ...budgetReservationIdentityRequestSchema,
    amount: amountSchema,
    input_tokens: tokenCountSchema,
    output_tokens: tokenCountSchema,
  })
  .strict();
const settleBudgetReservationRequestSchema = z
  .object({
    ...budgetReservationIdentityRequestSchema,
    actual_amount: amountSchema,
    actual_input_tokens: tokenCountSchema,
    actual_output_tokens: tokenCountSchema,
    cost_event_id: nonEmptyStringSchema,
  })
  .strict();
const releaseBudgetReservationRequestSchema = z
  .object({
    ...budgetReservationIdentityRequestSchema,
    release_reason: nonEmptyStringSchema,
    reconciliation_state: z.enum(['orphaned', 'reconciled']).optional(),
  })
  .strict();
const budgetSpendFilterSchema = z
  .object({
    budget_scope_id: z.string().min(1).optional(),
    scope_type: budgetScopeTypeSchema.optional(),
    owner_id: z.string().min(1).optional(),
    project_id: z.string().min(1).optional(),
    principal_id: z.string().min(1).optional(),
    virtual_key_id: z.string().min(1).optional(),
  })
  .strict();
const budgetScopeIdParamsSchema = z.object({ budget_scope_id: z.string().min(1) }).strict();
const budgetReservationIdParamsSchema = z.object({ reservation_id: nonEmptyStringSchema }).strict();
const budgetReservationStatusSchema = z.enum(['reserved', 'settled', 'released']);
const budgetReservationLifecycleStateSchema = z.enum(['held', 'released', 'settled', 'orphaned', 'reconciled']);
const budgetReservationResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    reservation_id: nonEmptyStringSchema,
    budget_scope_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    delegation_id: nonEmptyStringSchema.nullable(),
    tool_class: nonEmptyStringSchema.nullable(),
    model_alias: nonEmptyStringSchema.nullable(),
    currency: currencySchema,
    reserved_amount: amountSchema,
    reserved_input_tokens: tokenCountSchema,
    reserved_output_tokens: tokenCountSchema,
    status: budgetReservationStatusSchema,
    lifecycle_state: budgetReservationLifecycleStateSchema,
    reconciliation_state: z.enum(['orphaned', 'reconciled']).nullable(),
    idempotency_key: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    actual_amount: amountSchema.nullable(),
    actual_input_tokens: tokenCountSchema.nullable(),
    actual_output_tokens: tokenCountSchema.nullable(),
    cost_event_id: nonEmptyStringSchema.nullable(),
    settlement_idempotency_key: nonEmptyStringSchema.nullable(),
    settlement_request_id: nonEmptyStringSchema.nullable(),
    settlement_trace_id: nonEmptyStringSchema.nullable(),
    settled_at: nonEmptyStringSchema.nullable(),
    release_reason: nonEmptyStringSchema.nullable(),
    release_idempotency_key: nonEmptyStringSchema.nullable(),
    release_request_id: nonEmptyStringSchema.nullable(),
    release_trace_id: nonEmptyStringSchema.nullable(),
    released_at: nonEmptyStringSchema.nullable(),
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();
const budgetReservationEnvelopeResponseSchema = z.object({ budget_reservation: budgetReservationResponseSchema });

export const defineBudgetScopeSchema = {
  operationId: 'defineBudgetScope',
  tags: ['control-api', 'budgets'],
  summary: 'Define a non-production budget scope and policy placeholder',
  description: 'Request body follows the shared gateway-control budget scope contract with scope_type, owner_id, limits, reset period, and policy_version.',
  body: defineBudgetScopeRequestSchema,
  response: { 201: z.object({ budget_scope: budgetScopeResponseSchema }) },
} as const;

export const defineBudgetPolicySchema = {
  operationId: 'defineBudgetPolicy',
  tags: ['control-api', 'budgets'],
  summary: 'Apply a versioned budget policy to an existing budget scope',
  description: 'Request body requires budget_scope_id, limits, policy_version, and optional expected_current_policy_version for stale-policy protection.',
  body: defineBudgetPolicyRequestSchema,
  response: { 200: z.object({ budget_scope: budgetScopeResponseSchema }) },
} as const;

export const reserveBudgetReservationSchema = {
  operationId: 'reserveBudget',
  tags: ['control-api', 'budgets'],
  summary: 'Reserve non-production budget before model or tool execution',
  description:
    'Creates an idempotent budget reservation after verifying hard-cap headroom using actual spend plus active reservations plus requested amount.',
  body: reserveBudgetReservationRequestSchema,
  response: { 201: budgetReservationEnvelopeResponseSchema },
} as const;

export const getBudgetReservationSchema = {
  operationId: 'getBudgetReservation',
  tags: ['control-api', 'budgets'],
  summary: 'Inspect a non-production budget reservation lifecycle state',
  description:
    'Returns sanitized reservation lifecycle details, including held, settled, released, orphaned, or reconciled state.',
  params: budgetReservationIdParamsSchema,
  response: { 200: budgetReservationEnvelopeResponseSchema },
} as const;

export const settleBudgetReservationSchema = {
  operationId: 'settleBudgetReservation',
  tags: ['control-api', 'budgets'],
  summary: 'Settle a non-production budget reservation',
  description:
    'Records actual spend for a reserved model or tool execution, clears the reserved amount and tokens, and applies idempotency for settlement retries.',
  params: budgetReservationIdParamsSchema,
  body: settleBudgetReservationRequestSchema,
  response: { 200: budgetReservationEnvelopeResponseSchema },
} as const;

export const releaseBudgetReservationSchema = {
  operationId: 'releaseBudgetReservation',
  tags: ['control-api', 'budgets'],
  summary: 'Release an unused non-production budget reservation',
  description:
    'Releases the reserved amount and tokens without recording spend, requiring a release reason and an idempotency key for safe retries.',
  params: budgetReservationIdParamsSchema,
  body: releaseBudgetReservationRequestSchema,
  response: { 200: budgetReservationEnvelopeResponseSchema },
} as const;

export const getBudgetScopeSchema = {
  operationId: 'getBudgetScope',
  tags: ['control-api', 'budgets'],
  summary: 'Inspect a budget scope and current spend state',
  description: 'Returns a sanitized budget scope record including spend_state and reservation_state for non-production inspection.',
  params: budgetScopeIdParamsSchema,
  response: { 200: z.object({ budget_scope: budgetScopeResponseSchema }) },
} as const;

export const getBudgetScopeSpendSchema = {
  operationId: 'getBudgetScopeSpend',
  tags: ['control-api', 'budgets'],
  summary: 'Inspect spend for a budget scope',
  description: 'Returns sanitized spend_state and reservation_state for a single budget scope.',
  params: budgetScopeIdParamsSchema,
  response: { 200: z.record(z.string(), z.unknown()) },
} as const;

export const inspectBudgetSpendSchema = {
  operationId: 'inspectBudgetSpend',
  tags: ['control-api', 'budgets'],
  summary: 'Inspect spend and active reservations by budget scope filters',
  description:
    'Supports budget_scope_id, scope_type, owner_id, project_id, principal_id, and virtual_key_id query filters without exposing raw ledger rows or secrets.',
  querystring: budgetSpendFilterSchema,
  response: { 200: z.record(z.string(), z.unknown()) },
} as const;
