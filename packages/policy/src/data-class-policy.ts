import providerDataClassMatrixJson from '../policies/provider-data-class-matrix.v0.1.json' with { type: 'json' };
import type { DenialReasonCode } from './denial-reasons.ts';

export const DATA_CLASSES = ['public', 'internal', 'confidential', 'restricted'] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

export const DATA_CLASS_ROUTING_RULES: Record<DataClass, string> = {
  public: 'Any approved provider/model alias.',
  internal: 'Approved providers with acceptable retention/training terms.',
  confidential: 'Providers with DPA/ZDR or explicit company approval; traces redact sensitive snippets.',
  restricted: 'No external model calls; deterministic tooling or approved self-hosted route only.',
} as const;

export const POLICY_EVALUATION_ORDER = [
  'resolve_principal_and_project',
  'resolve_data_class_task_tool_context',
  'resolve_alias_and_provider_candidate',
  'check_provider_lifecycle_and_approval_gate',
  'check_data_class_dpa_zdr_retention_training_region_trace_storage',
  'check_eval_gate',
  'check_budget_and_rate_limit',
  'check_semantic_cache_acl_eligibility',
  'select_route_or_typed_denial',
] as const;

export type PolicyEvaluationStep = (typeof POLICY_EVALUATION_ORDER)[number];

export type ProviderLifecycle =
  | 'disabled'
  | 'evaluation_only'
  | 'approved_non_production'
  | 'approved_self_hosted'
  | 'approved_production'
  | 'retired';

export type ProviderKind = 'external_model' | 'self_hosted_model' | 'deterministic_tooling';

export type PolicyDenialReason = DenialReasonCode;

export type PolicyEnvironment = 'development' | 'test' | 'staging' | 'production';

export type DpaStatus = 'none' | 'pending' | 'signed' | 'not_applicable';

export type ZeroDataRetentionStatus = 'unavailable' | 'pending' | 'available' | 'not_applicable';

export type RetentionMode = 'none' | 'zero' | 'limited' | 'provider_default' | 'unknown';

export type TrainingUse = 'prohibited' | 'opt_out' | 'allowed' | 'unknown' | 'not_applicable';

export type TraceStorageMode = 'none' | 'metadata_only' | 'redacted_snippets_allowed' | 'full_content_allowed';

export interface ProviderPolicyMatrix {
  schemaVersion: '0.1.0';
  matrixId: string;
  status: 'track_0_governance_only';
  productionEnablement: {
    enabled: false;
    note: string;
  };
  dataClasses: Record<DataClass, { routingRule: string }>;
  evaluationOrder: readonly PolicyEvaluationStep[];
  providers: readonly ProviderPolicy[];
}

export interface ProviderPolicy {
  providerId: string;
  displayName: string;
  providerKind: ProviderKind;
  externalModelCalls: boolean;
  lifecycle: ProviderLifecycle;
  productionEnabled: false;
  allowedModelAliases: readonly string[];
  dataClassPolicy: {
    allowedDataClasses: readonly DataClass[];
    deniedDataClasses: readonly DataClass[];
    restrictedExternalCallsDefaultDeny: boolean;
    confidentialRequiresDpaOrZdrOrApproval: boolean;
    internalRequiresAcceptableRetentionTraining: boolean;
  };
  compliance: {
    dpa: DpaStatus;
    zeroDataRetention: ZeroDataRetentionStatus;
    retention: {
      mode: RetentionMode;
      maxDays: number | null;
    };
    trainingUse: TrainingUse;
    subprocessorsDocumented: boolean;
  };
  regionPolicy: {
    allowedRegions: readonly string[];
    disallowedRegions: readonly string[];
    requiresRegionPinning: boolean;
  };
  traceStoragePolicy: {
    mode: TraceStorageMode;
    sensitiveSnippetRedactionRequired: boolean;
    retentionDays: number | null;
    allowedForDataClasses: readonly DataClass[];
  };
  manualApprovalGate: {
    required: boolean;
    requiredForDataClasses: readonly DataClass[];
    productionApprovalRequired: boolean;
    approvalReference: string | null;
  };
  evalGate: {
    requiredForProduction: boolean;
    status: 'not_started' | 'pending' | 'passed' | 'failed' | 'not_applicable';
  };
  budgetRateLimitPolicy: {
    requiresBudgetCheck: boolean;
    requiresRateLimitCheck: boolean;
  };
  semanticCachePolicy: {
    eligibleDataClasses: readonly DataClass[];
    requiresAclScopedCacheKey: boolean;
  };
  auditability: {
    decisionAuditRequired: boolean;
    providerAttemptAuditRequired: boolean;
    recordsDpaZdrRetentionTrainingRegionTracePolicy: boolean;
  };
}

