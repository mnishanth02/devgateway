import { gatewayControlContractVersion, type DataClass, type GatewayControlContractVersion } from './gateway-control.ts';

export const agentWorkflowContractVersion = gatewayControlContractVersion;

export const workflowStates = [
  'created',
  'queued',
  'planning',
  'delegating',
  'running',
  'waiting_on_child',
  'synthesizing',
  // Track 3: pause/gate states
  'pending_approval',
  'cancel_requested',
  'manual_review',
  'succeeded',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'denied',
] as const;
export const workflowTerminalStates = ['succeeded', 'completed', 'failed', 'cancelled', 'timed_out', 'denied'] as const;
export const workflowAllowedTransitions = {
  created: ['queued', 'failed', 'denied'],
  queued: ['planning', 'pending_approval', 'cancel_requested', 'cancelled', 'timed_out', 'failed', 'denied'],
  planning: ['delegating', 'running', 'waiting_on_child', 'pending_approval', 'cancel_requested', 'manual_review', 'cancelled', 'timed_out', 'failed', 'denied'],
  delegating: ['running', 'pending_approval', 'cancel_requested', 'manual_review', 'cancelled', 'timed_out', 'failed', 'denied'],
  running: ['waiting_on_child', 'synthesizing', 'pending_approval', 'cancel_requested', 'manual_review', 'succeeded', 'cancelled', 'timed_out', 'failed', 'denied'],
  waiting_on_child: ['running', 'synthesizing', 'cancel_requested', 'cancelled', 'timed_out', 'failed', 'denied'],
  synthesizing: ['succeeded', 'completed', 'cancel_requested', 'manual_review', 'cancelled', 'timed_out', 'failed', 'denied'],
  // Track 3 pause/gate transitions
  pending_approval: ['running', 'planning', 'cancel_requested', 'cancelled', 'timed_out', 'failed', 'denied'],
  cancel_requested: ['cancelled', 'manual_review', 'failed'],
  manual_review: ['running', 'cancelled', 'failed'],
  succeeded: [],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  denied: [],
} satisfies Readonly<Record<WorkflowState, readonly WorkflowState[]>>;

export const workflowEventTypes = [
  'workflow_created',
  'state_transitioned',
  'workflow_state_changed',
  'step_created',
  'step_state_changed',
  'agent_run_started',
  'delegation_created',
  'delegation_completed',
  'delegation_state_changed',
  'tool_call_decided',
  'agent_run_state_changed',
  'tool_call_state_changed',
  'artifact_recorded',
  'budget_recorded',
  'budget_reserved',
  'cost_recorded',
  'audit_recorded',
  'heartbeat',
  'lease_acquired',
  'lease_released',
  'workflow_completed',
  'workflow_failed',
  'error',
  'cancel_requested',
  // Track 3: approval events
  'approval_requested',
  'approval_approved',
  'approval_denied',
  'approval_expired',
  // Track 3: retry events
  'retry_scheduled',
  'retry_executed',
  'retry_exhausted',
  // Track 3: outbox events
  'outbox_enqueued',
  'outbox_delivered',
  'outbox_failed',
  // Track 3: cancellation events
  'cancellation_observed',
  'cancellation_completed',
  // Track 3: manual-review events
  'manual_review_opened',
  'manual_review_resolved',
  // Track 3: artifact lifecycle events
  'artifact_lifecycle_changed',
  // Track 3: template events
  'template_instantiated',
] as const;

