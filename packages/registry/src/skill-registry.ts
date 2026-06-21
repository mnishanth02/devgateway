import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import skillRegistrySnapshotJson from '../registry/skills.v0.1.json' with { type: 'json' };
import {
  gateResultContractVersion,
  validateGateResultReferenceMatch,
  type GateResultRecord,
  type GateResultReference,
} from './gate-result-contract.ts';
import { getBundledRegistrySnapshot } from './load-registry.ts';
import { dataClasses } from './schema.ts';
import type { DataClass, ModelProviderRegistrySnapshot } from './schema.ts';

export const skillRegistryContractVersion = '0.1.0' as const;
export const skillRegistrySchemaId =
  'https://devgateway.local/schemas/registry/skill-registry.v0.1.schema.json' as const;

export const skillLifecycleStatuses = [
  'draft',
  'eval_ready',
  'approved',
  'limited_rollout',
  'production',
  'disabled',
] as const;
export const skillRolloutStates = ['none', 'limited', 'production', 'disabled'] as const;
export const skillToolRiskTiers = [
  'read_only_low',
  'read_only_medium',
  'approval_required',
  'disallowed_write',
  'network_restricted',
] as const;
export const skillSchemaEnforcements = [
  'validate_before_dispatch',
  'validate_before_execution',
  'validate_before_synthesis',
  'validate_before_persist',
] as const;
export const skillOwnerTypes = ['principal', 'team', 'project', 'service'] as const;

export const knownTrack2ReadOnlyToolIds = [
  'track2.catalog.schema.read',
  'track2.registry.model-alias.read',
  'track2.registry.skill.read',
  'track2.artifact.read',
  'track2.audit.events.read',
  'track2.workflow.state.read',
  'track2.workflow.event.read',
] as const;

export const knownTrack2DeniedToolIds = [
  'track2.artifact.write',
  'track2.workflow.dispatch',
  'track2.tool.execute',
  'track2.budget.reserve',
  'track2.registry.skill.publish',
  'track2.registry.model-alias.write',
] as const;

export const knownTrack2SchemaIds = [
  'https://devgateway.local/schemas/agent/skill-definition.v0.1.schema.json',
  'https://devgateway.local/schemas/agent/delegation.v0.1.schema.json',
  'https://devgateway.local/schemas/agent/sub-agent-result.v0.1.schema.json',
  'https://devgateway.local/schemas/agent/task-artifact.v0.1.schema.json',
  'https://devgateway.local/schemas/agent/tool-call.v0.1.schema.json',
  'https://devgateway.local/schemas/agent/workflow-state.v0.1.schema.json',
  'https://devgateway.local/schemas/agent/workflow-event.v0.1.schema.json',
  'https://devgateway.local/schemas/agent/agent-run.v0.1.schema.json',
  'https://devgateway.local/schemas/agent/agent-definition.v0.1.schema.json',
] as const;

export const knownTrack2EvalSuiteIds = [
  'track2.fixture.skill-definition.smoke.v0.1',
  'track2.fixture.delegation.contract.v0.1',
  'track2.fixture.sub-agent-result.contract.v0.1',
  'track2.fixture.task-artifact.contract.v0.1',
  'track2.fixture.tool-call.policy.v0.1',
  'track2.fixture.workflow-state-event.contract.v0.1',
] as const;

export type SkillLifecycleStatus = (typeof skillLifecycleStatuses)[number];
export type SkillRolloutState = (typeof skillRolloutStates)[number];
export type SkillToolRiskTier = (typeof skillToolRiskTiers)[number];
export type SkillSchemaEnforcement = (typeof skillSchemaEnforcements)[number];
export type SkillOwnerType = (typeof skillOwnerTypes)[number];
export type KnownTrack2ReadOnlyToolId = (typeof knownTrack2ReadOnlyToolIds)[number];
export type KnownTrack2DeniedToolId = (typeof knownTrack2DeniedToolIds)[number];
export type KnownTrack2SchemaId = (typeof knownTrack2SchemaIds)[number];
export type KnownTrack2EvalSuiteId = (typeof knownTrack2EvalSuiteIds)[number];

export interface SkillOpaqueRef {
  ref_id: string;
  ref_type: string;
  scope_ref: string;
}

export interface SkillOwnerRef {
  owner_type: SkillOwnerType;
  owner_id: string;
  project_id: string | null;
  principal_id: string | null;
}

export interface SkillToolRef {
  tool_definition_id: string;
  tool_version: string;
  risk_tier: SkillToolRiskTier;
}

export interface SkillToolBundle {
  bundle_id: string;
  bundle_version: string;
  tool_refs: SkillToolRef[];
}

export interface SkillSchemaRef {
  schema_id: string;
  json_pointer: string;
  schema_version: string;
  enforcement: SkillSchemaEnforcement;
}

export interface SkillApprovalPolicy {
  approval_required: boolean;
  approval_ref: string | null;
  approver_ref: string | null;
  policy_ref: string;
}

export interface SkillEvalSuiteRef {
  eval_suite_id: string;
  eval_suite_version: string;
  fixture_ref: SkillOpaqueRef;
  gate_result_ref: GateResultReference | null;
}

