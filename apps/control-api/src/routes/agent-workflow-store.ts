import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { approvalExpiresAtForRiskTier } from '../../../../packages/policy/src/index.ts';
import {
  dataClasses,
  gatewayControlContractVersion,
  type DataClass,
  type EnvironmentName,
} from '../../../../packages/shared-types/src/gateway-control.ts';
import {
  agentRoles,
  agentRunStatuses,
  approvalDecisions,
  approvalRiskTiers,
  approvalStatuses,
  artifactKinds,
  artifactLifecycleActions,
  artifactLifecycleStates,
  artifactSensitivityLabels,
  outboxDeliveryStates,
  outboxDestinationKinds,
  skillLifecycleStates,
  validateAgentWorkflowMetadataShape,
  workflowAllowedTransitions,
  workflowEventTypes,
  workflowStates,
  workflowTemplateRolloutStates,
  type AgentRunRecord,
  type ApprovalDecisionRef,
  type ApprovalRequestRecord,
  type ApprovalRiskTier,
  type ApprovalStatus,
  type ApproverPolicyRef,
  type ArtifactLifecycleAction,
  type ArtifactLifecycleEventRecord,
  type ArtifactLifecycleState,
  type ArtifactRef,
  type ArtifactSignedAccessEligibility,
  type AuditRef,
  type CostRef,
  type IdempotencyRef,
  type OpaqueContextRef,
  type OpaqueRef,
  type OutboxDeliveryState,
  type OutboxDestinationKind,
  type PolicyRef,
  type SchemaRef,
  type SkillDefinitionRecord,
  type TaskArtifactRecord,
  type WorkflowEventRecord,
  type WorkflowOutboxRecord,
  type WorkflowRunRecord,
  type WorkflowTemplateRecord,
  type WorkflowTemplateRolloutState,
  type WorkflowTemplateVersionRecord,
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
export type TaskCancellationExecutionStatus = 'queued' | 'running' | 'waiting_for_approval' | 'terminal';

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
  readonly execution_status: TaskCancellationExecutionStatus;
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

export interface ApprovalControlRecord extends ApprovalRequestRecord {
  readonly workflow_id: string;
  readonly request_id: string;
}

export interface OutboxControlRecord extends WorkflowOutboxRecord {
  readonly workflow_id: string;
  readonly request_id: string;
  readonly principal_id: string;
  readonly project_id: string;
}

// ---------------------------------------------------------------------------
// Track 3: Artifact lifecycle types
// ---------------------------------------------------------------------------

export interface ArtifactLifecycleControlRecord extends ArtifactLifecycleEventRecord {
  readonly request_id: string;
}

export interface ArtifactSignedAccessRequest {
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly requested_duration_seconds?: number | undefined;
}

export interface ArtifactLifecycleStatusResult {
  readonly artifact_id: string;
  readonly latest_state: ArtifactLifecycleState | null;
  readonly latest_action: ArtifactLifecycleAction | null;
  readonly legal_hold: boolean;
  readonly redacted: boolean;
  readonly deletion_scheduled_at: string | null;
  readonly signed_access_eligibility: ArtifactSignedAccessEligibility;
  readonly event_count: number;
}

export type ArtifactSignedAccessDecision = 'eligible' | 'approval_required' | 'ineligible';

export interface ArtifactSignedAccessDecisionResult {
  readonly artifact_id: string;
  readonly decision: ArtifactSignedAccessDecision;
  readonly decision_reason: string;
  readonly eligible: boolean;
  readonly requires_approval: boolean;
  readonly max_signed_duration_seconds: number | null;
  readonly sha256: string;
  readonly signed_access?: ArtifactSignedAccessGrant | undefined;
}

export interface ArtifactSignedAccessGrant {
  readonly signed_url: string;
  readonly expires_at: string;
  readonly ttl_seconds: number;
  readonly sha256: string;
}

// ---------------------------------------------------------------------------
// Track 3: Workflow template types
// ---------------------------------------------------------------------------

export interface TemplateControlRecord extends WorkflowTemplateRecord {
  readonly principal_id: string;
  readonly project_id: string;
}

export interface TemplateVersionControlRecord extends WorkflowTemplateVersionRecord {
  readonly principal_id: string;
  readonly project_id: string;
}

export interface WorkflowTemplateListFilter {
  readonly rollout_state?: WorkflowTemplateRolloutState | undefined;
  readonly project_id?: string | undefined;
}

export interface WorkflowTemplateVersionListFilter {
  readonly rollout_state?: WorkflowTemplateRolloutState | undefined;
}

export interface OutboxListFilter {
  readonly workflow_id?: string | undefined;
  readonly delivery_state?: OutboxDeliveryState | undefined;
  readonly destination_kind?: OutboxDestinationKind | undefined;
}

export interface OutboxStatusResult {
  readonly counts_by_state: Partial<Record<OutboxDeliveryState, number>>;
  readonly counts_by_destination: Partial<Record<OutboxDestinationKind, number>>;
  readonly backlog_count: number;
  readonly failed_count: number;
  readonly dead_lettered_count: number;
  readonly total: number;
}

export interface RetryWorkflowRequest {
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly idempotency_key: string;
  readonly retry_reason_ref?: OpaqueRef | undefined;
}

export interface WorkflowRetryControlRecord {
  readonly workflow_id: string;
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly idempotency: IdempotencyRef;
  readonly requested_by_principal_id: string;
  readonly retry_state: 'scheduled';
  readonly retry_reason_ref: OpaqueRef | null;
  readonly audit_ref: AuditRef;
  readonly created_at: string;
}

export type ManualReviewState = 'open' | 'in_progress' | 'resolved' | 'closed';
export type ManualReviewBlockingState = 'blocking_workflow' | 'blocking_step' | 'informational';

export interface ManualReviewControlRecord {
  readonly contract_version: typeof gatewayControlContractVersion;
  readonly manual_review_item_id: string;
  readonly workflow_id: string;
  readonly workflow_run_id: string;
  readonly task_id: string | null;
  readonly request_id: string;
  readonly reason: string;
  readonly owner_principal_id: string;
  readonly owner_role: string | null;
  readonly blocking_state: ManualReviewBlockingState;
  readonly review_state: ManualReviewState;
  readonly safe_actions: readonly OpaqueRef[];
  readonly side_effect_refs: readonly OpaqueRef[];
  readonly resolution_ref: OpaqueRef | null;
  readonly resolution_audit_ref: AuditRef | null;
  readonly idempotency: IdempotencyRef;
  readonly principal_id: string;
  readonly project_id: string;
  readonly data_class: DataClass;
  readonly budget_scope_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly trace_id: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ResolveManualReviewRequest {
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly idempotency_key: string;
  readonly resolution_ref: OpaqueRef;
}

export interface WorkflowLeaseStatusResult {
  readonly workflow_id: string;
  readonly workflow_run_id: string;
  readonly workflow_status: WorkflowControlRecord['status'];
  readonly workflow_lease: WorkflowControlRecord['lease_state'];
  readonly agent_run_leases: readonly {
    readonly agent_run_id: string;
    readonly lease_ref: AgentRunControlRecord['lease_ref'];
    readonly status: AgentRunControlRecord['status'];
  }[];
  readonly active_count: number;
  readonly expired_count: number;
  readonly stuck_count: number;
  readonly checked_at: string;
}

export interface ApprovalListFilter {
  readonly state?: ApprovalStatus | undefined;
  readonly workflow_id?: string | undefined;
  readonly project_id?: string | undefined;
}

export interface ApproveApprovalRequest {
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly decision_artifact_ref?: OpaqueRef | undefined;
}

export interface DenyApprovalRequest {
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly denial_reason_ref?: OpaqueRef | undefined;
}

export interface ExpireApprovalRequest {
  readonly request_id: string;
  readonly trace_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly expiry_reason_ref?: OpaqueRef | undefined;
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
  retryWorkflow(
    workflowId: string,
    input: RetryWorkflowRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<WorkflowRetryControlRecord>;
  listWorkflowEvents(
    workflowId: string,
    page: WorkflowEventPageRequest,
    reader: AgentWorkflowReadContext,
  ): Promise<WorkflowEventPage | null>;
  listManualReviews(workflowId: string, reader: AgentWorkflowReadContext): Promise<readonly ManualReviewControlRecord[] | null>;
  resolveManualReview(
    workflowId: string,
    manualReviewItemId: string,
    input: ResolveManualReviewRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ManualReviewControlRecord>;
  getWorkflowLeaseStatus(workflowId: string, reader: AgentWorkflowReadContext): Promise<WorkflowLeaseStatusResult | null>;
  getAgentRun(agentRunId: string, reader: AgentWorkflowReadContext): Promise<AgentRunControlRecord | null>;
  listSkills(filter: SkillListFilter): Promise<readonly SkillDefinitionControlRecord[]>;
  listApprovals(filter: ApprovalListFilter, reader: AgentWorkflowReadContext): Promise<readonly ApprovalControlRecord[]>;
  getApproval(approvalRequestId: string, reader: AgentWorkflowReadContext): Promise<ApprovalControlRecord | null>;
  approveApproval(
    approvalRequestId: string,
    input: ApproveApprovalRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ApprovalControlRecord>;
  denyApproval(
    approvalRequestId: string,
    input: DenyApprovalRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ApprovalControlRecord>;
  expireApproval(
    approvalRequestId: string,
    input: ExpireApprovalRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ApprovalControlRecord>;
  listOutbox(filter: OutboxListFilter, reader: AgentWorkflowReadContext): Promise<readonly OutboxControlRecord[]>;
  getOutbox(outboxId: string, reader: AgentWorkflowReadContext): Promise<OutboxControlRecord | null>;
  outboxStatus(filter: OutboxListFilter, reader: AgentWorkflowReadContext): Promise<OutboxStatusResult>;
  listArtifactLifecycle(artifactId: string, reader: AgentWorkflowReadContext): Promise<readonly ArtifactLifecycleControlRecord[] | null>;
  getArtifactLifecycleStatus(artifactId: string, reader: AgentWorkflowReadContext): Promise<ArtifactLifecycleStatusResult | null>;
  requestArtifactSignedAccess(
    artifactId: string,
    body: ArtifactSignedAccessRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ArtifactSignedAccessDecisionResult>;
  listWorkflowTemplates(filter: WorkflowTemplateListFilter, reader: AgentWorkflowReadContext): Promise<readonly TemplateControlRecord[]>;
  getWorkflowTemplate(templateId: string, reader: AgentWorkflowReadContext): Promise<TemplateControlRecord | null>;
  listWorkflowTemplateVersions(templateId: string, filter: WorkflowTemplateVersionListFilter, reader: AgentWorkflowReadContext): Promise<readonly TemplateVersionControlRecord[] | null>;
  getWorkflowTemplateVersion(templateVersionId: string, reader: AgentWorkflowReadContext): Promise<TemplateVersionControlRecord | null>;
}

export interface InMemoryAgentWorkflowStoreState {
  readonly tasks: readonly TaskRecord[];
  readonly workflows: readonly WorkflowControlRecord[];
  readonly workflowEvents: readonly WorkflowEventControlRecord[];
  readonly agentRuns: readonly AgentRunControlRecord[];
  readonly artifacts: readonly TaskArtifactControlRecord[];
  readonly skills: readonly SkillDefinitionControlRecord[];
  readonly approvals: readonly ApprovalControlRecord[];
  readonly manualReviews: readonly ManualReviewControlRecord[];
  readonly outboxes: readonly OutboxControlRecord[];
  readonly artifactLifecycles: readonly ArtifactLifecycleControlRecord[];
  readonly templates: readonly TemplateControlRecord[];
  readonly templateVersions: readonly TemplateVersionControlRecord[];
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
  readonly #approvals = new Map<string, ApprovalControlRecord>();
  readonly #manualReviews = new Map<string, ManualReviewControlRecord>();
  readonly #workflowRetryRequests = new Map<string, WorkflowRetryControlRecord>();
  readonly #manualReviewResolutionRequests = new Map<string, ResolveManualReviewRequest>();
  readonly #outboxes = new Map<string, OutboxControlRecord>();
  readonly #lifecycles = new Map<string, ArtifactLifecycleControlRecord[]>();
  readonly #templates = new Map<string, TemplateControlRecord>();
  readonly #templateVersions = new Map<string, TemplateVersionControlRecord>();

  constructor(options: InMemoryAgentWorkflowStoreOptions = {}) {
    const baseState = options.includeFixtures ?? true ? createSafeAgentWorkflowFixtureState() : createEmptyAgentWorkflowState();
    const state = {
      tasks: options.initialState?.tasks ?? baseState.tasks,
      workflows: options.initialState?.workflows ?? baseState.workflows,
      workflowEvents: options.initialState?.workflowEvents ?? baseState.workflowEvents,
      agentRuns: options.initialState?.agentRuns ?? baseState.agentRuns,
      artifacts: options.initialState?.artifacts ?? baseState.artifacts,
      skills: options.initialState?.skills ?? baseState.skills,
      approvals: options.initialState?.approvals ?? baseState.approvals,
      manualReviews: options.initialState?.manualReviews ?? baseState.manualReviews,
      outboxes: options.initialState?.outboxes ?? baseState.outboxes,
      artifactLifecycles: options.initialState?.artifactLifecycles ?? baseState.artifactLifecycles,
      templates: options.initialState?.templates ?? baseState.templates,
      templateVersions: options.initialState?.templateVersions ?? baseState.templateVersions,
    } satisfies InMemoryAgentWorkflowStoreState;

    state.tasks.forEach((task) => this.#tasks.set(task.task_id, task));
    state.workflows.forEach((workflow) => this.#workflows.set(workflow.workflow_id, workflow));
    state.workflowEvents.forEach((event) => this.#appendWorkflowEvent(event));
    state.agentRuns.forEach((agentRun) => this.#agentRuns.set(agentRun.agent_run_id, agentRun));
    state.artifacts.forEach((artifact) => this.#appendArtifact(artifact));
    state.skills.forEach((skill) => this.#skills.set(skill.skill_definition_id, skill));
    state.approvals.forEach((approval) => this.#approvals.set(approval.approval_request_id, approval));
    state.manualReviews.forEach((manualReview) => this.#manualReviews.set(manualReview.manual_review_item_id, manualReview));
    state.outboxes.forEach((outbox) => this.#outboxes.set(outbox.outbox_id, outbox));
    state.artifactLifecycles.forEach((event) => this.#appendLifecycleEvent(event));
    state.templates.forEach((template) => this.#templates.set(template.template_id, template));
    state.templateVersions.forEach((version) => this.#templateVersions.set(version.template_version_id, version));
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
    const workflow = this.#workflows.get(existing.workflow_run_id);
    const executionStatus = cancellationExecutionStatusFromWorkflow(workflow?.status ?? existing.status);
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
        execution_status: executionStatus,
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
    return (this.#artifacts.get(taskId) ?? [])
      .filter((artifact) => isArtifactVisibleToReader(artifact, reader))
      .filter((artifact) => this.#isArtifactDisplayable(artifact.artifact_id));
  }

  async getWorkflow(workflowId: string, reader: AgentWorkflowReadContext): Promise<WorkflowControlRecord | null> {
    const workflow = this.#workflows.get(workflowId);
    if (workflow === undefined || !isRecordVisibleToReader(workflow, reader)) return null;
    return workflow;
  }

  async retryWorkflow(
    workflowId: string,
    input: RetryWorkflowRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<WorkflowRetryControlRecord> {
    assertNoForbiddenAgentWorkflowFields(input);
    assertRetryWorkflowCriticalFields(input);
    assertWorkflowMutationRole(actor, 'retry');
    const workflow = this.#workflows.get(workflowId);
    if (workflow === undefined || !isWorkflowMutationVisible(workflow, reader)) {
      throw notFoundRouteError('Unknown workflow_id.');
    }
    assertWorkflowPolicyMatches(workflow, input.policy_version, input.registry_version);

    const retryKey = `${workflowId}:${input.idempotency_key}`;
    const existingRetry = this.#workflowRetryRequests.get(retryKey);
    if (existingRetry !== undefined) {
      assertRetryWorkflowReplayMatches(input, existingRetry);
      return existingRetry;
    }
    const conflictingRetry = [...this.#workflowRetryRequests.values()].find(
      (retry) => retry.idempotency.idempotency_key === input.idempotency_key && retry.workflow_id !== workflowId,
    );
    if (conflictingRetry !== undefined) {
      throw new AgentWorkflowRouteValidationError('retry idempotency_key is already bound to a different workflow_id.', {
        statusCode: 409,
        code: 'invalid_state',
      });
    }
    assertWorkflowRetryable(workflow);

    const now = new Date().toISOString();
    const idempotency = createIdempotencyRef(input.idempotency_key, 'retry', workflowId, now);
    const auditRef = createAuditRef(`audit_retry_${randomUUID()}`, now);
    const retry: WorkflowRetryControlRecord = {
      workflow_id: workflowId,
      request_id: input.request_id,
      trace_id: input.trace_id,
      policy_version: input.policy_version,
      registry_version: input.registry_version,
      idempotency,
      requested_by_principal_id: actor.principalId,
      retry_state: 'scheduled',
      retry_reason_ref: input.retry_reason_ref ?? null,
      audit_ref: auditRef,
      created_at: now,
    };

    const updatedWorkflow: WorkflowControlRecord = {
      ...workflow,
      status: 'queued',
      current_step_ref: {
        ...workflow.current_step_ref,
        step_status: 'queued',
      },
      allowed_transitions: workflowAllowedTransitions.queued,
      idempotency_refs: [...workflow.idempotency_refs, idempotency],
      resume_ref: createOpaqueRef(`retry_resume_${workflowId}`, 'workflow_retry_resume_ref', workflowId),
      audit_refs: [...workflow.audit_refs, auditRef],
      updated_at: now,
    };
    this.#workflows.set(workflowId, updatedWorkflow);
    const task = this.#tasks.get(workflow.task_id);
    if (task !== undefined) {
      const updatedTask: TaskRecord = { ...task, status: 'queued', updated_at: now };
      this.#tasks.set(task.task_id, updatedTask);
      this.#appendWorkflowEvent(
        createWorkflowEventRecord({
          task: updatedTask,
          workflowId,
          sequenceNumber: this.#nextWorkflowSequence(workflowId),
          eventType: 'retry_scheduled',
          fromStatus: workflow.status,
          toStatus: 'queued',
          actorRef: {
            actor_type: 'principal',
            actor_ref: actor.authSubjectRef,
            principal_id: actor.principalId,
          },
          now,
        }),
      );
    }
    this.#workflowRetryRequests.set(retryKey, retry);
    return retry;
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

  async listManualReviews(workflowId: string, reader: AgentWorkflowReadContext): Promise<readonly ManualReviewControlRecord[] | null> {
    const workflow = this.#workflows.get(workflowId);
    if (workflow === undefined || !isRecordVisibleToReader(workflow, reader)) return null;
    return [...this.#manualReviews.values()]
      .filter((item) => item.workflow_id === workflowId)
      .filter((item) => isManualReviewVisibleToReader(item, reader))
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async resolveManualReview(
    workflowId: string,
    manualReviewItemId: string,
    input: ResolveManualReviewRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ManualReviewControlRecord> {
    assertNoForbiddenAgentWorkflowFields(input);
    assertResolveManualReviewCriticalFields(input);
    const existing = this.#manualReviews.get(manualReviewItemId);
    if (
      existing === undefined ||
      existing.workflow_id !== workflowId ||
      !isManualReviewMutationVisible(existing, reader)
    ) {
      throw notFoundRouteError('Unknown manual_review_item_id.');
    }
    assertManualReviewPolicyMatches(existing, input.policy_version, input.registry_version);
    assertManualReviewActorAuthorized(existing, actor);

    const resolutionKey = `${manualReviewItemId}:${input.idempotency_key}`;
    const replay = this.#manualReviewResolutionRequests.get(resolutionKey);
    if (replay !== undefined) {
      assertResolveManualReviewReplayMatches(input, replay);
      return this.#manualReviews.get(manualReviewItemId) ?? existing;
    }
    const conflictingResolution = [...this.#manualReviewResolutionRequests.entries()].find(
      ([key]) => key.endsWith(`:${input.idempotency_key}`) && key !== resolutionKey,
    );
    if (conflictingResolution !== undefined) {
      throw new AgentWorkflowRouteValidationError('manual_review idempotency_key is already bound to a different review item.', {
        statusCode: 409,
        code: 'invalid_state',
      });
    }
    if (existing.review_state === 'resolved' || existing.review_state === 'closed') {
      throw new AgentWorkflowRouteValidationError(
        `Manual review ${manualReviewItemId} is in terminal state ${existing.review_state} and cannot be modified.`,
        { statusCode: 409, code: 'invalid_state' },
      );
    }

    const now = new Date().toISOString();
    const auditRef = createAuditRef(`audit_manual_review_resolved_${randomUUID()}`, now);
    const updated: ManualReviewControlRecord = {
      ...existing,
      review_state: 'resolved',
      resolution_ref: input.resolution_ref,
      resolution_audit_ref: auditRef,
      updated_at: now,
    };
    this.#manualReviews.set(manualReviewItemId, updated);
    this.#manualReviewResolutionRequests.set(resolutionKey, input);

    const workflow = this.#workflows.get(workflowId);
    const task = workflow === undefined ? undefined : this.#tasks.get(workflow.task_id);
    if (workflow !== undefined) {
      this.#workflows.set(workflowId, {
        ...workflow,
        status: workflow.status === 'manual_review' ? 'running' : workflow.status,
        current_step_ref: {
          ...workflow.current_step_ref,
          step_status: workflow.status === 'manual_review' ? 'running' : workflow.current_step_ref.step_status,
        },
        allowed_transitions: workflow.status === 'manual_review' ? workflowAllowedTransitions.running : workflow.allowed_transitions,
        audit_refs: [...workflow.audit_refs, auditRef],
        updated_at: now,
      });
    }
    if (task !== undefined) {
      this.#appendWorkflowEvent(
        createWorkflowEventRecord({
          task,
          workflowId,
          sequenceNumber: this.#nextWorkflowSequence(workflowId),
          eventType: 'manual_review_resolved',
          fromStatus: workflow?.status === 'manual_review' ? 'manual_review' : null,
          toStatus: workflow?.status === 'manual_review' ? 'running' : null,
          actorRef: {
            actor_type: 'principal',
            actor_ref: actor.authSubjectRef,
            principal_id: actor.principalId,
          },
          now,
        }),
      );
    }
    return updated;
  }

  async getWorkflowLeaseStatus(workflowId: string, reader: AgentWorkflowReadContext): Promise<WorkflowLeaseStatusResult | null> {
    const workflow = this.#workflows.get(workflowId);
    if (workflow === undefined || !isRecordVisibleToReader(workflow, reader)) return null;
    const checkedAt = new Date().toISOString();
    const agentRunLeases = [...this.#agentRuns.values()]
      .filter((agentRun) => agentRun.workflow_run_id === workflowId)
      .filter((agentRun) => isRecordVisibleToReader(agentRun, reader))
      .map((agentRun) => ({
        agent_run_id: agentRun.agent_run_id,
        lease_ref: agentRun.lease_ref,
        status: agentRun.status,
      }));
    const leaseStates = [
      workflow.lease_state,
      ...agentRunLeases.map((agentRun) => ({
        ...agentRun.lease_ref,
        lease_status: leaseStatusFromRef(agentRun.lease_ref, checkedAt),
      })),
    ];
    const activeCount = leaseStates.filter((lease) => lease.lease_status === 'active').length;
    const expiredCount = leaseStates.filter((lease) => lease.lease_status === 'expired').length;
    return {
      workflow_id: workflowId,
      workflow_run_id: workflow.workflow_run_id,
      workflow_status: workflow.status,
      workflow_lease: workflow.lease_state,
      agent_run_leases: agentRunLeases,
      active_count: activeCount,
      expired_count: expiredCount,
      stuck_count: expiredCount,
      checked_at: checkedAt,
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

  async listApprovals(filter: ApprovalListFilter, reader: AgentWorkflowReadContext): Promise<readonly ApprovalControlRecord[]> {
    const stateFilter = filter.state ?? 'pending';
    const now = new Date().toISOString();
    return [...this.#approvals.values()]
      .map((approval) => this.#materializeExpiredApproval(approval, now))
      .filter((approval) => isApprovalVisibleToReader(approval, reader))
      .filter((approval) => approval.state === stateFilter)
      .filter((approval) => filter.workflow_id === undefined || approval.workflow_id === filter.workflow_id)
      .filter((approval) => filter.project_id === undefined || approval.project_id === filter.project_id);
  }

  async getApproval(approvalRequestId: string, reader: AgentWorkflowReadContext): Promise<ApprovalControlRecord | null> {
    const existing = this.#approvals.get(approvalRequestId);
    const approval = existing === undefined ? undefined : this.#materializeExpiredApproval(existing, new Date().toISOString());
    if (approval === undefined || !isApprovalVisibleToReader(approval, reader)) return null;
    return approval;
  }

  async approveApproval(
    approvalRequestId: string,
    input: ApproveApprovalRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ApprovalControlRecord> {
    assertNoForbiddenAgentWorkflowFields(input);
    assertApprovalDecisionCriticalFields(input);
    const existing = this.#approvals.get(approvalRequestId);
    if (existing === undefined) {
      throw notFoundRouteError(`Unknown approval_request_id: ${approvalRequestId}`);
    }
    if (!isApprovalMutationProjectVisible(existing, reader)) {
      throw notFoundRouteError('Unknown approval_request_id.');
    }
    const now = new Date().toISOString();
    const current = this.#materializeExpiredApproval(existing, now);
    assertApprovalPolicyMatches(current, input.policy_version, input.registry_version);
    assertApprovalNotTerminal(current);
    assertApprovalActorAuthorized(current, actor);

    const decisionId = `decision_approve_${randomUUID()}`;
    const updated: ApprovalControlRecord = {
      ...current,
      state: 'approved',
      approver_principal_id: actor.principalId,
      decision_ref: {
        decision_id: decisionId,
        decision: 'approved',
        approver_principal_id: actor.principalId,
        policy_version_at_decision: input.policy_version,
        decision_audit_ref: createAuditRef(decisionId, now),
        decided_at: now,
      },
      audit_refs: [...existing.audit_refs, createAuditRef(decisionId, now)],
      updated_at: now,
    };
    this.#approvals.set(approvalRequestId, updated);
    return updated;
  }

  async denyApproval(
    approvalRequestId: string,
    input: DenyApprovalRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ApprovalControlRecord> {
    assertNoForbiddenAgentWorkflowFields(input);
    assertApprovalDecisionCriticalFields(input);
    const existing = this.#approvals.get(approvalRequestId);
    if (existing === undefined) {
      throw notFoundRouteError(`Unknown approval_request_id: ${approvalRequestId}`);
    }
    if (!isApprovalMutationProjectVisible(existing, reader)) {
      throw notFoundRouteError('Unknown approval_request_id.');
    }
    const now = new Date().toISOString();
    const current = this.#materializeExpiredApproval(existing, now);
    assertApprovalPolicyMatches(current, input.policy_version, input.registry_version);
    assertApprovalNotTerminal(current);
    assertApprovalActorAuthorized(current, actor);

    const decisionId = `decision_deny_${randomUUID()}`;
    const updated: ApprovalControlRecord = {
      ...current,
      state: 'denied',
      approver_principal_id: actor.principalId,
      decision_ref: {
        decision_id: decisionId,
        decision: 'denied',
        approver_principal_id: actor.principalId,
        policy_version_at_decision: input.policy_version,
        decision_audit_ref: createAuditRef(decisionId, now),
        decided_at: now,
      },
      audit_refs: [...existing.audit_refs, createAuditRef(decisionId, now)],
      updated_at: now,
    };
    this.#approvals.set(approvalRequestId, updated);
    return updated;
  }

  async expireApproval(
    approvalRequestId: string,
    input: ExpireApprovalRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ApprovalControlRecord> {
    assertNoForbiddenAgentWorkflowFields(input);
    assertApprovalDecisionCriticalFields(input);
    assertSystemApprovalActor(actor);
    const existing = this.#approvals.get(approvalRequestId);
    if (existing === undefined) {
      throw notFoundRouteError(`Unknown approval_request_id: ${approvalRequestId}`);
    }
    if (!isApprovalMutationProjectVisible(existing, reader)) {
      throw notFoundRouteError('Unknown approval_request_id.');
    }
    const now = new Date().toISOString();
    const current = this.#materializeExpiredApproval(existing, now);
    assertApprovalPolicyMatches(current, input.policy_version, input.registry_version);
    if (current.state === 'expired') return current;
    assertApprovalNotTerminal(current);

    const decisionId = `decision_expire_${randomUUID()}`;
    const updated: ApprovalControlRecord = {
      ...current,
      state: 'expired',
      approver_principal_id: null,
      decision_ref: {
        decision_id: decisionId,
        decision: 'expired',
        approver_principal_id: actor.principalId,
        policy_version_at_decision: input.policy_version,
        decision_audit_ref: createAuditRef(decisionId, now),
        decided_at: now,
      },
      audit_refs: [...existing.audit_refs, createAuditRef(decisionId, now)],
      updated_at: now,
    };
    this.#approvals.set(approvalRequestId, updated);
    return updated;
  }

  async listOutbox(filter: OutboxListFilter, reader: AgentWorkflowReadContext): Promise<readonly OutboxControlRecord[]> {
    return [...this.#outboxes.values()]
      .filter((outbox) => isRecordVisibleToReader(outbox, reader))
      .filter((outbox) => filter.workflow_id === undefined || outbox.workflow_id === filter.workflow_id)
      .filter((outbox) => filter.delivery_state === undefined || outbox.delivery_state === filter.delivery_state)
      .filter((outbox) => filter.destination_kind === undefined || outbox.destination_kind === filter.destination_kind);
  }

  async getOutbox(outboxId: string, reader: AgentWorkflowReadContext): Promise<OutboxControlRecord | null> {
    const outbox = this.#outboxes.get(outboxId);
    if (outbox === undefined || !isRecordVisibleToReader(outbox, reader)) return null;
    return outbox;
  }

  async outboxStatus(filter: OutboxListFilter, reader: AgentWorkflowReadContext): Promise<OutboxStatusResult> {
    const records = await this.listOutbox(filter, reader);
    const counts_by_state: Partial<Record<OutboxDeliveryState, number>> = {};
    const counts_by_destination: Partial<Record<OutboxDestinationKind, number>> = {};
    for (const record of records) {
      counts_by_state[record.delivery_state] = (counts_by_state[record.delivery_state] ?? 0) + 1;
      counts_by_destination[record.destination_kind] = (counts_by_destination[record.destination_kind] ?? 0) + 1;
    }
    const backlogCount = (counts_by_state.pending ?? 0) + (counts_by_state.delivering ?? 0) + (counts_by_state.failed ?? 0);
    return {
      counts_by_state,
      counts_by_destination,
      backlog_count: backlogCount,
      failed_count: counts_by_state.failed ?? 0,
      dead_lettered_count: counts_by_state.dead_lettered ?? 0,
      total: records.length,
    };
  }

  async listArtifactLifecycle(
    artifactId: string,
    reader: AgentWorkflowReadContext,
  ): Promise<readonly ArtifactLifecycleControlRecord[] | null> {
    const artifact = this.#findArtifactById(artifactId);
    if (artifact === undefined || !isArtifactVisibleToReader(artifact, reader)) return null;
    return (this.#lifecycles.get(artifactId) ?? []).filter((event) => isRecordVisibleToReader(event, reader));
  }

  async getArtifactLifecycleStatus(
    artifactId: string,
    reader: AgentWorkflowReadContext,
  ): Promise<ArtifactLifecycleStatusResult | null> {
    const events = await this.listArtifactLifecycle(artifactId, reader);
    if (events === null) return null;
    const latest = events[events.length - 1] ?? null;
    const defaultEligibility: ArtifactSignedAccessEligibility = {
      eligible: false,
      requires_approval: false,
      max_signed_duration_seconds: null,
    };
    return {
      artifact_id: artifactId,
      latest_state: latest?.state ?? null,
      latest_action: latest?.action ?? null,
      legal_hold: latest?.legal_hold ?? false,
      redacted: latest?.redacted ?? false,
      deletion_scheduled_at: latest?.deletion_scheduled_at ?? null,
      signed_access_eligibility: latest?.signed_access_eligibility ?? defaultEligibility,
      event_count: events.length,
    };
  }

  async requestArtifactSignedAccess(
    artifactId: string,
    body: ArtifactSignedAccessRequest,
    actor: ControlRouteAuthContext,
    reader: AgentWorkflowReadContext,
  ): Promise<ArtifactSignedAccessDecisionResult> {
    assertNoForbiddenAgentWorkflowFields(body);
    const artifact = this.#findArtifactById(artifactId);
    if (
      artifact === undefined ||
      actor.principalId !== reader.principalId ||
      !isArtifactVisibleToReader(artifact, reader)
    ) {
      throw notFoundRouteError('Unknown artifact_id.');
    }
    assertArtifactPolicyMatches(artifact, body.policy_version, body.registry_version);
    const lifecycleEvents = this.#lifecycles.get(artifactId) ?? [];
    const latest = lifecycleEvents[lifecycleEvents.length - 1];
    if (latest !== undefined) {
      assertArtifactLifecyclePolicyMatches(latest, body.policy_version, body.registry_version);
    }
    const eligibility: ArtifactSignedAccessEligibility = latest?.signed_access_eligibility ?? {
      eligible: false,
      requires_approval: false,
      max_signed_duration_seconds: null,
    };

    let decision: ArtifactSignedAccessDecision;
    let decision_reason: string;
    const hashVerified =
      latest === undefined ||
      latest.checksum_sha256.trim().toLowerCase() === artifact.sha256.trim().toLowerCase();
    if (!hashVerified) {
      decision = 'ineligible';
      decision_reason = 'Artifact hash verification failed before signed access.';
    } else if (isTerminalArtifactLifecycle(latest) || isExpiredAt(latest?.deletion_scheduled_at ?? null, new Date().toISOString())) {
      decision = 'ineligible';
      decision_reason = 'Artifact is terminal, redacted, deleted, or past its deletion schedule.';
    } else if (eligibility.requires_approval) {
      decision = 'approval_required';
      decision_reason = 'Signed access requires an approval before it can be granted.';
    } else if (eligibility.eligible) {
      decision = 'eligible';
      decision_reason = 'Artifact is eligible for signed access.';
    } else {
      decision = 'ineligible';
      decision_reason = 'Artifact is not eligible for signed access under the current policy.';
    }

    return {
      artifact_id: artifactId,
      decision,
      decision_reason,
      eligible: eligibility.eligible,
      requires_approval: eligibility.requires_approval,
      max_signed_duration_seconds: eligibility.max_signed_duration_seconds,
      sha256: artifact.sha256,
    };
  }

  async listWorkflowTemplates(filter: WorkflowTemplateListFilter, reader: AgentWorkflowReadContext): Promise<readonly TemplateControlRecord[]> {
    return [...this.#templates.values()]
      .filter((template) => isRecordVisibleToReader(template, reader))
      .filter((template) => filter.rollout_state === undefined || template.rollout_state === filter.rollout_state)
      .filter((template) => filter.project_id === undefined || template.project_id === filter.project_id);
  }

  async getWorkflowTemplate(templateId: string, reader: AgentWorkflowReadContext): Promise<TemplateControlRecord | null> {
    const template = this.#templates.get(templateId);
    if (template === undefined || !isRecordVisibleToReader(template, reader)) return null;
    return template;
  }

  async listWorkflowTemplateVersions(templateId: string, filter: WorkflowTemplateVersionListFilter, reader: AgentWorkflowReadContext): Promise<readonly TemplateVersionControlRecord[] | null> {
    const template = this.#templates.get(templateId);
    if (template === undefined || !isRecordVisibleToReader(template, reader)) return null;
    return [...this.#templateVersions.values()]
      .filter((version) => version.template_id === templateId)
      .filter((version) => isRecordVisibleToReader(version, reader))
      .filter((version) => filter.rollout_state === undefined || version.rollout_state === filter.rollout_state);
  }

  async getWorkflowTemplateVersion(templateVersionId: string, reader: AgentWorkflowReadContext): Promise<TemplateVersionControlRecord | null> {
    const version = this.#templateVersions.get(templateVersionId);
    if (version === undefined || !isRecordVisibleToReader(version, reader)) return null;
    return version;
  }

  #materializeExpiredApproval(approval: ApprovalControlRecord, now: string): ApprovalControlRecord {
    if (approval.state !== 'pending' || !isExpiredAt(approval.expires_at, now)) return approval;
    const expired: ApprovalControlRecord = {
      ...approval,
      state: 'expired',
      audit_refs: [...approval.audit_refs, createAuditRef(`audit_approval_expired_${approval.approval_request_id}`, now)],
      updated_at: now,
    };
    this.#approvals.set(approval.approval_request_id, expired);
    return expired;
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

  #appendLifecycleEvent(event: ArtifactLifecycleControlRecord): void {
    const events = this.#lifecycles.get(event.artifact_id) ?? [];
    this.#lifecycles.set(event.artifact_id, [...events, event]);
  }

  #findArtifactById(artifactId: string): TaskArtifactControlRecord | undefined {
    for (const artifacts of this.#artifacts.values()) {
      const found = artifacts.find((a) => a.artifact_id === artifactId);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  #nextWorkflowSequence(workflowId: string): number {
    const events = this.#workflowEvents.get(workflowId) ?? [];
    return events.reduce((max, event) => Math.max(max, event.sequence_number), 0) + 1;
  }

  #isArtifactDisplayable(artifactId: string): boolean {
    const lifecycleEvents = this.#lifecycles.get(artifactId) ?? [];
    const latest = lifecycleEvents[lifecycleEvents.length - 1];
    return !isTerminalArtifactLifecycle(latest) && !isExpiredAt(latest?.deletion_scheduled_at ?? null, new Date().toISOString());
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
  for (const [index, role] of (actor.roles ?? []).entries()) {
    assertNonEmptyString(role, `auth.roles.${index}`);
  }
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

export function asRetryWorkflowRequest(body: unknown): RetryWorkflowRequest {
  const input = retryWorkflowRequestSchema.parse(body);
  assertNoForbiddenAgentWorkflowFields(input);
  return input;
}

export function asResolveManualReviewRequest(body: unknown): ResolveManualReviewRequest {
  const input = resolveManualReviewRequestSchema.parse(body);
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

export function toWorkflowRetryResponse(record: WorkflowRetryControlRecord) {
  return {
    workflow_id: record.workflow_id,
    request_id: record.request_id,
    trace_id: record.trace_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    idempotency: record.idempotency,
    requested_by_principal_id: record.requested_by_principal_id,
    retry_state: record.retry_state,
    retry_reason_ref: record.retry_reason_ref,
    audit_ref: record.audit_ref,
    created_at: record.created_at,
  };
}

export function toManualReviewResponse(record: ManualReviewControlRecord) {
  return {
    contract_version: record.contract_version,
    manual_review_item_id: record.manual_review_item_id,
    workflow_id: record.workflow_id,
    workflow_run_id: record.workflow_run_id,
    task_id: record.task_id,
    request_id: record.request_id,
    reason_ref: createOpaqueRef(`manual_review_reason_${sha256Hex(record.reason).slice(0, 16)}`, 'manual_review_reason_ref', record.workflow_id),
    owner_principal_id: record.owner_principal_id,
    owner_role: record.owner_role,
    blocking_state: record.blocking_state,
    review_state: record.review_state,
    safe_actions: record.safe_actions,
    side_effect_refs: record.side_effect_refs,
    resolution_ref: record.resolution_ref,
    resolution_audit_ref: record.resolution_audit_ref,
    idempotency: record.idempotency,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function toWorkflowLeaseStatusResponse(record: WorkflowLeaseStatusResult) {
  return {
    workflow_id: record.workflow_id,
    workflow_run_id: record.workflow_run_id,
    workflow_status: record.workflow_status,
    workflow_lease: record.workflow_lease,
    agent_run_leases: record.agent_run_leases,
    active_count: record.active_count,
    expired_count: record.expired_count,
    stuck_count: record.stuck_count,
    checked_at: record.checked_at,
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
    storage_ref: createOpaqueRef(`storage_ref_${record.artifact_id}`, 'artifact_storage_ref', record.project_id),
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
  const approval = createApprovalRecord({ task, workflowId: task.workflow_run_id, approvalRequestId: 'approval_request_demo_001', now });
  const manualReview = createManualReviewRecord({ task, workflowId: task.workflow_run_id, manualReviewItemId: 'manual_review_item_demo_001', now });
  const outbox = createOutboxRecord({ task, workflowId: task.workflow_run_id, now });
  const artifactLifecycle = createArtifactLifecycleRecord({ task, artifact, now });
  const { template, templateVersions } = createTemplateFixtures({ task, now });
  return {
    tasks: [task],
    workflows: [workflow],
    workflowEvents: events,
    agentRuns: [agentRun],
    artifacts: [artifact],
    skills: [skill],
    approvals: [approval],
    manualReviews: [manualReview],
    outboxes: [outbox],
    artifactLifecycles: [artifactLifecycle],
    templates: [template],
    templateVersions,
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
    approvals: [],
    manualReviews: [],
    outboxes: [],
    artifactLifecycles: [],
    templates: [],
    templateVersions: [],
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

function cancellationExecutionStatusFromWorkflow(status: WorkflowControlRecord['status'] | TaskStatus): TaskCancellationExecutionStatus {
  if (status === 'queued' || status === 'created') return 'queued';
  if (status === 'pending_approval') return 'waiting_for_approval';
  if (['succeeded', 'completed', 'failed', 'cancelled', 'timed_out', 'denied'].includes(status)) return 'terminal';
  return 'running';
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
    sensitivity_label: 'confidential',
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

function createApprovalRecord(input: {
  readonly task: TaskRecord;
  readonly workflowId: string;
  readonly approvalRequestId: string;
  readonly now: string;
}): ApprovalControlRecord {
  const { task, workflowId, approvalRequestId, now } = input;
  return {
    contract_version: gatewayControlContractVersion,
    approval_request_id: approvalRequestId,
    workflow_run_id: workflowId,
    workflow_id: workflowId,
    task_id: task.task_id,
    request_id: task.request_id,
    step_id: null,
    delegation_id: null,
    tool_call_id: null,
    requester_principal_id: task.principal_id,
    approver_principal_id: null,
    required_role: 'approver',
    approver_policy: {
      required_role: 'approver',
      required_principal_ref: 'principal_approver',
      fallback_approver_ref: null,
      policy_version: task.policy_version,
    },
    risk_tier: 'medium',
    action_summary_artifact_ref: {
      artifact_id: 'artifact_demo_001',
      artifact_kind: 'trace_evidence',
      data_class: task.data_class,
      sha256: sha256Hex('safe-artifact-demo-001'),
      size_bytes: 128,
    },
    state: 'pending',
    decision_ref: null,
    expires_at: approvalExpiresAtForRiskTier('medium'),
    policy_ref: {
      policy_version: task.policy_version,
      policy_decision_ref: `policy_decision_${task.trace_id}`,
      evaluated_at: now,
    },
    audit_refs: [createAuditRef('audit_approval_requested', now)],
    idempotency: createIdempotencyRef(`${task.request_id}:approval`, 'approval', approvalRequestId, now),
    principal_id: task.principal_id,
    project_id: task.project_id,
    data_class: task.data_class,
    budget_scope_id: task.budget_scope_id,
    policy_version: task.policy_version,
    registry_version: task.registry_version,
    trace_id: task.trace_id,
    trace_context_ref: createTraceContextRef(task.trace_id),
    created_at: now,
    updated_at: now,
  };
}

function createManualReviewRecord(input: {
  readonly task: TaskRecord;
  readonly workflowId: string;
  readonly manualReviewItemId: string;
  readonly now: string;
}): ManualReviewControlRecord {
  const { task, workflowId, manualReviewItemId, now } = input;
  return {
    contract_version: gatewayControlContractVersion,
    manual_review_item_id: manualReviewItemId,
    workflow_id: workflowId,
    workflow_run_id: workflowId,
    task_id: task.task_id,
    request_id: task.request_id,
    reason: 'policy_manual_review_required',
    owner_principal_id: 'principal_reviewer',
    owner_role: 'reviewer',
    blocking_state: 'blocking_workflow',
    review_state: 'open',
    safe_actions: [createOpaqueRef('safe_action_review_only', 'manual_review_safe_action_ref', workflowId)],
    side_effect_refs: [],
    resolution_ref: null,
    resolution_audit_ref: null,
    idempotency: createIdempotencyRef(`${task.request_id}:manual_review`, 'manual_review', manualReviewItemId, now),
    principal_id: task.principal_id,
    project_id: task.project_id,
    data_class: task.data_class,
    budget_scope_id: task.budget_scope_id,
    policy_version: task.policy_version,
    registry_version: task.registry_version,
    trace_id: task.trace_id,
    created_at: now,
    updated_at: now,
  };
}

function createOutboxRecord(input: {
  readonly task: TaskRecord;
  readonly workflowId: string;
  readonly now: string;
}): OutboxControlRecord {
  const { task, workflowId, now } = input;
  const outboxId = 'outbox_demo_001';
  return {
    contract_version: gatewayControlContractVersion,
    outbox_id: outboxId,
    workflow_run_id: workflowId,
    workflow_id: workflowId,
    source_event_ref: createOpaqueRef(`workflow_event_${workflowId}_1`, 'workflow_event_ref', workflowId),
    destination_kind: 'portal_update',
    payload_artifact_ref: {
      artifact_id: 'artifact_demo_001',
      artifact_kind: 'trace_evidence',
      data_class: task.data_class,
      sha256: sha256Hex('safe-artifact-demo-001'),
      size_bytes: 128,
    },
    delivery_state: 'pending',
    attempt_count: 0,
    next_attempt_at: null,
    last_failure_ref: null,
    idempotency: createIdempotencyRef(`${task.request_id}:outbox`, 'outbox', outboxId, now),
    enqueued_at: now,
    delivered_at: null,
    request_id: task.request_id,
    principal_id: task.principal_id,
    project_id: task.project_id,
  };
}

function createArtifactLifecycleRecord(input: {
  readonly task: TaskRecord;
  readonly artifact: TaskArtifactControlRecord;
  readonly now: string;
}): ArtifactLifecycleControlRecord {
  const { task, artifact, now } = input;
  const artifactId = artifact.artifact_id;
  return {
    contract_version: gatewayControlContractVersion,
    lifecycle_event_id: `lifecycle_event_${artifactId}_1`,
    artifact_id: artifactId,
    workflow_run_id: artifact.workflow_run_id,
    task_id: artifact.task_id,
    action: 'created',
    state: 'active',
    storage_ref: artifact.storage_ref,
    checksum_sha256: artifact.sha256,
    retention_policy: artifact.retention_policy,
    signed_access_eligibility: {
      eligible: false,
      requires_approval: true,
      max_signed_duration_seconds: 900,
    },
    legal_hold: false,
    redacted: false,
    deletion_scheduled_at: null,
    audit_refs: [createAuditRef('audit_lifecycle_created', now)],
    idempotency: createIdempotencyRef(`${task.request_id}:lifecycle`, 'artifact_lifecycle', artifactId, now),
    principal_id: task.principal_id,
    project_id: task.project_id,
    data_class: task.data_class,
    budget_scope_id: task.budget_scope_id,
    policy_version: task.policy_version,
    registry_version: task.registry_version,
    trace_id: task.trace_id,
    trace_context_ref: createTraceContextRef(task.trace_id),
    occurred_at: now,
    request_id: task.request_id,
  };
}

function createTemplateFixtures(input: { readonly task: TaskRecord; readonly now: string }): {
  readonly template: TemplateControlRecord;
  readonly templateVersions: readonly TemplateVersionControlRecord[];
} {
  const { task, now } = input;
  const templateId = 'template_demo_001';
  const versionApprovedId = 'template_version_demo_001_v1';
  const versionDraftId = 'template_version_demo_001_v2_draft';

  const versionApproved: TemplateVersionControlRecord = {
    contract_version: gatewayControlContractVersion,
    template_id: templateId,
    template_version_id: versionApprovedId,
    version: 'v1',
    allowed_step_graph_ref: createOpaqueRef('step_graph_demo_001_v1', 'allowed_step_graph_ref', templateId),
    required_approval_policies: [
      {
        required_role: 'approver',
        required_principal_ref: null,
        fallback_approver_ref: null,
        policy_version: task.policy_version,
      },
    ],
    retry_policy_ids: [],
    allowed_agent_definition_refs: [
      {
        agent_definition_id: 'agent_definition_nonproduction_supervisor',
        agent_definition_version: 'agent-definition.v1',
        role: 'supervisor',
      },
    ],
    allowed_tool_bundles: [],
    allowed_model_aliases: ['default-safe-model-alias'],
    eval_gate_refs: [],
    rollout_state: 'approved',
    schema_ref: createSchemaRef('schema_template_demo_001_v1'),
    created_by_principal_id: task.principal_id,
    created_at: now,
    principal_id: task.principal_id,
    project_id: task.project_id,
  };

  const versionDraft: TemplateVersionControlRecord = {
    contract_version: gatewayControlContractVersion,
    template_id: templateId,
    template_version_id: versionDraftId,
    version: 'v2-draft',
    allowed_step_graph_ref: createOpaqueRef('step_graph_demo_001_v2', 'allowed_step_graph_ref', templateId),
    required_approval_policies: [],
    retry_policy_ids: [],
    allowed_agent_definition_refs: [],
    allowed_tool_bundles: [],
    allowed_model_aliases: ['default-safe-model-alias'],
    eval_gate_refs: [],
    rollout_state: 'draft',
    schema_ref: createSchemaRef('schema_template_demo_001_v2'),
    created_by_principal_id: task.principal_id,
    created_at: now,
    principal_id: task.principal_id,
    project_id: task.project_id,
  };

  const template: TemplateControlRecord = {
    contract_version: gatewayControlContractVersion,
    template_id: templateId,
    display_name: 'Demo Safe Research Workflow Template',
    description_ref: createOpaqueRef('template_desc_demo_001', 'template_description_ref', templateId),
    current_version_id: versionApprovedId,
    rollout_state: 'approved',
    owner_ref: {
      owner_type: 'project',
      owner_id: task.project_id,
      project_id: task.project_id,
      principal_id: task.principal_id,
    },
    eval_suite_refs: [],
    rollout_policy: {
      rollout_state: 'limited',
      production_enabled: false,
      allowed_project_refs: [task.project_id],
      allowed_principal_refs: [task.principal_id],
    },
    audit_refs: [createAuditRef('audit_template_registered', now)],
    created_at: now,
    updated_at: now,
    principal_id: task.principal_id,
    project_id: task.project_id,
  };

  return { template, templateVersions: [versionApproved, versionDraft] };
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

function assertRetryWorkflowCriticalFields(input: RetryWorkflowRequest): void {
  assertNonEmptyString(input.request_id, 'request_id');
  assertNonEmptyString(input.trace_id, 'trace_id');
  assertPolicyPins(input.policy_version, input.registry_version);
  assertNonEmptyString(input.idempotency_key, 'idempotency_key');
}

function assertResolveManualReviewCriticalFields(input: ResolveManualReviewRequest): void {
  assertNonEmptyString(input.request_id, 'request_id');
  assertNonEmptyString(input.trace_id, 'trace_id');
  assertPolicyPins(input.policy_version, input.registry_version);
  assertNonEmptyString(input.idempotency_key, 'idempotency_key');
  assertObject(input.resolution_ref, 'resolution_ref');
}

function assertApprovalDecisionCriticalFields(input: ApproveApprovalRequest | DenyApprovalRequest | ExpireApprovalRequest): void {
  assertNonEmptyString(input.request_id, 'request_id');
  assertNonEmptyString(input.trace_id, 'trace_id');
  assertPolicyPins(input.policy_version, input.registry_version);
}

function assertApprovalPolicyMatches(approval: ApprovalControlRecord, policyVersion: string, registryVersion: string): void {
  if (approval.policy_version !== policyVersion || approval.registry_version !== registryVersion) {
    throw stalePolicyControlError({
      approval_request_id: approval.approval_request_id,
      expected_policy_version: approval.policy_version,
      actual_policy_version: policyVersion,
      expected_registry_version: approval.registry_version,
      actual_registry_version: registryVersion,
    });
  }
}

function assertApprovalNotTerminal(approval: ApprovalControlRecord): void {
  const terminalStates: readonly string[] = ['approved', 'denied', 'expired', 'cancelled', 'superseded'];
  if (terminalStates.includes(approval.state)) {
    throw new AgentWorkflowRouteValidationError(
      `Approval ${approval.approval_request_id} is in terminal state ${approval.state} and cannot be modified.`,
      { statusCode: 409, code: 'invalid_state' },
    );
  }
}

function assertApprovalActorAuthorized(approval: ApprovalControlRecord, actor: ControlRouteAuthContext): void {
  if (actor.principalId === approval.requester_principal_id) {
    throw new AgentWorkflowRouteValidationError('approval requester cannot approve or deny their own request.', {
      statusCode: 403,
      code: 'invalid_state',
    });
  }
  const requiredPrincipal = approval.approver_policy.required_principal_ref;
  if (requiredPrincipal !== null && actor.principalId !== requiredPrincipal) {
    throw new AgentWorkflowRouteValidationError('approval actor does not match required approver principal.', {
      statusCode: 403,
      code: 'invalid_state',
    });
  }
  const actorRoles = new Set(actor.roles ?? []);
  const requiredRoles = new Set([approval.required_role, approval.approver_policy.required_role]);
  for (const requiredRole of requiredRoles) {
    if (!actorRoles.has(requiredRole)) {
      throw new AgentWorkflowRouteValidationError('approval actor does not hold required approver role.', {
        statusCode: 403,
        code: 'invalid_state',
      });
    }
  }
}

function assertSystemApprovalActor(actor: ControlRouteAuthContext): void {
  const roles = new Set(actor.roles ?? []);
  if (!roles.has('system') && !roles.has('approval_expiry_worker')) {
    throw new AgentWorkflowRouteValidationError('approval expiry requires an internal system actor.', {
      statusCode: 403,
      code: 'invalid_state',
    });
  }
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

function assertWorkflowPolicyMatches(record: WorkflowControlRecord, policyVersion: string, registryVersion: string): void {
  if (record.policy_version !== policyVersion || record.registry_version !== registryVersion) {
    throw stalePolicyControlError({
      workflow_id: record.workflow_id,
      expected_policy_version: record.policy_version,
      actual_policy_version: policyVersion,
      expected_registry_version: record.registry_version,
      actual_registry_version: registryVersion,
    });
  }
}

function assertManualReviewPolicyMatches(record: ManualReviewControlRecord, policyVersion: string, registryVersion: string): void {
  if (record.policy_version !== policyVersion || record.registry_version !== registryVersion) {
    throw stalePolicyControlError({
      manual_review_item_id: record.manual_review_item_id,
      expected_policy_version: record.policy_version,
      actual_policy_version: policyVersion,
      expected_registry_version: record.registry_version,
      actual_registry_version: registryVersion,
    });
  }
}

function assertWorkflowMutationRole(actor: ControlRouteAuthContext, operation: string): void {
  const roles = new Set(actor.roles ?? []);
  if (!roles.has('workflow_operator') && !roles.has('operator') && !roles.has('system')) {
    throw new AgentWorkflowRouteValidationError(`${operation} requires workflow_operator role.`, {
      statusCode: 403,
      code: 'invalid_state',
    });
  }
}

function assertWorkflowRetryable(workflow: WorkflowControlRecord): void {
  if (!['failed', 'timed_out', 'cancelled', 'denied', 'manual_review'].includes(workflow.status)) {
    throw new AgentWorkflowRouteValidationError(`Workflow ${workflow.workflow_id} is not in a retryable state.`, {
      statusCode: 409,
      code: 'invalid_state',
    });
  }
}

function assertRetryWorkflowReplayMatches(input: RetryWorkflowRequest, existing: WorkflowRetryControlRecord): void {
  const comparisons: readonly [string, unknown, unknown][] = [
    ['request_id', input.request_id, existing.request_id],
    ['trace_id', input.trace_id, existing.trace_id],
    ['policy_version', input.policy_version, existing.policy_version],
    ['registry_version', input.registry_version, existing.registry_version],
    ['retry_reason_ref', input.retry_reason_ref ?? null, existing.retry_reason_ref],
  ];
  const mismatch = comparisons.find(([, requested, persisted]) => !agentWorkflowValuesEqual(requested, persisted));
  if (mismatch !== undefined) {
    throw new AgentWorkflowRouteValidationError(
      `retry idempotency_key replay does not match original request ${mismatch[0]}.`,
      { statusCode: 409, code: 'invalid_state' },
    );
  }
}

function assertManualReviewActorAuthorized(record: ManualReviewControlRecord, actor: ControlRouteAuthContext): void {
  const roles = new Set(actor.roles ?? []);
  const hasRole = record.owner_role !== null && roles.has(record.owner_role);
  if (actor.principalId !== record.owner_principal_id && !hasRole && !roles.has('workflow_operator') && !roles.has('system')) {
    throw new AgentWorkflowRouteValidationError('manual review resolution requires the assigned reviewer role.', {
      statusCode: 403,
      code: 'invalid_state',
    });
  }
}

function assertResolveManualReviewReplayMatches(input: ResolveManualReviewRequest, existing: ResolveManualReviewRequest): void {
  const comparisons: readonly [string, unknown, unknown][] = [
    ['request_id', input.request_id, existing.request_id],
    ['trace_id', input.trace_id, existing.trace_id],
    ['policy_version', input.policy_version, existing.policy_version],
    ['registry_version', input.registry_version, existing.registry_version],
    ['resolution_ref', input.resolution_ref, existing.resolution_ref],
  ];
  const mismatch = comparisons.find(([, requested, persisted]) => !agentWorkflowValuesEqual(requested, persisted));
  if (mismatch !== undefined) {
    throw new AgentWorkflowRouteValidationError(
      `manual_review idempotency_key replay does not match original request ${mismatch[0]}.`,
      { statusCode: 409, code: 'invalid_state' },
    );
  }
}

function assertArtifactPolicyMatches(record: TaskArtifactControlRecord, policyVersion: string, registryVersion: string): void {
  if (record.policy_version !== policyVersion || record.registry_version !== registryVersion) {
    throw stalePolicyControlError({
      artifact_id: record.artifact_id,
      expected_policy_version: record.policy_version,
      actual_policy_version: policyVersion,
      expected_registry_version: record.registry_version,
      actual_registry_version: registryVersion,
    });
  }
}

function assertArtifactLifecyclePolicyMatches(
  record: ArtifactLifecycleControlRecord,
  policyVersion: string,
  registryVersion: string,
): void {
  if (record.policy_version !== policyVersion || record.registry_version !== registryVersion) {
    throw stalePolicyControlError({
      lifecycle_event_id: record.lifecycle_event_id,
      expected_policy_version: record.policy_version,
      actual_policy_version: policyVersion,
      expected_registry_version: record.registry_version,
      actual_registry_version: registryVersion,
    });
  }
}

function agentWorkflowValuesEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
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

function isWorkflowMutationVisible(record: WorkflowControlRecord, reader: AgentWorkflowReadContext): boolean {
  return reader.projectId !== undefined && isRecordVisibleToReader(record, reader);
}

function isArtifactVisibleToReader(record: TaskArtifactControlRecord, reader: AgentWorkflowReadContext): boolean {
  if (!isRecordVisibleToReader(record, reader)) return false;
  const projectAllowed = record.acl_scope.allowed_project_refs.includes(record.project_id);
  const principalAllowed = record.acl_scope.allowed_principal_refs.includes(reader.principalId);
  if (record.sensitivity_label === 'confidential' || record.sensitivity_label === 'restricted') {
    return projectAllowed && principalAllowed;
  }
  return projectAllowed && principalAllowed;
}

function isApprovalVisibleToReader(record: ApprovalControlRecord, reader: AgentWorkflowReadContext): boolean {
  const requiredPrincipal = record.approver_policy.required_principal_ref;
  const principalVisible =
    record.principal_id === reader.principalId ||
    record.requester_principal_id === reader.principalId ||
    requiredPrincipal === reader.principalId;
  return principalVisible && (reader.projectId === undefined || record.project_id === reader.projectId);
}

function isApprovalMutationProjectVisible(record: ApprovalControlRecord, reader: AgentWorkflowReadContext): boolean {
  return reader.projectId !== undefined && record.project_id === reader.projectId;
}

function isManualReviewVisibleToReader(record: ManualReviewControlRecord, reader: AgentWorkflowReadContext): boolean {
  const principalVisible =
    record.principal_id === reader.principalId ||
    record.owner_principal_id === reader.principalId;
  return principalVisible && (reader.projectId === undefined || record.project_id === reader.projectId);
}

function isManualReviewMutationVisible(record: ManualReviewControlRecord, reader: AgentWorkflowReadContext): boolean {
  return reader.projectId !== undefined && record.project_id === reader.projectId;
}

function leaseStatusFromRef(lease: AgentRunControlRecord['lease_ref'], now: string): WorkflowControlRecord['lease_state']['lease_status'] {
  if (lease.lease_id === null) return 'none';
  if (lease.expires_at !== null && isExpiredAt(lease.expires_at, now)) return 'expired';
  return 'active';
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

function isExpiredAt(expiresAt: string | null, now: string): boolean {
  if (expiresAt === null) return false;
  const expiresAtMs = Date.parse(expiresAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs;
}

function isTerminalArtifactLifecycle(event: ArtifactLifecycleControlRecord | undefined): boolean {
  return (
    event?.state === 'deleted' ||
    event?.state === 'redacted' ||
    event?.state === 'expired' ||
    event?.action === 'deleted' ||
    event?.action === 'redacted'
  );
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
    scope: z.enum([
      'workflow',
      'step',
      'delegation',
      'agent_run',
      'tool_call',
      'artifact_write',
      'skill_publish',
      // Track 3 scopes
      'approval',
      'outbox',
      'cancellation',
      'retry',
      'manual_review',
      'reservation_release',
      'artifact_lifecycle',
      'template_instantiation',
    ]),
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
    execution_status: z.enum(['queued', 'running', 'waiting_for_approval', 'terminal']),
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

export const retryWorkflowRequestSchema = z
  .object({
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    idempotency_key: nonEmptyStringSchema,
    retry_reason_ref: opaqueRefSchema.optional(),
  })
  .strict();

export const resolveManualReviewRequestSchema = z
  .object({
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    idempotency_key: nonEmptyStringSchema,
    resolution_ref: opaqueRefSchema,
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

export const workflowRetryResponseSchema = z
  .object({
    workflow_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    idempotency: idempotencyRefSchema,
    requested_by_principal_id: nonEmptyStringSchema,
    retry_state: z.literal('scheduled'),
    retry_reason_ref: opaqueRefSchema.nullable(),
    audit_ref: auditRefSchema,
    created_at: nonEmptyStringSchema,
  })
  .strict();

export const manualReviewResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    manual_review_item_id: nonEmptyStringSchema,
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    task_id: nonEmptyStringSchema.nullable(),
    request_id: nonEmptyStringSchema,
    reason_ref: opaqueRefSchema,
    owner_principal_id: nonEmptyStringSchema,
    owner_role: nonEmptyStringSchema.nullable(),
    blocking_state: z.enum(['blocking_workflow', 'blocking_step', 'informational']),
    review_state: z.enum(['open', 'in_progress', 'resolved', 'closed']),
    safe_actions: z.array(opaqueRefSchema),
    side_effect_refs: z.array(opaqueRefSchema),
    resolution_ref: opaqueRefSchema.nullable(),
    resolution_audit_ref: auditRefSchema.nullable(),
    idempotency: idempotencyRefSchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();

export const workflowLeaseStatusResponseSchema = z
  .object({
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    workflow_status: workflowStateSchema,
    workflow_lease: leaseStateSchema,
    agent_run_leases: z.array(
      z
        .object({
          agent_run_id: nonEmptyStringSchema,
          lease_ref: z
            .object({
              lease_id: nonEmptyStringSchema.nullable(),
              lease_owner_ref: nonEmptyStringSchema.nullable(),
              heartbeat_at: nonEmptyStringSchema.nullable(),
              expires_at: nonEmptyStringSchema.nullable(),
            })
            .strict(),
          status: agentRunStatusSchema,
        })
        .strict(),
    ),
    active_count: z.number().int().nonnegative(),
    expired_count: z.number().int().nonnegative(),
    stuck_count: z.number().int().nonnegative(),
    checked_at: nonEmptyStringSchema,
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
    storage_ref: opaqueRefSchema,
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

// ---------------------------------------------------------------------------
// Track 3: Approval schemas and types
// ---------------------------------------------------------------------------

const approvalStatusSchema = z.enum(approvalStatuses);
const approvalDecisionSchema = z.enum(approvalDecisions);
const approvalRiskTierSchema = z.enum(approvalRiskTiers);
const approverPolicyRefSchema = z
  .object({
    required_role: nonEmptyStringSchema,
    required_principal_ref: nonEmptyStringSchema.nullable(),
    fallback_approver_ref: nonEmptyStringSchema.nullable(),
    policy_version: nonEmptyStringSchema,
  })
  .strict();
const policyRefSchema = z
  .object({
    policy_version: nonEmptyStringSchema,
    policy_decision_ref: nonEmptyStringSchema,
    evaluated_at: nonEmptyStringSchema,
  })
  .strict();

const approvalDecisionRefSchema = z
  .object({
    decision_id: nonEmptyStringSchema,
    decision: approvalDecisionSchema,
    approver_principal_id: nonEmptyStringSchema,
    policy_version_at_decision: nonEmptyStringSchema,
    decision_audit_ref: auditRefSchema,
    decided_at: nonEmptyStringSchema,
  })
  .strict();

export const approveApprovalRequestSchema = z
  .object({
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    decision_artifact_ref: opaqueRefSchema.optional(),
  })
  .strict();

export const denyApprovalRequestSchema = z
  .object({
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    denial_reason_ref: opaqueRefSchema.optional(),
  })
  .strict();

export const expireApprovalRequestSchema = z
  .object({
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    expiry_reason_ref: opaqueRefSchema.optional(),
  })
  .strict();

export const approvalListQuerySchema = z
  .object({
    state: approvalStatusSchema.optional(),
    workflow_id: nonEmptyStringSchema.optional(),
    project_id: nonEmptyStringSchema.optional(),
  })
  .strict();

export const approvalParamsSchema = z.object({ approval_request_id: nonEmptyStringSchema }).strict();

export const approvalResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    approval_request_id: nonEmptyStringSchema,
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    task_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    step_id: nonEmptyStringSchema.nullable(),
    delegation_id: nonEmptyStringSchema.nullable(),
    tool_call_id: nonEmptyStringSchema.nullable(),
    requester_principal_id: nonEmptyStringSchema,
    approver_principal_id: nonEmptyStringSchema.nullable(),
    required_role: nonEmptyStringSchema,
    approver_policy: approverPolicyRefSchema,
    risk_tier: approvalRiskTierSchema,
    action_summary_artifact_ref: artifactRefSchema,
    state: approvalStatusSchema,
    decision_ref: approvalDecisionRefSchema.nullable(),
    expires_at: nonEmptyStringSchema,
    policy_ref: policyRefSchema,
    audit_refs: z.array(auditRefSchema),
    idempotency: idempotencyRefSchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    trace_context_ref: traceContextRefSchema,
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();

export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;

export function toApprovalResponse(record: ApprovalControlRecord): ApprovalResponse {
  return {
    contract_version: record.contract_version,
    approval_request_id: record.approval_request_id,
    workflow_id: record.workflow_id,
    workflow_run_id: record.workflow_run_id,
    task_id: record.task_id,
    request_id: record.request_id,
    step_id: record.step_id,
    delegation_id: record.delegation_id,
    tool_call_id: record.tool_call_id,
    requester_principal_id: record.requester_principal_id,
    approver_principal_id: record.approver_principal_id,
    required_role: record.required_role,
    approver_policy: record.approver_policy,
    risk_tier: record.risk_tier,
    action_summary_artifact_ref: record.action_summary_artifact_ref,
    state: record.state,
    decision_ref: record.decision_ref,
    expires_at: record.expires_at,
    policy_ref: record.policy_ref,
    audit_refs: [...record.audit_refs],
    idempotency: record.idempotency,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    trace_context_ref: record.trace_context_ref,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function asApproveApprovalRequest(body: unknown): ApproveApprovalRequest {
  const input = approveApprovalRequestSchema.parse(body);
  assertNoForbiddenAgentWorkflowFields(input);
  return input;
}

export function asDenyApprovalRequest(body: unknown): DenyApprovalRequest {
  const input = denyApprovalRequestSchema.parse(body);
  assertNoForbiddenAgentWorkflowFields(input);
  return input;
}

export function asExpireApprovalRequest(body: unknown): ExpireApprovalRequest {
  const input = expireApprovalRequestSchema.parse(body);
  assertNoForbiddenAgentWorkflowFields(input);
  return input;
}

export function asApprovalListFilter(query: unknown): ApprovalListFilter {
  if (query === undefined) return {};
  return approvalListQuerySchema.parse(query);
}

// ---------------------------------------------------------------------------
// Track 3: Outbox schemas, types, and response mappers
// ---------------------------------------------------------------------------

const outboxDeliveryStateSchema = z.enum(outboxDeliveryStates);
const outboxDestinationKindSchema = z.enum(outboxDestinationKinds);

export const outboxListQuerySchema = z
  .object({
    workflow_id: nonEmptyStringSchema.optional(),
    delivery_state: outboxDeliveryStateSchema.optional(),
    destination_kind: outboxDestinationKindSchema.optional(),
  })
  .strict();

export const outboxParamsSchema = z.object({ outbox_id: nonEmptyStringSchema }).strict();

export const outboxResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    outbox_id: nonEmptyStringSchema,
    workflow_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    source_event_ref: opaqueRefSchema,
    destination_kind: outboxDestinationKindSchema,
    payload_artifact_ref: artifactRefSchema.nullable(),
    delivery_state: outboxDeliveryStateSchema,
    attempt_count: z.number().int().nonnegative(),
    next_attempt_at: nonEmptyStringSchema.nullable(),
    last_failure_ref: opaqueRefSchema.nullable(),
    idempotency: idempotencyRefSchema,
    enqueued_at: nonEmptyStringSchema,
    delivered_at: nonEmptyStringSchema.nullable(),
  })
  .strict();

export const outboxStatusResponseSchema = z
  .object({
    counts_by_state: z.record(outboxDeliveryStateSchema, z.number().int().nonnegative()),
    counts_by_destination: z.record(outboxDestinationKindSchema, z.number().int().nonnegative()),
    backlog_count: z.number().int().nonnegative(),
    failed_count: z.number().int().nonnegative(),
    dead_lettered_count: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export type OutboxResponse = z.infer<typeof outboxResponseSchema>;
export type OutboxStatusResponse = z.infer<typeof outboxStatusResponseSchema>;

export function toOutboxResponse(record: OutboxControlRecord): OutboxResponse {
  return {
    contract_version: record.contract_version,
    outbox_id: record.outbox_id,
    workflow_id: record.workflow_id,
    workflow_run_id: record.workflow_run_id,
    request_id: record.request_id,
    principal_id: record.principal_id,
    project_id: record.project_id,
    source_event_ref: record.source_event_ref,
    destination_kind: record.destination_kind,
    payload_artifact_ref: record.payload_artifact_ref,
    delivery_state: record.delivery_state,
    attempt_count: record.attempt_count,
    next_attempt_at: record.next_attempt_at,
    last_failure_ref: record.last_failure_ref,
    idempotency: record.idempotency,
    enqueued_at: record.enqueued_at,
    delivered_at: record.delivered_at,
  };
}

export function asOutboxListFilter(query: unknown): OutboxListFilter {
  if (query === undefined) return {};
  return outboxListQuerySchema.parse(query);
}

// ---------------------------------------------------------------------------
// Track 3: Artifact lifecycle schemas, types, response mappers, and helpers
// ---------------------------------------------------------------------------

const artifactLifecycleActionSchema = z.enum(artifactLifecycleActions);
const artifactLifecycleStateSchema = z.enum(artifactLifecycleStates);

const artifactSignedAccessEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    requires_approval: z.boolean(),
    max_signed_duration_seconds: z.number().int().nonnegative().nullable(),
  })
  .strict();

const artifactRetentionPolicySchema = z
  .object({
    retained_until: nonEmptyStringSchema.nullable(),
    delete_after_seconds: z.number().int().nonnegative().nullable(),
    legal_hold: z.boolean(),
  })
  .strict();

export const artifactParamsSchema = z.object({ artifact_id: nonEmptyStringSchema }).strict();

export const artifactSignedAccessRequestSchema = z
  .object({
    request_id: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    requested_duration_seconds: z.number().int().positive().max(900).optional(),
  })
  .strict();

export const artifactLifecycleEventResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    lifecycle_event_id: nonEmptyStringSchema,
    artifact_id: nonEmptyStringSchema,
    workflow_run_id: nonEmptyStringSchema,
    task_id: nonEmptyStringSchema,
    request_id: nonEmptyStringSchema,
    action: artifactLifecycleActionSchema,
    state: artifactLifecycleStateSchema,
    storage_ref: opaqueRefSchema,
    checksum_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u),
    retention_policy: artifactRetentionPolicySchema,
    signed_access_eligibility: artifactSignedAccessEligibilitySchema,
    legal_hold: z.boolean(),
    redacted: z.boolean(),
    deletion_scheduled_at: nonEmptyStringSchema.nullable(),
    audit_refs: z.array(auditRefSchema),
    idempotency: idempotencyRefSchema,
    principal_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema,
    data_class: dataClassSchema,
    budget_scope_id: nonEmptyStringSchema,
    policy_version: nonEmptyStringSchema,
    registry_version: nonEmptyStringSchema,
    trace_id: nonEmptyStringSchema,
    trace_context_ref: traceContextRefSchema,
    occurred_at: nonEmptyStringSchema,
  })
  .strict();

export const artifactLifecycleStatusResponseSchema = z
  .object({
    artifact_id: nonEmptyStringSchema,
    latest_state: artifactLifecycleStateSchema.nullable(),
    latest_action: artifactLifecycleActionSchema.nullable(),
    legal_hold: z.boolean(),
    redacted: z.boolean(),
    deletion_scheduled_at: nonEmptyStringSchema.nullable(),
    signed_access_eligibility: artifactSignedAccessEligibilitySchema,
    event_count: z.number().int().nonnegative(),
  })
  .strict();

const artifactSignedAccessDecisionSchema = z.enum(['eligible', 'approval_required', 'ineligible']);

export const artifactSignedAccessDecisionResponseSchema = z
  .object({
    artifact_id: nonEmptyStringSchema,
    decision: artifactSignedAccessDecisionSchema,
    decision_reason: nonEmptyStringSchema,
    eligible: z.boolean(),
    requires_approval: z.boolean(),
    max_signed_duration_seconds: z.number().int().nonnegative().nullable(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u),
    signed_access: z
      .object({
        signed_url: z.string().url(),
        expires_at: nonEmptyStringSchema,
        ttl_seconds: z.number().int().positive().max(900),
        sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ArtifactLifecycleEventResponse = z.infer<typeof artifactLifecycleEventResponseSchema>;
export type ArtifactLifecycleStatusResponse = z.infer<typeof artifactLifecycleStatusResponseSchema>;
export type ArtifactSignedAccessDecisionResponse = z.infer<typeof artifactSignedAccessDecisionResponseSchema>;

export function toArtifactLifecycleEventResponse(record: ArtifactLifecycleControlRecord): ArtifactLifecycleEventResponse {
  return {
    contract_version: record.contract_version,
    lifecycle_event_id: record.lifecycle_event_id,
    artifact_id: record.artifact_id,
    workflow_run_id: record.workflow_run_id,
    task_id: record.task_id,
    request_id: record.request_id,
    action: record.action,
    state: record.state,
    storage_ref: createOpaqueRef(`storage_ref_${record.artifact_id}`, 'artifact_storage_ref', record.project_id),
    checksum_sha256: record.checksum_sha256,
    retention_policy: record.retention_policy,
    signed_access_eligibility: record.signed_access_eligibility,
    legal_hold: record.legal_hold,
    redacted: record.redacted,
    deletion_scheduled_at: record.deletion_scheduled_at,
    audit_refs: [...record.audit_refs],
    idempotency: record.idempotency,
    principal_id: record.principal_id,
    project_id: record.project_id,
    data_class: record.data_class,
    budget_scope_id: record.budget_scope_id,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    trace_id: record.trace_id,
    trace_context_ref: record.trace_context_ref,
    occurred_at: record.occurred_at,
  };
}

export function asArtifactSignedAccessRequest(body: unknown): ArtifactSignedAccessRequest {
  const input = artifactSignedAccessRequestSchema.parse(body);
  assertNoForbiddenAgentWorkflowFields(input);
  return input;
}

// ---------------------------------------------------------------------------
// Track 3: Workflow template schemas, types, response mappers, and helpers
// ---------------------------------------------------------------------------

const workflowTemplateRolloutStateSchema = z.enum(workflowTemplateRolloutStates);

export const templateParamsSchema = z.object({ template_id: nonEmptyStringSchema }).strict();
export const templateVersionParamsSchema = z.object({ template_version_id: nonEmptyStringSchema }).strict();

export const templateListQuerySchema = z
  .object({
    rollout_state: workflowTemplateRolloutStateSchema.optional(),
    project_id: nonEmptyStringSchema.optional(),
  })
  .strict();

export const templateVersionListQuerySchema = z
  .object({
    rollout_state: workflowTemplateRolloutStateSchema.optional(),
  })
  .strict();

const ownerRefSchema = z
  .object({
    owner_type: z.enum(['principal', 'team', 'project', 'service']),
    owner_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema.nullable(),
    principal_id: nonEmptyStringSchema.nullable(),
  })
  .strict();

const templateRolloutPolicySchema = z
  .object({
    rollout_state: z.enum(['none', 'limited', 'production', 'disabled']),
    production_enabled: z.boolean(),
    allowed_project_refs: z.array(z.string()),
    allowed_principal_refs: z.array(z.string()),
  })
  .strict();

const templateApproverPolicyRefSchema = z
  .object({
    required_role: nonEmptyStringSchema,
    required_principal_ref: nonEmptyStringSchema.nullable(),
    fallback_approver_ref: nonEmptyStringSchema.nullable(),
    policy_version: nonEmptyStringSchema,
  })
  .strict();

const agentDefinitionRefSchema = z
  .object({
    agent_definition_id: nonEmptyStringSchema,
    agent_definition_version: nonEmptyStringSchema,
    role: z.enum(agentRoles),
  })
  .strict();

const evalSuiteRefSchema = z
  .object({
    eval_suite_id: nonEmptyStringSchema,
    eval_suite_version: nonEmptyStringSchema,
    gate_result_ref: opaqueRefSchema,
  })
  .strict();

const templateToolRefSchema = z
  .object({
    tool_definition_id: nonEmptyStringSchema,
    tool_version: nonEmptyStringSchema,
    risk_tier: z.enum(['read_only_low', 'read_only_medium', 'approval_required', 'disallowed_write', 'network_restricted']),
  })
  .strict();

const toolBundleRefSchema = z
  .object({
    tool_bundle_id: nonEmptyStringSchema,
    tool_bundle_version: nonEmptyStringSchema,
    allowed_tool_refs: z.array(templateToolRefSchema),
    disallowed_tool_refs: z.array(templateToolRefSchema),
    policy_version: nonEmptyStringSchema,
  })
  .strict();

export const templateResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    template_id: nonEmptyStringSchema,
    display_name: nonEmptyStringSchema,
    description_ref: opaqueRefSchema,
    current_version_id: nonEmptyStringSchema,
    rollout_state: workflowTemplateRolloutStateSchema,
    owner_ref: ownerRefSchema,
    eval_suite_refs: z.array(evalSuiteRefSchema),
    rollout_policy: templateRolloutPolicySchema,
    audit_refs: z.array(auditRefSchema),
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema,
  })
  .strict();

export const templateVersionResponseSchema = z
  .object({
    contract_version: z.literal(gatewayControlContractVersion),
    template_id: nonEmptyStringSchema,
    template_version_id: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
    allowed_step_graph_ref: opaqueRefSchema,
    required_approval_policies: z.array(templateApproverPolicyRefSchema),
    retry_policy_ids: z.array(z.string()),
    allowed_agent_definition_refs: z.array(agentDefinitionRefSchema),
    allowed_tool_bundles: z.array(toolBundleRefSchema),
    allowed_model_aliases: z.array(z.string()),
    eval_gate_refs: z.array(evalSuiteRefSchema),
    rollout_state: workflowTemplateRolloutStateSchema,
    schema_ref: schemaRefSchema,
    created_by_principal_id: nonEmptyStringSchema,
    created_at: nonEmptyStringSchema,
  })
  .strict();

export type TemplateResponse = z.infer<typeof templateResponseSchema>;
export type TemplateVersionResponse = z.infer<typeof templateVersionResponseSchema>;

export function toWorkflowTemplateResponse(record: TemplateControlRecord): TemplateResponse {
  return {
    contract_version: record.contract_version,
    template_id: record.template_id,
    display_name: record.display_name,
    description_ref: record.description_ref,
    current_version_id: record.current_version_id,
    rollout_state: record.rollout_state,
    owner_ref: record.owner_ref,
    eval_suite_refs: record.eval_suite_refs.map((ref) => ({ ...ref })),
    rollout_policy: {
      ...record.rollout_policy,
      allowed_project_refs: [...record.rollout_policy.allowed_project_refs],
      allowed_principal_refs: [...record.rollout_policy.allowed_principal_refs],
    },
    audit_refs: record.audit_refs.map((ref) => ({ ...ref })),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function toWorkflowTemplateVersionResponse(record: TemplateVersionControlRecord): TemplateVersionResponse {
  return {
    contract_version: record.contract_version,
    template_id: record.template_id,
    template_version_id: record.template_version_id,
    version: record.version,
    allowed_step_graph_ref: record.allowed_step_graph_ref,
    required_approval_policies: record.required_approval_policies.map((policy) => ({ ...policy })),
    retry_policy_ids: [...record.retry_policy_ids],
    allowed_agent_definition_refs: record.allowed_agent_definition_refs.map((ref) => ({ ...ref })),
    allowed_tool_bundles: record.allowed_tool_bundles.map((bundle) => ({
      ...bundle,
      allowed_tool_refs: bundle.allowed_tool_refs.map((ref) => ({ ...ref })),
      disallowed_tool_refs: bundle.disallowed_tool_refs.map((ref) => ({ ...ref })),
    })),
    allowed_model_aliases: [...record.allowed_model_aliases],
    eval_gate_refs: record.eval_gate_refs.map((ref) => ({ ...ref })),
    rollout_state: record.rollout_state,
    schema_ref: record.schema_ref,
    created_by_principal_id: record.created_by_principal_id,
    created_at: record.created_at,
  };
}

export function asWorkflowTemplateListFilter(query: unknown): WorkflowTemplateListFilter {
  if (query === undefined) return {};
  return templateListQuerySchema.parse(query);
}

export function asWorkflowTemplateVersionListFilter(query: unknown): WorkflowTemplateVersionListFilter {
  if (query === undefined) return {};
  return templateVersionListQuerySchema.parse(query);
}
