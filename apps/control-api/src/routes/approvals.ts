import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  approvalListQuerySchema,
  approvalParamsSchema,
  approvalResponseSchema,
  approveApprovalRequestSchema,
  asApprovalListFilter,
  asApproveApprovalRequest,
  asDenyApprovalRequest,
  asExpireApprovalRequest,
  assertAgentWorkflowRouteEnabledOutsideProduction,
  authenticateAgentWorkflowRequest,
  createAgentWorkflowReadContext,
  createInMemoryAgentWorkflowStore,
  defaultAgentWorkflowStore,
  denyApprovalRequestSchema,
  errorResponseSchema,
  expireApprovalRequestSchema,
  getRouteParam,
  handleKnownAgentWorkflowRouteErrors,
  notFoundRouteError,
  respond,
  toApprovalResponse,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const APPROVALS_BASE_PATH = '/api/approvals' as const;

export interface ApprovalRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type ApprovalStore = Pick<AgentWorkflowStore, 'listApprovals' | 'getApproval' | 'approveApproval' | 'denyApproval' | 'expireApproval'>;

export interface ApprovalRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: ApprovalStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export function createInMemoryApprovalStore(options: InMemoryAgentWorkflowStoreOptions = {}): AgentWorkflowStore {
  return createInMemoryAgentWorkflowStore(options);
}

export function registerApprovalRoutes(registrar: ApprovalRouteRegistrar, options: ApprovalRouteOptions = {}): void {
  const store = options.store ?? defaultAgentWorkflowStore;

  registrar.route({
    method: 'GET',
    url: APPROVALS_BASE_PATH,
    schema: listApprovalsSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'approval-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const filter = asApprovalListFilter(request.query);
        const approvals = await store.listApprovals(filter, createAgentWorkflowReadContext(actor, request));
        return respond(reply, 200, { approvals: approvals.map(toApprovalResponse), count: approvals.length });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${APPROVALS_BASE_PATH}/:approval_request_id`,
    schema: getApprovalSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'approval-get');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const approval = await store.getApproval(
          getRouteParam(request.params, 'approval_request_id'),
          createAgentWorkflowReadContext(actor, request),
        );
        if (approval === null) throw notFoundRouteError('Unknown approval_request_id.');
        return respond(reply, 200, { approval: toApprovalResponse(approval) });
      }),
  });

  registrar.route({
    method: 'POST',
    url: `${APPROVALS_BASE_PATH}/:approval_request_id/approve`,
    schema: approveApprovalSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'approval-approve');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const reader = createAgentWorkflowReadContext(actor, request);
        const approval = await store.approveApproval(
          getRouteParam(request.params, 'approval_request_id'),
          asApproveApprovalRequest(request.body),
          actor,
          reader,
        );
        return respond(reply, 200, { approval: toApprovalResponse(approval) });
      }),
  });

  registrar.route({
    method: 'POST',
    url: `${APPROVALS_BASE_PATH}/:approval_request_id/deny`,
    schema: denyApprovalSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'approval-deny');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const reader = createAgentWorkflowReadContext(actor, request);
        const approval = await store.denyApproval(
          getRouteParam(request.params, 'approval_request_id'),
          asDenyApprovalRequest(request.body),
          actor,
          reader,
        );
        return respond(reply, 200, { approval: toApprovalResponse(approval) });
      }),
  });

  registrar.route({
    method: 'POST',
    url: `${APPROVALS_BASE_PATH}/:approval_request_id/expire`,
    schema: expireApprovalSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'approval-expire');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const reader = createAgentWorkflowReadContext(actor, request);
        const approval = await store.expireApproval(
          getRouteParam(request.params, 'approval_request_id'),
          asExpireApprovalRequest(request.body),
          actor,
          reader,
        );
        return respond(reply, 200, { approval: toApprovalResponse(approval) });
      }),
  });
}

const approvalEnvelopeSchema = {
  type: 'object',
  required: ['approval'],
  properties: {
    approval: approvalResponseSchema,
  },
} as const;

const approvalListEnvelopeSchema = {
  type: 'object',
  required: ['approvals', 'count'],
  properties: {
    approvals: {
      type: 'array',
      items: approvalResponseSchema,
    },
    count: { type: 'number' },
  },
} as const;

export const listApprovalsSchema = {
  operationId: 'listApprovals',
  tags: ['control-api', 'approvals'],
  summary: 'List approval requests',
  description:
    'Returns pending (default) or filtered approval requests for the authenticated principal. Metadata and opaque refs only — no raw prompts, artifact bodies, signed URLs, or provider secrets.',
  querystring: approvalListQuerySchema,
  response: {
    200: approvalListEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getApprovalSchema = {
  operationId: 'getApproval',
  tags: ['control-api', 'approvals'],
  summary: 'Get approval request metadata',
  description:
    'Returns sanitized approval request state, decision ref, and opaque refs. Raw action context and artifact bodies are never returned.',
  params: approvalParamsSchema,
  response: {
    200: approvalEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const approveApprovalSchema = {
  operationId: 'approveApproval',
  tags: ['control-api', 'approvals'],
  summary: 'Record a trusted human approval decision',
  description:
    'Records an approval decision by the authenticated principal. Model-supplied approval claims are rejected. Policy version must match the pinned version of the approval request. Terminal state requests are rejected with invalid_state.',
  params: approvalParamsSchema,
  body: approveApprovalRequestSchema,
  response: {
    200: approvalEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const denyApprovalSchema = {
  operationId: 'denyApproval',
  tags: ['control-api', 'approvals'],
  summary: 'Record a trusted human denial decision',
  description:
    'Records a denial decision by the authenticated principal. Policy version must match the pinned version of the approval request. Terminal state requests are rejected with invalid_state.',
  params: approvalParamsSchema,
  body: denyApprovalRequestSchema,
  response: {
    200: approvalEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const expireApprovalSchema = {
  operationId: 'expireApproval',
  tags: ['control-api', 'approvals'],
  summary: 'Expire a pending approval request from an internal system actor',
  description:
    'Internal/system path used by approval-expiry workers. It terminalizes a pending approval as expired and rejects non-expired terminal states with invalid_state.',
  params: approvalParamsSchema,
  body: expireApprovalRequestSchema,
  response: {
    200: approvalEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;
