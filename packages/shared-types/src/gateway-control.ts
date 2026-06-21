export const gatewayControlContractVersion = '0.1.0' as const;

export const dataClasses = ['public', 'internal', 'confidential', 'restricted'] as const;
export const routeIntents = ['chat', 'completion', 'embedding', 'eval', 'tool_planning', 'tool_execution', 'policy_check'] as const;
export const budgetScopeTypes = ['org', 'team', 'project', 'principal', 'virtual_key'] as const;
export const bifrostVirtualKeyMetadataForbiddenFields = [
  'one_time_secret',
  'raw_secret',
  'secret',
  'value',
  'key_hash_ref',
  'provider_key',
  'provider_secret',
  'api_key',
] as const;
export const bifrostVirtualKeyPolicyBoundary = {
  policy_decision_source: 'devgateway_platform',
  bifrost_enforcement_role: 'enforce_precomputed_virtual_key_metadata',
  bifrost_must_not_infer: ['project_policy', 'tool_policy', 'approval_policy'],
} as const;
export const denialReasonCodes = [
  'budget',
  'rate_limit',
  'data_class',
  'provider_lifecycle',
  'eval_gate',
  'policy_stale',
  'route_disabled',
  'approval_required',
] as const;

export type GatewayControlContractVersion = typeof gatewayControlContractVersion;
export type DataClass = (typeof dataClasses)[number];
export type RouteIntent = (typeof routeIntents)[number];
export type BudgetScopeType = (typeof budgetScopeTypes)[number];
export type BifrostVirtualKeyMetadataForbiddenField = (typeof bifrostVirtualKeyMetadataForbiddenFields)[number];
export type BifrostPolicyBoundary = typeof bifrostVirtualKeyPolicyBoundary;
export type DenialReasonCode = (typeof denialReasonCodes)[number];
export type PrincipalType = 'user' | 'service_account' | 'automation' | 'system';
export type EnvironmentName = 'development' | 'test' | 'staging' | 'production';
export type VirtualKeyStatus = 'draft' | 'active' | 'rotating' | 'revoked' | 'expired' | 'disabled';
export type VirtualKeyRotationState = 'not_scheduled' | 'scheduled' | 'in_progress' | 'completed';
export type BudgetScopeStatus = 'draft' | 'active' | 'disabled' | 'archived';
export type BudgetResetPeriod = 'none' | 'daily' | 'weekly' | 'monthly' | 'rolling_24h' | 'rolling_7d' | 'rolling_30d';
export type CostEventType = 'estimate' | 'actual' | 'reconciliation' | 'denial_estimate';
export type CostAttemptStatus = 'started' | 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'timed_out';
export type UnitCostBasis = 'per_token' | 'per_million_tokens' | 'per_request' | 'provider_invoice' | 'not_applicable';
export type CostMeasurementSource =
  | 'registry_estimate'
  | 'gateway_counter'
  | 'provider_reported'
  | 'estimated_final'
  | 'not_available';
export type GatewayDecision = 'allow' | 'deny';
export type SamplingDecision = 'record' | 'drop' | 'defer';
export type TraceComponent = 'control_api' | 'bifrost' | 'provider' | 'audit' | 'cost' | 'eval' | 'tool_broker' | 'admin_portal';

export interface ProductionDisabledPosture {
  readonly production_enabled: false;
  readonly success_fallback_allowed: false;
}

export interface VirtualKeyProductionPosture extends ProductionDisabledPosture {
  readonly fail_closed_without_policy: true;
}

export interface BudgetScopeProductionPosture extends ProductionDisabledPosture {
  readonly fail_closed_on_missing_scope: true;
}

export interface PrincipalBinding {
  readonly principal_id: string;
  readonly principal_type: PrincipalType;
  readonly auth_subject_ref: string;
}

export interface ProjectBinding {
  readonly project_id: string;
  readonly tenant_id: string;
  readonly org_id: string;
  readonly team_ids: readonly string[];
  readonly environment: EnvironmentName;
}

