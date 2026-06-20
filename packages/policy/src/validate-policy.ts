import {
  DENIAL_REASON_CODES,
  DENIAL_REASONS,
  DENIAL_TAXONOMY,
} from './denial-reasons.ts';
import {
  DATA_CLASSES,
  DATA_CLASS_ROUTING_RULES,
  POLICY_EVALUATION_ORDER,
  evaluateDataClassPolicy,
  providerDataClassMatrix,
} from './data-class-policy.ts';
import {
  gateResultContractVersion,
  validateGateResultReferenceMatch,
  type GateResultMatchIssue,
  type GateResultRecord,
  type GateResultReference,
  type GateResultTargetExpectation,
} from '../../registry/src/gate-result-contract.ts';
import type {
  DataClass,
  PolicyEvaluationStep,
  ProviderPolicy,
  ProviderPolicyMatrix,
} from './data-class-policy.ts';

declare const console: {
  error(message?: unknown, ...optionalParameters: unknown[]): void;
  log(message?: unknown, ...optionalParameters: unknown[]): void;
};
declare const process: {
  argv: string[];
  exitCode?: number;
};

export interface PolicyValidationIssue {
  code:
    | 'schema'
    | 'policy_stale'
    | 'production_gate'
    | 'data_class'
    | 'eval_gate'
    | 'approval_required'
    | 'denial_taxonomy'
    | 'fixture';
  path: string;
  message: string;
}

export interface PolicyValidationResult {
  ok: boolean;
  issues: PolicyValidationIssue[];
}

interface PolicyValidationInput {
  matrix: ProviderPolicyMatrix;
  gateResults?: readonly GateResultRecord[];
  now?: Date;
}

type MutableProviderPolicy = Omit<ProviderPolicy, 'productionEnabled' | 'lifecycle' | 'evalGate'> & {
  productionEnabled: boolean;
  lifecycle: ProviderPolicy['lifecycle'] | 'approved_production';
  evalGate: ProviderPolicy['evalGate'];
  productionGate?: {
    gateResultRef?: GateResultReference | null;
  };
};

type MutablePolicyMatrix = Omit<ProviderPolicyMatrix, 'providers' | 'productionEnablement'> & {
  productionEnablement: {
    enabled: boolean;
    note: string;
  };
  freshnessExpiresAt?: string;
  providers: MutableProviderPolicy[];
};

export function validatePolicy(input: PolicyValidationInput): PolicyValidationResult {
  const issues: PolicyValidationIssue[] = [];
  const gateResults = input.gateResults ?? [];
  const now = input.now ?? new Date();

  validateMatrixEnvelope(input.matrix, now, issues);
  validateDataClasses(input.matrix, issues);
  validateEvaluationOrder(input.matrix, issues);
  validateDenialTaxonomy(issues);
  validateProviders(input.matrix.providers as readonly MutableProviderPolicy[], gateResults, issues);

  return { ok: issues.length === 0, issues };
}

