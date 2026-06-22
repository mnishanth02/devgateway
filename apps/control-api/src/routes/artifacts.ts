import type { EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';
import { createHmac, randomBytes } from 'node:crypto';

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
  type ArtifactSignedAccessDecisionResult,
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
  readonly signedAccessTtlSeconds?: number | undefined;
  readonly issueSignedAccess?: (input: ArtifactSignedAccessIssueInput) => ArtifactSignedAccessGrant | Promise<ArtifactSignedAccessGrant>;
  readonly signedAccessSecret?: string | Uint8Array | undefined;
}

export interface ArtifactSignedAccessIssueInput {
  readonly artifactId: string;
  readonly actor: ControlRouteAuthContext;
  readonly ttlSeconds: number;
  readonly sha256: string;
  readonly policyVersion: string;
  readonly registryVersion: string;
  readonly secret?: string | Uint8Array | undefined;
}

export interface ArtifactSignedAccessGrant {
  readonly signed_url: string;
  readonly expires_at: string;
  readonly ttl_seconds: number;
  readonly sha256: string;
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
        return respond(reply, 200, { decision: await issueSignedAccessIfEligible(decision, body, actor, options) });
      }),
  });
}

async function issueSignedAccessIfEligible(
  decision: ArtifactSignedAccessDecisionResult,
  body: ReturnType<typeof asArtifactSignedAccessRequest>,
  actor: ControlRouteAuthContext,
  options: ArtifactRouteOptions,
): Promise<ArtifactSignedAccessDecisionResult> {
  if (decision.decision !== 'eligible' || !decision.eligible || decision.requires_approval) return decision;

  const routeDefaultTtlSeconds = normalizeTtl(options.signedAccessTtlSeconds ?? 300);
  const requestedTtlSeconds = normalizeTtl(body.requested_duration_seconds ?? routeDefaultTtlSeconds);
  const policyTtlSeconds = normalizeTtl(decision.max_signed_duration_seconds ?? routeDefaultTtlSeconds);
  const ttlSeconds = Math.min(routeDefaultTtlSeconds, requestedTtlSeconds, policyTtlSeconds, 900);
  const issuer = options.issueSignedAccess ?? defaultSignedAccessIssuer;
  const signedAccess = await issuer({
    artifactId: decision.artifact_id,
    actor,
    ttlSeconds,
    sha256: decision.sha256,
    policyVersion: body.policy_version,
    registryVersion: body.registry_version,
    secret: options.signedAccessSecret,
  });
  return { ...decision, signed_access: signedAccess };
}

function normalizeTtl(value: number): number {
  if (!Number.isInteger(value) || value <= 0) return 300;
  return Math.min(value, 900);
}

function defaultSignedAccessIssuer(input: ArtifactSignedAccessIssueInput): ArtifactSignedAccessGrant {
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
  const url = new URL(`https://control-api.local/artifacts/${encodeURIComponent(input.artifactId)}/object`);
  url.searchParams.set('expires_at', expiresAt);
  url.searchParams.set('principal_id', input.actor.principalId);
  url.searchParams.set('policy_version', input.policyVersion);
  url.searchParams.set('registry_version', input.registryVersion);
  url.searchParams.set('signature', signArtifactAccessGrant(input, expiresAt));
  return {
    signed_url: url.toString(),
    expires_at: expiresAt,
    ttl_seconds: input.ttlSeconds,
    sha256: input.sha256,
  };
}

const processLocalSignedAccessSecret = randomBytes(32);

function signArtifactAccessGrant(input: ArtifactSignedAccessIssueInput, expiresAt: string): string {
  const material = JSON.stringify({
    artifact_id: input.artifactId,
    expires_at: expiresAt,
    principal_id: input.actor.principalId,
    auth_subject_ref: input.actor.authSubjectRef,
    ttl_seconds: input.ttlSeconds,
    sha256: input.sha256,
    policy_version: input.policyVersion,
    registry_version: input.registryVersion,
  });
  const secret = input.secret ?? process.env.DEVGATEWAY_ARTIFACT_SIGNING_SECRET ?? process.env.CONTROL_API_ARTIFACT_SIGNING_SECRET;
  const key = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : (secret ?? processLocalSignedAccessSecret);
  if (key.length === 0) {
    throw new Error('artifact signed-access signing secret must be non-empty');
  }
  return createHmac('sha256', key).update(material).digest('base64url');
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
