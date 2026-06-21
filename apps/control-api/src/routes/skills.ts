import {
  getBundledSkillRegistrySnapshot,
  validateSkillRegistry,
  type GateResultReference,
  type SkillRegistryRecord,
  type SkillRegistrySnapshot,
} from '@devgateway/registry';

import { gatewayControlContractVersion, type EnvironmentName } from '../../../../packages/shared-types/src/gateway-control.ts';

import type { ControlRouteAuthContext, ControlRouteDefinition, ControlRouteRequest } from './virtual-keys.ts';
import { stalePolicyControlError } from '../policies/control-errors.ts';
import {
  AgentWorkflowRouteValidationError,
  asSkillListFilter,
  assertAgentWorkflowRouteEnabledOutsideProduction,
  authenticateAgentWorkflowRequest,
  createInMemoryAgentWorkflowStore,
  errorResponseSchema,
  handleKnownAgentWorkflowRouteErrors,
  respond,
  skillListQuerySchema,
  skillResponseSchema,
  toSkillResponse,
  type AgentWorkflowStore,
  type SkillDefinitionControlRecord,
  type SkillListFilter,
  type InMemoryAgentWorkflowStoreOptions,
} from './agent-workflow-store.ts';

export const SKILLS_BASE_PATH = '/api/skills' as const;

export interface SkillRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export type SkillStore = Pick<AgentWorkflowStore, 'listSkills'>;

export interface SkillRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: SkillStore;
  readonly registrySnapshot?: SkillRegistrySnapshot | null;
  readonly now?: Date;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export function createInMemorySkillStore(options: InMemoryAgentWorkflowStoreOptions = {}): AgentWorkflowStore {
  return createInMemoryAgentWorkflowStore(options);
}

export function createBundledSkillRegistryStore(
  options: Pick<SkillRouteOptions, 'registrySnapshot' | 'now'> = {},
): SkillStore {
  return new BundledSkillRegistryStore(options);
}

export function registerSkillRoutes(registrar: SkillRouteRegistrar, options: SkillRouteOptions = {}): void {
  const store = options.store ?? createBundledSkillRegistryStore(options);

  registrar.route({
    method: 'GET',
    url: SKILLS_BASE_PATH,
    schema: listSkillsSchema,
    handler: async (request, reply) =>
      handleKnownAgentWorkflowRouteErrors(reply, async () => {
        assertAgentWorkflowRouteEnabledOutsideProduction(options, 'skills-list');
        const actor = await authenticateAgentWorkflowRequest(request, options);
        const requestedFilter = asSkillListFilter(request.query);
        if (requestedFilter.principal_id !== undefined && requestedFilter.principal_id !== actor.principalId) {
          throw new AgentWorkflowRouteValidationError('principal_id filter must match authenticated principal.', {
            statusCode: 403,
            code: 'invalid_state',
          });
        }
        const skills = await store.listSkills({ ...requestedFilter, principal_id: actor.principalId });
        return respond(reply, 200, {
          skills: skills.map(toSkillResponse),
          count: skills.length,
        });
      }),
  });
}

const skillListEnvelopeSchema = {
  type: 'object',
  required: ['skills', 'count'],
  properties: {
    skills: {
      type: 'array',
      items: skillResponseSchema,
    },
    count: {
      type: 'integer',
      minimum: 0,
    },
  },
} as const;

export const listSkillsSchema = {
  operationId: 'listSkills',
  tags: ['control-api', 'skills'],
  summary: 'List skills',
  description:
    'Lists safe skill definitions visible to the authenticated principal or service token. Responses contain refs and policy metadata only, not raw instruction templates.',
  querystring: skillListQuerySchema,
  response: {
    200: skillListEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  },
} as const;

class BundledSkillRegistryStore implements SkillStore {
  readonly #registrySnapshot: SkillRegistrySnapshot | null | undefined;
  readonly #now: Date | undefined;

  constructor(options: Pick<SkillRouteOptions, 'registrySnapshot' | 'now'>) {
    this.#registrySnapshot = options.registrySnapshot;
    this.#now = options.now;
  }

