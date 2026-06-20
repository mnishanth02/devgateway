export const DENIAL_TAXONOMY_CONTRACT_VERSION = '0.1.0' as const;

export const DENIAL_REASON_CODES = [
  'budget',
  'rate_limit',
  'data_class',
  'provider_lifecycle',
  'eval_gate',
  'policy_stale',
  'route_disabled',
  'approval_required',
] as const;

export type DenialReasonCode = (typeof DENIAL_REASON_CODES)[number];

export const GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS = [
  'decision',
  'actor',
  'project',
  'alias',
  'provider_candidate',
  'policy_version',
  'registry_version',
  'reason',
  'trace_id',
  'cost_estimate',
] as const;

export type GatewayDenialAuditRequiredField =
  (typeof GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS)[number];

export const GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS = [
  'virtual_key_id',
  'budget_scope',
  'data_class',
  'route_intent',
  'environment',
  'gateway_instance',
  'decision_latency_ms',
  'policy_snapshot_checksum',
  'registry_snapshot_checksum',
  'request_timestamp',
] as const;

export type GatewayDenialAuditRecommendedField =
  (typeof GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS)[number];

export type DenialReasonDefinition = {
  readonly code: DenialReasonCode;
  readonly message: string;
  readonly appliesWhen: string;
  readonly decisionOwner: string;
  readonly audit: {
    readonly reason: DenialReasonCode;
    readonly message: string;
    readonly requiredContext: readonly GatewayDenialAuditRequiredField[];
    readonly recommendedContext: readonly GatewayDenialAuditRecommendedField[];
  };
  readonly gatewayPolicyContract: {
    readonly decision: 'deny';
    readonly reason: DenialReasonCode;
    readonly action: string;
    readonly auditRequiredFields: readonly GatewayDenialAuditRequiredField[];
    readonly failureMode: 'fail_closed';
    readonly successFallbackAllowed: false;
  };
};

