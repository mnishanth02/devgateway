import { createHash, randomUUID } from 'node:crypto';

import {
  dataClasses,
  gatewayControlContractVersion,
  type DataClass,
  type EnvironmentName,
} from '../../../../packages/shared-types/src/gateway-control.ts';
import {
  agentRoles,
  agentRunStatuses,
  artifactKinds,
  artifactSensitivityLabels,
  skillLifecycleStates,
  validateAgentWorkflowMetadataShape,
  workflowAllowedTransitions,
  workflowEventTypes,
  workflowStates,
  type AgentRunRecord,
  type ArtifactRef,
  type AuditRef,
  type CostRef,
  type IdempotencyRef,
  type OpaqueContextRef,
  type OpaqueRef,
  type SchemaRef,
  type SkillDefinitionRecord,
  type TaskArtifactRecord,
  type WorkflowEventRecord,
  type WorkflowRunRecord,
} from '../../../../packages/shared-types/src/agent-workflow.ts';
import { z } from 'zod';

import {
  isControlDeniedError,
  missingAuthControlError,
  productionDisabledRouteControlError,
  stalePolicyControlError,
  toControlDeniedErrorBody,
} from '../policies/control-errors.ts';
import type {
  ControlRouteAuthContext,
  ControlRouteReply,
  ControlRouteRequest,
} from './virtual-keys.ts';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_on_workflow'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'timed_out'
  | 'denied';

export type TaskType = 'analysis' | 'workflow' | 'code_review' | 'tool_execution' | 'synthesis' | 'custom';
export type TaskPriority = 'low' | 'normal' | 'high';

export interface CreateTaskRequest {
  readonly task_type: TaskType;
  readonly principal_id: string;
  readonly project_id: string;
  readonly data_class: DataClass;
  readonly budget_scope_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly trace_id: string;
  readonly request_id: string;
  readonly objective_ref: OpaqueRef;
  readonly input_context_refs?: readonly OpaqueContextRef[] | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly workflow_version?: string | undefined;
  readonly idempotency_key?: string | undefined;
}

export interface CancelTaskRequest {
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly cancellation_reason?: string | undefined;
}

export interface TaskCancellationRequestRecord {
  readonly requested: boolean;
  readonly requested_at: string;
  readonly requested_by_principal_id: string;
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly cancellation_reason: string | null;
}

export interface TaskRecord {
  readonly contract_version: typeof gatewayControlContractVersion;
  readonly task_id: string;
  readonly workflow_run_id: string;
  readonly status: TaskStatus;
  readonly task_type: TaskType;
  readonly priority: TaskPriority;
  readonly principal_id: string;
  readonly project_id: string;
  readonly data_class: DataClass;
  readonly budget_scope_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly trace_id: string;
  readonly request_id: string;
  readonly objective_ref: OpaqueRef;
  readonly input_context_refs: readonly OpaqueContextRef[];
  readonly artifact_refs: readonly ArtifactRef[];
  readonly agent_run_refs: readonly OpaqueRef[];
  readonly idempotency: IdempotencyRef;
  readonly cancellation_request: TaskCancellationRequestRecord | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorkflowControlRecord extends WorkflowRunRecord {
  readonly workflow_id: string;
  readonly request_id: string;
}

export interface WorkflowEventControlRecord extends WorkflowEventRecord {
  readonly workflow_id: string;
  readonly request_id: string;
}

export interface AgentRunControlRecord extends AgentRunRecord {
  readonly request_id: string;
}

export interface TaskArtifactControlRecord extends TaskArtifactRecord {
  readonly request_id: string;
}

export interface SkillDefinitionControlRecord extends SkillDefinitionRecord {
  readonly request_id: string;
}

export interface WorkflowEventPage {
  readonly events: readonly WorkflowEventControlRecord[];
  readonly next_cursor: string | null;
}

export interface WorkflowEventPageRequest {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface SkillListFilter {
  readonly project_id?: string | undefined;
  readonly principal_id?: string | undefined;
  readonly data_class?: DataClass | undefined;
  readonly status?: SkillDefinitionControlRecord['status'] | undefined;
}

export interface AgentWorkflowReadContext {
  readonly principalId: string;
  readonly projectId?: string | undefined;
}

export interface AgentWorkflowStore {
  createTask(input: CreateTaskRequest, actor: ControlRouteAuthContext): Promise<TaskRecord>;
  getTask(taskId: string, reader: AgentWorkflowReadContext): Promise<TaskRecord | null>;
  cancelTask(taskId: string, input: CancelTaskRequest, actor: ControlRouteAuthContext): Promise<TaskRecord>;
  listTaskArtifacts(
    taskId: string,
    reader: AgentWorkflowReadContext,
  ): Promise<readonly TaskArtifactControlRecord[] | null>;
  getWorkflow(workflowId: string, reader: AgentWorkflowReadContext): Promise<WorkflowControlRecord | null>;
  listWorkflowEvents(
    workflowId: string,
    page: WorkflowEventPageRequest,
    reader: AgentWorkflowReadContext,
  ): Promise<WorkflowEventPage | null>;
  getAgentRun(agentRunId: string, reader: AgentWorkflowReadContext): Promise<AgentRunControlRecord | null>;
  listSkills(filter: SkillListFilter): Promise<readonly SkillDefinitionControlRecord[]>;
}

export interface InMemoryAgentWorkflowStoreState {
  readonly tasks: readonly TaskRecord[];
  readonly workflows: readonly WorkflowControlRecord[];
  readonly workflowEvents: readonly WorkflowEventControlRecord[];
  readonly agentRuns: readonly AgentRunControlRecord[];
  readonly artifacts: readonly TaskArtifactControlRecord[];
  readonly skills: readonly SkillDefinitionControlRecord[];
}

export interface InMemoryAgentWorkflowStoreOptions {
  readonly initialState?: Partial<InMemoryAgentWorkflowStoreState> | undefined;
  readonly includeFixtures?: boolean | undefined;
}

export interface AgentWorkflowRouteBaseOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export class AgentWorkflowRouteValidationError extends Error {
  readonly statusCode: number;
  readonly code: 'invalid_request' | 'not_found' | 'invalid_state';

  constructor(
    message: string,
    options: { readonly statusCode?: number; readonly code?: 'invalid_request' | 'not_found' | 'invalid_state' } = {},
  ) {
    super(message);
    this.name = 'AgentWorkflowRouteValidationError';
    this.statusCode = options.statusCode ?? 400;
    this.code = options.code ?? 'invalid_request';
  }
}

export class InMemoryAgentWorkflowStore implements AgentWorkflowStore {
  readonly #tasks = new Map<string, TaskRecord>();
  readonly #workflows = new Map<string, WorkflowControlRecord>();
  readonly #workflowEvents = new Map<string, WorkflowEventControlRecord[]>();
  readonly #agentRuns = new Map<string, AgentRunControlRecord>();
  readonly #artifacts = new Map<string, TaskArtifactControlRecord[]>();
  readonly #skills = new Map<string, SkillDefinitionControlRecord>();