export interface SkillRolloutPolicy {
  rollout_state: SkillRolloutState;
  production_enabled: boolean;
  allowed_project_refs: string[];
  allowed_principal_refs: string[];
}

export interface SkillRegistryProductionPosture {
  production_enabled: boolean;
  production_route_allowed: boolean;
  gate_result_refs: GateResultReference[];
  notes: string;
}

export interface SkillRegistryRecord {
  contract_version: typeof skillRegistryContractVersion;
  skill_definition_id: string;
  skill_version_id: string;
  status: SkillLifecycleStatus;
  lifecycle_status: SkillLifecycleStatus;
  owner_ref: SkillOwnerRef;
  principal_id: string;
  project_id: string;
  data_class: DataClass;
  budget_scope_id: string;
  policy_version: string;
  registry_version: string;
  allowed_model_aliases: string[];
  allowed_tool_refs: SkillToolRef[];
  disallowed_tool_refs: SkillToolRef[];
  tool_bundles: SkillToolBundle[];
  instruction_template_refs: SkillOpaqueRef[];
  input_schema_ref: SkillSchemaRef;
  output_schema_ref: SkillSchemaRef;
  approval_policy: SkillApprovalPolicy;
  eval_suite_refs: SkillEvalSuiteRef[];
  rollout_policy: SkillRolloutPolicy;
  gate_result_refs: GateResultReference[];
  artifact_refs: SkillOpaqueRef[];
  audit_refs: SkillOpaqueRef[];
  cost_refs: SkillOpaqueRef[];
  created_at: string;
  updated_at: string;
}

export interface SkillRegistrySnapshot {
  contract_version: typeof skillRegistryContractVersion;
  registry_version: string;
  created_at: string;
  freshness_expires_at: string;
  production_posture: SkillRegistryProductionPosture;
  skills: SkillRegistryRecord[];
}

export type SkillRegistryValidationIssueCode =
  | 'schema'
  | 'policy_stale'
  | 'ref'
  | 'model_alias'
  | 'tool_ref'
  | 'eval_suite'
  | 'production_gate'
  | 'approval_required'
  | 'rollout'
  | 'content_safety'
  | 'fixture';

export interface SkillRegistryValidationIssue {
  code: SkillRegistryValidationIssueCode;
  path: string;
  message: string;
}

export interface SkillRegistryValidationResult {
  ok: boolean;
  issues: SkillRegistryValidationIssue[];
}

export interface SkillRegistryValidationInput {
  snapshot: SkillRegistrySnapshot;
  modelRegistry?: ModelProviderRegistrySnapshot;
  gateResults?: readonly GateResultRecord[];
  now?: Date;
}

export interface SkillRegistrySnapshotLoadOptions {
  readonly path?: string;
}

export const defaultSkillRegistrySnapshotPath = fileURLToPath(new URL('../registry/skills.v0.1.json', import.meta.url));
const skillRegistrySnapshot = skillRegistrySnapshotJson as SkillRegistrySnapshot;

export async function loadSkillRegistrySnapshot(
  options: SkillRegistrySnapshotLoadOptions = {},
): Promise<SkillRegistrySnapshot> {
  const path = options.path ?? defaultSkillRegistrySnapshotPath;
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return assertSkillRegistrySnapshot(parsed, path);
}

export function getBundledSkillRegistrySnapshot(): SkillRegistrySnapshot {
  return cloneSkillRegistrySnapshot(assertSkillRegistrySnapshot(skillRegistrySnapshotJson, defaultSkillRegistrySnapshotPath));
}

export function assertSkillRegistrySnapshot(value: unknown, source = 'skill registry snapshot'): SkillRegistrySnapshot {
  if (!isRecord(value)) throw new Error(`${source} must be a JSON object`);
  assertString(value.contract_version, `${source}.contract_version`);
  assertString(value.registry_version, `${source}.registry_version`);
  assertString(value.created_at, `${source}.created_at`);
  assertString(value.freshness_expires_at, `${source}.freshness_expires_at`);
  if (!isRecord(value.production_posture)) throw new Error(`${source}.production_posture must be a JSON object`);
  if (!Array.isArray(value.skills)) throw new Error(`${source}.skills must be an array`);
  return value as unknown as SkillRegistrySnapshot;
}

