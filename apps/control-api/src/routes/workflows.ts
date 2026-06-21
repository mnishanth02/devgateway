import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  asWorkflowEventPageRequest,
  assertAgentWorkflowRouteEnabledOutsideProduction,
  authenticateAgentWorkflowRequest,
  createAgentWorkflowReadContext,
  createInMemoryAgentWorkflowStore,
  defaultAgentWorkflowStore,
  errorResponseSchema,
  getRouteParam,
  handleKnownAgentWorkflowRouteErrors,
  notFoundRouteError,
  respond,
  toWorkflowEventResponse,
  toWorkflowResponse,
  workflowEventQuerySchema,
  workflowEventResponseSchema,
  workflowParamsSchema,
  workflowResponseSchema,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const WORKFLOWS_BASE_PATH = '/api/workflows' as const;

export interface WorkflowRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type WorkflowStore = Pick<AgentWorkflowStore, 'getWorkflow' | 'listWorkflowEvents'>;

export interface WorkflowRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: WorkflowStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export function createInMemoryWorkflowStore(options: InMemoryAgentWorkflowStoreOptions = {}): AgentWorkflowStore {
  return createInMemoryAgentWorkflowStore(options);
}

export function registerWorkflowRoutes(registrar: WorkflowRouteRegistrar, options: WorkflowRouteOptions = {}): void {
  const store = options.store ?? defaultAgentWorkflowStore;

  registrar.route({
    method: 'GET',
    url: `${WORKFLOWS_BASE_PATH}/:workflow_id`,
    schema: getWorkflowSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-get');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const workflow = await store.getWorkflow(
          getRouteParam(request.params, 'workflow_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (workflow === null) throw notFoundRouteError('Unknown workflow_id.');
        return respond(reply, 200, { workflow: toWorkflowResponse(workflow) });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${WORKFLOWS_BASE_PATH}/:workflow_id/events`,
    schema: listWorkflowEventsSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-events-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const page = await store.listWorkflowEvents(
          getRouteParam(request.params, 'workflow_id'),
          asWorkflowEventPageRequest(request.query),
          createAgentWorkflowReadContext(actor, request),
        );
        if (page === null) throw notFoundRouteError('Unknown workflow_id.');
        return respond(reply, 200, {
          events: page.events.map(toWorkflowEventResponse),
          next_cursor: page.next_cursor,
        });
      }),
  });
}

const workflowEnvelopeSchema = {
  type: 'object',
  required: ['workflow'],
  properties: {
    workflow: workflowResponseSchema,
  },
} as const;

const workflowEventsEnvelopeSchema = {
  type: 'object',
  required: ['events', 'next_cursor'],
  properties: {
    events: {
      type: 'array',
      items: workflowEventResponseSchema,
    },
    next_cursor: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
  },
} as const;

export const getWorkflowSchema = {
  operationId: 'getWorkflow',
  tags: ['control-api', 'workflows'],
  summary: 'Get workflow run metadata',
  description: 'Returns sanitized workflow state, policy pins, budget scope, trace correlation, and opaque references.',
  params: workflowParamsSchema,
  response: {
    200: workflowEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const listWorkflowEventsSchema = {
  operationId: 'listWorkflowEvents',
  tags: ['control-api', 'workflows'],
  summary: 'List workflow events',
  description:
    'Returns cursor-paginated workflow events ordered by sequence number. The cursor is the last seen sequence number; raw prompts and raw artifact bodies are never returned.',
  params: workflowParamsSchema,
  querystring: workflowEventQuerySchema,
  response: {
    200: workflowEventsEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;
