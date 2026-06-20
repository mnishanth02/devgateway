import type { DenialReasonCode } from './denial-reasons.js';

export const GITHUB_PERMISSION_RULES_CONTRACT_VERSION = '0.1.0' as const;

export const GITHUB_WEBHOOK_REQUIRED_HEADERS = [
  'x-hub-signature-256',
  'x-github-delivery',
  'x-github-event',
] as const;

export const GITHUB_WEBHOOK_SIGNATURE_ALGORITHM = 'hmac-sha256' as const;

export const GITHUB_WEBHOOK_IDEMPOTENCY_KEY_PARTS = [
  'installation_id',
  'delivery_id',
  'event_name',
  'payload_digest',
] as const;

export const GITHUB_PERMISSION_STALE_MARKER_REASONS = [
  'sync_lag_exceeded',
  'webhook_validation_failed',
  'ordering_gap',
  'sync_failed',
  'dead_letter_pending',
  'snapshot_unverifiable',
  'manual_security_hold',
] as const;

export const GITHUB_PERMISSION_REQUIRED_ROW_FIELDS = [
  'project_id',
  'acl_scope_hash',
  'source_ref',
  'index_version',
] as const;

export const GITHUB_PERMISSION_ACL_ARTIFACT_KINDS = [
  'chunk',
  'entity',
  'relation',
  'memory_item',
  'context_pack',
] as const;

export const GITHUB_PERMISSION_AUDIT_EVENTS = [
  'github_webhook_received',
  'github_webhook_rejected',
  'github_webhook_duplicate_ignored',
  'github_permission_sync_started',
  'github_permission_sync_succeeded',
  'github_permission_sync_failed',
  'github_permission_sync_stale_marked',
  'github_permission_sync_stale_cleared',
  'github_permission_sync_dead_lettered',
  'repo_retrieval_denied_stale_sync',
  'repo_retrieval_acl_rechecked_before_prompt',
  'prompt_assembly_denied_acl_or_stale_sync',
] as const;

export type GithubPermissionStaleMarkerReason =
  (typeof GITHUB_PERMISSION_STALE_MARKER_REASONS)[number];

export type GithubPermissionAuditEvent =
  (typeof GITHUB_PERMISSION_AUDIT_EVENTS)[number];

export type GithubPermissionRequiredRowField =
  (typeof GITHUB_PERMISSION_REQUIRED_ROW_FIELDS)[number];

export type GithubPermissionAclArtifactKind =
  (typeof GITHUB_PERMISSION_ACL_ARTIFACT_KINDS)[number];

export type GithubPermissionRuleCategory =
  | 'webhook_validation'
  | 'sync_freshness'
  | 'repo_aware_retrieval'
  | 'prompt_assembly_acl'
  | 'metadata'
  | 'failure_handling'
  | 'audit';

export interface GithubPermissionRule {
  readonly id: string;
  readonly category: GithubPermissionRuleCategory;
  readonly requirement: string;
  readonly failClosed: true;
  readonly auditRequired: true;
  readonly productionEndpointBehavior: false;
}