export interface VirtualKeyScopeConstraints {
  readonly route_intents: readonly RouteIntent[];
  readonly data_classes: readonly DataClass[];
  readonly model_aliases: readonly string[];
  readonly provider_candidates: readonly string[];
  readonly max_expires_at: string | null;
}

export interface BudgetScopeRef {
  readonly budget_scope_id: string;
  readonly budget_scope_type: BudgetScopeType;
}

export interface VirtualKeyRotation {
  readonly rotation_state: VirtualKeyRotationState;
  readonly rotated_from_virtual_key_id: string | null;
  readonly rotated_to_virtual_key_id: string | null;
  readonly rotation_due_at: string | null;
}

export interface VirtualKeyRevocation {
  readonly revoked_at: string | null;
  readonly revoked_by_principal_id: string | null;
  readonly revocation_reason: string | null;
}

export interface VirtualKeyLastUsedMetadata {
  readonly last_used_at: string | null;
  readonly last_used_trace_id: string | null;
  readonly last_used_request_id: string | null;
  readonly last_used_gateway_instance: string | null;
}

export interface AuditCorrelation {
  readonly created_audit_event_id: string;
  readonly last_audit_event_id: string | null;
  readonly trace_id: string;
}

export interface VirtualKeyRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly virtual_key_id: string;
  readonly external_key_id: string;
  readonly key_prefix: string;
  readonly key_fingerprint_sha256: string;
  readonly key_hash_ref: string;
  readonly status: VirtualKeyStatus;
  readonly production_posture: VirtualKeyProductionPosture;
  readonly principal_binding: PrincipalBinding;
  readonly project_binding: ProjectBinding;
  readonly scope_constraints: VirtualKeyScopeConstraints;
  readonly budget_scope_ref: BudgetScopeRef;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly policy_snapshot_checksum?: string;
  readonly registry_snapshot_checksum?: string;
  readonly issued_at: string;
  readonly not_before: string | null;
  readonly expires_at: string;
  readonly rotation: VirtualKeyRotation;
  readonly revocation: VirtualKeyRevocation;
  readonly last_used?: VirtualKeyLastUsedMetadata;
  readonly audit_correlation: AuditCorrelation;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BifrostVirtualKeyMetadata {
  readonly contract_version: GatewayControlContractVersion;
  readonly virtual_key_id: string;
  readonly external_key_id: string;
  readonly key_prefix: string;
  readonly key_fingerprint_sha256: string;
  readonly status: VirtualKeyStatus;
  readonly scope_constraints: VirtualKeyScopeConstraints;
  readonly budget_scope_ref: BudgetScopeRef;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly policy_snapshot_checksum?: string;
  readonly registry_snapshot_checksum?: string;
  readonly issued_at: string;
  readonly not_before: string | null;
  readonly expires_at: string;
  readonly revocation: VirtualKeyRevocation;
  readonly policy_boundary: BifrostPolicyBoundary;
}

export interface BifrostVirtualKeyMetadataValidationIssue {
  readonly code: 'forbidden_secret_field';
  readonly path: string;
  readonly field: BifrostVirtualKeyMetadataForbiddenField;
}

export function toBifrostVirtualKeyMetadata(record: VirtualKeyRecord): BifrostVirtualKeyMetadata {
  return {
    contract_version: record.contract_version,
    virtual_key_id: record.virtual_key_id,
    external_key_id: record.external_key_id,
    key_prefix: record.key_prefix,
    key_fingerprint_sha256: record.key_fingerprint_sha256,
    status: record.status,
    scope_constraints: record.scope_constraints,
    budget_scope_ref: record.budget_scope_ref,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    ...(record.policy_snapshot_checksum === undefined ? {} : { policy_snapshot_checksum: record.policy_snapshot_checksum }),
    ...(record.registry_snapshot_checksum === undefined
      ? {}
      : { registry_snapshot_checksum: record.registry_snapshot_checksum }),
    issued_at: record.issued_at,
    not_before: record.not_before,
    expires_at: record.expires_at,
    revocation: record.revocation,
    policy_boundary: bifrostVirtualKeyPolicyBoundary,
  };
}