export interface PolicyEvaluationInput {
  principal: { id: string; type: string } | null;
  project: { id: string; dataClass: DataClass; region?: string } | null;
  taskContext: { routeIntent: string; toolContext?: string };
  alias: string;
  providerCandidate: string;
  environment: PolicyEnvironment;
  approvals?: {
    providerManualApproval?: boolean;
    explicitCompanyConfidentialApproval?: boolean;
    selfHostedRestrictedApproval?: boolean;
  };
  evalGatePassed?: boolean;
  budgetAvailable?: boolean;
  rateLimitAvailable?: boolean;
  semanticCache?: {
    requested: boolean;
    aclScopedCacheKey: boolean;
  };
}

export type PolicyDecision =
  | {
      decision: 'allow';
      provider: ProviderPolicy;
      dataClass: DataClass;
      evaluationOrder: readonly PolicyEvaluationStep[];
    }
  | {
      decision: 'deny';
      reason: PolicyDenialReason;
      detail: string;
      step: PolicyEvaluationStep;
      dataClass?: DataClass;
      provider?: ProviderPolicy;
      evaluationOrder: readonly PolicyEvaluationStep[];
    };

export const providerDataClassMatrix = providerDataClassMatrixJson as ProviderPolicyMatrix;

export function evaluateDataClassPolicy(
  input: PolicyEvaluationInput,
  matrix: ProviderPolicyMatrix = providerDataClassMatrix,
): PolicyDecision {
  if (!input.principal?.id || !input.project?.id) {
    return deny('policy_stale', 'principal and project must be resolved before routing', 'resolve_principal_and_project');
  }

  const dataClass = input.project.dataClass;
  if (!isDataClass(dataClass) || !input.taskContext.routeIntent) {
    return deny('data_class', 'project data class and task/tool context must be resolved', 'resolve_data_class_task_tool_context');
  }

  const provider = matrix.providers.find(
    (candidate) => candidate.providerId === input.providerCandidate && candidate.allowedModelAliases.includes(input.alias),
  );
  if (!provider) {
    return deny('route_disabled', 'model alias is not mapped to the provider candidate', 'resolve_alias_and_provider_candidate', dataClass);
  }

  if (provider.lifecycle === 'disabled' || provider.lifecycle === 'retired') {
    return deny('provider_lifecycle', 'provider candidate is not active', 'check_provider_lifecycle_and_approval_gate', dataClass, provider);
  }

  if (input.environment === 'production' && (!provider.productionEnabled || provider.lifecycle !== 'approved_production')) {
    return deny('provider_lifecycle', 'provider candidate is not production enabled', 'check_provider_lifecycle_and_approval_gate', dataClass, provider);
  }

  if (
    provider.manualApprovalGate.required
    && provider.manualApprovalGate.requiredForDataClasses.includes(dataClass)
    && !input.approvals?.providerManualApproval
  ) {
    return deny('approval_required', 'provider data-class route requires manual approval', 'check_provider_lifecycle_and_approval_gate', dataClass, provider);
  }

  const dataClassEligibilityDenial = evaluateDataClassEligibility(provider, dataClass, input);
  if (dataClassEligibilityDenial) return dataClassEligibilityDenial;

  if (provider.evalGate.requiredForProduction && input.environment === 'production' && !input.evalGatePassed) {
    return deny('eval_gate', 'production route lacks required eval-gate evidence', 'check_eval_gate', dataClass, provider);
  }

  if (provider.budgetRateLimitPolicy.requiresBudgetCheck && input.budgetAvailable === false) {
    return deny('budget', 'budget check denied route', 'check_budget_and_rate_limit', dataClass, provider);
  }

  if (provider.budgetRateLimitPolicy.requiresRateLimitCheck && input.rateLimitAvailable === false) {
    return deny('rate_limit', 'rate-limit check denied route', 'check_budget_and_rate_limit', dataClass, provider);
  }

  if (input.semanticCache?.requested) {
    if (!provider.semanticCachePolicy.eligibleDataClasses.includes(dataClass)) {
      return deny('data_class', 'semantic cache is not eligible for this data class', 'check_semantic_cache_acl_eligibility', dataClass, provider);
    }
    if (provider.semanticCachePolicy.requiresAclScopedCacheKey && !input.semanticCache.aclScopedCacheKey) {
      return deny('data_class', 'semantic cache requires an ACL-scoped cache key', 'check_semantic_cache_acl_eligibility', dataClass, provider);
    }
  }

  return {
    decision: 'allow',
    provider,
    dataClass,
    evaluationOrder: matrix.evaluationOrder,
  };
}

