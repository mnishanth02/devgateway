import type { ControlApiFetchResult, OperationalControlApiSnapshot } from './operational-views.ts';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const CONTROL_API_SNAPSHOT_ENDPOINTS = {
  health: '/healthz',
  readiness: '/readyz',
  registry: '/registry/current',
  bifrostValidation: '/bifrost/config/validation',
  virtualKeys: '/api/virtual-keys',
  budgetSpend: '/api/budget-spend',
  costEvents: '/api/cost-events',
  openapi: '/openapi.json',
  task: '/api/tasks/task_demo_001',
  taskArtifacts: '/api/tasks/task_demo_001/artifacts',
  workflow: '/api/workflows/workflow_demo_001',
  workflowEvents: '/api/workflows/workflow_demo_001/events',
  agentRun: '/api/agent-runs/agent_run_demo_001',
  skills: '/api/skills',
  approvals: '/api/approvals?state=pending',
  manualReviews: '/api/workflows/workflow_demo_001/manual-review',
  workflowLeaseStatus: '/api/workflows/workflow_demo_001/leases',
  workflowOutboxStatus: '/api/workflows/workflow_demo_001/outbox/status',
  outboxStatus: '/api/outbox/status?workflow_id=workflow_demo_001',
  artifactLifecycle: '/api/artifacts/artifact_demo_001/lifecycle',
  artifactLifecycleStatus: '/api/artifacts/artifact_demo_001/lifecycle/status',
} as const;

export type ControlApiSnapshotKey = keyof typeof CONTROL_API_SNAPSHOT_ENDPOINTS;

export const CONTROL_API_TRACK2_TRACE_ENDPOINTS = {
  task: '/api/tasks/:task_id',
  taskArtifacts: '/api/tasks/:task_id/artifacts',
  workflow: '/api/workflows/:workflow_id',
  workflowEvents: '/api/workflows/:workflow_id/events',
  agentRun: '/api/agent-runs/:agent_run_id',
  skills: '/api/skills',
} as const;

export type ControlApiTrack2TraceEndpointKey = keyof typeof CONTROL_API_TRACK2_TRACE_ENDPOINTS;

export interface FetchControlApiOptions {
  readonly signal?: AbortSignal;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
}

export type ControlApiMutationBody = Readonly<Record<string, unknown>>;

export async function fetchControlApiResult(
  path: string,
  options: FetchControlApiOptions = {},
): Promise<ControlApiFetchResult<unknown>> {
  return requestControlApiResult(path, { ...options, method: 'GET' });
}

export async function postControlApiResult(
  path: string,
  body: ControlApiMutationBody,
  options: FetchControlApiOptions = {},
): Promise<ControlApiFetchResult<unknown>> {
  return requestControlApiResult(path, { ...options, method: 'POST', body });
}

export async function fetchApprovalQueue(options: FetchControlApiOptions = {}) {
  return fetchControlApiResult('/api/approvals?state=pending', options);
}

export async function approveApprovalRequest(
  approvalRequestId: string,
  body: ControlApiMutationBody,
  options: FetchControlApiOptions = {},
) {
  return postControlApiResult(`/api/approvals/${encodeURIComponent(approvalRequestId)}/approve`, body, options);
}

export async function denyApprovalRequest(
  approvalRequestId: string,
  body: ControlApiMutationBody,
  options: FetchControlApiOptions = {},
) {
  return postControlApiResult(`/api/approvals/${encodeURIComponent(approvalRequestId)}/deny`, body, options);
}

export async function retryWorkflow(
  workflowId: string,
  body: ControlApiMutationBody,
  options: FetchControlApiOptions = {},
) {
  return postControlApiResult(`/api/workflows/${encodeURIComponent(workflowId)}/retry`, body, options);
}

export async function cancelTask(taskId: string, body: ControlApiMutationBody, options: FetchControlApiOptions = {}) {
  return postControlApiResult(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, body, options);
}

export async function fetchManualReviews(workflowId: string, options: FetchControlApiOptions = {}) {
  return fetchControlApiResult(`/api/workflows/${encodeURIComponent(workflowId)}/manual-review`, options);
}

export async function resolveManualReview(
  workflowId: string,
  manualReviewItemId: string,
  body: ControlApiMutationBody,
  options: FetchControlApiOptions = {},
) {
  return postControlApiResult(
    `/api/workflows/${encodeURIComponent(workflowId)}/manual-review/${encodeURIComponent(manualReviewItemId)}/resolve`,
    body,
    options,
  );
}

export async function fetchWorkflowLeaseStatus(workflowId: string, options: FetchControlApiOptions = {}) {
  return fetchControlApiResult(`/api/workflows/${encodeURIComponent(workflowId)}/leases`, options);
}

export async function fetchWorkflowOutboxStatus(workflowId: string, options: FetchControlApiOptions = {}) {
  return fetchControlApiResult(`/api/workflows/${encodeURIComponent(workflowId)}/outbox/status`, options);
}

export async function fetchOutboxStatus(workflowId: string, options: FetchControlApiOptions = {}) {
  return fetchControlApiResult(`/api/outbox/status?workflow_id=${encodeURIComponent(workflowId)}`, options);
}

export async function fetchArtifactLifecycle(artifactId: string, options: FetchControlApiOptions = {}) {
  return fetchControlApiResult(`/api/artifacts/${encodeURIComponent(artifactId)}/lifecycle`, options);
}

export async function fetchArtifactLifecycleStatus(artifactId: string, options: FetchControlApiOptions = {}) {
  return fetchControlApiResult(`/api/artifacts/${encodeURIComponent(artifactId)}/lifecycle/status`, options);
}

export async function requestArtifactSignedAccess(
  artifactId: string,
  body: ControlApiMutationBody,
  options: FetchControlApiOptions = {},
) {
  return postControlApiResult(`/api/artifacts/${encodeURIComponent(artifactId)}/signed-access`, body, options);
}

async function requestControlApiResult(
  path: string,
  options: FetchControlApiOptions & {
    readonly method: 'GET' | 'POST';
    readonly body?: ControlApiMutationBody;
  },
): Promise<ControlApiFetchResult<unknown>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    throw new Error('fetch is required to read Control API state');
  }

  const init: RequestInit = {
    method: options.method,
    credentials: 'include',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { ...init.headers, 'content-type': 'application/json' };
  }
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  try {
    const response = await fetchImpl(`${options.baseUrl ?? ''}${path}`, init);
    const body = await readJsonSafe(response);
    if (response.ok) {
      return { ok: true, status: response.status, path, body };
    }
    return { ok: false, status: response.status, path, body: null, error: extractError(body, response.status) };
  } catch (cause) {
    return { ok: false, status: 0, path, body: null, error: cause instanceof Error ? cause.message : 'request failed' };
  }
}

export async function fetchOperationalSnapshot(
  options: FetchControlApiOptions = {},
): Promise<OperationalControlApiSnapshot> {
  const entries = Object.entries(CONTROL_API_SNAPSHOT_ENDPOINTS) as ReadonlyArray<[ControlApiSnapshotKey, string]>;
  const results = await Promise.all(
    entries.map(async ([key, path]) => [key, await fetchControlApiResult(path, options)] as const),
  );
  return Object.fromEntries(results) as unknown as OperationalControlApiSnapshot;
}

async function readJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractError(body: unknown, status: number): string {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (error !== null && typeof error === 'object') {
      const code = (error as { code?: unknown }).code;
      const message = (error as { message?: unknown }).message;
      const parts = [code, message].filter((value): value is string => typeof value === 'string');
      if (parts.length > 0) return parts.join(': ');
    }
  }
  return `HTTP ${status}`;
}