export function validateBifrostVirtualKeyMetadataShape(
  metadata: unknown,
): readonly BifrostVirtualKeyMetadataValidationIssue[] {
  const issues: BifrostVirtualKeyMetadataValidationIssue[] = [];
  collectForbiddenVirtualKeyMetadataFields(metadata, '$', issues);
  return issues;
}

function collectForbiddenVirtualKeyMetadataFields(
  value: unknown,
  path: string,
  issues: BifrostVirtualKeyMetadataValidationIssue[],
): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenVirtualKeyMetadataFields(item, `${path}[${index}]`, issues));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const forbiddenField = toForbiddenVirtualKeyMetadataField(key);
    const childPath = `${path}.${key}`;
    if (forbiddenField !== undefined) {
      issues.push({ code: 'forbidden_secret_field', path: childPath, field: forbiddenField });
    }
    collectForbiddenVirtualKeyMetadataFields(child, childPath, issues);
  }
}

function toForbiddenVirtualKeyMetadataField(key: string): BifrostVirtualKeyMetadataForbiddenField | undefined {
  const normalized = normalizeForbiddenFieldKey(key);
  return bifrostVirtualKeyMetadataForbiddenFields.find((field) => normalizeForbiddenFieldKey(field) === normalized);
}

function normalizeForbiddenFieldKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/gu, '');
}

export interface BudgetScopeOwnerRef {
  readonly owner_type: BudgetScopeType;
  readonly owner_id: string;
  readonly tenant_id: string | null;
  readonly project_id: string | null;
  readonly principal_id: string | null;
  readonly virtual_key_id: string | null;
}

export interface BudgetScopeInheritancePolicy {
  readonly inherits_parent_limit: boolean;
  readonly rolls_up_to_parent: boolean;
  readonly child_scope_types: readonly BudgetScopeType[];
}

export interface BudgetPeriod {
  readonly reset_period: BudgetResetPeriod;
  readonly period_started_at: string;
  readonly period_ends_at: string | null;
  readonly timezone: string;
}

export interface BudgetLimits {
  readonly hard_cap_amount: number | null;
  readonly soft_cap_amount: number | null;
  readonly input_token_limit: number | null;
  readonly output_token_limit: number | null;
  readonly request_limit: number | null;
}

export interface BudgetSpendState {
  readonly actual_spend_amount: number;
  readonly actual_input_tokens: number;
  readonly actual_output_tokens: number;
  readonly actual_request_count: number;
  readonly last_cost_event_id: string | null;
}

export interface BudgetReservationState {
  readonly reserved_amount: number;
  readonly reserved_input_tokens: number;
  readonly reserved_output_tokens: number;
  readonly reservation_count: number;
}

export interface RateLimitInteraction {
  readonly rate_limit_scope_id: string | null;
  readonly rate_limit_denial_reason: 'rate_limit';
  readonly shared_window: boolean;
  readonly enforce_budget_before_rate_limit: boolean;
}

export interface BudgetDenialSemantics {
  readonly denial_reason: 'budget';
  readonly hard_cap_action: 'deny';
  readonly soft_cap_action: 'warn' | 'deny';
  readonly reservation_failure_action: 'deny';
}

export interface BudgetScopeRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly budget_scope_id: string;
  readonly external_budget_scope_id: string;
  readonly scope_type: BudgetScopeType;
  readonly status: BudgetScopeStatus;
  readonly production_posture: BudgetScopeProductionPosture;
  readonly owner_ref: BudgetScopeOwnerRef;
  readonly parent_scope_ref: BudgetScopeRef | null;
  readonly inheritance: BudgetScopeInheritancePolicy;
  readonly period: BudgetPeriod;
  readonly currency: string;
  readonly limits: BudgetLimits;
  readonly spend_state: BudgetSpendState;
  readonly reservation_state: BudgetReservationState;
  readonly rate_limit_interaction: RateLimitInteraction;
  readonly denial_semantics: BudgetDenialSemantics;
  readonly policy_version: string;
  readonly policy_snapshot_checksum?: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CostMeasurement {
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cache_read_tokens: number | null;
  readonly cache_write_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly cost_amount: number | null;
  readonly unit_cost_basis: UnitCostBasis;
  readonly source: CostMeasurementSource;
}

