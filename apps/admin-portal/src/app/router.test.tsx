import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminQueryClient } from './query-client.js';
import { createAdminRouter } from './router.js';
import type { BetterAuthAdminSession } from './auth-session.js';

const sessionFixture: BetterAuthAdminSession = {
  session: {
    id: 'session_1',
    userId: 'user_1',
    expiresAt: '2026-06-21T08:00:00.000Z',
  },
  user: {
    id: 'user_1',
    name: 'Mina Ops',
    email: 'operator@example.test',
    role: 'admin',
  },
};

const registryFixture = {
  registry_version: 'model-aliases.v0.1',
  production_enabled: false,
  snapshot: {
    production_posture: { production_enabled: false, production_route_allowed: false },
    model_aliases: [
      {
        alias: 'claude-fast',
        lifecycle_status: 'approved',
        production_gate: { production_route_allowed: false },
        eval_gate: { latest_gate_status: 'passing' },
        candidates: [
          {
            candidate_id: 'anthropic-claude',
            provider_id: 'anthropic',
            provider_region: 'us-east-1',
            model_id: 'claude-3-5-haiku',
            allowed_data_classes: ['public', 'internal'],
            manual_approval_gate: { status: 'pending' },
          },
        ],
      },
    ],
  },
};

const traceNow = '2026-06-21T08:00:00.000Z';
const traceLater = '2026-06-21T09:00:00.000Z';

const traceSensitiveValues = {
  rawPrompt: 'ROUTER_RAW_PROMPT_SHOULD_NOT_RENDER',
  rawContext: 'ROUTER_RAW_CONTEXT_SHOULD_NOT_RENDER',
  artifactBody: 'ROUTER_ARTIFACT_BODY_SHOULD_NOT_RENDER',
  signedUrl: 'https://signed.example.test/download?token=ROUTER_SIGNED_URL_SHOULD_NOT_RENDER',
  providerKey: 'ROUTER_PROVIDER_KEY_SHOULD_NOT_RENDER',
  token: 'ROUTER_TOKEN_SHOULD_NOT_RENDER',
  secret: 'ROUTER_SECRET_SHOULD_NOT_RENDER',
} as const;

