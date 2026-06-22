import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  asResolveManualReviewRequest,
  asRetryWorkflowRequest,
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
  outboxStatusResponseSchema,
  resolveManualReviewRequestSchema,
  respond,
  retryWorkflowRequestSchema,
  manualReviewResponseSchema,
  toManualReviewResponse,
  toWorkflowResponse,
  toWorkflowLeaseStatusResponse,
  toWorkflowRetryResponse,
  toWorkflowEventResponse,
  workflowLeaseStatusResponseSchema,
  workflowEventQuerySchema,
  workflowEventResponseSchema,
  workflowParamsSchema,
  workflowRetryResponseSchema,
  workflowResponseSchema,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const WORKFLOWS_BASE_PATH = '/api/workflows' as const;

export interface WorkflowRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type WorkflowStore = Pick<
  AgentWorkflowStore,
  | 'getWorkflow'
  | 'retryWorkflow'
  | 'listWorkflowEvents'
  | 'listManualReviews'
  | 'resolveManualReview'
  | 'getWorkflowLeaseStatus'
  | 'outboxStatus'
>;

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
    method: 'POST',
    url: `${WORKFLOWS_BASE_PATH}/:workflow_id/retry`,
    schema: retryWorkflowSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-retry');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const retry = await store.retryWorkflow(
          getRouteParam(request.params, 'workflow_id'),
          asRetryWorkflowRequest(request.body),
          actor,
          createAgentWorkflowReadContext(actor, request),
        );
        return respond(reply, 202, { retry: toWorkflowRetryResponse(retry) });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${WORKFLOWS_BASE_PATH}/:workflow_id/manual-review`,
    schema: listManualReviewsSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-manual-review-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const manualReviews = await store.listManualReviews(
          getRouteParam(request.params, 'workflow_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (manualReviews === null) throw notFoundRouteError('Unknown workflow_id.');
        return respond(reply, 200, { manual_reviews: manualReviews.map(toManualReviewResponse), count: manualReviews.length });
      }),
  });

  registrar.route({
    method: 'POST',
    url: `${WORKFLOWS_BASE_PATH}/:workflow_id/manual-review/:manual_review_item_id/resolve`,
    schema: resolveManualReviewSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-manual-review-resolve');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const manualReview = await store.resolveManualReview(
          getRouteParam(request.params, 'workflow_id'),
          getRouteParam(request.params, 'manual_review_item_id'),
          asResolveManualReviewRequest(request.body),
          actor,
          createAgentWorkflowReadContext(actor, request),
        );
        return respond(reply, 200, { manual_review: toManualReviewResponse(manualReview) });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${WORKFLOWS_BASE_PATH}/:workflow_id/leases`,
    schema: getWorkflowLeasesSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-lease-status');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const leases = await store.getWorkflowLeaseStatus(
          getRouteParam(request.params, 'workflow_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (leases === null) throw notFoundRouteError('Unknown workflow_id.');
        return respond(reply, 200, { leases: toWorkflowLeaseStatusResponse(leases) });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${WORKFLOWS_BASE_PATH}/:workflow_id/outbox/status`,
    schema: getWorkflowOutboxStatusSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-outbox-status');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const workflowId = getRouteParam(request.params, 'workflow_id');
        const workflow = await store.getWorkflow(workflowId, createAgentWorkflowReadContext(actor, request));
        if (workflow === null) throw notFoundRouteError('Unknown workflow_id.');
        const status = await store.outboxStatus({ workflow_id: workflowId }, createAgentWorkflowReadContext(actor, request));
        return respond(reply, 200, { status });
      }),
  });

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

const workflowRetryEnvelopeSchema = {
  type: 'object',
  required: ['retry'],
  properties: {
    retry: workflowRetryResponseSchema,
  },
} as const;

const manualReviewEnvelopeSchema = {
  type: 'object',
  required: ['manual_review'],
  properties: {
    manual_review: manualReviewResponseSchema,
  },
} as const;

const manualReviewListEnvelopeSchema = {
  type: 'object',
  required: ['manual_reviews', 'count'],
  properties: {
    manual_reviews: {
      type: 'array',
      items: manualReviewResponseSchema,
    },
    count: { type: 'number' },
  },
} as const;

const workflowLeaseStatusEnvelopeSchema = {
  type: 'object',
  required: ['leases'],
  properties: {
    leases: workflowLeaseStatusResponseSchema,
  },
} as const;

const workflowOutboxStatusEnvelopeSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: outboxStatusResponseSchema,
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

export const retryWorkflowSchema = {
  operationId: 'retryWorkflow',
  tags: ['control-api', 'workflows'],
  summary: 'Schedule a workflow retry',
  description:
    'Schedules a retry for a failed or paused workflow using pinned policy and registry versions, trusted workflow_operator role authorization, idempotency, and audit metadata. Raw prompts, artifact bodies, signed URLs, and secrets are never accepted or returned.',
  params: workflowParamsSchema,
  body: retryWorkflowRequestSchema,
  response: {
    202: workflowRetryEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const listManualReviewsSchema = {
  operationId: 'listWorkflowManualReviews',
  tags: ['control-api', 'workflows', 'manual-review'],
  summary: 'List workflow manual review items',
  description:
    'Returns manual-review metadata backed by manual_review_item. Reason text is represented by opaque refs; no raw prompt, artifact body, signed URL, token, or provider secret is returned.',
  params: workflowParamsSchema,
  response: {
    200: manualReviewListEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

const manualReviewResolveParamsSchema = {
  type: 'object',
  required: ['workflow_id', 'manual_review_item_id'],
  properties: {
    workflow_id: { type: 'string', minLength: 1 },
    manual_review_item_id: { type: 'string', minLength: 1 },
  },
} as const;

export const resolveManualReviewSchema = {
  operationId: 'resolveWorkflowManualReview',
  tags: ['control-api', 'workflows', 'manual-review'],
  summary: 'Resolve a workflow manual review item',
  description:
    'Records a trusted reviewer resolution for a manual_review_item using policy/registry pins, idempotency, role checks, and audit metadata. Resolution content is an opaque ref only.',
  params: manualReviewResolveParamsSchema,
  body: resolveManualReviewRequestSchema,
  response: {
    200: manualReviewEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getWorkflowLeasesSchema = {
  operationId: 'getWorkflowLeases',
  tags: ['control-api', 'workflows', 'leases'],
  summary: 'Get workflow lease and stuck-work status',
  description:
    'Returns metadata-only workflow and agent-run lease status, including active/expired/stuck counts. Lease tokens, raw worker metadata, prompts, signed URLs, and secrets are never returned.',
  params: workflowParamsSchema,
  response: {
    200: workflowLeaseStatusEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getWorkflowOutboxStatusSchema = {
  operationId: 'getWorkflowOutboxStatus',
  tags: ['control-api', 'workflows', 'outbox'],
  summary: 'Get workflow outbox backlog status',
  description:
    'Returns metadata-only outbox backlog and dead-letter counts for a workflow. Payload bodies, signed URLs, tokens, and provider secrets are never returned.',
  params: workflowParamsSchema,
  response: {
    200: workflowOutboxStatusEnvelopeSchema,
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
