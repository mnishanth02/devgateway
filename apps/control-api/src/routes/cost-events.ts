import {
  type CostAttemptStatus,
  type CostEventRecord,
  type CostEventType,
  type EnvironmentName,
} from '../../../../packages/shared-types/src/gateway-control.ts';
import { z } from 'zod';

import {
  isControlDeniedError,
  missingAuthControlError,
  productionDisabledRouteControlError,
  toControlDeniedErrorBody,
} from '../policies/control-errors.ts';
import type {
  ControlRouteAuthContext,
  ControlRouteDefinition,
  ControlRouteReply,
  ControlRouteRequest,
} from './virtual-keys.ts';

export const COST_EVENTS_BASE_PATH = '/api/cost-events' as const;

export interface CostEventRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export interface CostEventRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: CostEventStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export interface CostEventStore {
  list(filter: CostEventFilter): Promise<CostEventRecord[]>;
}

export interface AppendableCostEventStore extends CostEventStore {
  append(event: CostEventRecord): Promise<void>;
}

export interface CostEventFilter {
  readonly trace_id?: string | undefined;
  readonly request_id?: string | undefined;
  readonly budget_scope_id?: string | undefined;
  readonly project_id?: string | undefined;
  readonly principal_id?: string | undefined;
  readonly virtual_key_id?: string | undefined;
  readonly provider_id?: string | undefined;
  readonly model_alias?: string | undefined;
  readonly event_type?: CostEventType | undefined;
  readonly attempt_status?: CostAttemptStatus | undefined;
}

class CostEventRouteValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'invalid_request';

  constructor(message: string) {
    super(message);
    this.name = 'CostEventRouteValidationError';
  }
}

export class InMemoryCostEventStore implements AppendableCostEventStore {
  readonly #events: CostEventRecord[];

  constructor(initialEvents: readonly CostEventRecord[] = []) {
    this.#events = [...initialEvents];
  }

  async append(event: CostEventRecord): Promise<void> {
    assertCostEventHasSafeShape(event);
    this.#events.push(event);
  }

  async list(filter: CostEventFilter): Promise<CostEventRecord[]> {
    return this.#events
      .filter((event) => filter.trace_id === undefined || event.trace_id === filter.trace_id)
      .filter((event) => filter.request_id === undefined || event.request_id === filter.request_id)
      .filter((event) => filter.budget_scope_id === undefined || event.budget_scope_id === filter.budget_scope_id)
      .filter((event) => filter.project_id === undefined || event.project_id === filter.project_id)
      .filter((event) => filter.principal_id === undefined || event.principal_id === filter.principal_id)
      .filter((event) => filter.virtual_key_id === undefined || event.virtual_key_id === filter.virtual_key_id)
      .filter((event) => filter.provider_id === undefined || event.provider_id === filter.provider_id)
      .filter((event) => filter.model_alias === undefined || event.model_alias === filter.model_alias)
      .filter((event) => filter.event_type === undefined || event.event_type === filter.event_type)
      .filter((event) => filter.attempt_status === undefined || event.attempt_status === filter.attempt_status);
  }
}

export function createInMemoryCostEventStore(initialEvents: readonly CostEventRecord[] = []): AppendableCostEventStore {
  return new InMemoryCostEventStore(initialEvents);
}

export function registerCostEventRoutes(registrar: CostEventRouteRegistrar, options: CostEventRouteOptions = {}): void {
  const store = options.store ?? createInMemoryCostEventStore();

  registrar.route({
    method: 'GET',
    url: COST_EVENTS_BASE_PATH,
    schema: inspectCostEventsSchema,
    handler: async (request, reply) =>
      handleKnownCostEventRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'cost-events-inspect');
        await authenticateCostEventRequest(request, options);
        const filter = asCostEventFilter(request.query);
        assertTraceOrRequestFilter(filter);
        const costEvents = await store.list(filter);
        return respond(reply, 200, { cost_events: costEvents, count: costEvents.length });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${COST_EVENTS_BASE_PATH}/traces/:trace_id`,
    schema: inspectCostEventsByTraceSchema,
    handler: async (request, reply) =>
      handleKnownCostEventRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'cost-events-by-trace');
        await authenticateCostEventRequest(request, options);
        const costEvents = await store.list({ trace_id: getParam(request.params, 'trace_id') });
        return respond(reply, 200, { cost_events: costEvents, count: costEvents.length });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${COST_EVENTS_BASE_PATH}/requests/:request_id`,
    schema: inspectCostEventsByRequestSchema,
    handler: async (request, reply) =>
      handleKnownCostEventRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'cost-events-by-request');
        await authenticateCostEventRequest(request, options);
        const costEvents = await store.list({ request_id: getParam(request.params, 'request_id') });
        return respond(reply, 200, { cost_events: costEvents, count: costEvents.length });
      }),
  });
}

