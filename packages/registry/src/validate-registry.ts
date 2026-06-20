import registrySnapshotJson from '../registry/model-aliases.v0.1.json' with { type: 'json' };
import {
  validateGateResultReferenceMatch,
  type GateResultRecord,
  type GateResultMatchIssue,
  type GateResultTargetExpectation,
} from './gate-result-contract.ts';
import {
  dataClasses,
  gateStatuses,
  lifecycleStatuses,
  modelProviderRegistryContractVersion,
  providerControlPlanes,
  wireFormats,
} from './schema.ts';
import type {
  DataClass,
  GateStatus,
  LifecycleStatus,
  ModelAliasRegistryEntry,
  ModelProviderRegistrySnapshot,
  RegistryGateResultReference,
  RegistryProductionGate,
  RegistryProviderCandidate,
} from './schema.ts';

declare const console: {
  error(message?: unknown, ...optionalParameters: unknown[]): void;
  log(message?: unknown, ...optionalParameters: unknown[]): void;
};
declare const process: {
  argv: string[];
  exitCode?: number;
};

export interface RegistryValidationIssue {
  code:
    | 'schema'
    | 'policy_stale'
    | 'production_gate'
    | 'eval_gate'
    | 'route_disabled'
    | 'approval_required'
    | 'fixture';
  path: string;
  message: string;
}

export interface RegistryValidationResult {
  ok: boolean;
  issues: RegistryValidationIssue[];
}

interface RegistryValidationInput {
  snapshot: ModelProviderRegistrySnapshot;
  gateResults?: readonly GateResultRecord[];
  now?: Date;
}

type GateTargetExpectation = GateResultTargetExpectation;

type MutableRegistryProductionGate = Omit<RegistryProductionGate, 'production_enabled' | 'production_route_allowed'> & {
  production_enabled: boolean;
  production_route_allowed: boolean;
};

type MutableModelAliasRegistryEntry = Omit<ModelAliasRegistryEntry, 'production_gate'> & {
  production_gate: MutableRegistryProductionGate;
};

const registrySnapshot = registrySnapshotJson as ModelProviderRegistrySnapshot;

export function validateRegistry(input: RegistryValidationInput): RegistryValidationResult {
  const issues: RegistryValidationIssue[] = [];
  const gateResults = input.gateResults ?? [];
  const now = input.now ?? new Date();
  const snapshot = input.snapshot;

  validateSnapshotEnvelope(snapshot, now, issues);
  validateProductionGate(snapshot.production_posture, gateResults, '$.production_posture', issues, {});

  const seenAliases = new Set<string>();
  const aliasesByName = new Map<string, ModelAliasRegistryEntry>();
  snapshot.model_aliases.forEach((alias, index) => {
    const path = `$.model_aliases[${index}]`;
    if (seenAliases.has(alias.alias)) {
      issues.push({ code: 'schema', path: `${path}.alias`, message: `duplicate alias "${alias.alias}"` });
    }
    seenAliases.add(alias.alias);
    aliasesByName.set(alias.alias, alias);
  });

  snapshot.model_aliases.forEach((alias, index) => {
    validateAlias(alias, index, aliasesByName, gateResults, issues);
  });

  return { ok: issues.length === 0, issues };
}

export function validateRegistryNegativeFixtures(): RegistryValidationResult {
  const brokenSnapshot = cloneRegistrySnapshot(registrySnapshot);
  const brokenAlias = brokenSnapshot.model_aliases[0] as MutableModelAliasRegistryEntry | undefined;
  if (!brokenAlias) {
    return {
      ok: false,
      issues: [{ code: 'fixture', path: '$.model_aliases', message: 'negative fixture could not find an alias to mutate' }],
    };
  }

  brokenAlias.lifecycle_status = 'approved';
  brokenAlias.production_gate = {
    production_enabled: true,
    production_route_allowed: true,
    gate_result_ref: null,
    notes: 'Negative fixture: production-enabled alias without gate must fail.',
  };
  brokenAlias.routing = {
    tier: 'primary',
    fallback_aliases: [],
  };
  brokenAlias.eval_gate = {
    ...brokenAlias.eval_gate,
    latest_gate_status: 'passing',
    gate_result_ref: null,
  };

  const result = validateRegistry({ snapshot: brokenSnapshot, gateResults: [], now: new Date('2026-06-20T08:00:00.000Z') });
  const provedNegativeCase = result.issues.some(
    (issue) => issue.code === 'production_gate' || issue.code === 'eval_gate',
  );

  if (!provedNegativeCase) {
    return {
      ok: false,
      issues: [
        {
          code: 'fixture',
          path: '$.negative.production_alias_without_gate',
          message: 'negative fixture unexpectedly passed; production aliases without gates are not being blocked',
        },
      ],
    };
  }

  return { ok: true, issues: [] };
}

