import { describe, expect, it } from 'vitest';
import {
  buildOperationalViewModel,
  sanitizeForDisplay,
  type ControlApiFetchResult,
  type OperationalControlApiSnapshot,
} from './operational-views.js';

const now = '2026-06-21T08:00:00.000Z';
const later = '2026-06-21T09:00:00.000Z';

const sensitiveValues = {
  rawPrompt: 'RAW_PROMPT_SHOULD_NOT_RENDER',
  rawContext: 'RAW_CONTEXT_SHOULD_NOT_RENDER',
  artifactBody: 'ARTIFACT_BODY_SHOULD_NOT_RENDER',
  signedUrl: 'https://signed.example.test/download?secret=SIGNED_URL_SHOULD_NOT_RENDER',
  providerKey: 'PROVIDER_KEY_SHOULD_NOT_RENDER',
  token: 'TOKEN_SHOULD_NOT_RENDER',
  secret: 'SECRET_SHOULD_NOT_RENDER',
} as const;

describe('operational task trace view model', () => {
  it('keeps taskTrace metadata-only and strips secret-bearing fields during display sanitization', () => {
    const model = buildOperationalViewModel(createSnapshot(), {
      generatedAt: now,
      controlApiBaseUrl: 'http://127.0.0.1:43101',
    });

    expect(model.taskTrace.status).toBe('ready');
    expect(model.taskTrace.task.id).toBe('task_demo_001');
    expect(model.taskTrace.workflow.workflowId).toBe('workflow_demo_001');
    expect(model.taskTrace.artifacts.metadata[0]?.id).toBe('artifact_demo_001');
    expect(model.taskTrace.skills[0]?.id).toBe('skill_demo_001');

    const traceText = JSON.stringify(model.taskTrace);
    for (const value of Object.values(sensitiveValues)) {
      expect(traceText).not.toContain(value);
    }
    for (const rawField of ['raw_prompt', 'raw_context', 'artifact_body', 'signed_url', 'provider_key', 'token', 'secret']) {
      expect(traceText).not.toContain(`"${rawField}"`);
    }

    const sanitizedTaskTrace = sanitizeForDisplay({
      ...model.taskTrace,
      raw_prompt: sensitiveValues.rawPrompt,
      raw_context: sensitiveValues.rawContext,
      artifact_body: sensitiveValues.artifactBody,
      signed_url: sensitiveValues.signedUrl,
      provider_key: sensitiveValues.providerKey,
      access_token: sensitiveValues.token,
      secret: sensitiveValues.secret,
      safe_marker: 'safe metadata stays visible',
    });
    const sanitizedText = JSON.stringify(sanitizedTaskTrace);

    expect(sanitizedText).toContain('safe metadata stays visible');
    for (const value of Object.values(sensitiveValues)) {
      expect(sanitizedText).not.toContain(value);
    }
  });

  it('produces fail-closed issue states when Track 2 trace endpoints fail', () => {
    const snapshot = createSnapshot({
      task: failed('/api/tasks/task_demo_001', 503, 'trace store unavailable'),
      taskArtifacts: failed('/api/tasks/task_demo_001/artifacts', 401, 'missing_auth: Authentication required'),
      workflow: failed('/api/workflows/workflow_demo_001', 404, 'not_found: workflow missing'),
      workflowEvents: failed('/api/workflows/workflow_demo_001/events', 0, 'connection refused'),
      agentRun: failed('/api/agent-runs/agent_run_demo_001', 500, 'HTTP 500'),
      skills: failed('/api/skills', 403, 'production disabled'),
    });
    const model = buildOperationalViewModel(snapshot, {
      generatedAt: now,
      controlApiBaseUrl: 'http://127.0.0.1:43101',
    });

    expect(model.taskTrace.status).toBe('error');
    expect(model.taskTrace.actionPolicy.allowed).toBe(false);
    expect(model.taskTrace.actionPolicy.reason).toContain('failed closed');
    expect(model.taskTrace.issues.map((issue) => issue.key)).toEqual([
      'task',
      'taskArtifacts',
      'workflow',
      'workflowEvents',
      'agentRun',
      'skills',
    ]);
    expect(model.taskTrace.issues.every((issue) => issue.state === 'error')).toBe(true);
    expect(model.taskTrace.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'task', path: '/api/tasks/task_demo_001', status: 503, message: 'trace store unavailable' }),
        expect.objectContaining({ key: 'taskArtifacts', status: 401, message: 'missing_auth: Authentication required' }),
        expect.objectContaining({ key: 'workflowEvents', status: 0, message: 'connection refused' }),
        expect.objectContaining({ key: 'skills', status: 403, message: 'production disabled' }),
      ]),
    );
  });
});

