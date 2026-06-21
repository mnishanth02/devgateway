export const dbPackage = {
  name: '@devgateway/db',
  status: 'phase-1-1-db-tooling-check-seed-separation',
} as const;

export * from './schema-conventions.js';
export * from './seeds/index.js';
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