  constructor(options: InMemoryAgentWorkflowStoreOptions = {}) {
    const baseState = options.includeFixtures ?? true ? createSafeAgentWorkflowFixtureState() : createEmptyAgentWorkflowState();
    const state = {
      tasks: options.initialState?.tasks ?? baseState.tasks,
      workflows: options.initialState?.workflows ?? baseState.workflows,
      workflowEvents: options.initialState?.workflowEvents ?? baseState.workflowEvents,
      agentRuns: options.initialState?.agentRuns ?? baseState.agentRuns,
      artifacts: options.initialState?.artifacts ?? baseState.artifacts,
      skills: options.initialState?.skills ?? baseState.skills,
    } satisfies InMemoryAgentWorkflowStoreState;

    state.tasks.forEach((task) => this.#tasks.set(task.task_id, task));
    state.workflows.forEach((workflow) => this.#workflows.set(workflow.workflow_id, workflow));
    state.workflowEvents.forEach((event) => this.#appendWorkflowEvent(event));
    state.agentRuns.forEach((agentRun) => this.#agentRuns.set(agentRun.agent_run_id, agentRun));
    state.artifacts.forEach((artifact) => this.#appendArtifact(artifact));
    state.skills.forEach((skill) => this.#skills.set(skill.skill_definition_id, skill));
  }

  async createTask(input: CreateTaskRequest, actor: ControlRouteAuthContext): Promise<TaskRecord> {
    assertNoForbiddenAgentWorkflowFields(input);
    assertCreateTaskCriticalFields(input);
    assertActorMatchesTask(input, actor);

    const existing = this.#findTaskByIdempotency(input);
    if (existing !== null) {
      this.#assertCreateTaskReplayMatches(input, existing);
      return existing;
    }

    const now = new Date().toISOString();
    const taskId = `task_${randomUUID()}`;
    const workflowId = `workflow_${randomUUID()}`;
    const agentRunId = `agent_run_${randomUUID()}`;
    const idempotency = createIdempotencyRef(input.idempotency_key ?? input.request_id, 'workflow', taskId, now);
    const traceContextRef = createTraceContextRef(input.trace_id);
    const objectiveRef = input.objective_ref;
    const inputContextRefs = input.input_context_refs ?? [];
    const agentRunRef = createOpaqueRef(agentRunId, 'agent_run', workflowId);

    const task: TaskRecord = {
      contract_version: gatewayControlContractVersion,
      task_id: taskId,
      workflow_run_id: workflowId,
      status: 'queued',
      task_type: input.task_type,
      priority: input.priority ?? 'normal',
      principal_id: input.principal_id,
      project_id: input.project_id,
      data_class: input.data_class,
      budget_scope_id: input.budget_scope_id,
      policy_version: input.policy_version,
      registry_version: input.registry_version,
      trace_id: input.trace_id,
      request_id: input.request_id,
      objective_ref: objectiveRef,
      input_context_refs: inputContextRefs,
      artifact_refs: [],
      agent_run_refs: [agentRunRef],
      idempotency,
      cancellation_request: null,
      created_at: now,
      updated_at: now,
    };

    const workflow = createWorkflowRecord({
      task,
      workflowId,
      workflowVersion: input.workflow_version ?? 'workflow.nonproduction.v1',
      status: 'queued',
      currentAgentRunId: agentRunId,
      now,
    });
    const agentRun = createAgentRunRecord({ task, workflowId, agentRunId, now });
    const event = createWorkflowEventRecord({
      task,
      workflowId,
      sequenceNumber: 1,
      eventType: 'workflow_created',
      fromStatus: null,
      toStatus: 'queued',
      actorRef: {
        actor_type: 'principal',
        actor_ref: actor.authSubjectRef,
        principal_id: actor.principalId,
      },
      now,
    });

    this.#tasks.set(task.task_id, task);
    this.#workflows.set(workflow.workflow_id, workflow);
    this.#agentRuns.set(agentRun.agent_run_id, agentRun);
    this.#appendWorkflowEvent(event);
    this.#artifacts.set(task.task_id, []);
    return task;
  }

  async getTask(taskId: string, reader: AgentWorkflowReadContext): Promise<TaskRecord | null> {
    const task = this.#tasks.get(taskId);
    if (task === undefined || !isRecordVisibleToReader(task, reader)) return null;
    return task;
  }

  async cancelTask(taskId: string, input: CancelTaskRequest, actor: ControlRouteAuthContext): Promise<TaskRecord> {
    assertNoForbiddenAgentWorkflowFields(input);
    assertCancelTaskCriticalFields(input);
    const existing = this.#tasks.get(taskId);
    if (existing === undefined) {
      throw notFoundRouteError(`Unknown task_id: ${taskId}`);
    }
    if (!isRecordVisibleToReader(existing, { principalId: actor.principalId })) {
      throw notFoundRouteError('Unknown task_id.');
    }
    assertPolicyMatches(existing, input.policy_version, input.registry_version);

    const now = new Date().toISOString();
    const updated: TaskRecord = {
      ...existing,
      cancellation_request: {
        requested: true,
        requested_at: now,
        requested_by_principal_id: actor.principalId,
        request_id: input.request_id,
        trace_id: input.trace_id,
        policy_version: input.policy_version,
        registry_version: input.registry_version,
        cancellation_reason: input.cancellation_reason ?? null,
      },
      updated_at: now,
    };
    this.#tasks.set(taskId, updated);
    this.#appendWorkflowEvent(
      createWorkflowEventRecord({
        task: updated,
        workflowId: updated.workflow_run_id,
        sequenceNumber: this.#nextWorkflowSequence(updated.workflow_run_id),
        eventType: 'audit_recorded',
        fromStatus: null,
        toStatus: null,
        actorRef: {
          actor_type: 'principal',
          actor_ref: actor.authSubjectRef,
          principal_id: actor.principalId,
        },
        now,
      }),
    );
    return updated;
  }

  async listTaskArtifacts(
    taskId: string,
    reader: AgentWorkflowReadContext,
  ): Promise<readonly TaskArtifactControlRecord[] | null> {
    const task = this.#tasks.get(taskId);
    if (task === undefined || !isRecordVisibleToReader(task, reader)) return null;
    return (this.#artifacts.get(taskId) ?? []).filter((artifact) => isRecordVisibleToReader(artifact, reader));
  }

  async getWorkflow(workflowId: string, reader: AgentWorkflowReadContext): Promise<WorkflowControlRecord | null> {
    const workflow = this.#workflows.get(workflowId);
    if (workflow === undefined || !isRecordVisibleToReader(workflow, reader)) return null;
    return workflow;
  }

  async listWorkflowEvents(
    workflowId: string,
    page: WorkflowEventPageRequest,
    reader: AgentWorkflowReadContext,
  ): Promise<WorkflowEventPage | null> {
    const workflow = this.#workflows.get(workflowId);
    if (workflow === undefined || !isRecordVisibleToReader(workflow, reader)) return null;
    const cursor = parseCursor(page.cursor);
    const limit = page.limit ?? 50;
    const events = [...(this.#workflowEvents.get(workflowId) ?? [])]
      .filter((event) => isRecordVisibleToReader(event, reader))
      .sort((left, right) => left.sequence_number - right.sequence_number);
    const window = events.filter((event) => event.sequence_number > cursor).slice(0, limit + 1);
    const visible = window.slice(0, limit);
    const last = visible[visible.length - 1];
    return {
      events: visible,
      next_cursor: window.length > limit && last !== undefined ? String(last.sequence_number) : null,
    };
  }

  async getAgentRun(agentRunId: string, reader: AgentWorkflowReadContext): Promise<AgentRunControlRecord | null> {
    const agentRun = this.#agentRuns.get(agentRunId);
    if (agentRun === undefined || !isRecordVisibleToReader(agentRun, reader)) return null;
    return agentRun;
  }

  async listSkills(filter: SkillListFilter): Promise<readonly SkillDefinitionControlRecord[]> {
    return [...this.#skills.values()]
      .filter((skill) => filter.project_id === undefined || skill.project_id === filter.project_id)
      .filter((skill) => filter.principal_id === undefined || skill.principal_id === filter.principal_id)
      .filter((skill) => filter.data_class === undefined || skill.data_class === filter.data_class)
      .filter((skill) => filter.status === undefined || skill.status === filter.status);
  }

  #findTaskByIdempotency(input: CreateTaskRequest): TaskRecord | null {
    const idempotencyKey = input.idempotency_key ?? input.request_id;
    return (
      [...this.#tasks.values()].find(
        (task) =>
          task.idempotency.idempotency_key === idempotencyKey &&
          task.principal_id === input.principal_id &&
          task.project_id === input.project_id,
      ) ?? null
    );
  }

  #assertCreateTaskReplayMatches(input: CreateTaskRequest, existing: TaskRecord): void {
    const existingWorkflow = this.#workflows.get(existing.workflow_run_id);
    const comparisons: readonly [string, unknown, unknown][] = [
      ['task_type', input.task_type, existing.task_type],
      ['priority', input.priority ?? 'normal', existing.priority],
      ['data_class', input.data_class, existing.data_class],
      ['budget_scope_id', input.budget_scope_id, existing.budget_scope_id],
      ['policy_version', input.policy_version, existing.policy_version],
      ['registry_version', input.registry_version, existing.registry_version],
      ['trace_id', input.trace_id, existing.trace_id],
      ['request_id', input.request_id, existing.request_id],
      ['workflow_version', input.workflow_version ?? 'workflow.nonproduction.v1', existingWorkflow?.workflow_version],
      ['objective_ref', input.objective_ref, existing.objective_ref],
      ['input_context_refs', input.input_context_refs ?? [], existing.input_context_refs],
    ];

    const mismatch = comparisons.find(([, requested, persisted]) => !agentWorkflowValuesEqual(requested, persisted));
    if (mismatch !== undefined) {
      throw new AgentWorkflowRouteValidationError(
        `idempotency_key replay does not match original task ${mismatch[0]}.`,
        { statusCode: 409, code: 'invalid_state' },
      );
    }
  }

  #appendWorkflowEvent(event: WorkflowEventControlRecord): void {
    const events = this.#workflowEvents.get(event.workflow_id) ?? [];
    this.#workflowEvents.set(event.workflow_id, [...events, event]);
  }

  #appendArtifact(artifact: TaskArtifactControlRecord): void {
    const artifacts = this.#artifacts.get(artifact.task_id) ?? [];
    this.#artifacts.set(artifact.task_id, [...artifacts, artifact]);
  }

  #nextWorkflowSequence(workflowId: string): number {
    const events = this.#workflowEvents.get(workflowId) ?? [];
    return events.reduce((max, event) => Math.max(max, event.sequence_number), 0) + 1;
  }
}

export function createInMemoryAgentWorkflowStore(
  options: InMemoryAgentWorkflowStoreOptions = {},
): AgentWorkflowStore {
  return new InMemoryAgentWorkflowStore(options);
}

export const defaultAgentWorkflowStore = createInMemoryAgentWorkflowStore();

export async function authenticateAgentWorkflowRequest(
  request: ControlRouteRequest,
  options: AgentWorkflowRouteBaseOptions,
): Promise<ControlRouteAuthContext> {
  if (options.authenticate === undefined) {
    throw missingAuthControlError({ auth: 'better_auth_session_or_scoped_service_token_required' });
  }
  const actor = await options.authenticate(request);
  assertNonEmptyString(actor.principalId, 'auth.principal_id');
  assertNonEmptyString(actor.authSubjectRef, 'auth.auth_subject_ref');
  return actor;
}

export function createAgentWorkflowReadContext(
  actor: ControlRouteAuthContext,
  request: ControlRouteRequest,
): AgentWorkflowReadContext {
  assertNonEmptyString(actor.principalId, 'auth.principal_id');
  const projectId = getOptionalHeaderValue(request.headers, 'x-devgateway-project-id');
  return projectId === undefined ? { principalId: actor.principalId } : { principalId: actor.principalId, projectId };
}

export function assertAgentWorkflowRouteEnabledOutsideProduction(
  options: AgentWorkflowRouteBaseOptions,
  route: string,
): void {
  if ((options.runtimeEnvironment ?? process.env.NODE_ENV) === 'production') {
    throw productionDisabledRouteControlError({
      route,
      store: 'in_memory_placeholder',
      contract: 'agent workflow control routes require approved DB-backed orchestration before production',
    });
  }
}

export function asCreateTaskRequest(body: unknown): CreateTaskRequest {
  const input = createTaskRequestSchema.parse(body);
  assertNoForbiddenAgentWorkflowFields(input);
  return input;
}

export function asCancelTaskRequest(body: unknown): CancelTaskRequest {
  const input = cancelTaskRequestSchema.parse(body);
  assertNoForbiddenAgentWorkflowFields(input);
  return input;
}

export function asWorkflowEventPageRequest(query: unknown): WorkflowEventPageRequest {
  if (query === undefined) return {};
  const parsed = workflowEventQuerySchema.parse(query);
  return {
    ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
    ...(parsed.limit === undefined ? {} : { limit: parseLimit(parsed.limit) }),
  };
}

export function asSkillListFilter(query: unknown): SkillListFilter {
  if (query === undefined) return {};
  return skillListQuerySchema.parse(query);
}

export function getRouteParam(params: unknown, name: string): string {
  assertObject(params, 'route params');
  const value = params[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentWorkflowRouteValidationError(`${name} route parameter is required.`);
  }
  return value;
}

export async function handleKnownAgentWorkflowRouteErrors(
  reply: ControlRouteReply | undefined,
  action: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    if (isControlDeniedError(error)) {
      return respond(reply, error.statusCode, toControlDeniedErrorBody(error));
    }
    if (error instanceof AgentWorkflowRouteValidationError) {
      return respond(reply, error.statusCode, { error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return respond(reply, 400, { error: { code: 'invalid_request', message: z.prettifyError(error) } });
    }
    throw error;
  }
}

export function respond<T>(reply: ControlRouteReply | undefined, statusCode: number, body: T): T {
  reply?.code(statusCode);
  return body;
}

export function notFoundRouteError(message: string): AgentWorkflowRouteValidationError {
  return new AgentWorkflowRouteValidationError(message, { statusCode: 404, code: 'not_found' });
}

export function toTaskResponse(record: TaskRecord) {
  return {
    contract_version: record.contract_version,
    task_id: record.task_id,
    workflow_id: record.workflow_run_id,
    workflow_run_id: record.workflow_run_id,
    status: record.status,
    task_type: record.task_type,
    priority: record.priority,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    request_id: record.request_id,
    objective_ref: record.objective_ref,
    input_context_refs: record.input_context_refs,
    artifact_refs: record.artifact_refs,
    agent_run_refs: record.agent_run_refs,
    idempotency: record.idempotency,
    cancellation_request: record.cancellation_request,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function toWorkflowResponse(record: WorkflowControlRecord) {
  return {
    contract_version: record.contract_version,
    workflow_id: record.workflow_id,
    workflow_run_id: record.workflow_run_id,
    task_id: record.task_id,
    workflow_version: record.workflow_version,
    status: record.status,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    request_id: record.request_id,
    trace_context_ref: record.trace_context_ref,
    current_step_ref: record.current_step_ref,
    allowed_transitions: record.allowed_transitions,
    idempotency_refs: record.idempotency_refs,
    lease_state: record.lease_state,
    resume_ref: record.resume_ref,
    terminal_failure_ref: record.terminal_failure_ref,
    artifact_refs: record.artifact_refs,
    audit_refs: record.audit_refs,
    cost_refs: record.cost_refs,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function toWorkflowEventResponse(record: WorkflowEventControlRecord) {
  return {
    contract_version: record.contract_version,
    workflow_event_id: record.workflow_event_id,
    workflow_id: record.workflow_id,
    workflow_run_id: record.workflow_run_id,
    sequence_number: record.sequence_number,
    event_type: record.event_type,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    request_id: record.request_id,
    trace_context_ref: record.trace_context_ref,
    actor_ref: record.actor_ref,
    state_transition: record.state_transition,
    step_ref: record.step_ref,
    agent_run_ref: record.agent_run_ref,
    delegation_ref: record.delegation_ref,
    tool_call_ref: record.tool_call_ref,
    event_metadata_ref: record.event_metadata_ref,
    artifact_refs: record.artifact_refs,
    audit_refs: record.audit_refs,
    cost_refs: record.cost_refs,
    idempotency: record.idempotency,
    occurred_at: record.occurred_at,
  };
}

export function toAgentRunResponse(record: AgentRunControlRecord) {
  return {
    contract_version: record.contract_version,
    agent_run_id: record.agent_run_id,
    workflow_id: record.workflow_run_id,
    workflow_run_id: record.workflow_run_id,
    task_id: record.task_id,
    delegation_id: record.delegation_id,
    parent_agent_run_id: record.parent_agent_run_id,
    agent_definition_ref: record.agent_definition_ref,
    role: record.role,
    status: record.status,
    model_alias: record.model_alias,
    output_schema_ref: record.output_schema_ref,
    timeouts: record.timeouts,
    idempotency: record.idempotency,
    allowed_tool_refs: record.allowed_tool_refs,
    disallowed_tool_refs: record.disallowed_tool_refs,
    context_refs: record.context_refs,
    child_agent_run_refs: record.child_agent_run_refs,
    artifact_refs: record.artifact_refs,
    audit_refs: record.audit_refs,
    cost_refs: record.cost_refs,
    lease_ref: record.lease_ref,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    request_id: record.request_id,
    trace_context_ref: record.trace_context_ref,
    started_at: record.started_at,
    completed_at: record.completed_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function toArtifactMetadataResponse(record: TaskArtifactControlRecord) {
  return {
    contract_version: record.contract_version,
    artifact_id: record.artifact_id,
    artifact_kind: record.artifact_kind,
    workflow_id: record.workflow_run_id,
    workflow_run_id: record.workflow_run_id,
    task_id: record.task_id,
    delegation_id: record.delegation_id,
    agent_run_id: record.agent_run_id,
    tool_call_id: record.tool_call_id,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    request_id: record.request_id,
    owner_ref: record.owner_ref,
    storage_ref: record.storage_ref,
    media_type: record.media_type,
    size_bytes: record.size_bytes,
    sha256: record.sha256,
    sensitivity_label: record.sensitivity_label,
    source_ref: record.source_ref,
    retention_policy: record.retention_policy,
    signed_download_eligible: record.signed_access_policy.signed_access_allowed,
    signed_access_expires_at: record.signed_access_policy.expires_at,
    acl_scope: record.acl_scope,
    related_artifact_refs: record.related_artifact_refs,
    audit_refs: record.audit_refs,
    cost_refs: record.cost_refs,
    idempotency: record.idempotency,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function toSkillResponse(record: SkillDefinitionControlRecord) {
  return {
    contract_version: record.contract_version,
    skill_definition_id: record.skill_definition_id,
    skill_version_id: record.skill_version_id,
    status: record.status,
    owner_ref: record.owner_ref,
    allowed_model_aliases: record.allowed_model_aliases,
    allowed_tool_refs: record.allowed_tool_refs,
    disallowed_tool_refs: record.disallowed_tool_refs,
    instruction_template_refs: record.instruction_template_refs,
    input_schema_ref: record.input_schema_ref,
    output_schema_ref: record.output_schema_ref,
    approval_policy: record.approval_policy,
    eval_suite_refs: record.eval_suite_refs,
    rollout_policy: record.rollout_policy,
    gate_result_refs: record.gate_result_refs,
    artifact_refs: record.artifact_refs,
    audit_refs: record.audit_refs,
    cost_refs: record.cost_refs,
    idempotency: record.idempotency,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    request_id: record.request_id,
    trace_context_ref: record.trace_context_ref,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function createSafeAgentWorkflowFixtureState(): InMemoryAgentWorkflowStoreState {
  const now = '2026-01-01T00:00:00.000Z';
  const task: TaskRecord = {
    contract_version: gatewayControlContractVersion,
    task_id: 'task_demo_001',
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
    objective_ref: createOpaqueRef('objective_demo_001', 'objective_ref', 'project_demo'),
    input_context_refs: [createOpaqueRef('context_demo_001', 'sanitized_context_ref', 'project_demo')],
    artifact_refs: [
      {
        artifact_id: 'artifact_demo_001',
        artifact_kind: 'trace_evidence',
        data_class: 'internal',
        sha256: sha256Hex('safe-artifact-demo-001'),
        size_bytes: 128,
      },
    ],
    agent_run_refs: [createOpaqueRef('agent_run_demo_001', 'agent_run', 'workflow_demo_001')],
    idempotency: createIdempotencyRef('request_demo_001', 'workflow', 'task_demo_001', now),
    cancellation_request: null,
    created_at: now,
    updated_at: now,
  };
  const workflow = createWorkflowRecord({
    task,
    workflowId: task.workflow_run_id,
    workflowVersion: 'workflow.nonproduction.v1',
    status: 'running',
    currentAgentRunId: 'agent_run_demo_001',
    now,
  });
  const agentRun = createAgentRunRecord({
    task,
    workflowId: task.workflow_run_id,
    agentRunId: 'agent_run_demo_001',
    now,
  });
  const events = [
    createWorkflowEventRecord({
      task,
      workflowId: task.workflow_run_id,
      sequenceNumber: 1,
      eventType: 'workflow_created',
      fromStatus: null,
      toStatus: 'queued',
      actorRef: {
        actor_type: 'principal',
        actor_ref: 'principal_demo',
        principal_id: 'principal_demo',
      },
      now,
    }),
    createWorkflowEventRecord({
      task,
      workflowId: task.workflow_run_id,
      sequenceNumber: 2,
      eventType: 'agent_run_started',
      fromStatus: 'queued',
      toStatus: 'running',
      actorRef: {
        actor_type: 'agent',
        actor_ref: 'agent_run_demo_001',
        principal_id: 'principal_demo',
      },
      now,
    }),
  ];
  const artifact = createArtifactRecord({ task, workflowId: task.workflow_run_id, agentRunId: 'agent_run_demo_001', now });
  const skill = createSkillRecord({ task, now });
  return {
    tasks: [task],
    workflows: [workflow],
    workflowEvents: events,
    agentRuns: [agentRun],
    artifacts: [artifact],
    skills: [skill],
  };
}

function createEmptyAgentWorkflowState(): InMemoryAgentWorkflowStoreState {
  return {
    tasks: [],
    workflows: [],
    workflowEvents: [],
    agentRuns: [],
    artifacts: [],
    skills: [],
  };
}

function createWorkflowRecord(input: {
  readonly task: TaskRecord;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly status: WorkflowControlRecord['status'];
  readonly currentAgentRunId: string;
  readonly now: string;
}): WorkflowControlRecord {
  const { task, workflowId, workflowVersion, status, currentAgentRunId, now } = input;
  return {
    contract_version: gatewayControlContractVersion,
    workflow_id: workflowId,
    workflow_run_id: workflowId,
    task_id: task.task_id,
    workflow_version: workflowVersion,
    status,
    principal_id: task.principal_id,
    project_id: task.project_id,
    data_class: task.data_class,
    budget_scope_id: task.budget_scope_id,
    policy_version: task.policy_version,
    registry_version: task.registry_version,
    trace_id: task.trace_id,
    request_id: task.request_id,
    trace_context_ref: createTraceContextRef(task.trace_id),
    current_step_ref: {
      step_id: `step_${workflowId}`,
      step_type: 'plan',
      step_status: status,
      agent_run_id: currentAgentRunId,
      delegation_id: null,
    },
    allowed_transitions: workflowAllowedTransitions[status],
    idempotency_refs: [task.idempotency],
    lease_state: {
      lease_id: null,
      lease_owner_ref: null,
      heartbeat_at: null,
      expires_at: null,
      lease_status: 'none',
    },
    resume_ref: null,
    terminal_failure_ref: null,
    artifact_refs: task.artifact_refs,
    audit_refs: [createAuditRef('audit_workflow_created', now)],
    cost_refs: [],
    created_at: now,
    updated_at: now,
  };
}

function createWorkflowEventRecord(input: {
  readonly task: TaskRecord;
  readonly workflowId: string;
  readonly sequenceNumber: number;
  readonly eventType: WorkflowEventControlRecord['event_type'];
  readonly fromStatus: WorkflowEventControlRecord['state_transition']['from_status'];
  readonly toStatus: WorkflowEventControlRecord['state_transition']['to_status'];
  readonly actorRef: WorkflowEventControlRecord['actor_ref'];
  readonly now: string;
}): WorkflowEventControlRecord {
  const { task, workflowId, sequenceNumber, eventType, fromStatus, toStatus, actorRef, now } = input;
  return {
    contract_version: gatewayControlContractVersion,
    workflow_event_id: `workflow_event_${workflowId}_${sequenceNumber}`,
    workflow_id: workflowId,
    workflow_run_id: workflowId,
    sequence_number: sequenceNumber,
    event_type: eventType,
    principal_id: task.principal_id,
    project_id: task.project_id,
    data_class: task.data_class,
    budget_scope_id: task.budget_scope_id,
    policy_version: task.policy_version,
    registry_version: task.registry_version,
    trace_id: task.trace_id,
    request_id: task.request_id,
    trace_context_ref: createTraceContextRef(task.trace_id),
    actor_ref: actorRef,
    state_transition: {
      from_status: fromStatus,
      to_status: toStatus,
      transition_reason_ref: null,
    },
    step_ref: createOpaqueRef(`step_${workflowId}`, 'workflow_step', workflowId),
    agent_run_ref: task.agent_run_refs[0] ?? null,
    delegation_ref: null,
    tool_call_ref: null,
    event_metadata_ref: createOpaqueRef(`event_metadata_${sequenceNumber}`, 'safe_event_metadata_ref', workflowId),
    artifact_refs: task.artifact_refs,
    audit_refs: [createAuditRef(`audit_event_${sequenceNumber}`, now)],
    cost_refs: [],
    idempotency: createIdempotencyRef(`${task.request_id}:event:${sequenceNumber}`, 'workflow', workflowId, now),
    occurred_at: now,
  };
}

function createAgentRunRecord(input: {
  readonly task: TaskRecord;
  readonly workflowId: string;
  readonly agentRunId: string;
  readonly now: string;
}): AgentRunControlRecord {
  const { task, workflowId, agentRunId, now } = input;
  return {
    contract_version: gatewayControlContractVersion,
    agent_run_id: agentRunId,
    workflow_run_id: workflowId,
    task_id: task.task_id,
    delegation_id: null,
    parent_agent_run_id: null,
    agent_definition_ref: {
      agent_definition_id: 'agent_definition_nonproduction_supervisor',
      agent_definition_version: 'agent-definition.v1',
      role: 'supervisor',
    },
    role: 'supervisor',
    status: task.status === 'running' ? 'running' : 'queued',
    model_alias: 'default-safe-model-alias',
    output_schema_ref: createSchemaRef('schema_agent_output'),
    timeouts: {
      queue_seconds: 60,
      execution_seconds: 600,
      idle_seconds: 120,
      overall_seconds: 900,
    },
    idempotency: createIdempotencyRef(`${task.request_id}:agent_run`, 'agent_run', agentRunId, now),
    allowed_tool_refs: [],
    disallowed_tool_refs: [],
    context_refs: task.input_context_refs,
    child_agent_run_refs: [],
    artifact_refs: task.artifact_refs,
    audit_refs: [createAuditRef('audit_agent_run_created', now)],
    cost_refs: [],
    lease_ref: {
      lease_id: null,
      lease_owner_ref: null,
      heartbeat_at: null,
      expires_at: null,
    },
    principal_id: task.principal_id,
    project_id: task.project_id,
    data_class: task.data_class,
    budget_scope_id: task.budget_scope_id,
    policy_version: task.policy_version,
    registry_version: task.registry_version,
    trace_id: task.trace_id,
    request_id: task.request_id,
    trace_context_ref: createTraceContextRef(task.trace_id),
    started_at: task.status === 'running' ? now : null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };
}

function createArtifactRecord(input: {
  readonly task: TaskRecord;
  readonly workflowId: string;
  readonly agentRunId: string;
  readonly now: string;
}): TaskArtifactControlRecord {
  const { task, workflowId, agentRunId, now } = input;
  const artifactId = 'artifact_demo_001';
  return {
    contract_version: gatewayControlContractVersion,
    artifact_id: artifactId,
    artifact_kind: 'trace_evidence',
    workflow_run_id: workflowId,
    task_id: task.task_id,
    delegation_id: null,
    agent_run_id: agentRunId,
    tool_call_id: null,
    owner_ref: {
      owner_type: 'workflow',
      owner_id: workflowId,
      principal_id: task.principal_id,
      project_id: task.project_id,
    },
    storage_ref: {
      storage_system: 'artifact_service',
      container_ref: 'artifact-container-nonproduction',
      object_path_ref: `opaque-artifact-ref:${artifactId}`,
      version_ref: 'v1',
    },
    media_type: 'application/json',
    size_bytes: 128,
    sha256: sha256Hex('safe-artifact-demo-001'),
    sensitivity_label: 'internal',
    source_ref: {
      source_type: 'workflow',
      source_id: workflowId,
      produced_by_ref: agentRunId,
    },
    retention_policy: {
      retained_until: '2026-02-01T00:00:00.000Z',
      delete_after_seconds: 2_592_000,
      legal_hold: false,
    },
    signed_access_policy: {
      signed_access_allowed: false,
      expires_at: null,
      audience_scope_ref: 'download-disabled-in-control-api-fixture',
    },
    acl_scope: {
      budget_scope_id: task.budget_scope_id,
      allowed_project_refs: [task.project_id],
      allowed_principal_refs: [task.principal_id],
    },
    related_artifact_refs: [],
    audit_refs: [createAuditRef('audit_artifact_recorded', now)],
    cost_refs: [],
    idempotency: createIdempotencyRef(`${task.request_id}:artifact`, 'artifact_write', artifactId, now),
    principal_id: task.principal_id,
    project_id: task.project_id,
    data_class: task.data_class,
    budget_scope_id: task.budget_scope_id,
    policy_version: task.policy_version,
    registry_version: task.registry_version,
    trace_id: task.trace_id,
    request_id: task.request_id,
    trace_context_ref: createTraceContextRef(task.trace_id),
    created_at: now,
    updated_at: now,
  };
}

function createSkillRecord(input: { readonly task: TaskRecord; readonly now: string }): SkillDefinitionControlRecord {
  const { task, now } = input;
  return {
    contract_version: gatewayControlContractVersion,
    skill_definition_id: 'skill_demo_safe_research',
    skill_version_id: 'skill_version_demo_safe_research_v1',
    status: 'approved',
    owner_ref: {
      owner_type: 'project',
      owner_id: task.project_id,
      project_id: task.project_id,
      principal_id: task.principal_id,
    },
    allowed_model_aliases: ['default-safe-model-alias'],
    allowed_tool_refs: [],
    disallowed_tool_refs: [],
    instruction_template_refs: [createOpaqueRef('instruction_template_demo_001', 'instruction_template_ref', task.project_id)],
    input_schema_ref: createSchemaRef('schema_skill_input_demo'),
    output_schema_ref: createSchemaRef('schema_skill_output_demo'),
    approval_policy: {
      approval_required: false,
      approval_ref: null,
      approver_ref: null,
      policy_ref: task.policy_version,
    },
    eval_suite_refs: [],
    rollout_policy: {
      rollout_state: 'limited',
      production_enabled: false,
      allowed_project_refs: [task.project_id],
      allowed_principal_refs: [task.principal_id],
    },
    gate_result_refs: [],
    artifact_refs: [],
    audit_refs: [createAuditRef('audit_skill_registered', now)],
    cost_refs: [],
    idempotency: createIdempotencyRef('skill_demo_safe_research:v1', 'skill_publish', 'skill_demo_safe_research', now),
    principal_id: task.principal_id,
    project_id: task.project_id,
    data_class: task.data_class,
    budget_scope_id: task.budget_scope_id,
    policy_version: task.policy_version,
    registry_version: task.registry_version,
    trace_id: task.trace_id,
    request_id: task.request_id,
    trace_context_ref: createTraceContextRef(task.trace_id),
    created_at: now,
    updated_at: now,
  };
}

function createOpaqueRef(refId: string, refType: string, scopeRef: string): OpaqueRef {
  return {
    ref_id: refId,
    ref_type: refType,
    scope_ref: scopeRef,
  };
}

function createSchemaRef(schemaId: string): SchemaRef {
  return {
    schema_id: schemaId,
    json_pointer: '#',
    schema_version: '1.0.0',
    enforcement: 'validate_before_dispatch',
  };
}

function createTraceContextRef(traceId: string): WorkflowControlRecord['trace_context_ref'] {
  const spanId = createHash('sha256').update(traceId).digest('hex').slice(0, 16);
  return {
    trace_context_id: `trace_context_${traceId}`,
    span_id: spanId,
    propagation_ref: `traceparent:${traceId}`,
  };
}

function createIdempotencyRef(
  idempotencyKey: string,
  scope: IdempotencyRef['scope'],
  dedupeRef: string,
  now: string,
): IdempotencyRef {
  return {
    idempotency_key: idempotencyKey,
    scope,
    dedupe_ref: dedupeRef,
    expires_at: addDaysIso(now, 1),
  };
}

function createAuditRef(auditEventId: string, recordedAt: string): AuditRef {
  return {
    audit_event_id: auditEventId,
    audit_stream: 'control-api-nonproduction-fixture',
    recorded_at: recordedAt,
  };
}

function assertCreateTaskCriticalFields(input: CreateTaskRequest): void {
  assertNonEmptyString(input.principal_id, 'principal_id');
  assertNonEmptyString(input.project_id, 'project_id');
  assertDataClass(input.data_class);
  assertNonEmptyString(input.budget_scope_id, 'budget_scope_id');
  assertPolicyPins(input.policy_version, input.registry_version);
  assertNonEmptyString(input.trace_id, 'trace_id');
  assertNonEmptyString(input.request_id, 'request_id');
  assertObject(input.objective_ref, 'objective_ref');
}

function assertActorMatchesTask(input: CreateTaskRequest, actor: ControlRouteAuthContext): void {
  if (input.principal_id !== actor.principalId) {
    throw new AgentWorkflowRouteValidationError('principal_id must match the authenticated Control API principal.', {
      statusCode: 403,
      code: 'invalid_state',
    });
  }
}

function assertCancelTaskCriticalFields(input: CancelTaskRequest): void {
  assertNonEmptyString(input.request_id, 'request_id');
  assertNonEmptyString(input.trace_id, 'trace_id');
  assertPolicyPins(input.policy_version, input.registry_version);
}

function assertPolicyPins(policyVersion: string, registryVersion: string): void {
  if (policyVersion.trim() === '') {
    throw stalePolicyControlError({ field: 'policy_version' });
  }
  if (registryVersion.trim() === '') {
    throw stalePolicyControlError({ field: 'registry_version' });
  }
}

function assertPolicyMatches(record: TaskRecord, policyVersion: string, registryVersion: string): void {
  if (record.policy_version !== policyVersion || record.registry_version !== registryVersion) {
    throw stalePolicyControlError({
      task_id: record.task_id,
      expected_policy_version: record.policy_version,
      actual_policy_version: policyVersion,
      expected_registry_version: record.registry_version,
      actual_registry_version: registryVersion,
    });
  }
}

function agentWorkflowValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertDataClass(value: unknown): asserts value is DataClass {
  if (typeof value !== 'string' || !(dataClasses as readonly string[]).includes(value)) {
    throw new AgentWorkflowRouteValidationError('data_class must be one of public, internal, confidential, restricted.');
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentWorkflowRouteValidationError(`${field} is required.`);
  }
}

function assertObject(value: unknown, label: string): asserts value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentWorkflowRouteValidationError(`${label} must be an object.`);
  }
}

function isRecordVisibleToReader(
  record: { readonly principal_id: string; readonly project_id: string },
  reader: AgentWorkflowReadContext,
): boolean {
  if (record.principal_id !== reader.principalId) return false;
  return reader.projectId === undefined || record.project_id === reader.projectId;
}

function getOptionalHeaderValue(
  headers: ControlRouteRequest['headers'],
  name: string,
): string | undefined {
  const value =
    headers instanceof Headers
      ? headers.get(name)
      : headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.trim() !== '' ? first : undefined;
}

function assertNoForbiddenAgentWorkflowFields(value: unknown, path = 'body'): void {
  const issues = validateAgentWorkflowMetadataShape(value);
  if (issues.length > 0) {
    const first = issues[0];
    throw new AgentWorkflowRouteValidationError(`Forbidden sensitive field is not accepted: ${first?.path ?? path}`);
  }
  assertNoForbiddenPromptOrSecretFields(value, path);
}

function assertNoForbiddenPromptOrSecretFields(value: unknown, path: string): void {
  if (
    typeof value === 'string' &&
    /raw[_-]?(prompt|artifact|input|output|context|secret)|signed[_-]?url|provider[_-]?(key|secret|token)|api[_-]?key|virtual[_-]?key[_-]?secret/i.test(
      value,
    )
  ) {
    throw new AgentWorkflowRouteValidationError(`Forbidden prompt, artifact body, or secret reference is not accepted: ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenPromptOrSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (
      /(^|[_-])(prompt|completion|artifact_body|object_body|signed_url)($|[_-])|provider.*(key|secret|token)|api[_-]?key|raw[_-]?(prompt|artifact|input|output|context|secret)|virtual[_-]?key[_-]?secret/i.test(
        key,
      )
    ) {
      throw new AgentWorkflowRouteValidationError(`Forbidden prompt, artifact body, or secret field is not accepted: ${path}.${key}`);
    }
    assertNoForbiddenPromptOrSecretFields(nested, `${path}.${key}`);
  }
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d+$/u.test(cursor)) {
    throw new AgentWorkflowRouteValidationError('cursor must be a workflow event sequence number.');
  }
  return Number(cursor);
}

function parseLimit(limit: string | number): number {
  const value = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new AgentWorkflowRouteValidationError('limit must be an integer between 1 and 100.');
  }
  return value;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function addDaysIso(value: string, days: number): string {
  return new Date(Date.parse(value) + days * 24 * 60 * 60 * 1000).toISOString();
}

const nonEmptyStringSchema = z.string().min(1);
const dataClassSchema = z.enum(dataClasses);
const taskTypeSchema = z.enum(['analysis', 'workflow', 'code_review', 'tool_execution', 'synthesis', 'custom']);
const taskPrioritySchema = z.enum(['low', 'normal', 'high']);
const taskStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_on_workflow',
  'succeeded',
  'failed',
  'cancel_requested',
  'cancelled',
  'timed_out',
  'denied',
]);
const workflowStateSchema = z.enum(workflowStates);
const workflowEventTypeSchema = z.enum(workflowEventTypes);
const agentRoleSchema = z.enum(agentRoles);
const agentRunStatusSchema = z.enum(agentRunStatuses);
const artifactKindSchema = z.enum(artifactKinds);
const artifactSensitivitySchema = z.enum(artifactSensitivityLabels);
const skillLifecycleStateSchema = z.enum(skillLifecycleStates);

export const opaqueRefSchema = z
  .object({
    ref_id: nonEmptyStringSchema,
    ref_type: nonEmptyStringSchema,
    scope_ref: nonEmptyStringSchema,
  })
  .strict();

const traceContextRefSchema = z
  .object({
    trace_context_id: nonEmptyStringSchema,
    span_id: nonEmptyStringSchema,
    propagation_ref: nonEmptyStringSchema,
  })
  .strict();

const schemaRefSchema = z
  .object({
    schema_id: nonEmptyStringSchema,
    json_pointer: nonEmptyStringSchema,
    schema_version: nonEmptyStringSchema,
    enforcement: z.enum([
      'validate_before_dispatch',
      'validate_before_execution',
      'validate_before_synthesis',
      'validate_before_persist',
    ]),
  })
  .strict();

const artifactRefSchema = z
  .object({
    artifact_id: nonEmptyStringSchema,
    artifact_kind: nonEmptyStringSchema,
    data_class: dataClassSchema,
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u),
    size_bytes: z.number().int().nonnegative(),
  })
  .strict();

const auditRefSchema = z
  .object({
    audit_event_id: nonEmptyStringSchema,
    audit_stream: nonEmptyStringSchema,
    recorded_at: nonEmptyStringSchema,
  })
  .strict();

const costRefSchema = z
  .object({
    cost_event_id: nonEmptyStringSchema,
    budget_scope_id: nonEmptyStringSchema,
    cost_phase: z.enum(['estimate', 'reservation', 'settlement', 'release', 'reconciliation']),
    recorded_at: nonEmptyStringSchema,
  })
  .strict();

const idempotencyRefSchema = z
  .object({
    idempotency_key: nonEmptyStringSchema,
    scope: z.enum(['workflow', 'step', 'delegation', 'agent_run', 'tool_call', 'artifact_write', 'skill_publish']),
    dedupe_ref: nonEmptyStringSchema,
    expires_at: nonEmptyStringSchema,
  })
  .strict();

const workflowStepRefSchema = z
  .object({
    step_id: nonEmptyStringSchema,
    step_type: z.enum(['plan', 'delegate', 'agent', 'tool', 'synthesize', 'review', 'artifact']),
    step_status: workflowStateSchema,
    agent_run_id: nonEmptyStringSchema.nullable(),
    delegation_id: nonEmptyStringSchema.nullable(),
  })
  .strict();

const leaseStateSchema = z
  .object({
    lease_id: nonEmptyStringSchema.nullable(),
    lease_owner_ref: nonEmptyStringSchema.nullable(),
    heartbeat_at: nonEmptyStringSchema.nullable(),
    expires_at: nonEmptyStringSchema.nullable(),
    lease_status: z.enum(['none', 'active', 'expired', 'released']),
  })
  .strict();

const taskCancellationRequestSchema = z
  .object({
    requested: z.literal(true),
    requested_at: nonEmptyStringSchema,
    requested_by_principal_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    cancellation_reason: nonEmptyStringSchema.nullable(),
  })
  .strict();

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).passthrough(),
});

export const createTaskRequestSchema = z
  .object({
    task_type: taskTypeSchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    objective_ref: opaqueRefSchema,
    input_context_refs: z.array(opaqueRefSchema).optional(),
    priority: taskPrioritySchema.optional(),
    workflow_version: nonEmptyStringSchema.optional(),
    idempotency_key: nonEmptyStringSchema.optional(),
  })
  .strict();

export const cancelTaskRequestSchema = z
  .object({
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    cancellation_reason: nonEmptyStringSchema.optional(),
  })
  .strict();

export const taskParamsSchema = z.object({ task_id: nonEmptyStringSchema }).strict();
export const workflowParamsSchema = z.object({ workflow_id: nonEmptyStringSchema }).strict();
export const agentRunParamsSchema = z.object({ agent_run_id: nonEmptyStringSchema }).strict();

export const workflowEventQuerySchema = z
  .object({
    cursor: nonEmptyStringSchema.optional(),
    limit: z.union([z.number().int().min(1).max(100), z.string().regex(/^\d+$/u)]).optional(),
  })
  .strict();

export const skillListQuerySchema = z
  .object({
    project_id: nonEmptyStringSchema.optional(),
    principal_id: nonEmptyStringSchema.optional(),
    data_class: dataClassSchema.optional(),
    status: skillLifecycleStateSchema.optional(),
  })
  .strict();

export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type WorkflowResponse = z.infer<typeof workflowResponseSchema>;
export type WorkflowEventResponse = z.infer<typeof workflowEventResponseSchema>;
export type AgentRunResponse = z.infer<typeof agentRunResponseSchema>;
export type ArtifactMetadataResponse = z.infer<typeof artifactMetadataResponseSchema>;
export type SkillResponse = z.infer<typeof skillResponseSchema>;

export const taskResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    task_id: nonEmptyStringSchema,
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    status: taskStatusSchema,
    task_type: taskTypeSchema,
    priority: taskPrioritySchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    objective_ref: opaqueRefSchema,
    input_context_refs: z.array(opaqueRefSchema),
    artifact_refs: z.array(artifactRefSchema),
    agent_run_refs: z.array(opaqueRefSchema),
    idempotency: idempotencyRefSchema,
    cancellation_request: taskCancellationRequestSchema.nullable(),
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();

export const workflowResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    task_id: nonEmptyStringSchema,
    workflow_version: nonEmptyStringSchema,
    status: workflowStateSchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    trace_context_ref: traceContextRefSchema,
    current_step_ref: workflowStepRefSchema,
    allowed_transitions: z.array(workflowStateSchema),
    idempotency_refs: z.array(idempotencyRefSchema),
    lease_state: leaseStateSchema,
    resume_ref: opaqueRefSchema.nullable(),
    terminal_failure_ref: z.record(z.string(), z.unknown()).nullable(),
    artifact_refs: z.array(artifactRefSchema),
    audit_refs: z.array(auditRefSchema),
    cost_refs: z.array(costRefSchema),
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();

export const workflowEventResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    workflow_event_id: nonEmptyStringSchema,
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    sequence_number: z.number().int().positive(),
    event_type: workflowEventTypeSchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    trace_context_ref: traceContextRefSchema,
    actor_ref: z
      .object({
        actor_type: z.enum(['system', 'principal', 'agent', 'tool', 'worker']),
        actor_ref: nonEmptyStringSchema,
        principal_id: nonEmptyStringSchema.nullable(),
      })
      .strict(),
    state_transition: z
      .object({
        from_status: workflowStateSchema.nullable(),
        to_status: workflowStateSchema.nullable(),
        transition_reason_ref: nonEmptyStringSchema.nullable(),
      })
      .strict(),
    step_ref: opaqueRefSchema,
    agent_run_ref: opaqueRefSchema.nullable(),
    delegation_ref: opaqueRefSchema.nullable(),
    tool_call_ref: opaqueRefSchema.nullable(),
    event_metadata_ref: opaqueRefSchema,
    artifact_refs: z.array(artifactRefSchema),
    audit_refs: z.array(auditRefSchema),
    cost_refs: z.array(costRefSchema),
    idempotency: idempotencyRefSchema,
    occurred_at: nonEmptyStringSchema,
  })
  .strict();

export const agentRunResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    agent_run_id: nonEmptyStringSchema,
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    task_id: nonEmptyStringSchema,
    delegation_id: nonEmptyStringSchema.nullable(),
    parent_agent_run_id: nonEmptyStringSchema.nullable(),
    agent_definition_ref: z
      .object({
        agent_definition_id: nonEmptyStringSchema,
        agent_definition_version: nonEmptyStringSchema,
        role: agentRoleSchema,
      })
      .strict(),
    role: agentRoleSchema,
    status: agentRunStatusSchema,
    model_alias: nonEmptyStringSchema,
    output_schema_ref: schemaRefSchema,
    timeouts: z
      .object({
        queue_seconds: z.number().int().nonnegative(),
        execution_seconds: z.number().int().nonnegative(),
        idle_seconds: z.number().int().nonnegative(),
        overall_seconds: z.number().int().nonnegative(),
      })
      .strict(),
    idempotency: idempotencyRefSchema,
    allowed_tool_refs: z.array(z.record(z.string(), z.unknown())),
    disallowed_tool_refs: z.array(z.record(z.string(), z.unknown())),
    context_refs: z.array(opaqueRefSchema),
    child_agent_run_refs: z.array(opaqueRefSchema),
    artifact_refs: z.array(artifactRefSchema),
    audit_refs: z.array(auditRefSchema),
    cost_refs: z.array(costRefSchema),
    lease_ref: z
      .object({
        lease_id: nonEmptyStringSchema.nullable(),
        lease_owner_ref: nonEmptyStringSchema.nullable(),
        heartbeat_at: nonEmptyStringSchema.nullable(),
        expires_at: nonEmptyStringSchema.nullable(),
      })
      .strict(),
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    trace_context_ref: traceContextRefSchema,
    started_at: nonEmptyStringSchema.nullable(),
    completed_at: nonEmptyStringSchema.nullable(),
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();

export const artifactMetadataResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    artifact_id: nonEmptyStringSchema,
    artifact_kind: artifactKindSchema,
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    task_id: nonEmptyStringSchema,
    delegation_id: nonEmptyStringSchema.nullable(),
    agent_run_id: nonEmptyStringSchema.nullable(),
    tool_call_id: nonEmptyStringSchema.nullable(),
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    owner_ref: z.record(z.string(), z.unknown()),
    storage_ref: z
      .object({
        storage_system: z.enum(['s3', 'azure_blob', 'gcs', 'filesystem', 'artifact_service']),
        container_ref: nonEmptyStringSchema,
        object_path_ref: nonEmptyStringSchema,
        version_ref: nonEmptyStringSchema.nullable(),
      })
      .strict(),
    media_type: nonEmptyStringSchema,
    size_bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u),
    sensitivity_label: artifactSensitivitySchema,
    source_ref: z.record(z.string(), z.unknown()),
    retention_policy: z.record(z.string(), z.unknown()),
    signed_download_eligible: z.boolean(),
    signed_access_expires_at: nonEmptyStringSchema.nullable(),
    acl_scope: z.record(z.string(), z.unknown()),
    related_artifact_refs: z.array(artifactRefSchema),
    audit_refs: z.array(auditRefSchema),
    cost_refs: z.array(costRefSchema),
    idempotency: idempotencyRefSchema,
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();

export const skillResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    skill_definition_id: nonEmptyStringSchema,
    skill_version_id: nonEmptyStringSchema,
    status: skillLifecycleStateSchema,
    owner_ref: z.record(z.string(), z.unknown()),
    allowed_model_aliases: z.array(nonEmptyStringSchema),
    allowed_tool_refs: z.array(z.record(z.string(), z.unknown())),
    disallowed_tool_refs: z.array(z.record(z.string(), z.unknown())),
    instruction_template_refs: z.array(opaqueRefSchema),
    input_schema_ref: schemaRefSchema,
    output_schema_ref: schemaRefSchema,
    approval_policy: z.record(z.string(), z.unknown()),
    eval_suite_refs: z.array(z.record(z.string(), z.unknown())),
    rollout_policy: z.record(z.string(), z.unknown()),
    gate_result_refs: z.array(z.record(z.string(), z.unknown())),
    artifact_refs: z.array(artifactRefSchema),
    audit_refs: z.array(auditRefSchema),
    cost_refs: z.array(costRefSchema),
    idempotency: idempotencyRefSchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    trace_context_ref: traceContextRefSchema,
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();
