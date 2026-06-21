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

export async function fetchControlApiResult(
  path: string,
  options: FetchControlApiOptions = {},
): Promise<ControlApiFetchResult<unknown>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    throw new Error('fetch is required to read Control API state');
  }

  const init: RequestInit = {
    credentials: 'include',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  };
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
