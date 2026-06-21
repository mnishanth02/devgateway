export {
  gateResultBlockingSeverities,
  gateResultContractVersion,
  gateResultPersistenceValidatorRules,
  gateResultSchemaId,
  gateResultTargetKinds,
  validateGateResultReferenceMatch,
} from './gate-result-contract.ts';

export type {
  GateResultArtifactRef,
  GateResultBlockingSeverity,
  GateResultMatchIssue,
  GateResultMatchIssueCode,
  GateResultPrincipalApproval,
  GateResultPrincipalReview,
  GateResultRecord,
  GateResultReference,
  GateResultReferenceMatchInput,
  GateResultReferenceMatchResult,
  GateResultTarget,
  GateResultTargetExpectation,
  GateResultTargetKind,
} from './gate-result-contract.ts';

export {
  dataClasses,
  gateStatuses,
  lifecycleStatuses,
  modelProviderRegistryContractVersion,
  modelProviderRegistrySchemaId,
  providerControlPlanes,
  wireFormats,
  type DataClass,
  type GateStatus,
  type LifecycleStatus,
  type ModelAliasRegistryEntry,
  type ModelProviderRegistrySnapshot,
  type ProviderControlPlane,
  type RegistryGateResultReference,
  type RegistryManualApprovalGate,
  type RegistryPricePoint,
  type RegistryPriceSnapshot,
  type RegistryProductionGate,
  type RegistryProviderCandidate,
  type WireFormat,
} from './schema.ts';

export {
  initialModelAliases,
  initialModelAliasNames,
  initialModelAliasRegistry,
  isProductionDisabledInitialAlias,
} from './initial-aliases.ts';

export type {
  InitialModelAlias,
  InitialModelAliasName,
} from './initial-aliases.ts';

export {
  assertRegistrySnapshot,
  defaultRegistrySnapshotPath,
  getBundledRegistrySnapshot,
  loadRegistrySnapshot,
  type RegistrySnapshotLoadOptions,
} from './load-registry.ts';

export {
  validateRegistry,
  validateRegistryCli,
  validateRegistryNegativeFixtures,
  type RegistryValidationIssue,
  type RegistryValidationResult,
} from './validate-registry.ts';