  async listSkills(filter: SkillListFilter): Promise<readonly SkillDefinitionControlRecord[]> {
    const snapshot = getValidatedSkillRegistrySnapshot(this.#registrySnapshot, this.#now);
    return snapshot.skills
      .filter(isNonProductionSkill)
      .filter((skill) => filter.project_id === undefined || skill.project_id === filter.project_id)
      .filter((skill) => filter.principal_id === undefined || skill.principal_id === filter.principal_id)
      .filter((skill) => filter.data_class === undefined || skill.data_class === filter.data_class)
      .filter((skill) => filter.status === undefined || skill.status === filter.status)
      .map((skill) => toSkillDefinitionControlRecord(skill, snapshot));
  }
}

function getValidatedSkillRegistrySnapshot(
  registrySnapshot: SkillRegistrySnapshot | null | undefined,
  now: Date | undefined,
): SkillRegistrySnapshot {
  if (registrySnapshot === null) {
    throw stalePolicyControlError({ field: 'skill_registry_snapshot', source: 'bundled', reason: 'missing' });
  }

  let snapshot: SkillRegistrySnapshot;
  try {
    snapshot = registrySnapshot ?? getBundledSkillRegistrySnapshot();
  } catch (error) {
    throw stalePolicyControlError({
      field: 'skill_registry_snapshot',
      source: 'bundled',
      reason: 'missing_or_unreadable',
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  const validation = validateSkillRegistry({ snapshot, ...(now === undefined ? {} : { now }) });
  if (!validation.ok) {
    throw stalePolicyControlError({
      field: 'skill_registry_snapshot',
      registry_version: snapshot.registry_version,
      issues: validation.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    });
  }

  return snapshot;
}

function isNonProductionSkill(skill: SkillRegistryRecord): boolean {
  return skill.status !== 'production' && !skill.rollout_policy.production_enabled;
}

function toSkillDefinitionControlRecord(
  skill: SkillRegistryRecord,
  snapshot: SkillRegistrySnapshot,
): SkillDefinitionControlRecord {
  return {
    contract_version: gatewayControlContractVersion,
    skill_definition_id: skill.skill_definition_id,
    skill_version_id: skill.skill_version_id,
    status: skill.status,
    owner_ref: { ...skill.owner_ref },
    allowed_model_aliases: [...skill.allowed_model_aliases],
    allowed_tool_refs: skill.allowed_tool_refs.map((ref) => ({ ...ref })),
    disallowed_tool_refs: skill.disallowed_tool_refs.map((ref) => ({ ...ref })),
    instruction_template_refs: skill.instruction_template_refs.map((ref) => ({ ...ref })),
    input_schema_ref: { ...skill.input_schema_ref },
    output_schema_ref: { ...skill.output_schema_ref },
    approval_policy: { ...skill.approval_policy },
    eval_suite_refs: skill.eval_suite_refs.map((ref) => ({
      eval_suite_id: ref.eval_suite_id,
      eval_suite_version: ref.eval_suite_version,
      gate_result_ref:
        ref.gate_result_ref === null
          ? {
              ref_id: `pending-gate-result:${ref.eval_suite_id}`,
              ref_type: 'gate_result_ref_pending',
              scope_ref: skill.skill_definition_id,
            }
          : toGateResultOpaqueRef(ref.gate_result_ref),
    })),
    rollout_policy: { ...skill.rollout_policy },
    gate_result_refs: skill.gate_result_refs.map(toGateResultOpaqueRef),
    artifact_refs: [],
    audit_refs: [],
    cost_refs: [],
    idempotency: {
      idempotency_key: `skill-registry:${skill.skill_version_id}`,
      scope: 'skill_publish',
      dedupe_ref: skill.skill_definition_id,
      expires_at: snapshot.freshness_expires_at,
    },
    principal_id: skill.principal_id,
    project_id: skill.project_id,
    data_class: skill.data_class,
    budget_scope_id: skill.budget_scope_id,
    policy_version: skill.policy_version,
    registry_version: skill.registry_version,
    trace_id: `trace:skill-registry:${skill.skill_definition_id}`,
    request_id: `request:skill-registry:${skill.skill_version_id}`,
    trace_context_ref: {
      trace_context_id: `trace-context:skill-registry:${skill.skill_definition_id}`,
      span_id: `span:skill-registry:${skill.skill_version_id}`,
      propagation_ref: `registry-snapshot:${snapshot.registry_version}`,
    },
    created_at: skill.created_at,
    updated_at: skill.updated_at,
  };
}

function toGateResultOpaqueRef(ref: GateResultReference): SkillDefinitionControlRecord['gate_result_refs'][number] {
  return {
    ref_id: ref.gate_result_id,
    ref_type: 'gate_result_ref',
    scope_ref: ref.change_id,
  };
}
