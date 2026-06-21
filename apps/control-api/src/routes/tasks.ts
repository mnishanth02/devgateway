import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  asCancelTaskRequest,
  asCreateTaskRequest,
  assertAgentWorkflowRouteEnabledOutsideProduction,
  authenticateAgentWorkflowRequest,
  createAgentWorkflowReadContext,
  cancelTaskRequestSchema,
  createInMemoryAgentWorkflowStore,
  createTaskRequestSchema,
  defaultAgentWorkflowStore,
  errorResponseSchema,
  getRouteParam,
  handleKnownAgentWorkflowRouteErrors,
  notFoundRouteError,
  respond,
  taskParamsSchema,
  taskResponseSchema,
  toTaskResponse,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const TASKS_BASE_PATH = '/api/tasks' as const;

export interface TaskRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type TaskStore = Pick<AgentWorkflowStore, 'createTask' | 'getTask' | 'cancelTask'>;

export interface TaskRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: TaskStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export function createInMemoryTaskStore(options: InMemoryAgentWorkflowStoreOptions = {}): AgentWorkflowStore {
  return createInMemoryAgentWorkflowStore(options);
}

export function registerTaskRoutes(registrar: TaskRouteRegistrar, options: TaskRouteOptions = {}): void {
  const store = options.store ?? defaultAgentWorkflowStore;

  registrar.route({
    method: 'POST',
    url: TASKS_BASE_PATH,
    schema: createTaskSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'task-create');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const task = await store.createTask(asCreateTaskRequest(request.body), actor);
        return respond(reply, 201, { task: toTaskResponse(task) });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${TASKS_BASE_PATH}/:task_id`,
    schema: getTaskSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'task-get');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const task = await store.getTask(getRouteParam(request.params, 'task_id'), createAgentWorkflowReadContext(actor, request));
        if (task === null) throw notFoundRouteError('Unknown task_id.');
        return respond(reply, 200, { task: toTaskResponse(task) });
      }),
  });

  registrar.route({
    method: 'POST',
    url: `${TASKS_BASE_PATH}/:task_id/cancel`,
    schema: cancelTaskSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'task-cancel-request');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const task = await store.cancelTask(
          getRouteParam(request.params, 'task_id'),
          asCancelTaskRequest(request.body),
          actor,
        );
        return respond(reply, 202, {
          task: toTaskResponse(task),
          cancellation_request: task.cancellation_request,
        });
      }),
  });
}

const taskEnvelopeSchema = {
  type: 'object',
  required: ['task'],
  properties: {
    task: taskResponseSchema,
  },
} as const;

const taskCancelEnvelopeSchema = {
  type: 'object',
  required: ['task', 'cancellation_request'],
  properties: {
    task: taskResponseSchema,
    cancellation_request: taskResponseSchema.shape.cancellation_request,
  },
} as const;

export const createTaskSchema = {
  operationId: 'createTask',
  tags: ['control-api', 'tasks'],
  summary: 'Create a non-production workflow task',
  description:
    'Creates a task using only opaque objective/context references. The request must include principal, project, data class, budget, policy, registry, trace, and request correlation fields; raw prompts and secrets are rejected.',
  body: createTaskRequestSchema,
  response: {
    201: taskEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getTaskSchema = {
  operationId: 'getTask',
  tags: ['control-api', 'tasks'],
  summary: 'Get task metadata',
  description: 'Returns sanitized task metadata and opaque refs without raw prompts, provider secrets, or artifact bodies.',
  params: taskParamsSchema,
  response: {
    200: taskEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const cancelTaskSchema = {
  operationId: 'cancelTask',
  tags: ['control-api', 'tasks'],
  summary: 'Record a task cancellation request',
  description:
    'Records the cancellation request only. Runtime workers must observe this request asynchronously; this route does not terminate execution directly.',
  params: taskParamsSchema,
  body: cancelTaskRequestSchema,
  response: {
    202: taskCancelEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;