export function validatePolicyNegativeFixtures(): PolicyValidationResult {
  const missingGateMatrix = clonePolicyMatrix(providerDataClassMatrix) as MutablePolicyMatrix;
  const missingGateProvider = missingGateMatrix.providers[0];
  const nonPassingGateMatrix = clonePolicyMatrix(providerDataClassMatrix) as MutablePolicyMatrix;
  const nonPassingGateProvider = nonPassingGateMatrix.providers[0];
  if (!missingGateProvider || !nonPassingGateProvider) {
    return {
      ok: false,
      issues: [{ code: 'fixture', path: '$.providers', message: 'negative fixture could not find a provider to mutate' }],
    };
  }

  prepareProductionProviderFixture(missingGateProvider);
  prepareProductionProviderFixture(nonPassingGateProvider);

  const gateResultRef: GateResultReference = {
    contract_version: gateResultContractVersion,
    gate_result_id: 'policy-negative-non-passing-gate-result',
    change_id: 'policy-provider-openai-track0-external-production',
    dataset_version: 'policy-eval-dataset.v0.1',
    eval_suite_version: 'policy-provider-route-suite.v0.1',
    artifact_version: 'provider-data-class-matrix.v0.1',
    required_pass: true,
  };
  nonPassingGateProvider.productionGate = { gateResultRef };

  const missingGateResult = validatePolicy({
    matrix: missingGateMatrix as ProviderPolicyMatrix,
    now: new Date('2026-06-20T08:00:00.000Z'),
  });
  const missingGateBlocked = missingGateResult.issues.some(
    (issue) => issue.code === 'production_gate' && issue.path === '$.providers[0].productionGate.gateResultRef',
  );

  const nonPassingGateResult = validatePolicy({
    matrix: nonPassingGateMatrix as ProviderPolicyMatrix,
    gateResults: [createGateResultFixture(gateResultRef, nonPassingGateProvider, { pass: false })],
    now: new Date('2026-06-20T08:00:00.000Z'),
  });
  const nonPassingGateBlocked = nonPassingGateResult.issues.some(
    (issue) => issue.code === 'eval_gate' && issue.path === '$.providers[0].productionGate.gateResultRef',
  );

  const externalProvider = providerDataClassMatrix.providers.find((provider) => provider.externalModelCalls);
  const alias = externalProvider?.allowedModelAliases[0];
  const restrictedDecision = externalProvider && alias
    ? evaluateDataClassPolicy({
      principal: { id: 'fixture-principal', type: 'user' },
      project: { id: 'fixture-project', dataClass: 'restricted' },
      taskContext: { routeIntent: 'fixture' },
      alias,
      providerCandidate: externalProvider.providerId,
      environment: 'test',
      evalGatePassed: true,
      budgetAvailable: true,
      rateLimitAvailable: true,
      approvals: { providerManualApproval: true },
    })
    : null;
  const restrictedDenied = restrictedDecision?.decision === 'deny' && restrictedDecision.reason === 'data_class';

  const issues: PolicyValidationIssue[] = [];
  if (!missingGateBlocked) {
    issues.push({
      code: 'fixture',
      path: '$.negative.production_provider_without_gate',
      message: 'negative fixture unexpectedly passed; production providers without gates are not being blocked',
    });
  }
  if (!nonPassingGateBlocked) {
    issues.push({
      code: 'fixture',
      path: '$.negative.production_provider_without_matching_passing_gate',
      message: 'negative fixture unexpectedly passed; production providers without matching passing gate results are not being blocked',
    });
  }
  if (!restrictedDenied) {
    issues.push({
      code: 'fixture',
      path: '$.negative.restricted_external_model_call',
      message: 'negative fixture unexpectedly allowed restricted data to use an external model call',
    });
  }

  return { ok: issues.length === 0, issues };
}