export function validateSkillRegistry(input: SkillRegistryValidationInput): SkillRegistryValidationResult {
  const issues: SkillRegistryValidationIssue[] = [];
  const snapshot = input.snapshot;
  const gateResults = input.gateResults ?? [];
  const now = input.now ?? new Date();
  const modelRegistry = input.modelRegistry ?? getBundledRegistrySnapshot();

  validateSkillRegistryEnvelope(snapshot, now, issues);
  const registryProductionEnabled = validateSkillRegistryProductionPosture(
    snapshot.production_posture,
    gateResults,
    '$.production_posture',
    issues,
  );
  const modelAliases = new Set(modelRegistry.model_aliases.map((alias) => alias.alias));
  const seenSkillDefinitions = new Set<string>();
  const seenSkillVersions = new Set<string>();

  snapshot.skills.forEach((skill, index) => {
    const path = `$.skills[${index}]`;
    if (seenSkillDefinitions.has(skill.skill_definition_id)) {
      issues.push({
        code: 'schema',
        path: `${path}.skill_definition_id`,
        message: `duplicate skill definition "${skill.skill_definition_id}"`,
      });
    }
    seenSkillDefinitions.add(skill.skill_definition_id);
    if (seenSkillVersions.has(skill.skill_version_id)) {
      issues.push({
        code: 'schema',
        path: `${path}.skill_version_id`,
        message: `duplicate skill version "${skill.skill_version_id}"`,
      });
    }
    seenSkillVersions.add(skill.skill_version_id);
    validateSkillRecord(skill, index, snapshot.registry_version, modelAliases, gateResults, registryProductionEnabled, issues);
  });

  validateNoRawContentOrSecrets(snapshot, '$', issues);
  return { ok: issues.length === 0, issues };
}

export function validateSkillRegistryNegativeFixtures(
  input: Omit<SkillRegistryValidationInput, 'snapshot'> = {},
): SkillRegistryValidationResult {
  const brokenSnapshot = cloneSkillRegistrySnapshot(skillRegistrySnapshot);
  const brokenSkill = brokenSnapshot.skills[0];
  if (!brokenSkill) {
    return {
      ok: false,
      issues: [{ code: 'fixture', path: '$.skills', message: 'negative fixture could not find a skill to mutate' }],
    };
  }

  brokenSkill.status = 'production';
  brokenSkill.lifecycle_status = 'production';
  brokenSkill.approval_policy = {
    approval_required: true,
    approval_ref: 'approval:fixture/production-skill',
    approver_ref: 'principal:skill-registry-admin',
    policy_ref: 'policy:track2.skill.production.v0.1',
  };
  brokenSkill.rollout_policy = {
    rollout_state: 'production',
    production_enabled: true,
    allowed_project_refs: ['project:devgateway'],
    allowed_principal_refs: ['principal:skill-registry-admin'],
  };
  brokenSkill.gate_result_refs = [];

  const validationInput: SkillRegistryValidationInput = {
    snapshot: brokenSnapshot,
    gateResults: input.gateResults ?? [],
    now: input.now ?? new Date('2026-06-21T10:30:00.000Z'),
  };
  if (input.modelRegistry !== undefined) {
    validationInput.modelRegistry = input.modelRegistry;
  }
  const result = validateSkillRegistry(validationInput);
  const provedNegativeCase = result.issues.some(
    (issue) => issue.code === 'production_gate' && issue.path.endsWith('.gate_result_refs'),
  );

  if (!provedNegativeCase) {
    return {
      ok: false,
      issues: [
        {
          code: 'fixture',
          path: '$.negative.production_skill_without_gate',
          message: 'negative fixture unexpectedly passed; production skills without gates are not being blocked',
        },
      ],
    };
  }

  return { ok: true, issues: [] };
}

function validateSkillRegistryEnvelope(
  snapshot: SkillRegistrySnapshot,
  now: Date,
  issues: SkillRegistryValidationIssue[],
): void {
  if (snapshot.contract_version !== skillRegistryContractVersion) {
    issues.push({
      code: 'schema',
      path: '$.contract_version',
      message: `expected ${skillRegistryContractVersion}`,
    });
  }
  validateRequiredSafeString(snapshot.registry_version, '$.registry_version', issues);
  if (!isValidDateTime(snapshot.created_at)) {
    issues.push({ code: 'policy_stale', path: '$.created_at', message: 'skill registry creation timestamp is missing or invalid' });
  }
  if (!isValidDateTime(snapshot.freshness_expires_at)) {
    issues.push({
      code: 'policy_stale',
      path: '$.freshness_expires_at',
      message: 'skill registry freshness expiration is missing or invalid',
    });
    return;
  }
  if (Date.parse(snapshot.freshness_expires_at) <= now.getTime()) {
    issues.push({
      code: 'policy_stale',
      path: '$.freshness_expires_at',
      message: 'skill registry snapshot is stale and must fail closed',
    });
  }
  if (!Array.isArray(snapshot.skills) || snapshot.skills.length < 2) {
    issues.push({
      code: 'schema',
      path: '$.skills',
      message: 'skill registry must include at least two non-production skills',
    });
  }
  if (!snapshot.skills.some((skill) => skill.status === 'draft')) {
    issues.push({ code: 'schema', path: '$.skills', message: 'skill registry must include a draft skill' });
  }
  if (!snapshot.skills.some((skill) => skill.status === 'eval_ready')) {
    issues.push({ code: 'schema', path: '$.skills', message: 'skill registry must include an eval_ready skill' });
  }
}