export const GITHUB_PERMISSION_RULES = [
  {
    id: 'webhooks-signed-hmac-sha256',
    category: 'webhook_validation',
    requirement: 'GitHub webhook payloads require raw-body X-Hub-Signature-256 HMAC-SHA-256 validation with constant-time comparison.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'webhooks-idempotent-replay-key',
    category: 'webhook_validation',
    requirement: 'Webhook side effects are guarded by an idempotency key derived from installation ID, delivery ID, event name, and payload digest.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'event-ordering-reconcile-on-gap',
    category: 'sync_freshness',
    requirement: 'Duplicate or older events cannot overwrite newer permission snapshots; ordering gaps require full reconciliation and stale-marker coverage.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'sync-lag-over-slo-default-deny',
    category: 'repo_aware_retrieval',
    requirement: 'Permission sync lag greater than the configured SLO causes default-deny for repo-aware retrieval.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'active-stale-marker-default-deny',
    category: 'repo_aware_retrieval',
    requirement: 'An active stale-sync marker on the requested scope or ancestor scope denies repo-aware retrieval until fresh reconciliation clears it.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'acl-recheck-before-prompt-assembly',
    category: 'prompt_assembly_acl',
    requirement: 'ACL checks are repeated immediately before prompt assembly against the current permission snapshot, ACL scope hash, and index version.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'indexed-artifacts-store-acl-and-index-version',
    category: 'metadata',
    requirement: 'Every chunk, entity, relation, memory item, and context pack stores ACL scope and index version.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'retrieval-rows-carry-project-acl-source-index',
    category: 'metadata',
    requirement: 'Knowledge, graph, memory, and context-pack rows include project_id, acl_scope_hash, source reference, and index_version.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'sync-failure-retry-dead-letter-stays-deny',
    category: 'failure_handling',
    requirement: 'Retries and dead-lettered webhook/sync failures keep stale-sync default-deny active for affected scopes.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
  {
    id: 'no-silent-allow-fallback',
    category: 'audit',
    requirement: 'Fail-closed/default-deny behavior is required; no silent allow fallback is permitted for missing, stale, or unverifiable permission state.',
    failClosed: true,
    auditRequired: true,
    productionEndpointBehavior: false,
  },
] as const satisfies readonly GithubPermissionRule[];

export interface GithubPermissionStaleMarker {
  readonly active: boolean;
  readonly reason: GithubPermissionStaleMarkerReason;
  readonly markedAt: Date;
  readonly scopeRef: string;
}

export interface GithubPermissionSnapshotEvidence {
  readonly projectId: string;
  readonly aclScopeHash: string;
  readonly sourceRef: string;
  readonly indexVersion: string;
  readonly verifiable: boolean;
}

export interface GithubPromptAssemblyAclRecheckEvidence {
  readonly performedAt: Date;
  readonly maxAgeMs: number;
  readonly projectId: string;
  readonly aclScopeHash: string;
  readonly sourceRef: string;
  readonly indexVersion: string;
  readonly result: 'allow' | 'deny';
}

export interface GithubRepoAwareRetrievalInput {
  readonly now: Date;
  readonly lastSuccessfulSyncAt: Date | null;
  readonly syncLagSloMs: number;
  readonly staleMarker: GithubPermissionStaleMarker | null;
  readonly snapshot: GithubPermissionSnapshotEvidence | null;
  readonly promptAssemblyAclRecheck: GithubPromptAssemblyAclRecheckEvidence | null;
}

export type GithubRepoAwareRetrievalDecision =
  | {
      readonly decision: 'allow';
      readonly syncLagMs: number;
      readonly aclScopeHash: string;
      readonly indexVersion: string;
      readonly auditEvent: 'repo_retrieval_acl_rechecked_before_prompt';
    }
  | {
      readonly decision: 'deny';
      readonly reason: DenialReasonCode;
      readonly detail: string;
      readonly failClosed: true;
      readonly syncLagMs: number | null;
      readonly auditEvent: 'repo_retrieval_denied_stale_sync' | 'prompt_assembly_denied_acl_or_stale_sync';
    };

export function evaluateGithubRepoAwareRetrieval(
  input: GithubRepoAwareRetrievalInput,
): GithubRepoAwareRetrievalDecision {
  if (!Number.isFinite(input.syncLagSloMs) || input.syncLagSloMs <= 0) {
    return deny('policy_stale', 'permission sync SLO is missing or invalid', null, 'repo_retrieval_denied_stale_sync');
  }

  if (!input.lastSuccessfulSyncAt) {
    return deny('policy_stale', 'no successful permission sync exists for the requested scope', null, 'repo_retrieval_denied_stale_sync');
  }

  const syncLagMs = input.now.getTime() - input.lastSuccessfulSyncAt.getTime();
  if (!Number.isFinite(syncLagMs) || syncLagMs < 0) {
    return deny('policy_stale', 'permission sync timestamp is unverifiable', null, 'repo_retrieval_denied_stale_sync');
  }

  if (syncLagMs > input.syncLagSloMs) {
    return deny('policy_stale', 'permission sync lag exceeds the configured SLO', syncLagMs, 'repo_retrieval_denied_stale_sync');
  }

  if (input.staleMarker?.active) {
    return deny(`policy_stale`, `active stale-sync marker: ${input.staleMarker.reason}`, syncLagMs, 'repo_retrieval_denied_stale_sync');
  }

  const snapshot = input.snapshot;
  const snapshotDenial = validateSnapshot(snapshot, syncLagMs);
  if (snapshotDenial) return snapshotDenial;
  if (!snapshot) {
    return deny('policy_stale', 'permission snapshot evidence is missing', syncLagMs, 'repo_retrieval_denied_stale_sync');
  }

  const recheck = input.promptAssemblyAclRecheck;
  if (!recheck) {
    return deny('policy_stale', 'ACL recheck before prompt assembly is missing', syncLagMs, 'prompt_assembly_denied_acl_or_stale_sync');
  }

  const recheckAgeMs = input.now.getTime() - recheck.performedAt.getTime();
  if (!Number.isFinite(recheckAgeMs) || recheckAgeMs < 0 || recheck.maxAgeMs <= 0 || recheckAgeMs > recheck.maxAgeMs) {
    return deny('policy_stale', 'ACL recheck before prompt assembly is stale or unverifiable', syncLagMs, 'prompt_assembly_denied_acl_or_stale_sync');
  }

  if (recheck.result !== 'allow') {
    return deny('data_class', 'ACL recheck denied the requested repository context', syncLagMs, 'prompt_assembly_denied_acl_or_stale_sync');
  }

  if (
    recheck.projectId !== snapshot.projectId
    || recheck.aclScopeHash !== snapshot.aclScopeHash
    || recheck.sourceRef !== snapshot.sourceRef
    || recheck.indexVersion !== snapshot.indexVersion
  ) {
    return deny('policy_stale', 'ACL recheck evidence does not match the retrieval snapshot', syncLagMs, 'prompt_assembly_denied_acl_or_stale_sync');
  }

  return {
    decision: 'allow',
    syncLagMs,
    aclScopeHash: snapshot.aclScopeHash,
    indexVersion: snapshot.indexVersion,
    auditEvent: 'repo_retrieval_acl_rechecked_before_prompt',
  };
}

function validateSnapshot(
  snapshot: GithubPermissionSnapshotEvidence | null,
  syncLagMs: number,
): GithubRepoAwareRetrievalDecision | null {
  if (!snapshot) {
    return deny('policy_stale', 'permission snapshot evidence is missing', syncLagMs, 'repo_retrieval_denied_stale_sync');
  }

  if (!snapshot.verifiable) {
    return deny('policy_stale', 'permission snapshot evidence is unverifiable', syncLagMs, 'repo_retrieval_denied_stale_sync');
  }

  if (
    !isNonEmptyString(snapshot.projectId)
    || !isNonEmptyString(snapshot.aclScopeHash)
    || !isNonEmptyString(snapshot.sourceRef)
    || !isNonEmptyString(snapshot.indexVersion)
  ) {
    return deny('policy_stale', 'permission snapshot lacks project_id, acl_scope_hash, source reference, or index_version', syncLagMs, 'repo_retrieval_denied_stale_sync');
  }

  return null;
}

function deny(
  reason: DenialReasonCode,
  detail: string,
  syncLagMs: number | null,
  auditEvent: 'repo_retrieval_denied_stale_sync' | 'prompt_assembly_denied_acl_or_stale_sync',
): GithubRepoAwareRetrievalDecision {
  return {
    decision: 'deny',
    reason,
    detail,
    failClosed: true,
    syncLagMs,
    auditEvent,
  };
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}