function createSnapshot(overrides: Partial<OperationalControlApiSnapshot> = {}): OperationalControlApiSnapshot {
  return {
    health: ok('/healthz', { service: '@devgateway/control-api', status: 'ok', port: 43100 }),
    readiness: ok('/readyz', {
      service: '@devgateway/control-api',
      status: 'ready',
      checks: { configuration: 'ok', productionRoutes: 'disabled' },
    }),
    registry: ok('/registry/current', {
      registry_version: 'model-aliases.v0.1',
      production_enabled: false,
      snapshot: { production_posture: { production_enabled: false, production_route_allowed: false }, model_aliases: [] },
    }),
    bifrostValidation: ok('/bifrost/config/validation', {
      route_config_version: 'bifrost.model-aliases.v0.1.disabled',
      production_enabled: false,
      errors: [],
    }),
    virtualKeys: ok('/api/virtual-keys', { virtual_keys: [] }),
    budgetSpend: ok('/api/budget-spend', { spend: [budgetSpend()] }),
    costEvents: ok('/api/cost-events', { cost_events: [costEvent()] }),
    openapi: ok('/openapi.json', {
      paths: {
        '/api/tasks/{task_id}': {},
        '/api/workflows/{workflow_id}/events': {},
        '/api/tool-decisions': {},
      },
    }),
    task: ok('/api/tasks/task_demo_001', { task: taskResponse() }),
    taskArtifacts: ok('/api/tasks/task_demo_001/artifacts', { artifacts: [artifactMetadata()], count: 1 }),
    workflow: ok('/api/workflows/workflow_demo_001', { workflow: workflowResponse() }),
    workflowEvents: ok('/api/workflows/workflow_demo_001/events', { events: [workflowEvent()], next_cursor: null }),
    agentRun: ok('/api/agent-runs/agent_run_demo_001', { agent_run: agentRunResponse() }),
    skills: ok('/api/skills', { skills: [skillResponse()], count: 1 }),
    ...overrides,
  } as OperationalControlApiSnapshot;
}

function ok<T>(path: string, body: T): ControlApiFetchResult<T> {
  return { ok: true, status: 200, path, body };
}

function failed<T = never>(path: string, status: number, error: string): ControlApiFetchResult<T> {
  return { ok: false, status, path, body: null, error };
}

function opaqueRef(refId: string, refType: string, scopeRef = 'project_demo') {
  return { ref_id: refId, ref_type: refType, scope_ref: scopeRef };
}

function artifactRef() {
  return {
    artifact_id: 'artifact_demo_001',
    artifact_kind: 'tool_result',
    data_class: 'internal',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    size_bytes: 128,
  };
}

function auditRef() {
  return { audit_event_id: 'audit_demo_001', audit_stream: 'workflow', recorded_at: now };
}

function costRef() {
  return { cost_event_id: 'cost_event_demo_001', budget_scope_id: 'budget_scope_demo', cost_phase: 'actual', recorded_at: now };
}