function validateSkillRegistryProductionPosture(
  posture: SkillRegistryProductionPosture,
  gateResults: readonly GateResultRecord[],
  path: string,
  issues: SkillRegistryValidationIssue[],
): boolean {
  if (!isRecord(posture)) {
    issues.push({ code: 'schema', path, message: 'production posture is required' });
    return false;
  }

  if (typeof posture.production_enabled !== 'boolean' || typeof posture.production_route_allowed !== 'boolean') {
    issues.push({ code: 'schema', path, message: 'production posture flags must be boolean' });
  }
  if (posture.production_enabled !== posture.production_route_allowed) {
    issues.push({
      code: 'production_gate',
      path,
      message: 'production_enabled and production_route_allowed must move together',
    });
  }
  if (posture.production_enabled || posture.production_route_allowed) {
    if (!Array.isArray(posture.gate_result_refs) || posture.gate_result_refs.length === 0) {
      issues.push({
        code: 'production_gate',
        path: `${path}.gate_result_refs`,
        message: 'production registry posture requires passing gate-result references',
      });
    } else {
      posture.gate_result_refs.forEach((ref, index) => {
        validateGateResultReference(ref, `${path}.gate_result_refs[${index}]`, gateResults, issues);
      });
    }
  }

  return posture.production_enabled === true && posture.production_route_allowed === true;
}

function validateSkillRecord(
  skill: SkillRegistryRecord,
  index: number,
  registryVersion: string,
  modelAliases: ReadonlySet<string>,
  gateResults: readonly GateResultRecord[],
  registryProductionEnabled: boolean,
  issues: SkillRegistryValidationIssue[],
): void {
  const path = `$.skills[${index}]`;
  const isProductionSkill = skill.status === 'production' || skill.lifecycle_status === 'production';

  if (skill.contract_version !== skillRegistryContractVersion) {
    issues.push({ code: 'schema', path: `${path}.contract_version`, message: `expected ${skillRegistryContractVersion}` });
  }
  validateRequiredSafeString(skill.skill_definition_id, `${path}.skill_definition_id`, issues);
  validateRequiredSafeString(skill.skill_version_id, `${path}.skill_version_id`, issues);
  validateRequiredSafeString(skill.principal_id, `${path}.principal_id`, issues);
  validateRequiredSafeString(skill.project_id, `${path}.project_id`, issues);
  if (!includesReadonly(dataClasses, skill.data_class)) {
    issues.push({ code: 'schema', path: `${path}.data_class`, message: 'unknown skill data class' });
  }
  validateRequiredSafeString(skill.budget_scope_id, `${path}.budget_scope_id`, issues);
  validateRequiredSafeString(skill.policy_version, `${path}.policy_version`, issues);
  validateRequiredSafeString(skill.registry_version, `${path}.registry_version`, issues);
  if (!isValidDateTime(skill.created_at)) {
    issues.push({ code: 'schema', path: `${path}.created_at`, message: 'skill creation timestamp is missing or invalid' });
  }
  if (!isValidDateTime(skill.updated_at)) {
    issues.push({ code: 'schema', path: `${path}.updated_at`, message: 'skill update timestamp is missing or invalid' });
  }
  if (skill.registry_version !== registryVersion) {
    issues.push({
      code: 'schema',
      path: `${path}.registry_version`,
      message: 'skill registry version must match the snapshot registry_version',
    });
  }

  if (!includesReadonly(skillLifecycleStatuses, skill.status)) {
    issues.push({ code: 'schema', path: `${path}.status`, message: 'unknown skill lifecycle status' });
  }
  if (!includesReadonly(skillLifecycleStatuses, skill.lifecycle_status)) {
    issues.push({ code: 'schema', path: `${path}.lifecycle_status`, message: 'unknown skill lifecycle status' });
  }
  if (skill.status !== skill.lifecycle_status) {
    issues.push({
      code: 'schema',
      path: `${path}.lifecycle_status`,
      message: 'status and lifecycle_status must match',
    });
  }

  validateOwnerRef(skill.owner_ref, `${path}.owner_ref`, issues);
  validateModelAliases(skill.allowed_model_aliases, modelAliases, `${path}.allowed_model_aliases`, issues);
  validateToolRefs(skill.allowed_tool_refs, `${path}.allowed_tool_refs`, 'allowed', issues);
  validateToolRefs(skill.disallowed_tool_refs, `${path}.disallowed_tool_refs`, 'disallowed', issues);
  validateToolBundles(skill.tool_bundles, `${path}.tool_bundles`, issues);
  validateOpaqueRefArray(skill.instruction_template_refs, `${path}.instruction_template_refs`, issues, { minItems: 1 });
  validateSchemaRef(skill.input_schema_ref, `${path}.input_schema_ref`, issues);
  validateSchemaRef(skill.output_schema_ref, `${path}.output_schema_ref`, issues);
  validateApprovalPolicy(skill.approval_policy, `${path}.approval_policy`, issues);
  validateEvalSuiteRefs(skill.eval_suite_refs, `${path}.eval_suite_refs`, isProductionSkill, skill.skill_definition_id, gateResults, issues);
  validateRolloutPolicy(skill.rollout_policy, `${path}.rollout_policy`, skill.status, issues);
  validateGateResultReferenceArray(skill.gate_result_refs, `${path}.gate_result_refs`, gateResults, issues, {
    skillId: skill.skill_definition_id,
  });
  validateOpaqueRefArray(skill.artifact_refs, `${path}.artifact_refs`, issues);
  validateOpaqueRefArray(skill.audit_refs, `${path}.audit_refs`, issues);
  validateOpaqueRefArray(skill.cost_refs, `${path}.cost_refs`, issues);

  if (isProductionSkill) {
    validateProductionSkill(skill, path, registryProductionEnabled, issues);
  } else if (skill.rollout_policy.production_enabled || skill.rollout_policy.rollout_state === 'production') {
    issues.push({
      code: 'rollout',
      path: `${path}.rollout_policy`,
      message: 'non-production skills cannot enable production rollout',
    });
  }
}

