export const policyPackage = {
  name: '@devgateway/policy',
  status: 'phase-0-6-github-permission-baseline',
} as const;

export {
  DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER,
  approvalExpiresAtForRiskTier,
  approvalTtlRiskTiers,
  defaultApprovalTtlSeconds,
  type ApprovalTtlRiskTier,
} from './approval-ttl-policy.ts';
export * from './denial-reasons.ts';
export {
  DATA_CLASSES,
  DATA_CLASS_ROUTING_RULES,
  POLICY_EVALUATION_ORDER,
  evaluateDataClassPolicy,
  providerDataClassMatrix,
} from './data-class-policy.ts';
export {
  GITHUB_APP_SCOPE_RULES,
  GITHUB_FIRST_RELEASE_SCM,
  githubAppScopeMatrix,
} from './github-app-scopes.ts';

export type {
  DataClass,
  DpaStatus,
  PolicyDecision,
  PolicyDenialReason,
  PolicyEnvironment,
  PolicyEvaluationInput,
  PolicyEvaluationStep,
  ProviderKind,
  ProviderLifecycle,
  ProviderPolicy,
  ProviderPolicyMatrix,
  ZeroDataRetentionStatus,
} from './data-class-policy.ts';
export type {
  GithubAppAccessLevel,
  GithubAppDataClassTouched,
  GithubAppInstallationScope,
  GithubAppRequirement,
  GithubAppScopeMatrixRow,
} from './github-app-scopes.ts';

export {
  GITHUB_PERMISSION_ACL_ARTIFACT_KINDS,
  GITHUB_PERMISSION_AUDIT_EVENTS,
  GITHUB_PERMISSION_REQUIRED_ROW_FIELDS,
  GITHUB_PERMISSION_RULES,
  GITHUB_PERMISSION_RULES_CONTRACT_VERSION,
  GITHUB_PERMISSION_STALE_MARKER_REASONS,
  GITHUB_WEBHOOK_IDEMPOTENCY_KEY_PARTS,
  GITHUB_WEBHOOK_REQUIRED_HEADERS,
  GITHUB_WEBHOOK_SIGNATURE_ALGORITHM,
  evaluateGithubRepoAwareRetrieval,
} from './github-permission-rules.ts';

export type {
  GithubPermissionAclArtifactKind,
  GithubPermissionAuditEvent,
  GithubPermissionRequiredRowField,
  GithubPermissionRule,
  GithubPermissionRuleCategory,
  GithubPermissionStaleMarker,
  GithubPermissionStaleMarkerReason,
  GithubPermissionSnapshotEvidence,
  GithubPromptAssemblyAclRecheckEvidence,
  GithubRepoAwareRetrievalDecision,
  GithubRepoAwareRetrievalInput,
} from './github-permission-rules.ts';

export {
  assertProviderDataClassMatrix,
  defaultProviderDataClassMatrixPath,
  getBundledProviderDataClassMatrix,
  loadProviderDataClassMatrix,
  type ProviderDataClassMatrixLoadOptions,
} from './load-policy.ts';

export {
  validatePolicy,
  validatePolicyCli,
  validatePolicyNegativeFixtures,
  type PolicyValidationIssue,
  type PolicyValidationResult,
} from './validate-policy.ts';
