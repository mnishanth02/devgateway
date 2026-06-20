export const dbPackage = {
  name: '@devgateway/db',
  status: 'phase-0-7-gate-persistence-contract',
} as const;

export * from './schema-conventions.js';
export {
  evalGatePersistenceContractVersion,
  evalGatePersistenceProductionPosture,
  evalGateResultAppendOnlyAuditConvention,
  evalGateResultColumns,
  evalGateResultConstraints,
  evalGateResultIndexes,
  evalGateResultMatchingRules,
  evalGateResultPersistenceContract,
  evalGateResultRequiredFieldNames,
  evalGateResultRetentionAndArtifactStorage,
  evalGateResultTableName,
} from './eval-gate-persistence.js';
export type {
  EvalGateResultColumnMetadata,
  EvalGateResultColumnRole,
  EvalGateResultColumnType,
  EvalGateResultConstraintMetadata,
  EvalGateResultIndexMetadata,
  EvalGateResultMatchingRule,
  EvalGateResultRequiredFieldName,
} from './eval-gate-persistence.js';
export {
  githubPermissionEntities,
  githubPermissionEntityNames,
  githubPermissionModelContractVersion,
  githubPermissionModelProductionPosture,
  githubPermissionRelationshipConventions,
  githubPermissionRetrievalDefaultDenyHooks,
} from './github-permission-model.js';
export type {
  GitHubPermissionAclMetadata,
  GitHubPermissionColumnMetadata,
  GitHubPermissionColumnRole,
  GitHubPermissionEntityMetadata,
  GitHubPermissionEntityMetadataSnapshot,
  GitHubPermissionEntityName,
  GitHubPermissionExternalReference,
  GitHubPermissionIndexMetadata,
  GitHubPermissionOnDelete,
  GitHubPermissionReferenceTarget,
  GitHubPermissionRelationshipMetadata,
  GitHubPermissionRetrievalDefaultDenyHook,
  GitHubPermissionRetrievalHookMetadata,
  GitHubPermissionRetrievalHookName,
  GitHubPermissionTenantIsolationMetadata,
  GitHubPermissionUniqueConstraintMetadata,
} from './github-permission-model.js';