function validateOwnerRef(
  owner: SkillOwnerRef,
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!isRecord(owner)) {
    issues.push({ code: 'ref', path, message: 'owner_ref is required' });
    return;
  }
  if (!includesReadonly(skillOwnerTypes, owner.owner_type)) {
    issues.push({ code: 'ref', path: `${path}.owner_type`, message: 'unknown owner type' });
  }
  validateRequiredSafeString(owner.owner_id, `${path}.owner_id`, issues);
  validateNullableSafeString(owner.project_id, `${path}.project_id`, issues);
  validateNullableSafeString(owner.principal_id, `${path}.principal_id`, issues);
}

function validateModelAliases(
  aliases: readonly string[],
  modelAliases: ReadonlySet<string>,
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!Array.isArray(aliases) || aliases.length === 0) {
    issues.push({ code: 'model_alias', path, message: 'allowed_model_aliases must include at least one alias' });
    return;
  }
  const seen = new Set<string>();
  aliases.forEach((alias, aliasIndex) => {
    const aliasPath = `${path}[${aliasIndex}]`;
    if (!validateRequiredSafeString(alias, aliasPath, issues)) return;
    if (seen.has(alias)) {
      issues.push({ code: 'model_alias', path: aliasPath, message: `duplicate model alias "${alias}"` });
    }
    seen.add(alias);
    if (!modelAliases.has(alias)) {
      issues.push({ code: 'model_alias', path: aliasPath, message: `model alias "${alias}" is not registered` });
    }
  });
}

function validateToolRefs(
  refs: readonly SkillToolRef[],
  path: string,
  mode: 'allowed' | 'disallowed',
  issues: SkillRegistryValidationIssue[],
): void {
  if (!Array.isArray(refs)) {
    issues.push({ code: 'tool_ref', path, message: 'tool refs must be an array' });
    return;
  }
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    const refPath = `${path}[${index}]`;
    validateToolRef(ref, refPath, mode, issues);
    const key = `${ref.tool_definition_id}@${ref.tool_version}`;
    if (seen.has(key)) {
      issues.push({ code: 'tool_ref', path: refPath, message: `duplicate tool ref "${key}"` });
    }
    seen.add(key);
  });
}

function validateToolRef(
  ref: SkillToolRef,
  path: string,
  mode: 'allowed' | 'disallowed',
  issues: SkillRegistryValidationIssue[],
): void {
  if (!isRecord(ref)) {
    issues.push({ code: 'tool_ref', path, message: 'tool ref is required' });
    return;
  }
  const id = ref.tool_definition_id;
  validateRequiredSafeString(id, `${path}.tool_definition_id`, issues);
  validateRequiredSafeString(ref.tool_version, `${path}.tool_version`, issues);
  if (!includesReadonly(skillToolRiskTiers, ref.risk_tier)) {
    issues.push({ code: 'tool_ref', path: `${path}.risk_tier`, message: 'unknown tool risk tier' });
    return;
  }

  if (mode === 'allowed') {
    if (!includesReadonly(knownTrack2ReadOnlyToolIds, id)) {
      issues.push({
        code: 'tool_ref',
        path: `${path}.tool_definition_id`,
        message: `allowed tool "${id}" is not a known read-only Track 2 tool`,
      });
    }
    if (ref.risk_tier !== 'read_only_low' && ref.risk_tier !== 'read_only_medium') {
      issues.push({ code: 'tool_ref', path: `${path}.risk_tier`, message: 'allowed tools must use a read-only risk tier' });
    }
    if (isSideEffectLikeToolId(id)) {
      issues.push({
        code: 'tool_ref',
        path: `${path}.tool_definition_id`,
        message: `write or side-effect-like tool "${id}" cannot be allowed`,
      });
    }
    return;
  }

  if (!includesReadonly(knownTrack2DeniedToolIds, id) && !isSideEffectLikeToolId(id)) {
    issues.push({
      code: 'tool_ref',
      path: `${path}.tool_definition_id`,
      message: `disallowed tool "${id}" is not a known Track 2 side-effect tool`,
    });
  }
  if (ref.risk_tier === 'read_only_low' || ref.risk_tier === 'read_only_medium') {
    issues.push({ code: 'tool_ref', path: `${path}.risk_tier`, message: 'disallowed tools must not use a read-only risk tier' });
  }
}

