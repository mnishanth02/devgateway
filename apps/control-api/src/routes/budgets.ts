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

  async getScope(budgetScopeId: string): Promise<BudgetScopeRecord | null> {
    return this.#scopes.get(budgetScopeId) ?? null;
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

function assertPolicyVersion(policyVersion: unknown): asserts policyVersion is string {
  if (typeof policyVersion !== 'string' || policyVersion.trim() === '') {
    throw stalePolicyControlError({ field: 'policy_version' });
  }
}

function assertBudgetScopeType(value: unknown): asserts value is BudgetScopeType {
  if (typeof value !== 'string' || !(budgetScopeTypes as readonly string[]).includes(value)) {
    throw new BudgetRouteValidationError('scope_type must be one of org, team, project, principal, virtual_key.');
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
      return ['team', 'project', 'principal', 'virtual_key'];
    case 'team':
      return ['project', 'principal', 'virtual_key'];
    case 'project':
      return ['principal', 'virtual_key'];
    case 'principal':
      return ['virtual_key'];
    case 'virtual_key':
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

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BudgetRouteValidationError(`${field} is required.`);
  }
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
    policy_version: z.string(),
  })
  .passthrough();

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
    currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
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
    currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
    limits: budgetLimitsSchema,
    reset_period: budgetResetPeriodSchema.optional(),
    period_started_at: z.string().min(1).optional(),
    period_ends_at: z.string().min(1).nullable().optional(),
    timezone: z.string().min(1).optional(),
    policy_version: z.string().min(1),
    expected_current_policy_version: z.string().min(1).optional(),
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

export const defineBudgetScopeSchema = {
  tags: ['control-api', 'budgets'],
  summary: 'Define a non-production budget scope and policy placeholder',
  description: 'Request body follows the shared gateway-control budget scope contract with scope_type, owner_id, limits, reset period, and policy_version.',
  body: defineBudgetScopeRequestSchema,
  response: { 201: z.object({ budget_scope: budgetScopeResponseSchema }) },
} as const;

export const defineBudgetPolicySchema = {
  tags: ['control-api', 'budgets'],
  summary: 'Apply a versioned budget policy to an existing budget scope',
  description: 'Request body requires budget_scope_id, limits, policy_version, and optional expected_current_policy_version for stale-policy protection.',
  body: defineBudgetPolicyRequestSchema,
  response: { 200: z.object({ budget_scope: budgetScopeResponseSchema }) },
} as const;

export const getBudgetScopeSchema = {
  tags: ['control-api', 'budgets'],
  summary: 'Inspect a budget scope and current spend state',
  params: budgetScopeIdParamsSchema,
  response: { 200: z.object({ budget_scope: budgetScopeResponseSchema }) },
} as const;

export const getBudgetScopeSpendSchema = {
  tags: ['control-api', 'budgets'],
  summary: 'Inspect spend for a budget scope',
  params: budgetScopeIdParamsSchema,
  response: { 200: z.record(z.string(), z.unknown()) },
} as const;

export const inspectBudgetSpendSchema = {
  tags: ['control-api', 'budgets'],
  summary: 'Inspect spend by org, team, project, principal, or virtual key',
  description: 'Supports budget_scope_id, scope_type, owner_id, project_id, principal_id, and virtual_key_id query filters.',
  querystring: budgetSpendFilterSchema,
  response: { 200: z.record(z.string(), z.unknown()) },
} as const;
