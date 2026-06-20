import { modelProviderRegistryContractVersion } from './schema.js';
import type { ModelAliasRegistryEntry, ModelProviderRegistrySnapshot, RegistryProductionGate } from './schema.js';

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

const disabledProductionGate = {
  production_enabled: false,
  production_route_allowed: false,
  gate_result_ref: null,
  notes:
    'Initial Track 0.5 alias posture: disabled lifecycle, no production route, no candidate providers, and no passing gate result reference.',
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
    candidates: [],
  };
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
  disabledAlias(
    'devgateway/code-review',
    'Diff review plus bug and security finding.',
    'code_review_v0_placeholder',
  ),
  disabledAlias(
    'devgateway/large-context',
    'Large documents, repositories, and context packs.',
    'large_context_v0_placeholder',
    'Initial Track 0.5 alias posture: disabled lifecycle, no production route, no candidate providers, no passing gate result reference, and any future Google Vertex route requires manual approval before configuration.',
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
      'Track 0.5 registry snapshot is data-only and cannot route production keys; aliases have no candidates, routes, fallbacks, or passing gate references.',
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
    alias.candidates.length === 0
  );
}