export const agentRoles = ['supervisor', 'planner', 'researcher', 'synthesizer', 'reviewer', 'tool_executor', 'custom'] as const;
export const agentDefinitionStatuses = ['draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled'] as const;
export const agentRunStatuses = [
  'queued',
  'leased',
  'running',
  'waiting_on_child',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'denied',
] as const;
export const delegationStatuses = ['draft', 'queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'denied'] as const;
export const subAgentResultStatuses = ['succeeded', 'failed', 'cancelled', 'timed_out', 'denied', 'invalid_output'] as const;

export const artifactSensitivityLabels = ['public', 'internal', 'confidential', 'restricted'] as const;
export const artifactKinds = [
  'workflow_input_ref',
  'delegation_result',
  'tool_result',
  'citation',
  'trace_evidence',
  'cost_report',
  'audit_report',
  'schema_validation',
  'runtime_log',
  'other',
] as const;
export const artifactSourceKinds = ['workflow', 'delegation', 'agent_run', 'tool_call', 'eval', 'upload'] as const;

export const toolRiskTiers = [
  'read_only_low',
  'read_only_medium',
  'approval_required',
  'disallowed_write',
  'network_restricted',
] as const;
export const toolPolicyDecisions = ['allow', 'deny', 'review'] as const;
export const toolCallStatuses = ['queued', 'running', 'succeeded', 'failed', 'denied', 'cancelled', 'timed_out'] as const;
export const toolDefinitionStatuses = ['draft', 'active', 'disabled', 'archived'] as const;

export const skillLifecycleStates = ['draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled'] as const;

export const agentWorkflowMetadataForbiddenFields = [
  'one_time_secret',
  'raw_secret',
  'secret',
  'value',
  'provider_key',
  'provider_secret',
  'api_key',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'authorization',
  'password',
  'private_key',
  'credential',
  'signed_url',
  'raw_context',
  'raw_artifact',
  'raw_input',
  'raw_output',
  'raw_prompt',
  'raw_completion',
] as const;

export type AgentWorkflowContractVersion = typeof agentWorkflowContractVersion;
export type WorkflowState = (typeof workflowStates)[number];
export type WorkflowTerminalState = (typeof workflowTerminalStates)[number];
export type WorkflowEventType = (typeof workflowEventTypes)[number];
export type AgentRole = (typeof agentRoles)[number];
export type AgentDefinitionStatus = (typeof agentDefinitionStatuses)[number];
export type AgentRunStatus = (typeof agentRunStatuses)[number];
export type DelegationStatus = (typeof delegationStatuses)[number];
export type SubAgentResultStatus = (typeof subAgentResultStatuses)[number];
export type ArtifactSensitivityLabel = (typeof artifactSensitivityLabels)[number];
export type ArtifactKind = (typeof artifactKinds)[number];
export type ArtifactSourceKind = (typeof artifactSourceKinds)[number];
export type ToolRiskTier = (typeof toolRiskTiers)[number];
export type ToolPolicyDecision = (typeof toolPolicyDecisions)[number];
export type ToolCallStatus = (typeof toolCallStatuses)[number];
export type ToolDefinitionStatus = (typeof toolDefinitionStatuses)[number];
export type SkillLifecycleState = (typeof skillLifecycleStates)[number];
export type AgentWorkflowMetadataForbiddenField = (typeof agentWorkflowMetadataForbiddenFields)[number];
export type ToolClass = string;
export type NullableDateTime = string | null;
export type IdempotencyScope =
  | 'workflow'
  | 'step'
  | 'delegation'
  | 'agent_run'
  | 'tool_call'
  | 'artifact_write'
  | 'skill_publish'
  // Track 3 scopes
  | 'approval'
  | 'outbox'
  | 'cancellation'
  | 'retry'
  | 'manual_review'
  | 'reservation_release'
  | 'artifact_lifecycle'
  | 'template_instantiation';
export type SchemaEnforcement =
  | 'validate_before_dispatch'
  | 'validate_before_execution'
  | 'validate_before_synthesis'
  | 'validate_before_persist';
export type CostPhase = 'estimate' | 'reservation' | 'settlement' | 'release' | 'reconciliation';
export type AgentFailureType =
  | 'policy_denial'
  | 'budget_denial'
  | 'timeout'
  | 'validation_error'
  | 'tool_denial'
  | 'runtime_error'
  | 'cancelled';

export interface AgentWorkflowScopeRef {
  readonly principal_id: string;
  readonly project_id: string;
  readonly data_class: DataClass;
  readonly budget_scope_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
}

export interface TraceContextRef {
  readonly trace_context_id: string;
  readonly span_id: string;
  readonly propagation_ref: string;
}

export interface AgentWorkflowTraceRef {
  readonly trace_id: string;
  readonly trace_context_ref: TraceContextRef;
}

export interface ScopedAgentContractFields extends AgentWorkflowScopeRef, AgentWorkflowTraceRef {
  readonly contract_version: GatewayControlContractVersion;
}

export interface SchemaRef {
  readonly schema_id: string;
  readonly json_pointer: string;
  readonly schema_version: string;
  readonly enforcement: SchemaEnforcement;
}

export type OutputSchemaRef = SchemaRef;

export interface OpaqueRef {
  readonly ref_id: string;
  readonly ref_type: string;
  readonly scope_ref: string;
}

export type OpaqueContextRef = OpaqueRef;

export interface ToolRef {
  readonly tool_definition_id: string;
  readonly tool_version: string;
  readonly risk_tier: ToolRiskTier;
}

export interface ToolBundleRef {
  readonly tool_bundle_id: string;
  readonly tool_bundle_version: string;
  readonly allowed_tool_refs: readonly ToolRef[];
  readonly disallowed_tool_refs: readonly ToolRef[];
  readonly policy_version: string;
}

export interface OwnerRef {
  readonly owner_type: 'principal' | 'team' | 'project' | 'service';
  readonly owner_id: string;
  readonly project_id: string | null;
  readonly principal_id: string | null;
}

export interface EvalSuiteRef {
  readonly eval_suite_id: string;
  readonly eval_suite_version: string;
  readonly gate_result_ref: OpaqueRef;
}

export interface RolloutPolicy {
  readonly rollout_state: 'none' | 'limited' | 'production' | 'disabled';
  readonly production_enabled: boolean;
  readonly allowed_project_refs: readonly string[];
  readonly allowed_principal_refs: readonly string[];
}

export interface AgentDefinitionRef {
  readonly agent_definition_id: string;
  readonly agent_definition_version: string;
  readonly role: AgentRole;
}

export interface TimeoutPolicy {
  readonly queue_seconds: number;
  readonly execution_seconds: number;
  readonly idle_seconds: number;
  readonly overall_seconds: number;
}

export interface IdempotencyRef {
  readonly idempotency_key: string;
  readonly scope: IdempotencyScope;
  readonly dedupe_ref: string;
  readonly expires_at: string;
}

export interface ArtifactRef {
  readonly artifact_id: string;
  readonly artifact_kind: string;
  readonly data_class: DataClass;
  readonly sha256: string;
  readonly size_bytes: number;
}

export interface TaskArtifactRef extends ArtifactRef {
  readonly artifact_kind: ArtifactKind;
}

export interface AuditRef {
  readonly audit_event_id: string;
  readonly audit_stream: string;
  readonly recorded_at: string;
}

export interface CostRef {
  readonly cost_event_id: string;
  readonly budget_scope_id: string;
  readonly cost_phase: CostPhase;
  readonly recorded_at: string;
}

export interface LeaseRef {
  readonly lease_id: string | null;
  readonly lease_owner_ref: string | null;
  readonly heartbeat_at: NullableDateTime;
  readonly expires_at: NullableDateTime;
}

export interface LeaseState extends LeaseRef {
  readonly lease_status: 'none' | 'active' | 'expired' | 'released';
}

export interface BudgetReservationRef {
  readonly reservation_id: string;
  readonly budget_scope_id: string;
  readonly currency: string;
  readonly reserved_amount: number;
  readonly reservation_status: 'reserved' | 'settled' | 'released' | 'denied';
}

export interface ApprovalPolicy {
  readonly approval_required: boolean;
  readonly approval_ref: string | null;
  readonly approver_ref: string | null;
  readonly policy_ref: string;
}

export interface ProvenanceRequirement {
  readonly citation_required: boolean;
  readonly artifact_reference_required: boolean;
  readonly minimum_confidence: number;
  readonly allowed_source_classes: readonly (DataClass | 'verified_tool' | 'system')[];
}

export interface FailureRef {
  readonly failure_type: AgentFailureType;
  readonly failure_code: string;
  readonly failure_ref: string;
  readonly retryable: boolean;
}

export type FailureCause = FailureRef;

export interface WorkflowStepRef {
  readonly step_id: string;
  readonly step_type: 'plan' | 'delegate' | 'agent' | 'tool' | 'synthesize' | 'review' | 'artifact' | 'approval_gate';
  readonly step_status: WorkflowState;
  readonly agent_run_id: string | null;
  readonly delegation_id: string | null;
}

export interface WorkflowStateTransition {
  readonly from_status: WorkflowState | null;
  readonly to_status: WorkflowState | null;
  readonly transition_reason_ref: string | null;
}

export interface WorkflowEventActorRef {
  readonly actor_type: 'system' | 'principal' | 'agent' | 'tool' | 'worker';
  readonly actor_ref: string;
  readonly principal_id: string | null;
}

export interface StructuredResultRef {
  readonly result_ref_id: string;
  readonly schema_ref: SchemaRef;
  readonly artifact_ref: ArtifactRef;
  readonly validation_status: 'not_validated' | 'valid' | 'invalid';
}

export interface CitationRef {
  readonly citation_ref_id: string;
  readonly artifact_ref: ArtifactRef;
  readonly locator_ref: string;
  readonly source_class: DataClass | 'verified_tool' | 'system';
  readonly retrieved_at: string;
}

export interface UsageRef {
  readonly usage_id: string;
  readonly measurement_ref: string;
  readonly cost_refs: readonly CostRef[];
}

export interface PolicyRef {
  readonly policy_version: string;
  readonly policy_decision_ref: string;
  readonly evaluated_at: string;
}

export interface StorageRef {
  readonly storage_system: 's3' | 'azure_blob' | 'gcs' | 'filesystem' | 'artifact_service';
  readonly container_ref: string;
  readonly object_path_ref: string;
  readonly version_ref: string | null;
}

export interface TaskArtifactOwnerRef {
  readonly owner_type: 'workflow' | 'delegation' | 'agent_run' | 'tool_call' | 'skill' | 'principal';
  readonly owner_id: string;
  readonly principal_id: string;
  readonly project_id: string;
}

export interface ArtifactSourceRef {
  readonly source_type: ArtifactSourceKind;
  readonly source_id: string;
  readonly produced_by_ref: string;
}

export interface ArtifactRetentionPolicy {
  readonly retained_until: NullableDateTime;
  readonly delete_after_seconds: number | null;
  readonly legal_hold: boolean;
}

export interface ArtifactSignedAccessPolicy {
  readonly signed_access_allowed: boolean;
  readonly expires_at: NullableDateTime;
  readonly audience_scope_ref: string;
}

export interface ArtifactSignedUrlPolicy extends ArtifactSignedAccessPolicy {}

export interface ArtifactSignedAccessEligibility {
  readonly eligible: boolean;
  readonly requires_approval: boolean;
  readonly max_signed_duration_seconds: number | null;
}

export interface ArtifactAclScope {
  readonly budget_scope_id: string;
  readonly allowed_project_refs: readonly string[];
  readonly allowed_principal_refs: readonly string[];
}

export interface ToolDefinitionRef {
  readonly tool_definition_id: string;
  readonly tool_version: string;
  readonly tool_server_ref: string;
  readonly operation_ref: string;
  readonly input_schema_ref: SchemaRef;
  readonly output_schema_ref: SchemaRef;
}

export interface ArgumentsRef {
  readonly argument_set_ref: string;
  readonly schema_ref: SchemaRef;
  readonly sha256: string;
}

export interface ToolPolicyDecisionRecord {
  readonly decision: ToolPolicyDecision;
  readonly policy_ref: string;
  readonly denial_reason: string | null;
  readonly evaluated_at: string;
}

export interface ApprovalRef {
  readonly approval_ref: string;
  readonly approver_ref: string;
  readonly approved_at: string;
}

export interface ToolCallResultReference {
  readonly tool_call_id: string;
  readonly status: ToolCallStatus;
  readonly result_artifact_refs: readonly ArtifactRef[];
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
}

export interface AgentDefinitionRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly agent_definition_id: string;
  readonly agent_definition_version: string;
  readonly role: AgentRole;
  readonly status: AgentDefinitionStatus;
  readonly owner_ref: OwnerRef;
  readonly allowed_model_aliases: readonly string[];
  readonly allowed_tool_bundles: readonly ToolBundleRef[];
  readonly output_schema_refs: readonly SchemaRef[];
  readonly instruction_template_refs: readonly OpaqueRef[];
  readonly eval_suite_refs: readonly EvalSuiteRef[];
  readonly rollout_policy: RolloutPolicy;
  readonly gate_result_refs: readonly OpaqueRef[];
  readonly policy_version: string;
  readonly registry_version: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorkflowStateRecord extends ScopedAgentContractFields {
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly workflow_version: string;
  readonly status: WorkflowState;
  readonly current_step_ref: WorkflowStepRef;
  readonly allowed_transitions: readonly WorkflowState[];
  readonly idempotency_refs: readonly IdempotencyRef[];
  readonly lease_state: LeaseState;
  readonly resume_ref: OpaqueRef | null;
  readonly terminal_failure_ref: FailureRef | null;
  readonly artifact_refs: readonly ArtifactRef[];
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
  readonly created_at: string;
  readonly updated_at: string;
}

export type WorkflowRunRecord = WorkflowStateRecord;

export interface WorkflowEventRecord extends ScopedAgentContractFields {
  readonly workflow_event_id: string;
  readonly workflow_run_id: string;
  readonly sequence_number: number;
  readonly event_type: WorkflowEventType;
  readonly actor_ref: WorkflowEventActorRef;
  readonly state_transition: WorkflowStateTransition;
  readonly step_ref: OpaqueRef;
  readonly agent_run_ref: OpaqueRef | null;
  readonly delegation_ref: OpaqueRef | null;
  readonly tool_call_ref: OpaqueRef | null;
  readonly event_metadata_ref: OpaqueRef;
  readonly artifact_refs: readonly ArtifactRef[];
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
  readonly idempotency: IdempotencyRef;
  readonly occurred_at: string;
}

export interface AgentRunRecord extends ScopedAgentContractFields {
  readonly agent_run_id: string;
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly delegation_id: string | null;
  readonly parent_agent_run_id: string | null;
  readonly agent_definition_ref: AgentDefinitionRef;
  readonly role: AgentRole;
  readonly status: AgentRunStatus;
  readonly model_alias: string;
  readonly output_schema_ref: SchemaRef;
  readonly timeouts: TimeoutPolicy;
  readonly idempotency: IdempotencyRef;
  readonly allowed_tool_refs: readonly ToolRef[];
  readonly disallowed_tool_refs: readonly ToolRef[];
  readonly context_refs: readonly OpaqueContextRef[];
  readonly child_agent_run_refs: readonly OpaqueRef[];
  readonly artifact_refs: readonly ArtifactRef[];
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
  readonly lease_ref: LeaseRef;
  readonly started_at: NullableDateTime;
  readonly completed_at: NullableDateTime;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface DelegationRecord extends ScopedAgentContractFields {
  readonly delegation_id: string;
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly parent_agent_run_id: string;
  readonly child_agent_definition_ref: AgentDefinitionRef;
  readonly status: DelegationStatus;
  readonly task_type: 'plan' | 'research' | 'analysis' | 'code_review' | 'synthesis' | 'tool_execution' | 'custom';
  readonly model_alias: string;
  readonly input_context_refs: readonly OpaqueContextRef[];
  readonly allowed_tool_refs: readonly ToolRef[];
  readonly disallowed_tool_refs: readonly ToolRef[];
  readonly budget_reservation_ref: BudgetReservationRef;
  readonly timeouts: TimeoutPolicy;
  readonly output_schema_ref: SchemaRef;
  readonly approval_policy: ApprovalPolicy;
  readonly provenance_requirement: ProvenanceRequirement;
  readonly idempotency: IdempotencyRef;
  readonly artifact_refs: readonly ArtifactRef[];
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SubAgentResultRecord extends ScopedAgentContractFields {
  readonly sub_agent_result_id: string;
  readonly delegation_id: string;
  readonly workflow_run_id: string;
  readonly agent_run_id: string;
  readonly status: SubAgentResultStatus;
  readonly output_schema_ref: SchemaRef;
  readonly validation_status: 'not_validated' | 'valid' | 'invalid';
  readonly confidence: number;
  readonly structured_result_ref: StructuredResultRef | null;
  readonly citation_refs: readonly CitationRef[];
  readonly artifact_refs: readonly ArtifactRef[];
  readonly usage_ref: UsageRef;
  readonly policy_ref: PolicyRef;
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
  readonly failure_ref: FailureRef | null;
  readonly idempotency: IdempotencyRef;
  readonly created_at: string;
  readonly completed_at: NullableDateTime;
}

export interface TaskArtifactRecord extends ScopedAgentContractFields {
  readonly artifact_id: string;
  readonly artifact_kind: ArtifactKind;
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly delegation_id: string | null;
  readonly agent_run_id: string | null;
  readonly tool_call_id: string | null;
  readonly owner_ref: TaskArtifactOwnerRef;
  readonly storage_ref: StorageRef;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly sensitivity_label: ArtifactSensitivityLabel;
  readonly source_ref: ArtifactSourceRef;
  readonly retention_policy: ArtifactRetentionPolicy;
  readonly signed_access_policy: ArtifactSignedAccessPolicy;
  readonly acl_scope: ArtifactAclScope;
  readonly related_artifact_refs: readonly TaskArtifactRef[];
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
  readonly idempotency: IdempotencyRef;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ToolDefinitionRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly tool_definition_id: string;
  readonly tool_class: ToolClass;
  readonly display_name: string;
  readonly description: string;
  readonly risk_tier: ToolRiskTier;
  readonly status: ToolDefinitionStatus;
  readonly input_schema_ref: SchemaRef;
  readonly output_schema_ref: SchemaRef;
  readonly owner_principal_id: string;
  readonly allowed_roles: readonly AgentRole[];
  readonly policy_version: string;
  readonly registry_version: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ToolCallRecord extends ScopedAgentContractFields {
  readonly tool_call_id: string;
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly delegation_id: string | null;
  readonly agent_run_id: string;
  readonly status: ToolCallStatus;
  readonly tool_definition_ref: ToolDefinitionRef;
  readonly risk_tier: ToolRiskTier;
  readonly arguments_ref: ArgumentsRef;
  readonly policy_decision: ToolPolicyDecisionRecord;
  readonly approval_ref: ApprovalRef | null;
  readonly allowed_tool_refs: readonly ToolRef[];
  readonly disallowed_tool_refs: readonly ToolRef[];
  readonly output_schema_ref: SchemaRef;
  readonly timeouts: TimeoutPolicy;
  readonly result_artifact_refs: readonly ArtifactRef[];
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
  readonly idempotency: IdempotencyRef;
  readonly created_at: string;
  readonly started_at: NullableDateTime;
  readonly completed_at: NullableDateTime;
}

export interface SkillDefinitionRecord extends ScopedAgentContractFields {
  readonly skill_definition_id: string;
  readonly skill_version_id: string;
  readonly status: SkillLifecycleState;
  readonly owner_ref: OwnerRef;
  readonly allowed_model_aliases: readonly string[];
  readonly allowed_tool_refs: readonly ToolRef[];
  readonly disallowed_tool_refs: readonly ToolRef[];
  readonly instruction_template_refs: readonly OpaqueRef[];
  readonly input_schema_ref: SchemaRef;
  readonly output_schema_ref: SchemaRef;
  readonly approval_policy: ApprovalPolicy;
  readonly eval_suite_refs: readonly EvalSuiteRef[];
  readonly rollout_policy: RolloutPolicy;
  readonly gate_result_refs: readonly OpaqueRef[];
  readonly artifact_refs: readonly ArtifactRef[];
  readonly audit_refs: readonly AuditRef[];
  readonly cost_refs: readonly CostRef[];
  readonly idempotency: IdempotencyRef;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SkillVersionRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly skill_definition_id: string;
  readonly skill_version_id: string;
  readonly version: string;
  readonly instruction_template_refs: readonly OpaqueRef[];
  readonly allowed_model_aliases: readonly string[];
  readonly allowed_tool_refs: readonly ToolRef[];
  readonly disallowed_tool_refs: readonly ToolRef[];
  readonly input_schema_ref: SchemaRef;
  readonly output_schema_ref: SchemaRef;
  readonly eval_suite_refs: readonly EvalSuiteRef[];
  readonly lifecycle_state: SkillLifecycleState;
  readonly created_by_principal_id: string;
  readonly created_at: string;
}

// ---------------------------------------------------------------------------
// Track 3: Approval constants and types
// ---------------------------------------------------------------------------

export const approvalStatuses = [
  'pending',
  'approved',
  'denied',
  'expired',
  'cancelled',
  'superseded',
] as const;

export const approvalDecisions = ['approved', 'denied', 'expired', 'cancelled'] as const;

export const approvalRiskTiers = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

export type ApprovalStatus = (typeof approvalStatuses)[number];
export type ApprovalDecision = (typeof approvalDecisions)[number];
export type ApprovalRiskTier = (typeof approvalRiskTiers)[number];

// ---------------------------------------------------------------------------
// Track 3: Retry policy constants and types
// ---------------------------------------------------------------------------

export const retryBackoffTypes = ['fixed', 'linear', 'exponential', 'exponential_with_jitter'] as const;

export const failureClasses = [
  'transient_timeout_before_accept',
  'provider_request_id_returned_commit_failed',
  'tool_adapter_transient',
  'validation_failure',
  'budget_denial',
  'policy_denial',
  'non_idempotent_unknown_side_effect',
  'worker_crash_active_lease',
] as const;

export const nonIdempotentFallbackBehaviors = ['manual_review', 'terminal_failure', 'replan_within_budget'] as const;

export type RetryBackoffType = (typeof retryBackoffTypes)[number];
export type FailureClass = (typeof failureClasses)[number];
export type NonIdempotentFallbackBehavior = (typeof nonIdempotentFallbackBehaviors)[number];

// ---------------------------------------------------------------------------
// Track 3: Outbox delivery constants and types
// ---------------------------------------------------------------------------

export const outboxDeliveryStates = [
  'pending',
  'delivering',
  'delivered',
  'failed',
  'dead_lettered',
] as const;

export const outboxDestinationKinds = [
  'trace',
  'audit',
  'notification',
  'eval_evidence',
  'portal_update',
  'webhook_ref',
] as const;

export type OutboxDeliveryState = (typeof outboxDeliveryStates)[number];
export type OutboxDestinationKind = (typeof outboxDestinationKinds)[number];

// ---------------------------------------------------------------------------
// Track 3: Cancellation constants and types
// ---------------------------------------------------------------------------

export const cancellationPropagationStates = [
  'requested',
  'propagating',
  'pending_manual_review',
  'unwinding',
  'releasing_reservations',
  'completed',
  'partially_completed',
  'partially_completed_manual_review',
] as const;

export type CancellationPropagationState = (typeof cancellationPropagationStates)[number];

// ---------------------------------------------------------------------------
// Track 3: Manual-review constants and types
// ---------------------------------------------------------------------------

export const manualReviewReasons = [
  'non_idempotent_side_effect',
  'stuck_lease_recovery',
  'stuck_lease',
  'ambiguous_external_call',
  'partial_artifact_write',
  'retry_exhausted_non_idempotent',
  'retry_exhausted',
  'worker_crash_non_recoverable',
  'budget_anomaly',
  'policy_ambiguity',
  'cancellation_unresolvable',
] as const;

export const manualReviewStates = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const manualReviewBlockingStates = ['blocking_workflow', 'blocking_step', 'informational'] as const;

export type ManualReviewReason = (typeof manualReviewReasons)[number];
export type ManualReviewState = (typeof manualReviewStates)[number];
export type ManualReviewBlockingState = (typeof manualReviewBlockingStates)[number];

// ---------------------------------------------------------------------------
// Track 3: Artifact lifecycle constants and types
// ---------------------------------------------------------------------------

export const artifactLifecycleActions = [
  'created',
  'verified',
  'expiry_set',
  'retained',
  'legal_hold_applied',
  'legal_hold_released',
  'redacted',
  'deletion_scheduled',
  'deleted',
  'signed_access_granted',
  'signed_access_revoked',
] as const;
export const artifactLifecycleStates = [
  'pending',
  'active',
  'expiring',
  'redacted',
  'expired',
  'deletion_pending',
  'deleted',
  'legal_hold_active',
] as const;

export type ArtifactLifecycleAction = (typeof artifactLifecycleActions)[number];
export type ArtifactLifecycleState = (typeof artifactLifecycleStates)[number];

// ---------------------------------------------------------------------------
// Track 3: Workflow template constants and types
// ---------------------------------------------------------------------------

export const workflowTemplateRolloutStates = ['draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled'] as const;

export type WorkflowTemplateRolloutState = (typeof workflowTemplateRolloutStates)[number];

// ---------------------------------------------------------------------------
// Track 3: Approval supporting refs
// ---------------------------------------------------------------------------

export interface ApproverPolicyRef {
  readonly required_role: string;
  readonly required_principal_ref: string | null;
  readonly fallback_approver_ref: string | null;
  readonly policy_version: string;
}

export interface ApprovalDecisionRef {
  readonly decision_id: string;
  readonly decision: ApprovalDecision;
  readonly approver_principal_id: string;
  readonly policy_version_at_decision: string;
  readonly decision_audit_ref: AuditRef;
  readonly decided_at: string;
}

// ---------------------------------------------------------------------------
// Track 3: Retry policy supporting types
// ---------------------------------------------------------------------------

export interface RetryBackoffPolicy {
  readonly backoff_type: RetryBackoffType;
  readonly initial_delay_seconds: number;
  readonly max_delay_seconds: number;
  readonly jitter_fraction: number;
  readonly multiplier: number;
}

export interface RetryFailureClassPolicy {
  readonly failure_class: FailureClass;
  readonly retryable: boolean;
  readonly idempotency_required: boolean;
  readonly non_idempotent_fallback: NonIdempotentFallbackBehavior;
}

// ---------------------------------------------------------------------------
// Track 3: Cancellation supporting refs
// ---------------------------------------------------------------------------

export interface CancellationTargetRef {
  readonly workflow_run_id: string;
  readonly step_ids: readonly string[];
  readonly delegation_ids: readonly string[];
  readonly agent_run_ids: readonly string[];
  readonly tool_call_ids: readonly string[];
}

// ---------------------------------------------------------------------------
// Track 3: Record interfaces
// ---------------------------------------------------------------------------

/** Durable human approval gate for a workflow step, tool call, or delegation. */
export interface ApprovalRequestRecord extends ScopedAgentContractFields {
  readonly approval_request_id: string;
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly step_id: string | null;
  readonly delegation_id: string | null;
  readonly tool_call_id: string | null;
  readonly requester_principal_id: string;
  readonly approver_principal_id: string | null;
  readonly required_role: string;
  readonly approver_policy: ApproverPolicyRef;
  readonly risk_tier: ApprovalRiskTier;
  readonly action_summary_artifact_ref: ArtifactRef;
  readonly state: ApprovalStatus;
  readonly decision_ref: ApprovalDecisionRef | null;
  readonly expires_at: string;
  readonly policy_ref: PolicyRef;
  readonly audit_refs: readonly AuditRef[];
  readonly idempotency: IdempotencyRef;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Retry policy attached to a workflow step or delegation, enforcing backoff and failure classification. */
export interface RetryPolicyRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly retry_policy_id: string;
  readonly max_attempts: number;
  readonly backoff_policy: RetryBackoffPolicy;
  readonly timeout_policy: TimeoutPolicy;
  readonly failure_class_policies: readonly RetryFailureClassPolicy[];
  readonly idempotency_required_for_auto_retry: boolean;
  readonly non_idempotent_fallback: NonIdempotentFallbackBehavior;
  readonly policy_ref: PolicyRef;
  readonly owner_ref: OwnerRef;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Records the propagation and resolution of a cancellation request through a workflow. */
export interface WorkflowCancellationRecord extends ScopedAgentContractFields {
  readonly cancellation_id: string;
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly requester_principal_id: string;
  readonly cancellation_reason_ref: OpaqueRef;
  readonly propagation_state: CancellationPropagationState;
  readonly target_ref: CancellationTargetRef;
  readonly cancellation_deadline: string;
  readonly budget_release_refs: readonly CostRef[];
  readonly terminal_artifact_refs: readonly ArtifactRef[];
  readonly manual_review_item_ids: readonly string[];
  readonly audit_refs: readonly AuditRef[];
  readonly idempotency: IdempotencyRef;
  readonly requested_at: string;
  readonly completed_at: NullableDateTime;
}

/** Transactional event publication record for at-least-once delivery to trace/audit/notification/portal consumers. */
export interface WorkflowOutboxRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly outbox_id: string;
  readonly workflow_run_id: string;
  readonly source_event_ref: OpaqueRef;
  readonly destination_kind: OutboxDestinationKind;
  readonly payload_artifact_ref: ArtifactRef | null;
  readonly delivery_state: OutboxDeliveryState;
  readonly attempt_count: number;
  readonly next_attempt_at: NullableDateTime;
  readonly last_failure_ref: OpaqueRef | null;
  readonly idempotency: IdempotencyRef;
  readonly enqueued_at: string;
  readonly delivered_at: NullableDateTime;
}

/** Immutable workflow template definition governing allowed steps, agents, tools, models, and policies. */
export interface WorkflowTemplateRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly template_id: string;
  readonly display_name: string;
  readonly description_ref: OpaqueRef;
  readonly current_version_id: string;
  readonly rollout_state: WorkflowTemplateRolloutState;
  readonly owner_ref: OwnerRef;
  readonly eval_suite_refs: readonly EvalSuiteRef[];
  readonly rollout_policy: RolloutPolicy;
  readonly audit_refs: readonly AuditRef[];
  readonly created_at: string;
  readonly updated_at: string;
}

/** An immutable snapshot of a workflow template at a specific version. */
export interface WorkflowTemplateVersionRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly template_id: string;
  readonly template_version_id: string;
  readonly version: string;
  readonly allowed_step_graph_ref: OpaqueRef;
  readonly required_approval_policies: readonly ApproverPolicyRef[];
  readonly retry_policy_ids: readonly string[];
  readonly allowed_agent_definition_refs: readonly AgentDefinitionRef[];
  readonly allowed_tool_bundles: readonly ToolBundleRef[];
  readonly allowed_model_aliases: readonly string[];
  readonly eval_gate_refs: readonly EvalSuiteRef[];
  readonly rollout_state: WorkflowTemplateRolloutState;
  readonly schema_ref: SchemaRef;
  readonly created_by_principal_id: string;
  readonly created_at: string;
}

/** Safe-handling record for non-idempotent side effects, stuck leases, or ambiguous external calls requiring human resolution. */
export interface ManualReviewItemRecord extends ScopedAgentContractFields {
  readonly manual_review_item_id: string;
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly step_id: string | null;
  readonly agent_run_id: string | null;
  readonly delegation_id: string | null;
  readonly reason: ManualReviewReason;
  readonly blocking_state: ManualReviewBlockingState;
  readonly review_state: ManualReviewState;
  readonly side_effect_artifact_refs: readonly ArtifactRef[];
  readonly safe_action_refs: readonly OpaqueRef[];
  readonly owner_ref: OwnerRef;
  readonly required_role: string;
  readonly resolution_artifact_ref: ArtifactRef | null;
  readonly audit_refs: readonly AuditRef[];
  readonly idempotency: IdempotencyRef;
  readonly opened_at: string;
  readonly resolved_at: NullableDateTime;
}

/** Append-only lifecycle event for an artifact: verification, retention, legal hold, redaction, expiry, deletion, signed access. */
export interface ArtifactLifecycleEventRecord extends ScopedAgentContractFields {
  readonly lifecycle_event_id: string;
  readonly artifact_id: string;
  readonly workflow_run_id: string;
  readonly task_id: string;
  readonly action: ArtifactLifecycleAction;
  readonly state: ArtifactLifecycleState;
  readonly storage_ref: StorageRef;
  readonly checksum_sha256: string;
  readonly retention_policy: ArtifactRetentionPolicy;
  readonly signed_access_eligibility: ArtifactSignedAccessEligibility;
  readonly legal_hold: boolean;
  readonly redacted: boolean;
  readonly deletion_scheduled_at: NullableDateTime;
  readonly audit_refs: readonly AuditRef[];
  readonly idempotency: IdempotencyRef;
  readonly occurred_at: string;
}

export interface AgentWorkflowMetadataValidationIssue {
  readonly code: 'forbidden_metadata_field';
  readonly path: string;
  readonly field: AgentWorkflowMetadataForbiddenField;
}

export function validateAgentWorkflowMetadataShape(
  metadata: unknown,
): readonly AgentWorkflowMetadataValidationIssue[] {
  const issues: AgentWorkflowMetadataValidationIssue[] = [];
  collectForbiddenAgentWorkflowMetadataFields(metadata, '$', issues);
  return issues;
}

export function hasForbiddenAgentWorkflowMetadataFields(metadata: unknown): boolean {
  return validateAgentWorkflowMetadataShape(metadata).length > 0;
}

export function toAgentWorkflowMetadataForbiddenField(
  key: string,
): AgentWorkflowMetadataForbiddenField | undefined {
  const normalized = normalizeAgentWorkflowMetadataFieldKey(key);
  return agentWorkflowMetadataForbiddenFields.find((field) => normalizeAgentWorkflowMetadataFieldKey(field) === normalized);
}

function collectForbiddenAgentWorkflowMetadataFields(
  value: unknown,
  path: string,
  issues: AgentWorkflowMetadataValidationIssue[],
): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenAgentWorkflowMetadataFields(item, `${path}[${index}]`, issues));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const forbiddenField = toAgentWorkflowMetadataForbiddenField(key);
    const childPath = `${path}.${key}`;
    if (forbiddenField !== undefined) {
      issues.push({ code: 'forbidden_metadata_field', path: childPath, field: forbiddenField });
    }
    collectForbiddenAgentWorkflowMetadataFields(child, childPath, issues);
  }
}

function normalizeAgentWorkflowMetadataFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}