export const DENIAL_REASONS = {
  budget: {
    code: 'budget',
    message: 'Request denied because the resolved budget scope lacks remaining quota or cost headroom.',
    appliesWhen: 'The resolved budget scope lacks quota, spend, token, or cost headroom.',
    decisionOwner: 'Platform budget policy',
    audit: {
      reason: 'budget',
      message: 'Audit budget scope, limit context, and cost estimate when available.',
      requiredContext: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      recommendedContext: GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS,
    },
    gatewayPolicyContract: {
      decision: 'deny',
      reason: 'budget',
      action: 'Deny and audit with cost estimate where available.',
      auditRequiredFields: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      failureMode: 'fail_closed',
      successFallbackAllowed: false,
    },
  },
  rate_limit: {
    code: 'rate_limit',
    message: 'Request denied because a synced rate limit has been exceeded.',
    appliesWhen: 'The principal, virtual key, project, tenant, route, or provider exceeds a synced rate limit.',
    decisionOwner: 'Platform policy / rate-limit service',
    audit: {
      reason: 'rate_limit',
      message: 'Audit limit identity, scope, and synced policy version.',
      requiredContext: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      recommendedContext: GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS,
    },
    gatewayPolicyContract: {
      decision: 'deny',
      reason: 'rate_limit',
      action: 'Deny and audit limit context.',
      auditRequiredFields: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      failureMode: 'fail_closed',
      successFallbackAllowed: false,
    },
  },
  data_class: {
    code: 'data_class',
    message: 'Request denied because the resolved data class is not allowed for the route.',
    appliesWhen: 'The resolved data class is not allowed for the alias, provider candidate, route intent, project, or policy version.',
    decisionOwner: 'Platform policy and registry eligibility',
    audit: {
      reason: 'data_class',
      message: 'Audit resolved data class, route intent, alias, and provider candidate when available.',
      requiredContext: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      recommendedContext: GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS,
    },
    gatewayPolicyContract: {
      decision: 'deny',
      reason: 'data_class',
      action: 'Deny before provider call.',
      auditRequiredFields: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      failureMode: 'fail_closed',
      successFallbackAllowed: false,
    },
  },
  provider_lifecycle: {
    code: 'provider_lifecycle',
    message: 'Request denied because the provider or model lifecycle state is not eligible.',
    appliesWhen: 'Provider/model is disabled, deprecated beyond allowed window, retired, unhealthy-for-policy, or not production-approved.',
    decisionOwner: 'Model/provider registry',
    audit: {
      reason: 'provider_lifecycle',
      message: 'Audit provider candidate, alias, registry version, and lifecycle state evidence when available.',
      requiredContext: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      recommendedContext: GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS,
    },
    gatewayPolicyContract: {
      decision: 'deny',
      reason: 'provider_lifecycle',
      action: 'Exclude candidate or deny if no valid candidate remains.',
      auditRequiredFields: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      failureMode: 'fail_closed',
      successFallbackAllowed: false,
    },
  },
  eval_gate: {
    code: 'eval_gate',
    message: 'Request denied because required evaluation gate evidence is missing or failing.',
    appliesWhen: 'Alias, provider, route, data class, or policy version lacks required evaluation gate evidence.',
    decisionOwner: 'Eval owner / registry policy',
    audit: {
      reason: 'eval_gate',
      message: 'Audit route, alias, provider candidate, and gate evidence reference when available.',
      requiredContext: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      recommendedContext: GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS,
    },
    gatewayPolicyContract: {
      decision: 'deny',
      reason: 'eval_gate',
      action: 'Deny production route.',
      auditRequiredFields: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      failureMode: 'fail_closed',
      successFallbackAllowed: false,
    },
  },
  policy_stale: {
    code: 'policy_stale',
    message: 'Request denied because policy or registry state is missing, stale, unverifiable, or incompatible.',
    appliesWhen: 'Registry or policy version is missing, stale, unverifiable, incompatible, or not synced.',
    decisionOwner: 'Platform policy / registry validators',
    audit: {
      reason: 'policy_stale',
      message: 'Audit policy version, registry version, checksums, and freshness evidence when available.',
      requiredContext: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      recommendedContext: GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS,
    },
    gatewayPolicyContract: {
      decision: 'deny',
      reason: 'policy_stale',
      action: 'Fail closed before routing.',
      auditRequiredFields: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      failureMode: 'fail_closed',
      successFallbackAllowed: false,
    },
  },
  route_disabled: {
    code: 'route_disabled',
    message: 'Request denied because the requested alias, intent, project, environment, or provider route is disabled.',
    appliesWhen: 'The alias, route intent, project route, environment, or provider route is explicitly disabled.',
    decisionOwner: 'Platform policy / registry',
    audit: {
      reason: 'route_disabled',
      message: 'Audit alias, route intent, project, environment, and provider route when available.',
      requiredContext: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      recommendedContext: GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS,
    },
    gatewayPolicyContract: {
      decision: 'deny',
      reason: 'route_disabled',
      action: 'Deny before provider call.',
      auditRequiredFields: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      failureMode: 'fail_closed',
      successFallbackAllowed: false,
    },
  },
  approval_required: {
    code: 'approval_required',
    message: 'Request denied because required approval has not been satisfied.',
    appliesWhen: 'A human, break-glass, security, or project approval is required and not satisfied.',
    decisionOwner: 'Platform approval policy',
    audit: {
      reason: 'approval_required',
      message: 'Audit approval scope and platform approval policy reference when available.',
      requiredContext: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      recommendedContext: GATEWAY_DENIAL_AUDIT_RECOMMENDED_FIELDS,
    },
    gatewayPolicyContract: {
      decision: 'deny',
      reason: 'approval_required',
      action: 'Return a non-success denial or approval-required response without evaluating approval in Bifrost.',
      auditRequiredFields: GATEWAY_DENIAL_AUDIT_REQUIRED_FIELDS,
      failureMode: 'fail_closed',
      successFallbackAllowed: false,
    },
  },
} as const satisfies Record<DenialReasonCode, DenialReasonDefinition>;

export type DenialReason = (typeof DENIAL_REASONS)[DenialReasonCode];

export const DENIAL_TAXONOMY = {
  contractVersion: DENIAL_TAXONOMY_CONTRACT_VERSION,
  productionCapability: 'none',
  failClosed: true,
  successFallbackAllowed: false,
  codes: DENIAL_REASON_CODES,
  reasons: DENIAL_REASONS,
} as const;