function validateToolBundles(
  bundles: readonly SkillToolBundle[],
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    issues.push({ code: 'tool_ref', path, message: 'at least one read-only tool bundle is required' });
    return;
  }
  const seen = new Set<string>();
  bundles.forEach((bundle, index) => {
    const bundlePath = `${path}[${index}]`;
    if (!isRecord(bundle)) {
      issues.push({ code: 'tool_ref', path: bundlePath, message: 'tool bundle is required' });
      return;
    }
    validateRequiredSafeString(bundle.bundle_id, `${bundlePath}.bundle_id`, issues);
    validateRequiredSafeString(bundle.bundle_version, `${bundlePath}.bundle_version`, issues);
    const key = `${bundle.bundle_id}@${bundle.bundle_version}`;
    if (seen.has(key)) {
      issues.push({ code: 'tool_ref', path: bundlePath, message: `duplicate tool bundle "${key}"` });
    }
    seen.add(key);
    if (!Array.isArray(bundle.tool_refs) || bundle.tool_refs.length === 0) {
      issues.push({ code: 'tool_ref', path: `${bundlePath}.tool_refs`, message: 'tool bundle must include read-only tool refs' });
      return;
    }
    validateToolRefs(bundle.tool_refs, `${bundlePath}.tool_refs`, 'allowed', issues);
  });
}

function validateSchemaRef(
  ref: SkillSchemaRef,
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!isRecord(ref)) {
    issues.push({ code: 'ref', path, message: 'schema ref is required' });
    return;
  }
  validateRequiredSafeString(ref.schema_id, `${path}.schema_id`, issues);
  if (!includesReadonly(knownTrack2SchemaIds, ref.schema_id)) {
    issues.push({
      code: 'ref',
      path: `${path}.schema_id`,
      message: `schema "${ref.schema_id}" is not a known Track 2 schema/catalog ref`,
    });
  }
  if (typeof ref.json_pointer !== 'string' || !/^#(\/.*)?$/.test(ref.json_pointer)) {
    issues.push({ code: 'ref', path: `${path}.json_pointer`, message: 'json_pointer must be a schema pointer' });
  }
  validateRequiredSafeString(ref.schema_version, `${path}.schema_version`, issues);
  if (!includesReadonly(skillSchemaEnforcements, ref.enforcement)) {
    issues.push({ code: 'ref', path: `${path}.enforcement`, message: 'unknown schema enforcement point' });
  }
}

function validateApprovalPolicy(
  policy: SkillApprovalPolicy,
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!isRecord(policy)) {
    issues.push({ code: 'approval_required', path, message: 'approval policy is required' });
    return;
  }
  if (typeof policy.approval_required !== 'boolean') {
    issues.push({ code: 'approval_required', path: `${path}.approval_required`, message: 'approval_required must be boolean' });
  }
  validateNullableSafeString(policy.approval_ref, `${path}.approval_ref`, issues);
  validateNullableSafeString(policy.approver_ref, `${path}.approver_ref`, issues);
  validateRequiredSafeString(policy.policy_ref, `${path}.policy_ref`, issues);
  if (policy.approval_required && (!policy.approval_ref || !policy.approver_ref)) {
    issues.push({
      code: 'approval_required',
      path,
      message: 'required approvals must include approval_ref and approver_ref',
    });
  }
}

function validateEvalSuiteRefs(
  refs: readonly SkillEvalSuiteRef[],
  path: string,
  isProductionSkill: boolean,
  skillId: string,
  gateResults: readonly GateResultRecord[],
  issues: SkillRegistryValidationIssue[],
): void {
  if (!Array.isArray(refs) || refs.length === 0) {
    issues.push({ code: 'eval_suite', path, message: 'eval_suite_refs must include at least one known Track 2 fixture suite' });
    return;
  }
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    const refPath = `${path}[${index}]`;
    if (!isRecord(ref)) {
      issues.push({ code: 'eval_suite', path: refPath, message: 'eval suite ref is required' });
      return;
    }
    const suiteRef = ref as unknown as SkillEvalSuiteRef;
    validateRequiredSafeString(suiteRef.eval_suite_id, `${refPath}.eval_suite_id`, issues);
    if (!includesReadonly(knownTrack2EvalSuiteIds, suiteRef.eval_suite_id)) {
      issues.push({
        code: 'eval_suite',
        path: `${refPath}.eval_suite_id`,
        message: `eval suite "${suiteRef.eval_suite_id}" is not a known Track 2 fixture suite`,
      });
    }
    validateRequiredSafeString(suiteRef.eval_suite_version, `${refPath}.eval_suite_version`, issues);
    const key = `${suiteRef.eval_suite_id}@${suiteRef.eval_suite_version}`;
    if (seen.has(key)) {
      issues.push({ code: 'eval_suite', path: refPath, message: `duplicate eval suite ref "${key}"` });
    }
    seen.add(key);
    validateOpaqueRef(suiteRef.fixture_ref, `${refPath}.fixture_ref`, issues);
    if (suiteRef.gate_result_ref === null) {
      if (isProductionSkill) {
        issues.push({
          code: 'production_gate',
          path: `${refPath}.gate_result_ref`,
          message: 'production skills require passing eval gate-result references',
        });
      }
      return;
    }
    validateGateResultReference(suiteRef.gate_result_ref, `${refPath}.gate_result_ref`, gateResults, issues, {
      skillId,
    });
  });
}