export function validatePolicyCli(): PolicyValidationResult {
  const validation = validatePolicy({ matrix: providerDataClassMatrix });
  const negativeFixture = validatePolicyNegativeFixtures();
  const issues = [...validation.issues, ...negativeFixture.issues];
  const result = { ok: issues.length === 0, issues };

  if (!result.ok) {
    console.error('Policy validation failed:');
    for (const issue of result.issues) {
      console.error(`- [${issue.code}] ${issue.path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return result;
  }

  console.log('Policy validation passed.');
  return result;
}

function validateMatrixEnvelope(matrix: ProviderPolicyMatrix, now: Date, issues: PolicyValidationIssue[]): void {
  if (matrix.schemaVersion !== '0.1.0') {
    issues.push({ code: 'schema', path: '$.schemaVersion', message: 'policy schema version must be 0.1.0' });
  }
  if (!isNonEmptyString(matrix.matrixId)) {
    issues.push({ code: 'policy_stale', path: '$.matrixId', message: 'policy matrix ID is missing or unverifiable' });
  }
  if (matrix.status !== 'track_0_governance_only') {
    issues.push({ code: 'schema', path: '$.status', message: 'Track 0.5 policy matrix must remain governance-only' });
  }
  if (matrix.productionEnablement.enabled !== false) {
    issues.push({
      code: 'production_gate',
      path: '$.productionEnablement.enabled',
      message: 'matrix-level production enablement is not represented with gate evidence and must fail closed',
    });
  }

  const freshness = (matrix as ProviderPolicyMatrix & { freshnessExpiresAt?: string }).freshnessExpiresAt;
  if (freshness !== undefined) {
    if (!isValidDateTime(freshness)) {
      issues.push({ code: 'policy_stale', path: '$.freshnessExpiresAt', message: 'policy freshness is unverifiable' });
    } else if (Date.parse(freshness) <= now.getTime()) {
      issues.push({ code: 'policy_stale', path: '$.freshnessExpiresAt', message: 'policy matrix is stale and must fail closed' });
    }
  }
}

function validateDataClasses(matrix: ProviderPolicyMatrix, issues: PolicyValidationIssue[]): void {
  for (const dataClass of DATA_CLASSES) {
    const entry = matrix.dataClasses[dataClass];
    if (!entry) {
      issues.push({ code: 'data_class', path: `$.dataClasses.${dataClass}`, message: 'data class policy is missing' });
      continue;
    }
    if (entry.routingRule !== DATA_CLASS_ROUTING_RULES[dataClass]) {
      issues.push({
        code: 'data_class',
        path: `$.dataClasses.${dataClass}.routingRule`,
        message: 'data class routing rule does not match the locked policy baseline',
      });
    }
  }

  for (const key of Object.keys(matrix.dataClasses)) {
    if (!includesReadonly(DATA_CLASSES, key)) {
      issues.push({ code: 'data_class', path: `$.dataClasses.${key}`, message: 'unknown data class policy entry' });
    }
  }
}

function validateEvaluationOrder(matrix: ProviderPolicyMatrix, issues: PolicyValidationIssue[]): void {
  if (matrix.evaluationOrder.length !== POLICY_EVALUATION_ORDER.length) {
    issues.push({ code: 'schema', path: '$.evaluationOrder', message: 'policy evaluation order length changed' });
    return;
  }

  matrix.evaluationOrder.forEach((step, index) => {
    if (step !== POLICY_EVALUATION_ORDER[index]) {
      issues.push({
        code: 'schema',
        path: `$.evaluationOrder[${index}]`,
        message: `expected ${POLICY_EVALUATION_ORDER[index] ?? 'no step'}`,
      });
    }
  });
}

function validateDenialTaxonomy(issues: PolicyValidationIssue[]): void {
  if (DENIAL_TAXONOMY.failClosed !== true || DENIAL_TAXONOMY.successFallbackAllowed !== false) {
    issues.push({
      code: 'denial_taxonomy',
      path: '$.DENIAL_TAXONOMY',
      message: 'denial taxonomy must fail closed with no success fallback',
    });
  }

  for (const code of DENIAL_REASON_CODES) {
    const reason = DENIAL_REASONS[code];
    if (!reason) {
      issues.push({ code: 'denial_taxonomy', path: `$.DENIAL_REASONS.${code}`, message: 'denial reason is missing' });
      continue;
    }
    if (reason.gatewayPolicyContract.failureMode !== 'fail_closed' || reason.gatewayPolicyContract.successFallbackAllowed !== false) {
      issues.push({
        code: 'denial_taxonomy',
        path: `$.DENIAL_REASONS.${code}.gatewayPolicyContract`,
        message: 'denial reason must fail closed and disallow success fallback',
      });
    }
    if (reason.gatewayPolicyContract.reason !== code || reason.audit.reason !== code) {
      issues.push({
        code: 'denial_taxonomy',
        path: `$.DENIAL_REASONS.${code}`,
        message: 'denial reason code must be consistent in audit and gateway contracts',
      });
    }
  }
}

function validateProviders(
  providers: readonly MutableProviderPolicy[],
  gateResults: readonly GateResultRecord[],
  issues: PolicyValidationIssue[],
): void {
  const providerIds = new Set<string>();

  providers.forEach((provider, index) => {
    const path = `$.providers[${index}]`;
    if (!isNonEmptyString(provider.providerId)) {
      issues.push({ code: 'schema', path: `${path}.providerId`, message: 'provider ID is required' });
    }
    if (providerIds.has(provider.providerId)) {
      issues.push({ code: 'schema', path: `${path}.providerId`, message: `duplicate provider ID "${provider.providerId}"` });
    }
    providerIds.add(provider.providerId);

    validateProviderDataClassPolicy(provider, path, issues);
    validateProviderProductionPosture(provider, path, gateResults, issues);
  });
}

function validateProviderDataClassPolicy(
  provider: MutableProviderPolicy,
  path: string,
  issues: PolicyValidationIssue[],
): void {
  for (const dataClass of provider.dataClassPolicy.allowedDataClasses) {
    if (!includesReadonly(DATA_CLASSES, dataClass)) {
      issues.push({ code: 'data_class', path: `${path}.dataClassPolicy.allowedDataClasses`, message: `unknown data class ${dataClass}` });
    }
  }
  for (const dataClass of provider.dataClassPolicy.deniedDataClasses) {
    if (!includesReadonly(DATA_CLASSES, dataClass)) {
      issues.push({ code: 'data_class', path: `${path}.dataClassPolicy.deniedDataClasses`, message: `unknown data class ${dataClass}` });
    }
  }

  const isExternalModelProvider = provider.providerKind === 'external_model' || provider.externalModelCalls;
  if (isExternalModelProvider) {
    if (!provider.externalModelCalls) {
      issues.push({ code: 'data_class', path: `${path}.externalModelCalls`, message: 'external model providers must mark externalModelCalls=true' });
    }
    if (!provider.dataClassPolicy.restrictedExternalCallsDefaultDeny) {
      issues.push({
        code: 'data_class',
        path: `${path}.dataClassPolicy.restrictedExternalCallsDefaultDeny`,
        message: 'restricted data class must deny external model calls by default',
      });
    }
    if (provider.dataClassPolicy.allowedDataClasses.includes('restricted')) {
      issues.push({
        code: 'data_class',
        path: `${path}.dataClassPolicy.allowedDataClasses`,
        message: 'external model providers cannot allow restricted data',
      });
    }
    if (!provider.dataClassPolicy.deniedDataClasses.includes('restricted')) {
      issues.push({
        code: 'data_class',
        path: `${path}.dataClassPolicy.deniedDataClasses`,
        message: 'external model providers must explicitly deny restricted data',
      });
    }
    if (provider.traceStoragePolicy.allowedForDataClasses.includes('restricted')) {
      issues.push({
        code: 'data_class',
        path: `${path}.traceStoragePolicy.allowedForDataClasses`,
        message: 'external model trace storage cannot be allowed for restricted data',
      });
    }
  }

  if (
    provider.externalModelCalls
    && provider.providerKind === 'external_model'
    && provider.dataClassPolicy.confidentialRequiresDpaOrZdrOrApproval
    && provider.dataClassPolicy.allowedDataClasses.includes('confidential')
    && provider.compliance.dpa !== 'signed'
    && provider.compliance.zeroDataRetention !== 'available'
    && !provider.manualApprovalGate.requiredForDataClasses.includes('confidential')
  ) {
    issues.push({
      code: 'data_class',
      path: `${path}.dataClassPolicy.confidentialRequiresDpaOrZdrOrApproval`,
      message: 'confidential routes require signed DPA, available ZDR, or explicit approval gate',
    });
  }
}

function validateProviderProductionPosture(
  provider: MutableProviderPolicy,
  path: string,
  gateResults: readonly GateResultRecord[],
  issues: PolicyValidationIssue[],
): void {
  if (!provider.evalGate.requiredForProduction) {
    issues.push({
      code: 'eval_gate',
      path: `${path}.evalGate.requiredForProduction`,
      message: 'provider routes must require eval gates before production',
    });
  }

  if (!provider.productionEnabled) {
    return;
  }

  if (provider.lifecycle !== 'approved_production') {
    issues.push({
      code: 'production_gate',
      path: `${path}.lifecycle`,
      message: 'production-enabled providers must have approved_production lifecycle',
    });
  }
  if (provider.evalGate.status !== 'passed') {
    issues.push({
      code: 'eval_gate',
      path: `${path}.evalGate.status`,
      message: 'production-enabled providers must have passed eval gate status',
    });
  }
  validateProviderProductionGate(provider, `${path}.productionGate.gateResultRef`, gateResults, issues);
  if (provider.manualApprovalGate.productionApprovalRequired && !provider.manualApprovalGate.approvalReference) {
    issues.push({
      code: 'approval_required',
      path: `${path}.manualApprovalGate.approvalReference`,
      message: 'production providers requiring approval must include approval reference',
    });
  }
}

function validateProviderProductionGate(
  provider: MutableProviderPolicy,
  path: string,
  gateResults: readonly GateResultRecord[],
  issues: PolicyValidationIssue[],
): void {
  const target: GateResultTargetExpectation = { provider: provider.providerId };
  const validation = validateGateResultReferenceMatch({
    ref: provider.productionGate?.gateResultRef ?? null,
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

function mapGateResultMatchIssueCode(code: GateResultMatchIssue['code']): PolicyValidationIssue['code'] {
  if (code === 'pass_required' || code === 'blocking_severity') {
    return 'eval_gate';
  }
  if (code === 'approver_required') {
    return 'approval_required';
  }
  return 'production_gate';
}

function prepareProductionProviderFixture(provider: MutableProviderPolicy): void {
  provider.productionEnabled = true;
  provider.lifecycle = 'approved_production';
  provider.evalGate = {
    ...provider.evalGate,
    status: 'passed',
  };
  provider.manualApprovalGate = {
    ...provider.manualApprovalGate,
    approvalReference: 'policy-negative-fixture-production-approval',
  };
}

function createGateResultFixture(
  ref: GateResultReference,
  provider: MutableProviderPolicy,
  overrides: Partial<Pick<GateResultRecord, 'pass' | 'blocking_severity' | 'owner_approval_required' | 'approver'>> = {},
): GateResultRecord {
  const alias = provider.allowedModelAliases[0] ?? provider.providerId;
  return {
    contract_version: gateResultContractVersion,
    gate_result_id: ref.gate_result_id,
    change_id: ref.change_id,
    dataset_version: ref.dataset_version,
    eval_suite_version: ref.eval_suite_version,
    runner_version: 'policy-negative-fixture-runner.v0.1',
    target: {
      kind: 'model_alias',
      artifact_version: ref.artifact_version,
      model_alias: alias,
      provider: provider.providerId,
    },
    metrics: {},
    thresholds: {},
    pass: true,
    blocking_severity: 'none',
    artifact_refs: [],
    audit_event_id: 'policy-negative-fixture-audit-event',
    created_at: '2026-06-20T08:00:00.000Z',
    ...overrides,
  };
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

function clonePolicyMatrix(matrix: ProviderPolicyMatrix): ProviderPolicyMatrix {
  return JSON.parse(JSON.stringify(matrix)) as ProviderPolicyMatrix;
}

if (process.argv[1]?.endsWith('validate-policy.ts') === true) {
  validatePolicyCli();
}
