import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import {
  asWorkflowTemplateListFilter,
  asWorkflowTemplateVersionListFilter,
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
  templateListQuerySchema,
  templateParamsSchema,
  templateResponseSchema,
  templateVersionListQuerySchema,
  templateVersionParamsSchema,
  templateVersionResponseSchema,
  toWorkflowTemplateResponse,
  toWorkflowTemplateVersionResponse,
  type AgentWorkflowStore,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const WORKFLOW_TEMPLATES_BASE_PATH = '/api/workflow-templates' as const;
export const WORKFLOW_TEMPLATE_VERSIONS_BASE_PATH = '/api/workflow-template-versions' as const;

export interface TemplateRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type TemplateStore = Pick<
  AgentWorkflowStore,
  | 'listWorkflowTemplates'
  | 'getWorkflowTemplate'
  | 'listWorkflowTemplateVersions'
  | 'getWorkflowTemplateVersion'
>;

export interface TemplateRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: TemplateStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export function createInMemoryTemplateStore(options: InMemoryAgentWorkflowStoreOptions = {}): AgentWorkflowStore {
  return createInMemoryAgentWorkflowStore(options);
}

export function registerTemplateRoutes(registrar: TemplateRouteRegistrar, options: TemplateRouteOptions = {}): void {
  const store = options.store ?? defaultAgentWorkflowStore;

  // GET /api/workflow-templates
  registrar.route({
    method: 'GET',
    url: WORKFLOW_TEMPLATES_BASE_PATH,
    schema: listWorkflowTemplatesSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-template-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const reader = createAgentWorkflowReadContext(actor, request);
        const filter = asWorkflowTemplateListFilter(request.query);
        const templates = await store.listWorkflowTemplates(filter, reader);
        return respond(reply, 200, {
          templates: templates.map(toWorkflowTemplateResponse),
          count: templates.length,
        });
      }),
  });

  // GET /api/workflow-templates/:template_id
  registrar.route({
    method: 'GET',
    url: `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id`,
    schema: getWorkflowTemplateSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-template-get');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const reader = createAgentWorkflowReadContext(actor, request);
        const template = await store.getWorkflowTemplate(
          getRouteParam(request.params, 'template_id'),
          reader,
        );
        if (template === null) throw notFoundRouteError('Unknown template_id.');
        return respond(reply, 200, { template: toWorkflowTemplateResponse(template) });
      }),
  });

  // GET /api/workflow-templates/:template_id/versions
  registrar.route({
    method: 'GET',
    url: `${WORKFLOW_TEMPLATES_BASE_PATH}/:template_id/versions`,
    schema: listWorkflowTemplateVersionsSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-template-versions-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const reader = createAgentWorkflowReadContext(actor, request);
        const filter = asWorkflowTemplateVersionListFilter(request.query);
        const versions = await store.listWorkflowTemplateVersions(
          getRouteParam(request.params, 'template_id'),
          filter,
          reader,
        );
        if (versions === null) throw notFoundRouteError('Unknown template_id.');
        return respond(reply, 200, {
          versions: versions.map(toWorkflowTemplateVersionResponse),
          count: versions.length,
        });
      }),
  });

  // GET /api/workflow-template-versions/:template_version_id
  registrar.route({
    method: 'GET',
    url: `${WORKFLOW_TEMPLATE_VERSIONS_BASE_PATH}/:template_version_id`,
    schema: getWorkflowTemplateVersionSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'workflow-template-version-get');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const reader = createAgentWorkflowReadContext(actor, request);
        const version = await store.getWorkflowTemplateVersion(
          getRouteParam(request.params, 'template_version_id'),
          reader,
        );
        if (version === null) throw notFoundRouteError('Unknown template_version_id.');
        return respond(reply, 200, { version: toWorkflowTemplateVersionResponse(version) });
      }),
  });
}

// ---------------------------------------------------------------------------
// OpenAPI schemas
// ---------------------------------------------------------------------------

const templateEnvelopeSchema = {
  type: 'object',
  required: ['template'],
  properties: {
    template: templateResponseSchema,
  },
} as const;

const templateListEnvelopeSchema = {
  type: 'object',
  required: ['templates', 'count'],
  properties: {
    templates: {
      type: 'array',
      items: templateResponseSchema,
    },
    count: { type: 'number' },
  },
} as const;

const templateVersionEnvelopeSchema = {
  type: 'object',
  required: ['version'],
  properties: {
    version: templateVersionResponseSchema,
  },
} as const;

const templateVersionListEnvelopeSchema = {
  type: 'object',
  required: ['versions', 'count'],
  properties: {
    versions: {
      type: 'array',
      items: templateVersionResponseSchema,
    },
    count: { type: 'number' },
  },
} as const;

export const listWorkflowTemplatesSchema = {
  operationId: 'listWorkflowTemplates',
  tags: ['control-api', 'workflow-templates'],
  summary: 'List workflow templates',
  description:
    'Returns workflow template metadata for the authenticated principal. Metadata and opaque refs only — no raw step graphs, tool bodies, model weights, prompts, or provider secrets.',
  querystring: templateListQuerySchema,
  response: {
    200: templateListEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getWorkflowTemplateSchema = {
  operationId: 'getWorkflowTemplate',
  tags: ['control-api', 'workflow-templates'],
  summary: 'Get workflow template metadata',
  description:
    'Returns sanitized workflow template state and opaque refs. Raw step graphs, tool configurations, prompts, and artifact bodies are never returned.',
  params: templateParamsSchema,
  response: {
    200: templateEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const listWorkflowTemplateVersionsSchema = {
  operationId: 'listWorkflowTemplateVersions',
  tags: ['control-api', 'workflow-templates'],
  summary: 'List workflow template versions',
  description:
    'Returns immutable version metadata for a workflow template. Allowed model aliases, tool bundle IDs, and approval policy refs are opaque identifiers — no raw tool bodies or model weights.',
  params: templateParamsSchema,
  querystring: templateVersionListQuerySchema,
  response: {
    200: templateVersionListEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

export const getWorkflowTemplateVersionSchema = {
  operationId: 'getWorkflowTemplateVersion',
  tags: ['control-api', 'workflow-templates'],
  summary: 'Get workflow template version metadata',
  description:
    'Returns immutable metadata for a single workflow template version. Allowed refs and aliases are opaque — raw step graphs, tool bodies, and prompts are never returned.',
  params: templateVersionParamsSchema,
  response: {
    200: templateVersionEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;