function validateRolloutPolicy(
  rollout: SkillRolloutPolicy,
  path: string,
  status: SkillLifecycleStatus,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!isRecord(rollout)) {
    issues.push({ code: 'rollout', path, message: 'rollout policy is required' });
    return;
  }
  if (!includesReadonly(skillRolloutStates, rollout.rollout_state)) {
    issues.push({ code: 'rollout', path: `${path}.rollout_state`, message: 'unknown rollout state' });
  }
  if (typeof rollout.production_enabled !== 'boolean') {
    issues.push({ code: 'rollout', path: `${path}.production_enabled`, message: 'production_enabled must be boolean' });
  }
  validateSafeStringArray(rollout.allowed_project_refs, `${path}.allowed_project_refs`, issues);
  validateSafeStringArray(rollout.allowed_principal_refs, `${path}.allowed_principal_refs`, issues);
  if (status === 'disabled' && rollout.rollout_state !== 'disabled') {
    issues.push({ code: 'rollout', path: `${path}.rollout_state`, message: 'disabled skills must use disabled rollout state' });
  }
  if (rollout.rollout_state === 'production' && !rollout.production_enabled) {
    issues.push({
      code: 'rollout',
      path,
      message: 'production rollout state must set production_enabled true',
    });
  }
}

function validateProductionSkill(
  skill: SkillRegistryRecord,
  path: string,
  registryProductionEnabled: boolean,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!registryProductionEnabled) {
    issues.push({
      code: 'production_gate',
      path: '$.production_posture',
      message: 'static skill registry production posture is disabled',
    });
  }
  if (!skill.approval_policy.approval_required || !skill.approval_policy.approval_ref || !skill.approval_policy.approver_ref) {
    issues.push({
      code: 'approval_required',
      path: `${path}.approval_policy`,
      message: 'production skills require owner approval with approval_ref and approver_ref',
    });
  }
  if (skill.rollout_policy.rollout_state !== 'production' || !skill.rollout_policy.production_enabled) {
    issues.push({
      code: 'rollout',
      path: `${path}.rollout_policy`,
      message: 'production skills require rollout_state production and production_enabled true',
    });
  }
  if (!Array.isArray(skill.gate_result_refs) || skill.gate_result_refs.length === 0) {
    issues.push({
      code: 'production_gate',
      path: `${path}.gate_result_refs`,
      message: 'production skills require passing gate-result references',
    });
  }
}

function validateOpaqueRefArray(
  refs: readonly SkillOpaqueRef[],
  path: string,
  issues: SkillRegistryValidationIssue[],
  options: { minItems?: number } = {},
): void {
  if (!Array.isArray(refs)) {
    issues.push({ code: 'ref', path, message: 'refs must be an array' });
    return;
  }
  if (options.minItems !== undefined && refs.length < options.minItems) {
    issues.push({ code: 'ref', path, message: `at least ${options.minItems} ref is required` });
  }
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    const refPath = `${path}[${index}]`;
    validateOpaqueRef(ref, refPath, issues);
    if (!isRecord(ref)) return;
    const key = `${ref.ref_type}:${ref.scope_ref}:${ref.ref_id}`;
    if (seen.has(key)) {
      issues.push({ code: 'ref', path: refPath, message: `duplicate opaque ref "${key}"` });
    }
    seen.add(key);
  });
}

function validateOpaqueRef(
  ref: SkillOpaqueRef,
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!isRecord(ref)) {
    issues.push({ code: 'ref', path, message: 'opaque ref is required' });
    return;
  }
  const allowedKeys = new Set(['ref_id', 'ref_type', 'scope_ref']);
  for (const key of Object.keys(ref)) {
    if (!allowedKeys.has(key)) {
      issues.push({ code: 'ref', path: `${path}.${key}`, message: 'opaque refs cannot carry raw content or metadata' });
    }
  }
  validateRequiredSafeString(ref.ref_id, `${path}.ref_id`, issues);
  validateRequiredSafeString(ref.ref_type, `${path}.ref_type`, issues);
  validateRequiredSafeString(ref.scope_ref, `${path}.scope_ref`, issues);
}

function validateGateResultReferenceArray(
  refs: readonly GateResultReference[],
  path: string,
  gateResults: readonly GateResultRecord[],
  issues: SkillRegistryValidationIssue[],
  target: { skillId?: string } = {},
): void {
  if (!Array.isArray(refs)) {
    issues.push({ code: 'production_gate', path, message: 'gate_result_refs must be an array' });
    return;
  }
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    const refPath = `${path}[${index}]`;
    validateGateResultReference(ref, refPath, gateResults, issues, target);
    if (!isRecord(ref)) return;
    const key = `${ref.gate_result_id}:${ref.change_id}:${ref.dataset_version}:${ref.eval_suite_version}:${ref.artifact_version}`;
    if (seen.has(key)) {
      issues.push({ code: 'production_gate', path: refPath, message: `duplicate gate result ref "${key}"` });
    }
    seen.add(key);
  });
}

