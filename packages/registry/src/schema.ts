export const modelProviderRegistryContractVersion = '0.1.0' as const;

export const modelProviderRegistrySchemaId =
  'https://devgateway.local/schemas/registry/model-provider-registry.v0.1.schema.json' as const;

export const lifecycleStatuses = ['experimental', 'approved', 'deprecated', 'disabled'] as const;
export const wireFormats = [
  'openai_chat_completions',
  'anthropic_messages',
  'provider_native_bifrost_translated',
] as const;
export const dataClasses = ['public', 'internal', 'confidential', 'restricted'] as const;
export const gateStatuses = ['not_run', 'passing', 'failing', 'blocked'] as const;
export const providerControlPlanes = [
  'direct',
  'azure',
  'aws',
  'gcp',
  'vertex',
  'self_hosted',
] as const;

export type LifecycleStatus = (typeof lifecycleStatuses)[number];
export type WireFormat = (typeof wireFormats)[number];
export type DataClass = (typeof dataClasses)[number];
export type GateStatus = (typeof gateStatuses)[number];
export type ProviderControlPlane = (typeof providerControlPlanes)[number];

export interface RegistryGateResultReference {
  contract_version: typeof modelProviderRegistryContractVersion;
  gate_result_id: string;
  change_id: string;
  dataset_version: string;
  eval_suite_version: string;
  artifact_version: string;
  required_pass: true;
}

export interface RegistryProductionGate {
  production_enabled: false;
  production_route_allowed: false;
  gate_result_ref: RegistryGateResultReference | null;
  notes: string;
}

export interface RegistryPricePoint {
  status: 'known' | 'not_offered' | 'unknown';
  amount: number | null;
}

export interface RegistryPriceSnapshot {
  currency: string;
  effective_at: string;
  source: string;
  input_per_million_tokens: RegistryPricePoint;
  output_per_million_tokens: RegistryPricePoint;
  cache_read_per_million_tokens: RegistryPricePoint;
  cache_write_per_million_tokens: RegistryPricePoint;
  batch_input_per_million_tokens: RegistryPricePoint;
  batch_output_per_million_tokens: RegistryPricePoint;
}

export interface RegistryManualApprovalGate {
  required: boolean;
  status: 'not_required' | 'pending' | 'approved' | 'rejected' | 'expired';
  approval_ref: string | null;
  approver: string | null;
  reviewed_at: string | null;
  notes: string;
}

export interface RegistryProviderCandidate {
  candidate_id: string;
  provider_id: string;
  provider_control_plane: ProviderControlPlane;
  provider_region: string;
  model_id: string;
  wire_format: WireFormat;
  tokenizer: {
    source: 'provider_api' | 'gateway_estimator' | 'tiktoken' | 'anthropic_count_tokens' | 'custom';
    reference: string;
    count_tokens_endpoint: string | null;
  };
  context_limits: {
    context_window_tokens: number;
    max_output_tokens: number;
  };
  price_snapshot: RegistryPriceSnapshot;
  tool_call_support: {
    supported: boolean;
    schema_dialect:
      | 'none'
      | 'openai_tools_json_schema'
      | 'anthropic_tools_json_schema'
      | 'json_schema_draft_2020_12'
      | 'provider_native';
  };
  structured_output: {
    supported: boolean;
    validation_strategy:
      | 'none'
      | 'json_schema'
      | 'provider_strict_json_schema'
      | 'gateway_repair_then_validate'
      | 'application_validator';
  };
  streaming: {
    supported: boolean;
    event_format: 'none' | 'sse' | 'jsonl' | 'provider_native';
  };
  data_residency: {
    processing_regions: string[];
    storage_regions: string[];
    cross_border_transfer: boolean;
  };
  allowed_data_classes: DataClass[];
  provider_posture: {
    retention: 'none' | 'zero_retention' | 'limited' | 'standard' | 'unknown';
    retention_days: number | null;
    training: 'disabled' | 'opt_out' | 'enabled' | 'unknown';
    dpa: 'in_place' | 'not_in_place' | 'not_required' | 'unknown';
    zdr: 'available_enabled' | 'available_not_enabled' | 'not_available' | 'unknown';
  };
  rate_limits: Array<{
    scope: 'alias' | 'provider' | 'project' | 'tenant' | 'virtual_key';
    window_seconds: number;
    request_limit: number | null;
    input_token_limit: number | null;
    output_token_limit: number | null;
    concurrency_limit: number | null;
  }>;
  manual_approval_gate: RegistryManualApprovalGate;
}

export interface ModelAliasRegistryEntry {
  alias: string;
  purpose: string;
  lifecycle_status: LifecycleStatus;
  production_gate: RegistryProductionGate;
  routing: {
    tier: 'primary' | 'fallback' | 'manual' | 'disabled';
    fallback_aliases: string[];
  };
  eval_gate: {
    suite_id: string;
    suite_version: string;
    latest_gate_status: GateStatus;
    gate_result_ref: RegistryGateResultReference | null;
    evaluated_at: string | null;
  };
  candidates: RegistryProviderCandidate[];
}

export interface ModelProviderRegistrySnapshot {
  contract_version: typeof modelProviderRegistryContractVersion;
  registry_version: string;
  created_at: string;
  freshness_expires_at: string;
  production_posture: RegistryProductionGate;
  model_aliases: ModelAliasRegistryEntry[];
}