export function validateRegistryCli(): RegistryValidationResult {
  const validation = validateRegistry({ snapshot: registrySnapshot });
  const negativeFixture = validateRegistryNegativeFixtures();
  const issues = [...validation.issues, ...negativeFixture.issues];
  const result = { ok: issues.length === 0, issues };

  if (!result.ok) {
    console.error('Registry validation failed:');
    for (const issue of result.issues) {
      console.error(`- [${issue.code}] ${issue.path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return result;
  }

  console.log('Registry validation passed.');
  return result;
}

function validateSnapshotEnvelope(
  snapshot: ModelProviderRegistrySnapshot,
  now: Date,
  issues: RegistryValidationIssue[],
): void {
  if (snapshot.contract_version !== modelProviderRegistryContractVersion) {
    issues.push({
      code: 'schema',
      path: '$.contract_version',
      message: `expected ${modelProviderRegistryContractVersion}`,
    });
  }

  if (!isNonEmptyString(snapshot.registry_version)) {
    issues.push({ code: 'policy_stale', path: '$.registry_version', message: 'registry version is missing or unverifiable' });
  }

  if (!isValidDateTime(snapshot.created_at)) {
    issues.push({ code: 'policy_stale', path: '$.created_at', message: 'registry creation timestamp is missing or invalid' });
  }

  if (!isValidDateTime(snapshot.freshness_expires_at)) {
    issues.push({
      code: 'policy_stale',
      path: '$.freshness_expires_at',
      message: 'registry freshness expiration is missing or invalid',
    });
    return;
  }

  if (Date.parse(snapshot.freshness_expires_at) <= now.getTime()) {
    issues.push({
      code: 'policy_stale',
      path: '$.freshness_expires_at',
      message: 'registry snapshot is stale and must fail closed',
    });
  }
}

function validateAlias(
  alias: ModelAliasRegistryEntry,
  index: number,
  aliasesByName: ReadonlyMap<string, ModelAliasRegistryEntry>,
  gateResults: readonly GateResultRecord[],
  issues: RegistryValidationIssue[],
): void {
  const path = `$.model_aliases[${index}]`;
  const productionEnabled = alias.production_gate.production_enabled || alias.production_gate.production_route_allowed;

  if (!isNonEmptyString(alias.alias)) {
    issues.push({ code: 'schema', path: `${path}.alias`, message: 'alias is required' });
  }

  if (!includesReadonly(lifecycleStatuses, alias.lifecycle_status)) {
    issues.push({ code: 'schema', path: `${path}.lifecycle_status`, message: 'unknown lifecycle status' });
  }

  if (!includesReadonly(gateStatuses, alias.eval_gate.latest_gate_status)) {
    issues.push({ code: 'schema', path: `${path}.eval_gate.latest_gate_status`, message: 'unknown gate status' });
  }

  if (productionEnabled) {
    if (alias.lifecycle_status !== 'approved') {
      issues.push({
        code: 'production_gate',
        path: `${path}.lifecycle_status`,
        message: 'production-enabled aliases must have approved lifecycle status',
      });
    }
    if (alias.eval_gate.latest_gate_status !== 'passing') {
      issues.push({
        code: 'eval_gate',
        path: `${path}.eval_gate.latest_gate_status`,
        message: 'production-enabled aliases must have a passing eval gate status',
      });
    }
    if (alias.candidates.length === 0) {
      issues.push({
        code: 'route_disabled',
        path: `${path}.candidates`,
        message: 'production-enabled aliases must have at least one gated provider candidate',
      });
    }
  } else {
    validateNonProductionRoutePosture(alias, path, issues);
  }

  const productionGateTarget: GateTargetExpectation = {
    kind: alias.routing.fallback_aliases.length > 0 ? 'fallback_route' : 'model_alias',
    modelAlias: alias.alias,
  };
  validateProductionGate(alias.production_gate, gateResults, `${path}.production_gate`, issues, productionGateTarget);

  if (alias.eval_gate.latest_gate_status === 'passing' || productionEnabled) {
    validateGateReference(alias.eval_gate.gate_result_ref, gateResults, `${path}.eval_gate.gate_result_ref`, issues, {
      kind: 'model_alias',
      modelAlias: alias.alias,
    });
  } else if (alias.eval_gate.gate_result_ref) {
    validateGateReference(alias.eval_gate.gate_result_ref, gateResults, `${path}.eval_gate.gate_result_ref`, issues, {
      kind: 'model_alias',
      modelAlias: alias.alias,
    });
  }

  alias.routing.fallback_aliases.forEach((fallbackAlias, fallbackIndex) => {
    const fallbackPath = `${path}.routing.fallback_aliases[${fallbackIndex}]`;
    const fallback = aliasesByName.get(fallbackAlias);
    if (!fallback) {
      issues.push({ code: 'route_disabled', path: fallbackPath, message: `fallback alias "${fallbackAlias}" is not registered` });
      return;
    }
    if (productionEnabled && (!fallback.production_gate.production_enabled || !fallback.production_gate.production_route_allowed)) {
      issues.push({
        code: 'production_gate',
        path: fallbackPath,
        message: 'production fallback targets must themselves be production-gated',
      });
    }
  });

  alias.candidates.forEach((candidate, candidateIndex) => {
    validateCandidate(candidate, `${path}.candidates[${candidateIndex}]`, productionEnabled, issues);
  });
}

function validateNonProductionRoutePosture(
  alias: ModelAliasRegistryEntry,
  path: string,
  issues: RegistryValidationIssue[],
): void {
  if (alias.production_gate.gate_result_ref) {
    return;
  }

  if (alias.lifecycle_status === 'disabled' && alias.routing.tier !== 'disabled') {
    issues.push({
      code: 'route_disabled',
      path: `${path}.routing.tier`,
      message: 'disabled aliases must use disabled routing so production keys cannot reach them',
    });
  }

  if (alias.lifecycle_status === 'experimental' && (alias.routing.tier === 'primary' || alias.routing.tier === 'fallback')) {
    issues.push({
      code: 'route_disabled',
      path: `${path}.routing.tier`,
      message: 'experimental aliases cannot use production-shaped primary or fallback routing without a gate',
    });
  }
}

function validateCandidate(
  candidate: RegistryProviderCandidate,
  path: string,
  productionEnabled: boolean,
  issues: RegistryValidationIssue[],
): void {
  if (!isNonEmptyString(candidate.candidate_id)) {
    issues.push({ code: 'schema', path: `${path}.candidate_id`, message: 'candidate ID is required' });
  }
  if (!isNonEmptyString(candidate.provider_id)) {
    issues.push({ code: 'schema', path: `${path}.provider_id`, message: 'provider ID is required' });
  }
  if (!includesReadonly(providerControlPlanes, candidate.provider_control_plane)) {
    issues.push({ code: 'schema', path: `${path}.provider_control_plane`, message: 'unknown provider control plane' });
  }
  if (!includesReadonly(wireFormats, candidate.wire_format)) {
    issues.push({ code: 'schema', path: `${path}.wire_format`, message: 'unknown wire format' });
  }
  candidate.allowed_data_classes.forEach((dataClass, index) => {
    if (!includesReadonly(dataClasses, dataClass)) {
      issues.push({ code: 'schema', path: `${path}.allowed_data_classes[${index}]`, message: 'unknown data class' });
    }
  });

  if (productionEnabled && candidate.manual_approval_gate.required) {
    if (candidate.manual_approval_gate.status !== 'approved' || !candidate.manual_approval_gate.approver) {
      issues.push({
        code: 'approval_required',
        path: `${path}.manual_approval_gate`,
        message: 'production candidates requiring manual approval must include approved status and approver',
      });
    }
  }
}

function validateProductionGate(
  gate: RegistryProductionGate,
  gateResults: readonly GateResultRecord[],
  path: string,
  issues: RegistryValidationIssue[],
  target: GateTargetExpectation,
): void {
  if (gate.production_enabled !== gate.production_route_allowed) {
    issues.push({
      code: 'production_gate',
      path,
      message: 'production_enabled and production_route_allowed must move together to avoid partial production routes',
    });
  }

  if (gate.production_enabled || gate.production_route_allowed) {
    validateGateReference(gate.gate_result_ref, gateResults, `${path}.gate_result_ref`, issues, target);
  } else if (gate.gate_result_ref) {
    validateGateReference(gate.gate_result_ref, gateResults, `${path}.gate_result_ref`, issues, target);
  }
}

function validateGateReference(
  ref: RegistryGateResultReference | null,
  gateResults: readonly GateResultRecord[],
  path: string,
  issues: RegistryValidationIssue[],
  target: GateTargetExpectation,
): void {
  const validation = validateGateResultReferenceMatch({
    ref,
    gateResults,
    target,
  });
  for (const issue of validation.issues) {
    issues.push({
      code: mapGateResultMatchIssueCode(issue.code),
      path,
      message: issue.message,
    });
  }
}

function mapGateResultMatchIssueCode(code: GateResultMatchIssue['code']): RegistryValidationIssue['code'] {
  if (code === 'pass_required' || code === 'blocking_severity') {
    return 'eval_gate';
  }
  if (code === 'approver_required') {
    return 'approval_required';
  }
  return 'production_gate';
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function isValidDateTime(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function includesReadonly<T extends string>(values: readonly T[], value: string): value is T {
  return values.includes(value as T);
}

function cloneRegistrySnapshot(snapshot: ModelProviderRegistrySnapshot): ModelProviderRegistrySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ModelProviderRegistrySnapshot;
}

if (process.argv[1]?.endsWith('validate-registry.ts') === true) {
  validateRegistryCli();
}