function idempotency(scope: string, dedupeRef: string) {
  return { idempotency_key: `idem_${scope}`, scope, dedupe_ref: dedupeRef, expires_at: later };
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
    objective_ref: opaqueRef('objective_demo_001', 'objective_ref'),
    input_context_refs: [opaqueRef('context_demo_001', 'sanitized_context_ref')],
    artifact_refs: [artifactRef()],
    agent_run_refs: [opaqueRef('agent_run_demo_001', 'agent_run', 'workflow_demo_001')],
    idempotency: idempotency('task', 'task_demo_001'),
    cancellation_request: null,
    created_at: now,
    updated_at: now,
    raw_prompt: sensitiveValues.rawPrompt,
    raw_context: sensitiveValues.rawContext,
    provider_key: sensitiveValues.providerKey,
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
    idempotency_refs: [idempotency('workflow', 'workflow_demo_001')],
    lease_state: {
      lease_id: 'lease_demo_001',
      lease_owner_ref: 'agent_run_demo_001',
      heartbeat_at: now,
      expires_at: later,
      lease_status: 'active',
    },
    resume_ref: opaqueRef('resume_demo_001', 'resume_ref', 'workflow_demo_001'),
    terminal_failure_ref: null,
    artifact_refs: [artifactRef()],
    audit_refs: [auditRef()],
    cost_refs: [costRef()],
    created_at: now,
    updated_at: now,
    raw_context: sensitiveValues.rawContext,
    secret: sensitiveValues.secret,
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
    step_ref: opaqueRef('step_demo_001', 'workflow_step', 'workflow_demo_001'),
    agent_run_ref: opaqueRef('agent_run_demo_001', 'agent_run', 'workflow_demo_001'),
    delegation_ref: opaqueRef('delegation_demo_001', 'delegation', 'workflow_demo_001'),
    tool_call_ref: opaqueRef('tool_call_demo_001', 'tool_call', 'agent_run_demo_001'),
    event_metadata_ref: opaqueRef('event_metadata_demo_001', 'event_metadata', 'workflow_demo_001'),
    artifact_refs: [artifactRef()],
    audit_refs: [auditRef()],
    cost_refs: [costRef()],
    idempotency: idempotency('event', 'workflow_event_demo_001'),
    occurred_at: now,
    raw_prompt: sensitiveValues.rawPrompt,
    access_token: sensitiveValues.token,
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
    idempotency: idempotency('agent', 'agent_run_demo_001'),
    allowed_tool_refs: [{ tool_definition_id: 'tool.search', tool_class: 'search', risk_tier: 'low', provider_key: sensitiveValues.providerKey }],
    disallowed_tool_refs: [{ tool_definition_id: 'tool.shell', tool_class: 'shell', risk_tier: 'high', secret: sensitiveValues.secret }],
    context_refs: [opaqueRef('context_demo_001', 'sanitized_context_ref')],
    child_agent_run_refs: [opaqueRef('agent_run_child_001', 'agent_run', 'workflow_demo_001')],
    artifact_refs: [artifactRef()],
    audit_refs: [auditRef()],
    cost_refs: [costRef()],
    lease_ref: {
      lease_id: 'lease_demo_001',
      lease_owner_ref: 'agent_run_demo_001',
      heartbeat_at: now,
      expires_at: later,
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
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
    provider_key: sensitiveValues.providerKey,
    access_token: sensitiveValues.token,
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
    retention_policy: { retained_until: later, delete_after_seconds: 3600, legal_hold: false },
    signed_download_eligible: false,
    signed_access_expires_at: null,
    acl_scope: { principals: ['principal_demo'], projects: ['project_demo'] },
    related_artifact_refs: [artifactRef()],
    audit_refs: [auditRef()],
    cost_refs: [costRef()],
    idempotency: idempotency('artifact', 'artifact_demo_001'),
    created_at: now,
    updated_at: now,
    artifact_body: sensitiveValues.artifactBody,
    signed_url: sensitiveValues.signedUrl,
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
    allowed_tool_refs: [{ tool_definition_id: 'tool.search', tool_class: 'search', risk_tier: 'low', provider_key: sensitiveValues.providerKey }],
    disallowed_tool_refs: [{ tool_definition_id: 'tool.shell', tool_class: 'shell', risk_tier: 'high', token: sensitiveValues.token }],
    instruction_template_refs: [opaqueRef('instruction_template_demo_001', 'instruction_template', 'skill_demo_001')],
    input_schema_ref: { schema_id: 'skill-input', schema_version: 'v1' },
    output_schema_ref: { schema_id: 'skill-output', schema_version: 'v1' },
    approval_policy: { approval_required: false },
    eval_suite_refs: [],
    rollout_policy: { rollout_state: 'development', production_enabled: false },
    gate_result_refs: [],
    artifact_refs: [artifactRef()],
    audit_refs: [auditRef()],
    cost_refs: [costRef()],
    idempotency: idempotency('skill', 'skill_demo_001'),
    principal_id: 'principal_demo',
    project_id: 'project_demo',
    data_class: 'internal',
    budget_scope_id: 'budget_scope_demo',
    policy_version: 'policy-demo-v1',
    registry_version: 'registry-demo-v1',
    trace_id: 'trace_demo_001',
    request_id: 'request_demo_001',
    trace_context_ref: traceContext(),
    created_at: now,
    updated_at: now,
    raw_prompt: sensitiveValues.rawPrompt,
    secret: sensitiveValues.secret,
  };
}

function budgetSpend() {
  return {
    budget_scope_id: 'budget_scope_demo',
    scope_type: 'workflow',
    owner_id: 'workflow_demo_001',
    status: 'active',
    currency: 'USD',
    spend_state: { actual_spend_amount: 1.25, actual_request_count: 1 },
    reservation_state: { reserved_amount: 0.25 },
    limits: { hard_cap_amount: 50 },
    decision: 'allow',
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
      tool_class: 'tool.search',
    },
    route_intent: 'nonproduction',
    budget_scope_id: 'budget_scope_demo',
    model_alias: 'claude-fast',
    provider_id: 'anthropic',
    attempt_status: 'succeeded',
    decision: 'allow',
    actual: { cost_amount: 1.25, input_tokens: 100, output_tokens: 20 },
    estimated: { cost_amount: 1.5, input_tokens: 120, output_tokens: 30 },
    currency: 'USD',
    denial_reason: null,
    occurred_at: now,
    recorded_at: now,
    provider_key: sensitiveValues.providerKey,
  };
}
