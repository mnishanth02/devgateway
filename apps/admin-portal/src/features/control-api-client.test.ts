import { describe, expect, it, vi } from 'vitest';
import {
  CONTROL_API_SNAPSHOT_ENDPOINTS,
  CONTROL_API_TRACK2_TRACE_ENDPOINTS,
  approveApprovalRequest,
  fetchControlApiResult,
  fetchOperationalSnapshot,
  retryWorkflow,
} from './control-api-client.js';

describe('control API client', () => {
  it('returns parsed body for 2xx responses and sends credentials', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ status: 'ok' }));
    const result = await fetchControlApiResult('/healthz', { fetchImpl });

    expect(result).toMatchObject({ ok: true, status: 200, path: '/healthz', body: { status: 'ok' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe('include');
    expect(fetchImpl.mock.calls[0]?.[1]?.cache).toBe('no-store');
  });

  it('maps fail-closed responses to a typed error without a body', async () => {
    const result = await fetchControlApiResult('/api/virtual-keys', {
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'missing_auth', message: 'Authentication required' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.body).toBeNull();
    expect(result.error).toBe('missing_auth: Authentication required');
  });

  it('reports offline status when fetch throws', async () => {
    const result = await fetchControlApiResult('/readyz', {
      fetchImpl: async () => {
        throw new Error('connection refused');
      },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe('connection refused');
  });

  it('posts durable operator actions with JSON, cookies, and no cache', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return Response.json({ accepted: true }, { status: 202 });
    });

    await retryWorkflow(
      'workflow_demo_001',
      {
        request_id: 'admin_retry_001',
        trace_id: 'trace_demo_001',
        policy_version: 'policy-demo-v1',
        registry_version: 'registry-demo-v1',
        idempotency_key: 'retry_workflow_demo_001',
      },
      { fetchImpl },
    );
    await approveApprovalRequest(
      'approval_request_demo_001',
      {
        request_id: 'admin_approval_001',
        trace_id: 'trace_demo_001',
        policy_version: 'policy-demo-v1',
        registry_version: 'registry-demo-v1',
      },
      { fetchImpl },
    );

    expect(calls[0]?.[0]).toBe('/api/workflows/workflow_demo_001/retry');
    expect(calls[1]?.[0]).toBe('/api/approvals/approval_request_demo_001/approve');
    for (const [, init] of calls) {
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      expect(init?.cache).toBe('no-store');
      expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
      expect(typeof init?.body).toBe('string');
    }
    expect(JSON.parse(calls[0]?.[1]?.body as string)).toMatchObject({ idempotency_key: 'retry_workflow_demo_001' });
  });

  it('assembles a snapshot result for every control API endpoint key', async () => {
    const requestedPaths: string[] = [];
    const snapshot = await fetchOperationalSnapshot({
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        requestedPaths.push(url);
        if (url.includes('/api/')) return new Response(null, { status: 401 });
        return Response.json({ ok: true });
      },
    });

    for (const key of Object.keys(CONTROL_API_SNAPSHOT_ENDPOINTS) as Array<keyof typeof CONTROL_API_SNAPSHOT_ENDPOINTS>) {
      expect(snapshot[key]).toBeDefined();
      expect(snapshot[key]?.path).toBe(CONTROL_API_SNAPSHOT_ENDPOINTS[key]);
    }
    expect(snapshot.virtualKeys.status).toBe(401);
    expect(snapshot.registry.ok).toBe(true);
    expect(requestedPaths).toEqual(
      expect.arrayContaining([
        '/api/tasks/task_demo_001',
        '/api/tasks/task_demo_001/artifacts',
        '/api/workflows/workflow_demo_001',
        '/api/workflows/workflow_demo_001/events',
        '/api/agent-runs/agent_run_demo_001',
        '/api/skills',
      ]),
    );
  });

  it('keeps Track 2 trace endpoint keys represented in the operational snapshot', () => {
    const traceKeys = Object.keys(CONTROL_API_TRACK2_TRACE_ENDPOINTS) as Array<keyof typeof CONTROL_API_TRACK2_TRACE_ENDPOINTS>;

    for (const key of traceKeys) {
      expect(CONTROL_API_SNAPSHOT_ENDPOINTS[key]).toBeDefined();
    }
    expect(CONTROL_API_SNAPSHOT_ENDPOINTS.task).toBe('/api/tasks/task_demo_001');
    expect(CONTROL_API_SNAPSHOT_ENDPOINTS.taskArtifacts).toBe('/api/tasks/task_demo_001/artifacts');
    expect(CONTROL_API_SNAPSHOT_ENDPOINTS.workflow).toBe('/api/workflows/workflow_demo_001');
    expect(CONTROL_API_SNAPSHOT_ENDPOINTS.workflowEvents).toBe('/api/workflows/workflow_demo_001/events');
    expect(CONTROL_API_SNAPSHOT_ENDPOINTS.agentRun).toBe('/api/agent-runs/agent_run_demo_001');
    expect(CONTROL_API_SNAPSHOT_ENDPOINTS.skills).toBe('/api/skills');
  });
});
