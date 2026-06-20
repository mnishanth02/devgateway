export const evalGatePersistenceContractVersion = '0.1.0' as const;

export const evalGateResultTableName = 'eval_gate_result' as const;

export type EvalGateResultColumnType =
  | 'BIGINT GENERATED ALWAYS AS IDENTITY'
  | 'TEXT'
  | 'TIMESTAMPTZ'
  | 'BOOLEAN'
  | 'JSONB';

export type EvalGateResultColumnRole =
  | 'internal_identity'
  | 'public_gate_identity'
  | 'version_match_key'
  | 'runner_evidence'
  | 'target_identity'
  | 'decision_evidence'
  | 'human_review'
  | 'artifact_reference'
  | 'audit_reference'
  | 'retention_reference'
  | 'created_timestamp';

export interface EvalGateResultColumnMetadata {
  name: string;
  type: EvalGateResultColumnType;
  nullable: boolean;
  role: EvalGateResultColumnRole;
  check?: readonly string[];
  references?: {
    table: string;
    column: string;
    onDelete: 'RESTRICT' | 'NO ACTION';
  };
  notes?: string;
}

export interface EvalGateResultIndexMetadata {
  name: string;
  columns: readonly string[];
  unique: boolean;
  purpose: string;
}

export interface EvalGateResultConstraintMetadata {
  name: string;
  kind: 'primary_key' | 'unique' | 'check' | 'foreign_key' | 'append_only';
  columns?: readonly string[];
  expression?: string;
  purpose: string;
}

export const evalGateResultRequiredFieldNames = [
  'change_id',
  'dataset_version',
  'eval_suite_version',
  'runner_version',
  'target_kind',
  'artifact_version',
  'metrics',
  'thresholds',
  'pass',
  'blocking_severity',
  'artifact_refs',
  'audit_event_id',
] as const;

export const evalGateResultMatchingRules = [
  {
    id: 'exact-change-dataset-suite-artifact-match',
    checkedFields: ['change_id', 'dataset_version', 'eval_suite_version', 'artifact_version'],
    failureMode: 'fail_closed',
  },
  {
    id: 'passing-result-required',
    checkedFields: ['pass'],
    requiredValue: true,
    failureMode: 'fail_closed',
  },
  {
    id: 'no-blocking-severity',
    checkedFields: ['blocking_severity'],
    requiredValue: 'none',
    failureMode: 'fail_closed',
  },
  {
    id: 'owner-approval-required',
    checkedFields: ['owner_approval_required', 'approver_principal_id'],
    condition: 'approver_principal_id is required when owner_approval_required is true',
    failureMode: 'fail_closed',
  },
] as const;

export const evalGateResultColumns: readonly EvalGateResultColumnMetadata[] = [
  {
    name: 'id',
    type: 'BIGINT GENERATED ALWAYS AS IDENTITY',
    nullable: false,
    role: 'internal_identity',
    notes: 'Internal relational primary key; never exposed outside the database boundary.',
  },
  {
    name: 'gate_result_id',
    type: 'TEXT',
    nullable: false,
    role: 'public_gate_identity',
    notes: 'Stable opaque ID referenced by registry and policy gate_result_ref objects.',
  },
  {
    name: 'change_id',
    type: 'TEXT',
    nullable: false,
    role: 'version_match_key',
  },
  {
    name: 'dataset_version',
    type: 'TEXT',
    nullable: false,
    role: 'version_match_key',
  },
  {
    name: 'eval_suite_version',
    type: 'TEXT',
    nullable: false,
    role: 'version_match_key',
  },
  {
    name: 'runner_version',
    type: 'TEXT',
    nullable: false,
    role: 'runner_evidence',
  },
  {
    name: 'target_kind',
    type: 'TEXT',
    nullable: false,
    role: 'target_identity',
    check: ['model_alias', 'fallback_route', 'tool', 'prompt_template', 'retrieval_strategy', 'skill', 'index_version'],
  },
  {
    name: 'artifact_version',
    type: 'TEXT',
    nullable: false,
    role: 'version_match_key',
  },
  {
    name: 'model_alias',
    type: 'TEXT',
    nullable: true,
    role: 'target_identity',
  },
  {
    name: 'provider',
    type: 'TEXT',
    nullable: true,
    role: 'target_identity',
  },
  {
    name: 'retrieval_strategy_id',
    type: 'TEXT',
    nullable: true,
    role: 'target_identity',
  },
  {
    name: 'prompt_template_id',
    type: 'TEXT',
    nullable: true,
    role: 'target_identity',
  },
  {
    name: 'tool_name',
    type: 'TEXT',
    nullable: true,
    role: 'target_identity',
  },
  {
    name: 'skill_id',
    type: 'TEXT',
    nullable: true,
    role: 'target_identity',
  },
  {
    name: 'index_id',
    type: 'TEXT',
    nullable: true,
    role: 'target_identity',
  },
  {
    name: 'metrics',
    type: 'JSONB',
    nullable: false,
    role: 'decision_evidence',
    notes: 'Flexible numeric metric map; core match keys remain relational columns.',
  },
  {
    name: 'thresholds',
    type: 'JSONB',
    nullable: false,
    role: 'decision_evidence',
    notes: 'Flexible numeric threshold map used to reconstruct the pass/fail decision.',
  },
  {
    name: 'pass',
    type: 'BOOLEAN',
    nullable: false,
    role: 'decision_evidence',
  },
  {
    name: 'blocking_severity',
    type: 'TEXT',
    nullable: false,
    role: 'decision_evidence',
    check: ['none', 'low', 'medium', 'high', 'critical'],
  },
  {
    name: 'owner_approval_required',
    type: 'BOOLEAN',
    nullable: false,
    role: 'human_review',
  },
  {
    name: 'reviewer_principal_id',
    type: 'TEXT',
    nullable: true,
    role: 'human_review',
  },
  {
    name: 'reviewed_at',
    type: 'TIMESTAMPTZ',
    nullable: true,
    role: 'human_review',
  },
  {
    name: 'approver_principal_id',
    type: 'TEXT',
    nullable: true,
    role: 'human_review',
  },
  {
    name: 'approved_at',
    type: 'TIMESTAMPTZ',
    nullable: true,
    role: 'human_review',
  },
  {
    name: 'approval_reason',
    type: 'TEXT',
    nullable: true,
    role: 'human_review',
  },
  {
    name: 'artifact_refs',
    type: 'JSONB',
    nullable: false,
    role: 'artifact_reference',
    notes: 'Immutable artifact IDs, storage URIs, types, hashes, sizes, and sensitivity labels.',
  },
  {
    name: 'artifact_storage_policy_ref',
    type: 'TEXT',
    nullable: false,
    role: 'artifact_reference',
    notes: 'Reference to the approved artifact storage policy used for the gate evidence.',
  },
  {
    name: 'retention_policy_ref',
    type: 'TEXT',
    nullable: false,
    role: 'retention_reference',
    notes: 'Reference to the retention/archive policy governing this row and its artifacts.',
  },
  {
    name: 'audit_event_id',
    type: 'TEXT',
    nullable: false,
    role: 'audit_reference',
    references: {
      table: 'audit_event',
      column: 'audit_event_id',
      onDelete: 'RESTRICT',
    },
  },
  {
    name: 'created_at',
    type: 'TIMESTAMPTZ',
    nullable: false,
    role: 'created_timestamp',
  },
] as const;