async function authenticateCostEventRequest(
  request: ControlRouteRequest,
  options: CostEventRouteOptions,
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

function assertRouteEnabledOutsideProduction(options: CostEventRouteOptions, route: string): void {
  if ((options.runtimeEnvironment ?? process.env.NODE_ENV) === 'production') {
    throw productionDisabledRouteControlError({
      route,
      store: 'in_memory_placeholder',
      contract: 'cost event inspection requires approved DB-backed cost-event retention before production',
    });
  }
}

function asCostEventFilter(query: unknown): CostEventFilter {
  if (query === undefined) return {};
  return costEventFilterSchema.parse(query);
}

function assertTraceOrRequestFilter(filter: CostEventFilter): void {
  if (
    (filter.trace_id === undefined || filter.trace_id.trim() === '') &&
    (filter.request_id === undefined || filter.request_id.trim() === '')
  ) {
    throw new CostEventRouteValidationError('Cost event inspection requires trace_id or request_id.');
  }
}

function assertCostEventHasSafeShape(event: CostEventRecord): void {
  assertNoForbiddenSecretFields(event);
  assertNonEmptyString(event.trace_id, 'trace_id');
  assertNonEmptyString(event.request_id, 'request_id');
  assertNonEmptyString(event.budget_scope_id, 'budget_scope_id');
  assertNonEmptyString(event.policy_version, 'policy_version');
  assertNonEmptyString(event.registry_version, 'registry_version');
}

function getParam(params: unknown, name: string): string {
  assertObject(params, 'route params');
  const value = (params as Readonly<Record<string, unknown>>)[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CostEventRouteValidationError(`${name} route parameter is required.`);
  }
  return value;
}

function assertNoForbiddenSecretFields(value: unknown, path = 'event'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/prompt|completion|provider.*(key|secret|token)|api[_-]?key|raw[_-]?secret|virtual[_-]?key[_-]?secret/i.test(key)) {
      throw new CostEventRouteValidationError(`Forbidden payload or secret field is not accepted: ${path}.${key}`);
    }
    assertNoForbiddenSecretFields(nested, `${path}.${key}`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CostEventRouteValidationError(`${field} is required.`);
  }
}

function assertObject(value: unknown, label: string): asserts value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CostEventRouteValidationError(`${label} must be an object.`);
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

async function handleKnownCostEventRouteErrors(
  reply: ControlRouteReply | undefined,
  action: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    if (isControlDeniedError(error)) {
      return respond(reply, error.statusCode, toControlDeniedErrorBody(error));
    }
    if (error instanceof CostEventRouteValidationError) {
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

const costEventListResponseSchema = z.object({
  cost_events: z.array(z.record(z.string(), z.unknown())),
  count: z.number().int().nonnegative(),
});

const costEventFilterSchema = z
  .object({
    budget_scope_id: z.string().min(1).optional(),
    project_id: z.string().min(1).optional(),
    principal_id: z.string().min(1).optional(),
    virtual_key_id: z.string().min(1).optional(),
    provider_id: z.string().min(1).optional(),
    model_alias: z.string().min(1).optional(),
    request_id: z.string().min(1).optional(),
    trace_id: z.string().min(1).optional(),
    event_type: z.enum(['estimate', 'actual', 'reconciliation', 'denial_estimate']).optional(),
    attempt_status: z.enum(['started', 'succeeded', 'failed', 'denied', 'cancelled', 'timed_out']).optional(),
  })
  .strict();

const traceIdParamsSchema = z.object({ trace_id: z.string().min(1) }).strict();
const requestIdParamsSchema = z.object({ request_id: z.string().min(1) }).strict();

export const inspectCostEventsSchema = {
  tags: ['control-api', 'cost-events'],
  summary: 'Inspect cost event stream by trace or request correlation',
  description: 'Requires trace_id or request_id query filter. Additional filters may narrow budget, project, principal, virtual key, provider, model, event type, or attempt status.',
  querystring: costEventFilterSchema,
  response: {
    200: costEventListResponseSchema,
  },
} as const;

export const inspectCostEventsByTraceSchema = {
  tags: ['control-api', 'cost-events'],
  summary: 'Inspect cost event stream for a trace id',
  params: traceIdParamsSchema,
  response: inspectCostEventsSchema.response,
} as const;

export const inspectCostEventsByRequestSchema = {
  tags: ['control-api', 'cost-events'],
  summary: 'Inspect cost event stream for a request id',
  params: requestIdParamsSchema,
  response: inspectCostEventsSchema.response,
} as const;
