import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  artifactMetadataResponseSchema,
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
  taskParamsSchema,
  toArtifactMetadataResponse,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const TASK_ARTIFACTS_PATH = '/api/tasks/:task_id/artifacts' as const;

export interface ArtifactRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type ArtifactStore = Pick<AgentWorkflowStore, 'listTaskArtifacts'>;

export interface ArtifactRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: ArtifactStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export function createInMemoryArtifactStore(options: InMemoryAgentWorkflowStoreOptions = {}): AgentWorkflowStore {
  return createInMemoryAgentWorkflowStore(options);
}

export function registerArtifactRoutes(registrar: ArtifactRouteRegistrar, options: ArtifactRouteOptions = {}): void {
  const store = options.store ?? defaultAgentWorkflowStore;

  registrar.route({
    method: 'GET',
    url: TASK_ARTIFACTS_PATH,
    schema: listTaskArtifactsSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'task-artifacts-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const artifacts = await store.listTaskArtifacts(
          getRouteParam(request.params, 'task_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (artifacts === null) throw notFoundRouteError('Unknown task_id.');
        return respond(reply, 200, {
          artifacts: artifacts.map(toArtifactMetadataResponse),
          count: artifacts.length,
        });
      }),
  });
}

const artifactListEnvelopeSchema = {
  type: 'object',
  required: ['artifacts', 'count'],
  properties: {
    artifacts: {
      type: 'array',
      items: artifactMetadataResponseSchema,
    },
    count: {
      type: 'integer',
      minimum: 0,
    },
  },
} as const;

export const listTaskArtifactsSchema = {
  operationId: 'listTaskArtifacts',
  tags: ['control-api', 'artifacts', 'tasks'],
  summary: 'List task artifact metadata',
  description:
    'Returns artifact metadata only: IDs, classification, size/hash, storage policy refs, ACL scope, retention details, and signed-download eligibility. It never returns object bodies or signed URLs.',
  params: taskParamsSchema,
  response: {
    200: artifactListEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;
