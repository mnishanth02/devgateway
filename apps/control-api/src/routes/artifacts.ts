import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  artifactLifecycleEventResponseSchema,
  artifactLifecycleStatusResponseSchema,
  artifactMetadataResponseSchema,
  artifactParamsSchema,
  artifactSignedAccessDecisionResponseSchema,
  assertAgentWorkflowRouteEnabledOutsideProduction,
  asArtifactSignedAccessRequest,
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
  toArtifactLifecycleEventResponse,
  toArtifactMetadataResponse,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const TASK_ARTIFACTS_PATH = '/api/tasks/:task_id/artifacts' as const;
export const ARTIFACT_LIFECYCLE_PATH = '/api/artifacts/:artifact_id/lifecycle' as const;
export const ARTIFACT_LIFECYCLE_STATUS_PATH = '/api/artifacts/:artifact_id/lifecycle/status' as const;
export const ARTIFACT_SIGNED_ACCESS_PATH = '/api/artifacts/:artifact_id/signed-access' as const;

export interface ArtifactRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type ArtifactStore = Pick<
  AgentWorkflowStore,
  'listTaskArtifacts' | 'listArtifactLifecycle' | 'getArtifactLifecycleStatus' | 'requestArtifactSignedAccess'
>;

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

  registrar.route({
    method: 'GET',
    url: ARTIFACT_LIFECYCLE_PATH,
    schema: listArtifactLifecycleSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'artifact-lifecycle-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const events = await store.listArtifactLifecycle(
          getRouteParam(request.params, 'artifact_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (events === null) throw notFoundRouteError('Unknown artifact_id.');
        return respond(reply, 200, {
          events: events.map(toArtifactLifecycleEventResponse),
          count: events.length,
        });
      }),
  });

  registrar.route({
    method: 'GET',
    url: ARTIFACT_LIFECYCLE_STATUS_PATH,
    schema: getArtifactLifecycleStatusSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'artifact-lifecycle-status');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const status = await store.getArtifactLifecycleStatus(
          getRouteParam(request.params, 'artifact_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (status === null) throw notFoundRouteError('Unknown artifact_id.');
        return respond(reply, 200, { status });
      }),
  });

  registrar.route({
    method: 'POST',
    url: ARTIFACT_SIGNED_ACCESS_PATH,
    schema: requestArtifactSignedAccessSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'artifact-signed-access-request');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const body = asArtifactSignedAccessRequest(request.body);
        const decision = await store.requestArtifactSignedAccess(
          getRouteParam(request.params, 'artifact_id'),
          body,
          actor,
          createAgentWorkflowReadContext(actor, request),
        );
        return respond(reply, 200, { decision });
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

const artifactParamsJsonSchema = {
  type: 'object',
  required: ['artifact_id'],
  properties: { artifact_id: { type: 'string', minLength: 1 } },
} as const;

const artifactLifecycleListEnvelopeSchema = {
  type: 'object',
  required: ['events', 'count'],
  properties: {
    events: {
      type: 'array',
      items: artifactLifecycleEventResponseSchema,
    },
    count: {
      type: 'integer',
      minimum: 0,
    },
  },
} as const;

const artifactLifecycleStatusEnvelopeSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: artifactLifecycleStatusResponseSchema,
  },
} as const;

const artifactSignedAccessDecisionEnvelopeSchema = {
  type: 'object',
  required: ['decision'],
  properties: {
    decision: artifactSignedAccessDecisionResponseSchema,
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

export const listArtifactLifecycleSchema = {
  operationId: 'listArtifactLifecycle',
  tags: ['control-api', 'artifacts'],
  summary: 'List artifact lifecycle events',
  description:
    'Returns append-only lifecycle event metadata for an artifact: action, state, retention policy, signed access eligibility, legal hold, redaction, and deletion schedule. Never returns object bodies, signed URLs, or provider credentials.',
  params: artifactParamsJsonSchema,
  response: {
    200: artifactLifecycleListEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getArtifactLifecycleStatusSchema = {
  operationId: 'getArtifactLifecycleStatus',
  tags: ['control-api', 'artifacts'],
  summary: 'Get artifact lifecycle status summary',
  description:
    'Returns the latest lifecycle state summary for an artifact: current state/action, legal hold, redaction, deletion schedule, and signed access eligibility. Never returns object bodies or signed URLs.',
  params: artifactParamsJsonSchema,
  response: {
    200: artifactLifecycleStatusEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const requestArtifactSignedAccessSchema = {
  operationId: 'requestArtifactSignedAccess',
  tags: ['control-api', 'artifacts'],
  summary: 'Request signed access eligibility decision for an artifact',
  description:
    'Returns an eligibility/approval-required decision for signed artifact access. Never returns a signed URL, object body, or provider credentials. If the artifact requires approval, callers must complete the approval flow before access is granted.',
  params: artifactParamsJsonSchema,
  response: {
    200: artifactSignedAccessDecisionEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;