describe('admin portal router and authenticated layout', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the Track 1 panels after a Better Auth admin session resolves', async () => {
    stubControlApi({ session: Response.json(sessionFixture) });
    renderRouter();

    expect(await screen.findByText('Mina Ops')).toBeTruthy();
    expect(screen.getByText('operator@example.test · admin')).toBeTruthy();
    expect(await screen.findByText('Gateway health / readiness')).toBeTruthy();
    expect(await screen.findByText('claude-fast')).toBeTruthy();
    expect(screen.getByText('Registry route posture')).toBeTruthy();
  });

  it('renders the Phase 2.9 trace route after a Better Auth admin session resolves', async () => {
    stubControlApi({ session: Response.json(sessionFixture) });
    renderRouter(['/trace']);

    expect(await screen.findByText('Admin session verified')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Every handoff visible. Payloads stay sealed.' })).toBeTruthy();
    expect(screen.getByText('Task summary')).toBeTruthy();
    expect(screen.getByText('Workflow state')).toBeTruthy();
    expect(screen.getByText('Event timeline rail')).toBeTruthy();
    expect(screen.getByText('Cost pressure')).toBeTruthy();
    expect(screen.getByText('Artifact metadata only')).toBeTruthy();
    expect(screen.getByText('Tool decision lattice')).toBeTruthy();
    expect(screen.getByText('Skill registry')).toBeTruthy();
  });

  it('marks the Trace navigation item as current on the trace route', async () => {
    stubControlApi({ session: Response.json(sessionFixture) });
    renderRouter(['/trace']);

    expect(await screen.findByRole('heading', { name: 'Every handoff visible. Payloads stay sealed.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Trace' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Command' }).getAttribute('aria-current')).toBeNull();
  });

  it('does not render raw trace payload, signed URL, provider key, token, or secret strings', async () => {
    stubControlApi({ session: Response.json(sessionFixture) });
    renderRouter(['/trace']);

    expect(await screen.findByRole('heading', { name: 'Every handoff visible. Payloads stay sealed.' })).toBeTruthy();
    const renderedText = document.body.textContent ?? '';
    for (const value of Object.values(traceSensitiveValues)) {
      expect(renderedText).not.toContain(value);
    }
  });

  it('marks deny tool decisions as danger in the trace route', async () => {
    stubControlApi({ session: Response.json(sessionFixture) });
    renderRouter(['/trace']);

    const denyElements = await screen.findAllByText('deny');
    const denialChips = denyElements.filter((element) => element.className.includes('trace-chip--danger'));
    expect(denialChips.length).toBeGreaterThan(0);
  });

  it('renders the local-dev preview when the Control API reports AUTH_NOT_CONFIGURED', async () => {
    stubControlApi({
      session: new Response(
        JSON.stringify({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    });
    renderRouter();

    expect(await screen.findByText('Local dev — unauthenticated preview')).toBeTruthy();
    expect(await screen.findByText('Local dev — unauthenticated preview')).toBeTruthy();
    expect(await screen.findByText('Gateway health / readiness')).toBeTruthy();
  });
  it('allows the local-dev preview shell to render the trace route when auth is not configured', async () => {
    stubControlApi({
      session: new Response(
        JSON.stringify({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    });
    renderRouter(['/trace']);

    expect(await screen.findByText('Local dev — unauthenticated preview')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Every handoff visible. Payloads stay sealed.' })).toBeTruthy();
  });

  it('fails closed for authenticated non-admin sessions', async () => {
    stubControlApi({ session: Response.json({ ...sessionFixture, user: { ...sessionFixture.user, role: 'member' } }) });
    renderRouter();

    expect(await screen.findByText('No admin session found.')).toBeTruthy();
    expect(screen.queryByText('Registry route posture')).toBeNull();
  });

  it('fails closed when no Better Auth session is present', async () => {
    stubControlApi({ session: new Response(null, { status: 401 }) });
    renderRouter();

    expect(await screen.findByText('No admin session found.')).toBeTruthy();
    expect(screen.getByText('Authentication required')).toBeTruthy();
    expect(screen.queryByText('Registry route posture')).toBeNull();
  });
});

function renderRouter(initialEntries: string[] = ['/']): void {
  const queryClient = createAdminQueryClient();
  const router = createAdminRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function stubControlApi(overrides: { readonly session: Response }): void {
  const traceResponses = createTrack2EndpointResponses();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/get-session')) return overrides.session.clone();
      if (url.includes('/api/tasks/task_demo_001/artifacts')) return Response.json(traceResponses.taskArtifacts);
      if (url.includes('/api/tasks/task_demo_001')) return Response.json(traceResponses.task);
      if (url.includes('/api/workflows/workflow_demo_001/events')) return Response.json(traceResponses.workflowEvents);
      if (url.includes('/api/workflows/workflow_demo_001')) return Response.json(traceResponses.workflow);
      if (url.includes('/api/agent-runs/agent_run_demo_001')) return Response.json(traceResponses.agentRun);
      if (url.includes('/api/skills')) return Response.json(traceResponses.skills);
      if (url.includes('/healthz')) {
        return Response.json({ service: '@devgateway/control-api', status: 'ok', port: 43100 });
      }
      if (url.includes('/readyz')) {
        return Response.json({
          service: '@devgateway/control-api',
          status: 'ready',
          checks: { configuration: 'ok', productionRoutes: 'disabled' },
        });
      }
      if (url.includes('/api/budget-spend')) return Response.json({ spend: [] });
      if (url.includes('/api/cost-events')) return Response.json({ cost_events: [costEvent()] });
      if (url.includes('/registry/current')) return Response.json(registryFixture);
      if (url.includes('/bifrost/config/validation')) {
        return Response.json({ route_config_version: 'bifrost.model-aliases.v0.1.disabled', production_enabled: false, errors: [] });
      }
      if (url.includes('/openapi.json')) {
        return Response.json({ paths: { '/api/tasks/{task_id}': {}, '/api/workflows/{workflow_id}/events': {}, '/api/tool-decisions': {} } });
      }
      if (url.includes('/api/virtual-keys')) {
        return new Response(JSON.stringify({ error: { code: 'missing_auth', message: 'Authentication required' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

function createTrack2EndpointResponses() {
  return {
    task: { task: taskResponse() },
    taskArtifacts: { artifacts: [artifactMetadata()], count: 1 },
    workflow: { workflow: workflowResponse() },
    workflowEvents: { events: [workflowEvent()], next_cursor: null },
    agentRun: { agent_run: agentRunResponse() },
    skills: { skills: [skillResponse()], count: 1 },
  };
}

function traceOpaqueRef(refId: string, refType: string, scopeRef = 'project_demo') {
  return { ref_id: refId, ref_type: refType, scope_ref: scopeRef };
}

function traceArtifactRef() {
  return {
    artifact_id: 'artifact_demo_001',
    artifact_kind: 'tool_result',
    data_class: 'internal',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    size_bytes: 128,
  };
}

function traceAuditRef() {
  return { audit_event_id: 'audit_demo_001', audit_stream: 'workflow', recorded_at: traceNow };
}

function traceCostRef() {
  return { cost_event_id: 'cost_event_demo_001', budget_scope_id: 'budget_scope_demo', cost_phase: 'actual', recorded_at: traceNow };
}

function traceIdempotency(scope: string, dedupeRef: string) {
  return { idempotency_key: `idem_${scope}`, scope, dedupe_ref: dedupeRef, expires_at: traceLater };
}

function traceContext() {
  return { trace_context_id: 'trace_context_demo_001', span_id: 'span_demo_001' };
}

function taskResponse() {
  return {
    contract_version: 'gateway-control.v0.1',
    task_id: 'task_demo_001',
    workflow_id: 'workflow_demo_001',
    workflow_run_id: 'workflow_demo_001',
    status: 'running',
    task_type: 'analysis',
    priority: 'normal',
    principal_id: 'principal_demo',
    project_id: 'project_demo',
    data_class: 'internal',
    budget_scope_id: 'budget_scope_demo',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
    trace_id: 'trace_demo_001',
    request_id: 'request_demo_001',
    objective_ref: traceOpaqueRef('objective_demo_001', 'objective_ref'),
    input_context_refs: [traceOpaqueRef('context_demo_001', 'sanitized_context_ref')],
    artifact_refs: [traceArtifactRef()],
    agent_run_refs: [traceOpaqueRef('agent_run_demo_001', 'agent_run', 'workflow_demo_001')],
    idempotency: traceIdempotency('task', 'task_demo_001'),
    cancellation_request: null,
    created_at: traceNow,
    updated_at: traceNow,
    raw_prompt: traceSensitiveValues.rawPrompt,
    raw_context: traceSensitiveValues.rawContext,
  };
}

function workflowResponse() {
  return {
    contract_version: 'gateway-control.v0.1',
    workflow_id: 'workflow_demo_001',
    workflow_run_id: 'workflow_demo_001',
    task_id: 'task_demo_001',
    workflow_version: 'workflow.nonproduction.v1',
    status: 'running',
    principal_id: 'principal_demo',
    project_id: 'project_demo',
    data_class: 'internal',
    budget_scope_id: 'budget_scope_demo',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
    trace_id: 'trace_demo_001',
    request_id: 'request_demo_001',
    trace_context_ref: traceContext(),
    current_step_ref: {
      step_id: 'step_demo_001',
      step_type: 'agent_run',
      step_status: 'running',
      agent_run_id: 'agent_run_demo_001',
      delegation_id: 'delegation_demo_001',
    },
    allowed_transitions: ['succeeded', 'failed'],
    idempotency_refs: [traceIdempotency('workflow', 'workflow_demo_001')],
    lease_state: {
      lease_id: 'lease_demo_001',
      lease_owner_ref: 'agent_run_demo_001',
      heartbeat_at: traceNow,
      expires_at: traceLater,
      lease_status: 'active',
    },
    resume_ref: traceOpaqueRef('resume_demo_001', 'resume_ref', 'workflow_demo_001'),
    terminal_failure_ref: null,
    artifact_refs: [traceArtifactRef()],
    audit_refs: [traceAuditRef()],
    cost_refs: [traceCostRef()],
    created_at: traceNow,
    updated_at: traceNow,
    raw_context: traceSensitiveValues.rawContext,
    secret: traceSensitiveValues.secret,
  };
}

function workflowEvent() {
  return {
    contract_version: 'gateway-control.v0.1',
    workflow_event_id: 'workflow_event_demo_001',
    workflow_id: 'workflow_demo_001',
    workflow_run_id: 'workflow_demo_001',
    sequence_number: 1,
    event_type: 'tool_call_decided',
    principal_id: 'principal_demo',
    project_id: 'project_demo',
    data_class: 'internal',
    budget_scope_id: 'budget_scope_demo',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
    trace_id: 'trace_demo_001',
    request_id: 'request_demo_001',
    trace_context_ref: traceContext(),
    actor_ref: { actor_type: 'agent', actor_ref: 'agent_run_demo_001', principal_id: 'principal_demo' },
    state_transition: { from_status: 'queued', to_status: 'running' },
    step_ref: traceOpaqueRef('step_demo_001', 'workflow_step', 'workflow_demo_001'),
    agent_run_ref: traceOpaqueRef('agent_run_demo_001', 'agent_run', 'workflow_demo_001'),
    delegation_ref: traceOpaqueRef('delegation_demo_001', 'delegation', 'workflow_demo_001'),
    tool_call_ref: traceOpaqueRef('tool_call_demo_001', 'tool_call', 'agent_run_demo_001'),
    event_metadata_ref: traceOpaqueRef('event_metadata_demo_001', 'event_metadata', 'workflow_demo_001'),
    artifact_refs: [traceArtifactRef()],
    audit_refs: [traceAuditRef()],
    cost_refs: [traceCostRef()],
    idempotency: traceIdempotency('event', 'workflow_event_demo_001'),
    occurred_at: traceNow,
    raw_prompt: traceSensitiveValues.rawPrompt,
    access_token: traceSensitiveValues.token,
  };
}

function agentRunResponse() {
  return {
    contract_version: 'gateway-control.v0.1',
    agent_run_id: 'agent_run_demo_001',
    workflow_id: 'workflow_demo_001',
    workflow_run_id: 'workflow_demo_001',
    task_id: 'task_demo_001',
    delegation_id: 'delegation_demo_001',
    parent_agent_run_id: null,
    agent_definition_ref: { agent_definition_id: 'agent.demo', agent_definition_version: 'v1' },
    role: 'worker',
    status: 'running',
    model_alias: 'claude-fast',
    output_schema_ref: { schema_id: 'schema_demo_001', schema_version: 'v1' },
    timeouts: { heartbeat_timeout_seconds: 30, execution_timeout_seconds: 300 },
    idempotency: traceIdempotency('agent', 'agent_run_demo_001'),
    allowed_tool_refs: [
      { tool_definition_id: 'tool.search', tool_class: 'search', risk_tier: 'low', provider_key: traceSensitiveValues.providerKey },
    ],
    disallowed_tool_refs: [
      { tool_definition_id: 'tool.shell', tool_class: 'shell', risk_tier: 'high', secret: traceSensitiveValues.secret },
    ],
    context_refs: [traceOpaqueRef('context_demo_001', 'sanitized_context_ref')],
    child_agent_run_refs: [traceOpaqueRef('agent_run_child_001', 'agent_run', 'workflow_demo_001')],
    artifact_refs: [traceArtifactRef()],
    audit_refs: [traceAuditRef()],
    cost_refs: [traceCostRef()],
    lease_ref: {
      lease_id: 'lease_demo_001',
      lease_owner_ref: 'agent_run_demo_001',
      heartbeat_at: traceNow,
      expires_at: traceLater,
      lease_status: 'active',
    },
    principal_id: 'principal_demo',
    project_id: 'project_demo',
    data_class: 'internal',
    budget_scope_id: 'budget_scope_demo',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
    trace_id: 'trace_demo_001',
    request_id: 'request_demo_001',
    trace_context_ref: traceContext(),
    started_at: traceNow,
    completed_at: null,
    created_at: traceNow,
    updated_at: traceNow,
    provider_key: traceSensitiveValues.providerKey,
    access_token: traceSensitiveValues.token,
  };
}

function artifactMetadata() {
  return {
    contract_version: 'gateway-control.v0.1',
    artifact_id: 'artifact_demo_001',
    artifact_kind: 'tool_result',
    workflow_id: 'workflow_demo_001',
    workflow_run_id: 'workflow_demo_001',
    task_id: 'task_demo_001',
    delegation_id: 'delegation_demo_001',
    agent_run_id: 'agent_run_demo_001',
    tool_call_id: 'tool_call_demo_001',
    principal_id: 'principal_demo',
    project_id: 'project_demo',
    data_class: 'internal',
    budget_scope_id: 'budget_scope_demo',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
    trace_id: 'trace_demo_001',
    request_id: 'request_demo_001',
    owner_ref: { owner_type: 'project', owner_id: 'project_demo' },
    storage_ref: { storage_system: 'object-store', container_ref: 'artifact-metadata' },
    media_type: 'application/json',
    size_bytes: 128,
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sensitivity_label: 'internal',
    source_ref: { source_type: 'tool', source_id: 'tool_call_demo_001' },
    retention_policy: { retained_until: traceLater, delete_after_seconds: 3600, legal_hold: false },
    signed_download_eligible: false,
    signed_access_expires_at: null,
    acl_scope: { principals: ['principal_demo'], projects: ['project_demo'] },
    related_artifact_refs: [traceArtifactRef()],
    audit_refs: [traceAuditRef()],
    cost_refs: [traceCostRef()],
    idempotency: traceIdempotency('artifact', 'artifact_demo_001'),
    created_at: traceNow,
    updated_at: traceNow,
    artifact_body: traceSensitiveValues.artifactBody,
    signed_url: traceSensitiveValues.signedUrl,
  };
}

function costEvent() {
  return {
    cost_event_id: 'cost_event_demo_001',
    event_type: 'model_invocation',
    trace_id: 'trace_demo_001',
    request_id: 'request_demo_001',
    aggregation_targets: {
      workflow_run_id: 'workflow_demo_001',
      delegation_id: 'delegation_demo_001',
      tool_class: 'tool.shell',
    },
    route_intent: 'nonproduction',
    budget_scope_id: 'budget_scope_demo',
    model_alias: 'cost-model-demo',
    provider_id: 'anthropic',
    attempt_status: 'denied',
    decision: 'deny',
    actual: { cost_amount: 0, input_tokens: 0, output_tokens: 0 },
    estimated: { cost_amount: 1.5, input_tokens: 120, output_tokens: 30 },
    currency: 'USD',
    denial_reason: 'policy_budget_denied',
    occurred_at: traceNow,
    recorded_at: traceNow,
    provider_key: traceSensitiveValues.providerKey,
  };
}

function skillResponse() {
  return {
    contract_version: 'gateway-control.v0.1',
    skill_definition_id: 'skill_demo_001',
    skill_version_id: 'v1',
    status: 'approved',
    owner_ref: { owner_type: 'project', owner_id: 'project_demo' },
    allowed_model_aliases: ['claude-fast'],
    allowed_tool_refs: [
      { tool_definition_id: 'tool.search', tool_class: 'search', risk_tier: 'low', provider_key: traceSensitiveValues.providerKey },
    ],
    disallowed_tool_refs: [
      { tool_definition_id: 'tool.shell', tool_class: 'shell', risk_tier: 'high', token: traceSensitiveValues.token },
    ],
    instruction_template_refs: [traceOpaqueRef('instruction_template_demo_001', 'instruction_template', 'skill_demo_001')],
    input_schema_ref: { schema_id: 'skill-input', schema_version: 'v1' },
    output_schema_ref: { schema_id: 'skill-output', schema_version: 'v1' },
    approval_policy: { approval_required: false },
    eval_suite_refs: [],
    rollout_policy: { rollout_state: 'development', production_enabled: false },
    gate_result_refs: [],
    artifact_refs: [traceArtifactRef()],
    audit_refs: [traceAuditRef()],
    cost_refs: [traceCostRef()],
    idempotency: traceIdempotency('skill', 'skill_demo_001'),
    principal_id: 'principal_demo',
    project_id: 'project_demo',
    data_class: 'internal',
    budget_scope_id: 'budget_scope_demo',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
    trace_id: 'trace_demo_001',
    request_id: 'request_demo_001',
    trace_context_ref: traceContext(),
    created_at: traceNow,
    updated_at: traceNow,
    raw_prompt: traceSensitiveValues.rawPrompt,
    secret: traceSensitiveValues.secret,
  };
}