export interface CostAggregationTargets {
  readonly tenant_id: string | null;
  readonly org_id: string | null;
  readonly team_id: string | null;
  readonly project_id: string;
  readonly principal_id: string;
  readonly virtual_key_id: string;
  readonly budget_scope_id: string;
  readonly model_alias: string;
  readonly provider_id: string | null;
  readonly environment: EnvironmentName;
  readonly route_intent: RouteIntent;
  readonly data_class: DataClass;
  readonly reset_period_start: string;
  readonly reset_period_end: string;
}

export interface CostEventRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly cost_event_id: string;
  readonly event_type: CostEventType;
  readonly trace_id: string;
  readonly request_id: string;
  readonly span_id?: string | null;
  readonly virtual_key_id: string;
  readonly budget_scope_id: string;
  readonly principal_id: string;
  readonly project_id: string;
  readonly environment: EnvironmentName;
  readonly route_intent: RouteIntent;
  readonly data_class: DataClass;
  readonly model_alias: string;
  readonly provider_id: string | null;
  readonly provider_model_id: string | null;
  readonly provider_candidate?: string | null;
  readonly gateway_attempt: number;
  readonly fallback_attempt: number;
  readonly attempt_status: CostAttemptStatus;
  readonly fallback_of_cost_event_id?: string | null;
  readonly currency: string;
  readonly usage_source: CostMeasurementSource;
  readonly decision: GatewayDecision;
  readonly estimated: CostMeasurement;
  readonly actual: CostMeasurement;
  readonly denial_reason?: DenialReasonCode | null;
  readonly aggregation_targets: CostAggregationTargets;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
}

export interface DevGatewayTraceHeaders {
  readonly x_devgateway_request_id: string;
  readonly x_devgateway_principal_id: string;
  readonly x_devgateway_project_id: string;
  readonly x_devgateway_virtual_key_id: string;
  readonly x_devgateway_budget_scope_id: string;
  readonly x_devgateway_policy_version: string;
  readonly x_devgateway_registry_version: string;
  readonly x_devgateway_route_intent: RouteIntent;
  readonly x_devgateway_data_class: DataClass;
  readonly x_devgateway_environment: EnvironmentName;
  readonly x_devgateway_sampling_decision: SamplingDecision;
}

export interface TraceSampling {
  readonly decision: SamplingDecision;
  readonly sample_rate: number;
  readonly debug: boolean;
  readonly policy: string;
}

export interface TraceHop {
  readonly component: TraceComponent;
  readonly span_id: string;
  readonly entered_at: string;
  readonly exited_at: string | null;
}

export interface TraceLogCorrelation {
  readonly audit_event_id: string | null;
  readonly cost_event_id: string | null;
  readonly gateway_instance_id: string | null;
  readonly request_log_id: string | null;
}

export interface TraceContextRecord {
  readonly contract_version: GatewayControlContractVersion;
  readonly trace_context_id: string;
  readonly trace_id: string;
  readonly request_id: string;
  readonly traceparent: string;
  readonly tracestate: string | null;
  readonly devgateway_headers: DevGatewayTraceHeaders;
  readonly principal_id: string;
  readonly project_id: string;
  readonly virtual_key_id: string;
  readonly budget_scope_id: string;
  readonly data_class: DataClass;
  readonly environment: EnvironmentName;
  readonly model_alias: string;
  readonly route_intent: RouteIntent;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly sampling: TraceSampling;
  readonly propagation_path: readonly TraceHop[];
  readonly log_correlation: TraceLogCorrelation;
  readonly created_at: string;
}