export const evalGateResultIndexes: readonly EvalGateResultIndexMetadata[] = [
  {
    name: 'eval_gate_result_gate_result_id_key',
    columns: ['gate_result_id'],
    unique: true,
    purpose: 'Fast registry/policy lookup by referenced gate_result_id.',
  },
  {
    name: 'eval_gate_result_match_key_idx',
    columns: ['change_id', 'dataset_version', 'eval_suite_version', 'artifact_version'],
    unique: false,
    purpose: 'Supports exact gate-result match checks for production enablement.',
  },
  {
    name: 'eval_gate_result_audit_event_id_idx',
    columns: ['audit_event_id'],
    unique: false,
    purpose: 'Supports audit trace reconstruction.',
  },
] as const;

export const evalGateResultConstraints: readonly EvalGateResultConstraintMetadata[] = [
  {
    name: 'eval_gate_result_pkey',
    kind: 'primary_key',
    columns: ['id'],
    purpose: 'Internal relational identity.',
  },
  {
    name: 'eval_gate_result_gate_result_id_key',
    kind: 'unique',
    columns: ['gate_result_id'],
    purpose: 'Public gate result IDs are immutable and globally unique within the operational store.',
  },
  {
    name: 'eval_gate_result_pass_requires_no_blocking_severity',
    kind: 'check',
    expression: "pass = false OR blocking_severity = 'none'",
    purpose: 'A passing gate result cannot carry a blocking finding.',
  },
  {
    name: 'eval_gate_result_owner_approval_requires_approver',
    kind: 'check',
    expression: 'owner_approval_required = false OR approver_principal_id IS NOT NULL',
    purpose: 'Owner-gated production evidence must name an approver.',
  },
  {
    name: 'eval_gate_result_append_only',
    kind: 'append_only',
    purpose: 'Runtime roles may insert only; UPDATE and DELETE must be rejected by role grants and/or triggers before production.',
  },
] as const;

export const evalGateResultRetentionAndArtifactStorage = {
  artifactRefsRequired: true,
  artifactRefFields: ['artifact_id', 'uri', 'type', 'sha256', 'size_bytes', 'sensitivity_label'],
  artifactStoragePolicyRefColumn: 'artifact_storage_policy_ref',
  retentionPolicyRefColumn: 'retention_policy_ref',
  productionReadinessRequirement:
    'Retention period, archive/export behavior, partitioning decision, and artifact storage class must be approved before any migration or production enablement.',
} as const;

export const evalGateResultAppendOnlyAuditConvention = {
  appendOnly: true,
  immutableColumns: evalGateResultColumns.map((column) => column.name),
  auditEventColumn: 'audit_event_id',
  permittedRuntimeOperations: ['INSERT'],
  forbiddenRuntimeOperations: ['UPDATE', 'DELETE'],
} as const;

export const evalGatePersistenceProductionPosture = {
  productionEnabled: false,
  createsLiveDbConnection: false,
  createsMigration: false,
  conventionMetadataOnly: true,
} as const;

export const evalGateResultPersistenceContract = {
  contractVersion: evalGatePersistenceContractVersion,
  tableName: evalGateResultTableName,
  store: 'operational_postgres',
  ownerPackage: 'packages\\db',
  status: 'phase_0_7_metadata_only_no_live_db_connection_or_migration',
  productionPosture: evalGatePersistenceProductionPosture,
  columns: evalGateResultColumns,
  indexes: evalGateResultIndexes,
  constraints: evalGateResultConstraints,
  requiredFields: evalGateResultRequiredFieldNames,
  matchingRules: evalGateResultMatchingRules,
  appendOnlyAudit: evalGateResultAppendOnlyAuditConvention,
  retentionAndArtifactStorage: evalGateResultRetentionAndArtifactStorage,
} as const;

export type EvalGateResultRequiredFieldName = (typeof evalGateResultRequiredFieldNames)[number];
export type EvalGateResultMatchingRule = (typeof evalGateResultMatchingRules)[number];
