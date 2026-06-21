import { modelProviderRegistryContractVersion } from './schema.ts';
import type {
  ModelAliasRegistryEntry,
  ModelProviderRegistrySnapshot,
  RegistryPricePoint,
  RegistryPriceSnapshot,
  RegistryProductionGate,
  RegistryProviderCandidate,
} from './schema.ts';

export const initialModelAliasNames = [
  'devgateway/orchestrator',
  'devgateway/deep-reasoning',
  'devgateway/code-review',
  'devgateway/large-context',
  'devgateway/fast',
  'devgateway/retrieval-planner',
] as const;

export type InitialModelAliasName = (typeof initialModelAliasNames)[number];
export type InitialModelAlias = ModelAliasRegistryEntry & { alias: InitialModelAliasName };

type ProviderProfile = {
  provider: 'openai' | 'anthropic';
  model_id: string;
  context_window_tokens: number;
  max_output_tokens: number;
};

const aliasCandidateProfiles = {
  'devgateway/orchestrator': [
    {'provider': 'openai', 'model_id': 'gpt-4o', 'context_window_tokens': 128000, 'max_output_tokens': 16384},
    {'provider': 'anthropic', 'model_id': 'claude-3-5-sonnet-20240620', 'context_window_tokens': 200000, 'max_output_tokens': 8192},
  ],
  'devgateway/deep-reasoning': [
    {'provider': 'openai', 'model_id': 'gpt-4o', 'context_window_tokens': 128000, 'max_output_tokens': 16384},
    {'provider': 'anthropic', 'model_id': 'claude-3-5-sonnet-20240620', 'context_window_tokens': 200000, 'max_output_tokens': 8192},
  ],
  'devgateway/code-review': [
    {'provider': 'openai', 'model_id': 'gpt-4o', 'context_window_tokens': 128000, 'max_output_tokens': 16384},
    {'provider': 'anthropic', 'model_id': 'claude-3-5-sonnet-20240620', 'context_window_tokens': 200000, 'max_output_tokens': 8192},
  ],
  'devgateway/large-context': [
    {'provider': 'openai', 'model_id': 'gpt-4o', 'context_window_tokens': 128000, 'max_output_tokens': 16384},
    {'provider': 'anthropic', 'model_id': 'claude-3-5-sonnet-20240620', 'context_window_tokens': 200000, 'max_output_tokens': 8192},
  ],
  'devgateway/fast': [
    {'provider': 'openai', 'model_id': 'gpt-4o-mini', 'context_window_tokens': 128000, 'max_output_tokens': 16384},
    {'provider': 'anthropic', 'model_id': 'claude-3-haiku-20240307', 'context_window_tokens': 200000, 'max_output_tokens': 4096},
  ],
  'devgateway/retrieval-planner': [
    {'provider': 'openai', 'model_id': 'gpt-4o-mini', 'context_window_tokens': 128000, 'max_output_tokens': 16384},
    {'provider': 'anthropic', 'model_id': 'claude-3-haiku-20240307', 'context_window_tokens': 200000, 'max_output_tokens': 4096},
  ],
} as const satisfies Record<InitialModelAliasName, readonly ProviderProfile[]>;

const disabledProductionGate = {
  production_enabled: false,
  production_route_allowed: false,
  gate_result_ref: null,
  notes:
    'Initial Track 1.3 alias posture: production lifecycle and routing disabled; non-production candidate metadata only; no passing gate result reference.',
} satisfies RegistryProductionGate;

function disabledAlias(
  alias: InitialModelAliasName,
  purpose: string,
  suite_id: string,
  notes?: string,
): InitialModelAlias {
  return {
    alias,
    purpose,
    lifecycle_status: 'disabled',
    production_gate: {
      ...disabledProductionGate,
      notes: notes ?? disabledProductionGate.notes,
    },
    routing: {
      tier: 'disabled',
      fallback_aliases: [],
    },
    eval_gate: {
      suite_id,
      suite_version: 'placeholder',
      latest_gate_status: 'not_run',
      gate_result_ref: null,
      evaluated_at: null,
    },
    candidates: aliasCandidateProfiles[alias].map((profile) => buildProviderCandidate(alias, profile)),
  };
}

