export type InternalIdStrategy = 'BIGINT GENERATED ALWAYS AS IDENTITY';
export type PublicOpaqueIdStrategy = 'UUIDv7' | 'prefixed_opaque_text_id';
export type TimestampStrategy = 'TIMESTAMPTZ';
export type StatusFieldStrategy = 'TEXT_WITH_CHECK';
export type MigrationTool = 'drizzle' | 'alembic_if_independently_approved' | 'generated_contract_consumer';

export const dbNamingConventions = {
  tableNames: 'singular_snake_case',
  columnNames: 'singular_snake_case',
  internalRelationalIds: 'BIGINT GENERATED ALWAYS AS IDENTITY',
  publicOpaqueIds: ['UUIDv7', 'prefixed_opaque_text_id'],
  timeValues: 'TIMESTAMPTZ',
  statusFields: 'TEXT_WITH_CHECK',
  foreignKeys: {
    requireExplicitOnDelete: true,
    requireReferencingIndex: true,
  },
  jsonb: {
    allowedFor: ['flexible_metadata', 'provider_payload_snapshots', 'trace_context'],
    notFor: ['core_relational_fields', 'policy_decisions', 'acl_facts', 'lifecycle_state'],
  },
} as const;

export const migrationOwnershipConventions = [
  {
    store: 'operational_postgres',
    owner: 'packages\\db',
    tool: 'drizzle',
    domains: ['auth', 'tenancy', 'policy', 'workflow', 'audit', 'cost', 'eval_gate'],
  },
  {
    store: 'better_auth_tables',
    owner: 'packages\\db',
    tool: 'drizzle',
    note: 'Better Auth CLI/config output is reconciled into the Operational Postgres Drizzle migration plan.',
  },
  {
    store: 'knowledge_postgres',
    owner: 'retrieval_indexing_domain_if_independently_approved',
    tool: 'alembic_if_independently_approved',
    fallback: 'consume_generated_contracts_from_packages_db',
  },
  {
    store: 'python_workers',
    owner: 'generated_contract_consumer',
    tool: 'generated_contract_consumer',
    note: 'No independent migrations unless explicitly approved.',
  },
  {
    store: 'postgres_extensions',
    owner: 'approval_gated_operator_action',
    tool: 'approval_gated',
    operations: ['create_extension', 'extension_upgrade', 'privileged_extension_operation'],
  },
] as const;

export const seedConventions = {
  bootstrapAdminSeedsSeparateFromTestFixtures: true,
  migrationsForwardOnlyByDefault: true,
} as const;

export const encryptedCredentialStorageConvention = {
  secretClasses: ['provider_keys', 'break_glass_credentials'],
  persistedSecretMaterial: 'ciphertext_plus_metadata_only',
  encryptionKeySource: 'Railway variables',
  plaintextForbiddenIn: ['database_columns', 'jsonb_metadata', 'logs', 'audit_detail', 'fixtures', 'generated_contracts'],
  metadataExamples: ['key_id', 'key_version', 'algorithm', 'nonce_or_iv_ref', 'created_at', 'rotated_at', 'disabled_at'],
} as const;

export const tenantAclColumns = {
  requiredDomains: ['knowledge', 'memory', 'graph_metadata', 'context_pack'],
  columns: ['project_id', 'acl_scope_hash', 'source_reference', 'index_version'],
} as const;

export const auditImmutabilityConvention = {
  appendOnly: true,
  enforcement: ['db_roles_insert_only_without_update_delete', 'triggers_reject_update_delete'],
  requiredCorrelation: ['actor_or_principal', 'project', 'request_or_trace_id'],
} as const;

export const highVolumeRetentionCandidates = ['audit_event', 'request_log', 'workflow_event', 'cost_event', 'eval_run'] as const;

export const initialSchemaDomainMap = [
  {
    domain: 'identity_tenancy',
    representativeTables: ['org', 'team', 'project', 'principal', 'role', 'permission_grant', 'virtual_key'],
  },
  {
    domain: 'provider_model',
    representativeTables: [
      'provider',
      'model',
      'model_alias',
      'capability',
      'price_snapshot',
      'rate_limit',
      'routing_policy',
    ],
  },
  {
    domain: 'agents_workflows',
    representativeTables: [
      'agent_definition',
      'agent_run',
      'delegation',
      'workflow_definition',
      'workflow_run',
      'workflow_step',
      'step_attempt',
      'workflow_event',
      'workflow_outbox',
      'workflow_lease',
      'task_artifact',
    ],
  },
  {
    domain: 'tools_mcp_skills',
    representativeTables: [
      'tool_definition',
      'mcp_server',
      'tool_policy',
      'tool_call',
      'approval_request',
      'sandbox_run',
      'skill_definition',
      'skill_version',
    ],
  },
  {
    domain: 'knowledge',
    representativeTables: [
      'knowledge_source',
      'document',
      'chunk',
      'embedding',
      'entity',
      'relation',
      'repo_symbol',
      'api_endpoint',
      'decision',
      'retrieval_strategy_run',
      'context_budget_policy',
      'context_compression_run',
      'context_pack',
      'context_pack_item',
    ],
  },
  {
    domain: 'memory',
    representativeTables: [
      'working_memory',
      'episodic_summary',
      'semantic_memory',
      'decision_memory',
      'memory_correction',
      'retention_policy',
    ],
  },
  {
    domain: 'observability_evals',
    representativeTables: [
      'request_log',
      'trace_ref',
      'eval_dataset',
      'eval_case',
      'eval_run',
      'metric',
      'cost_event',
      'audit_event',
    ],
  },
] as const;

export type MigrationOwnershipConvention = (typeof migrationOwnershipConventions)[number];
export type SchemaDomainConvention = (typeof initialSchemaDomainMap)[number];
export type HighVolumeRetentionCandidate = (typeof highVolumeRetentionCandidates)[number];
