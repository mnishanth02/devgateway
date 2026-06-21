import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  agentRunParamsSchema,
  agentRunResponseSchema,
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
  toAgentRunResponse,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const AGENT_RUNS_BASE_PATH = '/api/agent-runs' as const;

export interface AgentRunRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type AgentRunStore = Pick<AgentWorkflowStore, 'getAgentRun'>;

export interface AgentRunRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: AgentRunStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export function createInMemoryAgentRunStore(options: InMemoryAgentWorkflowStoreOptions = {}): AgentWorkflowStore {
  return createInMemoryAgentWorkflowStore(options);
}

export function registerAgentRunRoutes(registrar: AgentRunRouteRegistrar, options: AgentRunRouteOptions = {}): void {
  const store = options.store ?? defaultAgentWorkflowStore;

  registrar.route({
    method: 'GET',
    url: `${AGENT_RUNS_BASE_PATH}/:agent_run_id`,
    schema: getAgentRunSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'agent-run-get');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const agentRun = await store.getAgentRun(
          getRouteParam(request.params, 'agent_run_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (agentRun === null) throw notFoundRouteError('Unknown agent_run_id.');
        return respond(reply, 200, { agent_run: toAgentRunResponse(agentRun) });
      }),
  });
}

const agentRunEnvelopeSchema = {
  type: 'object',
  required: ['agent_run'],
  properties: {
    agent_run: agentRunResponseSchema,
  },
} as const;

export const getAgentRunSchema = {
  operationId: 'getAgentRun',
  tags: ['control-api', 'agent-runs'],
  summary: 'Get agent run metadata',
  description: 'Returns sanitized agent-run state, refs, budgets, policy pins, and trace correlation without raw prompts or context.',
  params: agentRunParamsSchema,
  response: {
    200: agentRunEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;