function buildProviderCandidate(alias: InitialModelAliasName, profile: ProviderProfile): RegistryProviderCandidate {
  const common: Omit<
    RegistryProviderCandidate,
    'provider_id' | 'wire_format' | 'tokenizer' | 'tool_call_support' | 'structured_output' | 'streaming'
  > = {
    candidate_id: `${slug(alias)}-${profile.provider}-${slug(profile.model_id)}`,
    provider_control_plane: 'direct',
    provider_region: 'us',
    model_id: profile.model_id,
    context_limits: {
      context_window_tokens: profile.context_window_tokens,
      max_output_tokens: profile.max_output_tokens,
    },
    price_snapshot: unknownPriceSnapshot(),
    data_residency: {
      processing_regions: ['us', 'eu'],
      storage_regions: [],
      cross_border_transfer: true,
    },
    allowed_data_classes: ['public', 'internal'],
    provider_posture: {
      retention: 'limited',
      retention_days: 30,
      training: 'opt_out',
      dpa: 'unknown',
      zdr: 'unknown',
    },
    rate_limits: [
      {
        scope: 'virtual_key',
        window_seconds: 60,
        request_limit: 60,
        input_token_limit: 500_000,
        output_token_limit: 100_000,
        concurrency_limit: 5,
      },
    ],
    manual_approval_gate: {
      required: false,
      status: 'not_required',
      approval_ref: null,
      approver: null,
      reviewed_at: null,
      notes:
        'Direct external provider candidate is non-production only; production enablement requires alias, provider, eval, and approval gates.',
    },
  };

  if (profile.provider === 'openai') {
    return {
      ...common,
      provider_id: 'openai-track0-external',
      wire_format: 'openai_chat_completions',
      tokenizer: {
        source: 'tiktoken',
        reference: 'o200k_base',
        count_tokens_endpoint: null,
      },
      tool_call_support: {
        supported: true,
        schema_dialect: 'openai_tools_json_schema',
      },
      structured_output: {
        supported: true,
        validation_strategy: 'provider_strict_json_schema',
      },
      streaming: {
        supported: true,
        event_format: 'sse',
      },
    };
  }

  return {
    ...common,
    provider_id: 'anthropic-track0-external',
    wire_format: 'anthropic_messages',
    tokenizer: {
      source: 'anthropic_count_tokens',
      reference: 'POST /v1/messages/count_tokens',
      count_tokens_endpoint: '/v1/messages/count_tokens',
    },
    tool_call_support: {
      supported: true,
      schema_dialect: 'anthropic_tools_json_schema',
    },
    structured_output: {
      supported: true,
      validation_strategy: 'gateway_repair_then_validate',
    },
    streaming: {
      supported: true,
      event_format: 'sse',
    },
  };
}

function unknownPriceSnapshot(): RegistryPriceSnapshot {
  return {
    currency: 'USD',
    effective_at: '2026-06-20T07:48:38.024Z',
    source: 'First-release non-production placeholder; verify provider-published pricing before production enablement.',
    input_per_million_tokens: unknownPricePoint(),
    output_per_million_tokens: unknownPricePoint(),
    cache_read_per_million_tokens: unknownPricePoint(),
    cache_write_per_million_tokens: unknownPricePoint(),
    batch_input_per_million_tokens: unknownPricePoint(),
    batch_output_per_million_tokens: unknownPricePoint(),
  };
}

function unknownPricePoint(): RegistryPricePoint {
  return {
    status: 'unknown',
    amount: null,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const initialModelAliases = [
  disabledAlias(
    'devgateway/orchestrator',
    'Supervisor, task decomposition, and synthesis.',
    'agent_orchestration_v0_placeholder',
  ),
  disabledAlias(
    'devgateway/deep-reasoning',
    'Architecture and high-complexity planning.',
    'deep_reasoning_v0_placeholder',
  ),
  disabledAlias('devgateway/code-review', 'Diff review plus bug and security finding.', 'code_review_v0_placeholder'),
  disabledAlias(
    'devgateway/large-context',
    'Large documents, repositories, and context packs.',
    'large_context_v0_placeholder',
    'Initial Track 1.3 alias posture: production lifecycle and routing disabled; non-production candidate metadata only; no passing gate result reference; any future Google Vertex route requires manual approval before configuration.',
  ),
  disabledAlias('devgateway/fast', 'Low-cost high-volume tasks.', 'fast_tasks_v0_placeholder'),
  disabledAlias(
    'devgateway/retrieval-planner',
    'Query planning and context-pack construction.',
    'retrieval_planning_v0_placeholder',
  ),
] satisfies InitialModelAlias[];

export const initialModelAliasRegistry = {
  contract_version: modelProviderRegistryContractVersion,
  registry_version: 'model-aliases.v0.1',
  created_at: '2026-06-20T07:48:38.024Z',
  freshness_expires_at: '2026-12-31T00:00:00.000Z',
  production_posture: {
    production_enabled: false,
    production_route_allowed: false,
    gate_result_ref: null,
    notes:
      'Track 1.3 registry snapshot is data-only and cannot route production keys; aliases carry non-production candidate metadata but no production routes, fallbacks, or passing gate references.',
  },
  model_aliases: initialModelAliases,
} satisfies ModelProviderRegistrySnapshot;

export function isProductionDisabledInitialAlias(alias: ModelAliasRegistryEntry): boolean {
  return (
    alias.lifecycle_status === 'disabled' &&
    alias.production_gate.production_enabled === false &&
    alias.production_gate.production_route_allowed === false &&
    alias.production_gate.gate_result_ref === null &&
    alias.routing.tier === 'disabled' &&
    alias.routing.fallback_aliases.length === 0 &&
    alias.eval_gate.latest_gate_status !== 'passing' &&
    alias.eval_gate.gate_result_ref === null &&
    alias.candidates.every((candidate) => candidate.manual_approval_gate.status !== 'approved')
  );
}