function validateGateResultReference(
  ref: GateResultReference,
  path: string,
  gateResults: readonly GateResultRecord[],
  issues: SkillRegistryValidationIssue[],
  target: { skillId?: string } = {},
): void {
  if (!isRecord(ref)) {
    issues.push({ code: 'production_gate', path, message: 'gate-result reference is required' });
    return;
  }
  if (ref.contract_version !== gateResultContractVersion) {
    issues.push({
      code: 'production_gate',
      path: `${path}.contract_version`,
      message: `gate-result reference must use contract ${gateResultContractVersion}`,
    });
  }
  validateRequiredSafeString(ref.gate_result_id, `${path}.gate_result_id`, issues);
  validateRequiredSafeString(ref.change_id, `${path}.change_id`, issues);
  validateRequiredSafeString(ref.dataset_version, `${path}.dataset_version`, issues);
  validateRequiredSafeString(ref.eval_suite_version, `${path}.eval_suite_version`, issues);
  validateRequiredSafeString(ref.artifact_version, `${path}.artifact_version`, issues);
  if (ref.required_pass !== true) {
    issues.push({ code: 'production_gate', path: `${path}.required_pass`, message: 'gate-result reference must require a pass' });
  }

  const targetExpectation = target.skillId === undefined ? undefined : { kind: 'skill' as const, skillId: target.skillId };
  const validation = targetExpectation === undefined
    ? validateGateResultReferenceMatch({ ref, gateResults })
    : validateGateResultReferenceMatch({ ref, gateResults, target: targetExpectation });
  for (const issue of validation.issues) {
    issues.push({
      code: issue.code === 'approver_required' ? 'approval_required' : 'production_gate',
      path,
      message: issue.message,
    });
  }
}

function validateSafeStringArray(
  values: readonly string[],
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!Array.isArray(values)) {
    issues.push({ code: 'ref', path, message: 'value must be an array' });
    return;
  }
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const valuePath = `${path}[${index}]`;
    if (!validateRequiredSafeString(value, valuePath, issues)) return;
    if (seen.has(value)) {
      issues.push({ code: 'ref', path: valuePath, message: `duplicate ref "${value}"` });
    }
    seen.add(value);
  });
}

function validateRequiredSafeString(
  value: unknown,
  path: string,
  issues: SkillRegistryValidationIssue[],
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ code: 'ref', path, message: 'required ref string is missing' });
    return false;
  }
  validateSafeRefString(value, path, issues);
  return true;
}

function validateNullableSafeString(
  value: unknown,
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (value === null) return;
  validateRequiredSafeString(value, path, issues);
}

function validateSafeRefString(
  value: string,
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,191}$/.test(value)) {
    issues.push({
      code: 'ref',
      path,
      message: 'ref values must be opaque identifiers without whitespace or inline content',
    });
  }
  if (containsSecretLikeValue(value)) {
    issues.push({ code: 'content_safety', path, message: 'ref value resembles a secret, key, or token' });
  }
}

function validateNoRawContentOrSecrets(
  value: unknown,
  path: string,
  issues: SkillRegistryValidationIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoRawContentOrSecrets(item, `${path}[${index}]`, issues));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === 'string' && containsSecretLikeValue(value)) {
      issues.push({ code: 'content_safety', path, message: 'registry value resembles a secret, key, or token' });
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isForbiddenRawContentField(key)) {
      issues.push({
        code: 'content_safety',
        path: childPath,
        message: 'skill registry records must use refs instead of raw prompts, content, secrets, keys, or tokens',
      });
      continue;
    }
    validateNoRawContentOrSecrets(child, childPath, issues);
  }
}

function isForbiddenRawContentField(key: string): boolean {
  return [
    'prompt',
    'prompts',
    'prompt_template',
    'instruction',
    'instructions',
    'instruction_template',
    'content',
    'raw_content',
    'secret',
    'secrets',
    'api_key',
    'provider_key',
    'token',
    'access_token',
    'refresh_token',
    'provider_token',
    'private_key',
  ].includes(key.toLowerCase());
}

function containsSecretLikeValue(value: string): boolean {
  return /(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-|-----BEGIN|api[_-]?key\s*=|authorization:\s*bearer|bearer\s+[A-Za-z0-9._-]{20,})/i.test(
    value,
  );
}

function isSideEffectLikeToolId(toolId: string): boolean {
  return /(?:^|[._:-])(write|dispatch|execute|mutate|create|update|delete|reserve|publish)(?:$|[._:-])/.test(toolId);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidDateTime(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function includesReadonly<T extends string>(values: readonly T[], value: string): value is T {
  return values.includes(value as T);
}

function cloneSkillRegistrySnapshot(snapshot: SkillRegistrySnapshot): SkillRegistrySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as SkillRegistrySnapshot;
}
