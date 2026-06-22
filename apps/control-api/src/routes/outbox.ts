import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  asOutboxListFilter,
  assertAgentWorkflowRouteEnabledOutsideProduction,
  authenticateAgentWorkflowRequest,
  createAgentWorkflowReadContext,
  createInMemoryAgentWorkflowStore,
  defaultAgentWorkflowStore,
  errorResponseSchema,
  getRouteParam,
  handleKnownAgentWorkflowRouteErrors,
  notFoundRouteError,
  outboxListQuerySchema,
  outboxParamsSchema,
  outboxResponseSchema,
  outboxStatusResponseSchema,
  respond,
  toOutboxResponse,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const OUTBOX_BASE_PATH = '/api/outbox' as const;

export interface OutboxRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type OutboxStore = Pick<AgentWorkflowStore, 'listOutbox' | 'getOutbox' | 'outboxStatus'>;

export interface OutboxRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: OutboxStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export function createInMemoryOutboxStore(options: InMemoryAgentWorkflowStoreOptions = {}): AgentWorkflowStore {
  return createInMemoryAgentWorkflowStore(options);
}

export function registerOutboxRoutes(registrar: OutboxRouteRegistrar, options: OutboxRouteOptions = {}): void {
  const store = options.store ?? defaultAgentWorkflowStore;

  registrar.route({
    method: 'GET',
    url: OUTBOX_BASE_PATH,
    schema: listOutboxSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'outbox-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const filter = asOutboxListFilter(request.query);
        const outboxes = await store.listOutbox(filter, createAgentWorkflowReadContext(actor, request));
        return respond(reply, 200, { outboxes: outboxes.map(toOutboxResponse), count: outboxes.length });
      }),
  });

  // /status must be registered before /:outbox_id so the static segment wins
  registrar.route({
    method: 'GET',
    url: `${OUTBOX_BASE_PATH}/status`,
    schema: getOutboxStatusSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'outbox-status');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const filter = asOutboxListFilter(request.query);
        const status = await store.outboxStatus(filter, createAgentWorkflowReadContext(actor, request));
        return respond(reply, 200, { status });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${OUTBOX_BASE_PATH}/:outbox_id`,
    schema: getOutboxSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'outbox-get');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const outbox = await store.getOutbox(
          getRouteParam(request.params, 'outbox_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (outbox === null) throw notFoundRouteError('Unknown outbox_id.');
        return respond(reply, 200, { outbox: toOutboxResponse(outbox) });
      }),
  });
}

const outboxEnvelopeSchema = {
  type: 'object',
  required: ['outbox'],
  properties: {
    outbox: outboxResponseSchema,
  },
} as const;

const outboxListEnvelopeSchema = {
  type: 'object',
  required: ['outboxes', 'count'],
  properties: {
    outboxes: {
      type: 'array',
      items: outboxResponseSchema,
    },
    count: { type: 'number' },
  },
} as const;

const outboxStatusEnvelopeSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: outboxStatusResponseSchema,
  },
} as const;

export const listOutboxSchema = {
  operationId: 'listOutbox',
  tags: ['control-api', 'outbox'],
  summary: 'List outbox delivery records',
  description:
    'Returns metadata-only outbox delivery records for the authenticated principal. No raw payload bodies, signed URLs, or provider secrets are returned.',
  querystring: outboxListQuerySchema,
  response: {
    200: outboxListEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getOutboxStatusSchema = {
  operationId: 'getOutboxStatus',
  tags: ['control-api', 'outbox'],
  summary: 'Outbox delivery status summary',
  description:
    'Returns aggregated counts by delivery state and destination kind for the authenticated principal. Metadata-only — no payload bodies or secrets.',
  querystring: outboxListQuerySchema,
  response: {
    200: outboxStatusEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getOutboxSchema = {
  operationId: 'getOutbox',
  tags: ['control-api', 'outbox'],
  summary: 'Get outbox record metadata',
  description:
    'Returns sanitized outbox delivery record metadata. No raw payload bodies, signed URLs, or provider secrets are returned.',
  params: outboxParamsSchema,
  response: {
    200: outboxEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;