function evaluateDataClassEligibility(
  provider: ProviderPolicy,
  dataClass: DataClass,
  input: PolicyEvaluationInput,
): PolicyDecision | null {
  if (provider.dataClassPolicy.deniedDataClasses.includes(dataClass) || !provider.dataClassPolicy.allowedDataClasses.includes(dataClass)) {
    return deny('data_class', 'provider candidate is not allowed for the requested data class', 'check_data_class_dpa_zdr_retention_training_region_trace_storage', dataClass, provider);
  }

  if (dataClass === 'restricted') {
    if (provider.externalModelCalls && provider.dataClassPolicy.restrictedExternalCallsDefaultDeny) {
      return deny('data_class', 'restricted data denies external model calls by default', 'check_data_class_dpa_zdr_retention_training_region_trace_storage', dataClass, provider);
    }
    if (provider.providerKind === 'self_hosted_model' && !input.approvals?.selfHostedRestrictedApproval) {
      return deny('approval_required', 'restricted self-hosted routes require explicit approval', 'check_data_class_dpa_zdr_retention_training_region_trace_storage', dataClass, provider);
    }
  }

  if (dataClass === 'internal' && provider.dataClassPolicy.internalRequiresAcceptableRetentionTraining) {
    const acceptableRetention = provider.compliance.retention.mode === 'zero' || provider.compliance.retention.mode === 'limited';
    const acceptableTraining = provider.compliance.trainingUse === 'prohibited' || provider.compliance.trainingUse === 'opt_out' || provider.compliance.trainingUse === 'not_applicable';
    if (!acceptableRetention || !acceptableTraining) {
      return deny('data_class', 'internal data requires acceptable retention and training terms', 'check_data_class_dpa_zdr_retention_training_region_trace_storage', dataClass, provider);
    }
  }

  if (dataClass === 'confidential' && provider.dataClassPolicy.confidentialRequiresDpaOrZdrOrApproval) {
    const hasDpaOrZdrOrApproval =
      provider.compliance.dpa === 'signed'
      || provider.compliance.zeroDataRetention === 'available'
      || input.approvals?.explicitCompanyConfidentialApproval === true;
    if (!hasDpaOrZdrOrApproval) {
      return deny('data_class', 'confidential data requires DPA, ZDR, or explicit company approval', 'check_data_class_dpa_zdr_retention_training_region_trace_storage', dataClass, provider);
    }
  }

  if (input.project?.region && !regionAllowed(provider, input.project.region)) {
    return deny('data_class', 'provider candidate is not allowed for the project region policy', 'check_data_class_dpa_zdr_retention_training_region_trace_storage', dataClass, provider);
  }

  if (!provider.traceStoragePolicy.allowedForDataClasses.includes(dataClass)) {
    return deny('data_class', 'trace storage policy is not compatible with the requested data class', 'check_data_class_dpa_zdr_retention_training_region_trace_storage', dataClass, provider);
  }

  if (dataClass === 'confidential' && !provider.traceStoragePolicy.sensitiveSnippetRedactionRequired) {
    return deny('data_class', 'confidential traces require sensitive snippet redaction', 'check_data_class_dpa_zdr_retention_training_region_trace_storage', dataClass, provider);
  }

  return null;
}

function regionAllowed(provider: ProviderPolicy, region: string): boolean {
  return !provider.regionPolicy.disallowedRegions.includes(region)
    && (!provider.regionPolicy.requiresRegionPinning || provider.regionPolicy.allowedRegions.includes(region));
}

function isDataClass(value: string): value is DataClass {
  return DATA_CLASSES.includes(value as DataClass);
}

function deny(
  reason: PolicyDenialReason,
  detail: string,
  step: PolicyEvaluationStep,
  dataClass?: DataClass,
  provider?: ProviderPolicy,
): PolicyDecision {
  return {
    decision: 'deny',
    reason,
    detail,
    step,
    ...(dataClass ? { dataClass } : {}),
    ...(provider ? { provider } : {}),
    evaluationOrder: providerDataClassMatrix.evaluationOrder,
  };
}
