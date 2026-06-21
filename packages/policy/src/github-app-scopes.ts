import type { DataClass } from './data-class-policy.ts';

export type GithubAppInstallationScope = 'repository' | 'organization' | 'webhook_event' | 'forbidden';
export type GithubAppAccessLevel = 'read' | 'subscribe' | 'not_requested';
export type GithubAppRequirement = 'required' | 'conditional' | 'forbidden';
export type GithubAppDataClassTouched = DataClass | 'inherits_repository_class';

export interface GithubAppScopeMatrixRow {
  id: string;
  area: string;
  githubPermissionOrEvent: string;
  installationScope: GithubAppInstallationScope;
  access: GithubAppAccessLevel;
  requirement: GithubAppRequirement;
  whyNeeded: string;
  dataClassesTouched: readonly GithubAppDataClassTouched[];
  approvalOwner: string;
  productionGate: string;
  denialDefaultBehavior: string;
}

export const GITHUB_FIRST_RELEASE_SCM = {
  provider: 'github',
  role: 'first_release_scm_and_repository_content_permission_source_of_truth',
  productionProvisioningAllowedInTrack0: false,
  secretsAllowedInRepository: false,
} as const;

export const GITHUB_APP_SCOPE_RULES = {
  platformRolesCanGrantPortalVisibility: true,
  platformRolesCannotExceedGithubRestrictionsForPrivateRepoContent: true,
  sharedAnonymousTeamKeysForbiddenForRetrieval: true,
  staleSyncDefaultDeny: true,
  signedIdempotentWebhooksRequired: true,
  aclCheckRepeatedBeforePromptAssembly: true,
  productionGithubAppProvisioningForbiddenInTrack0: true,
} as const;

export const githubAppScopeMatrix = [
  {
    id: 'repository-metadata',
    area: 'Repository metadata and installation inventory',
    githubPermissionOrEvent: 'Repository permission: Metadata read-only',
    installationScope: 'repository',
    access: 'read',
    requirement: 'required',
    whyNeeded: 'Resolve installation, repository IDs, visibility, default branch, archival state, and repository inventory.',
    dataClassesTouched: ['internal', 'confidential'],
    approvalOwner: 'SCM integration owner; Platform security owner reviews production use',
    productionGate: 'Signed installation sync, freshness SLO, immutable audit event, and ACL safety eval gate pass',
    denialDefaultBehavior: 'Repository is omitted from portal retrieval/indexing; private content remains hidden.',
  },
  {
    id: 'repository-content',
    area: 'Repository content snapshots',
    githubPermissionOrEvent: 'Repository permission: Contents read-only',
    installationScope: 'repository',
    access: 'read',
    requirement: 'required',
    whyNeeded: 'Read files, trees, blobs, source references, source snapshots, and CODEOWNERS files for indexing and retrieval.',
    dataClassesTouched: ['inherits_repository_class', 'confidential', 'restricted'],
    approvalOwner: 'SCM integration owner; Platform security owner',
    productionGate: 'ACL-first indexing, source snapshot audit, index versioning, stale-sync default-deny test, retrieval eval gate pass',
    denialDefaultBehavior: 'No content indexing or retrieval; existing index versions for the repo are treated stale and denied.',
  },
  {
    id: 'codeowners-context',
    area: 'CODEOWNERS context',
    githubPermissionOrEvent: 'Repository permission: Contents read-only for CODEOWNERS paths through content reader policy',
    installationScope: 'repository',
    access: 'read',
    requirement: 'required',
    whyNeeded: 'Parse CODEOWNERS to enrich ACL and reviewer context without a separate write/admin permission.',
    dataClassesTouched: ['internal', 'confidential', 'inherits_repository_class'],
    approvalOwner: 'SCM integration owner',
    productionGate: 'CODEOWNER parser fixture, ACL precedence fixture, source ref and index version audit',
    denialDefaultBehavior: 'CODEOWNER-specific grants are ignored; retrieval falls back to collaborator/team permissions only, never allow-by-default.',
  },
  {
    id: 'organization-members',
    area: 'Organization teams and membership',
    githubPermissionOrEvent: 'Organization permission: Members read-only',
    installationScope: 'organization',
    access: 'read',
    requirement: 'required',
    whyNeeded: 'Map GitHub teams, organization members, team slugs, and membership changes into private-repository permission grants.',
    dataClassesTouched: ['internal', 'confidential'],
    approvalOwner: 'SCM integration owner; Platform security owner',
    productionGate: 'Principal account-link check, team membership freshness SLO, membership webhook signature/idempotency tests',
    denialDefaultBehavior: 'Team-derived access is denied; platform roles may show portal shell only, not private repo content.',
  },
  {
    id: 'pull-request-context',
    area: 'Pull request context',
    githubPermissionOrEvent: 'Repository permission: Pull requests read-only',
    installationScope: 'repository',
    access: 'read',
    requirement: 'conditional',
    whyNeeded: 'Read PR title/body/state, base/head refs, changed files metadata, review ownership context, and linked source refs when PR-aware answers are enabled.',
    dataClassesTouched: ['inherits_repository_class', 'confidential'],
    approvalOwner: 'SCM integration owner; Product/Platform owner approves feature use',
    productionGate: 'PR fixture coverage, ACL check immediately before prompt assembly, retrieval eval gate',
    denialDefaultBehavior: 'PR-aware retrieval is disabled; source code permissions do not imply PR text access if the permission is absent.',
  },
  {
    id: 'issue-context',
    area: 'Issue context',
    githubPermissionOrEvent: 'Repository permission: Issues read-only',
    installationScope: 'repository',
    access: 'read',
    requirement: 'conditional',
    whyNeeded: 'Read issue title/body/labels/state only when issue-aware support/product workflows are explicitly enabled.',
    dataClassesTouched: ['inherits_repository_class', 'confidential'],
    approvalOwner: 'SCM integration owner; Product/Platform owner approves feature use',
    productionGate: 'Issue fixture coverage, ACL check immediately before prompt assembly, retrieval eval gate',
    denialDefaultBehavior: 'Issue-aware retrieval is disabled; no issue text is indexed or shown.',
  },
  {
    id: 'installation-webhooks',
    area: 'Installation inventory webhooks',
    githubPermissionOrEvent: 'Webhook events: installation, installation_repositories',
    installationScope: 'webhook_event',
    access: 'subscribe',
    requirement: 'required',
    whyNeeded: 'Keep installation and repository inventory current when repositories are added/removed or app permissions change.',
    dataClassesTouched: ['internal', 'confidential'],
    approvalOwner: 'SCM integration owner',
    productionGate: 'Webhook secret configured outside this repo, signature verification, idempotency key, audit event',
    denialDefaultBehavior: 'Event is ignored if unsigned/invalid; affected installation is marked stale and repo-aware retrieval denies.',
  },
  {
    id: 'repository-change-webhooks',
    area: 'Repository change webhooks',
    githubPermissionOrEvent: 'Webhook events: repository, push, create, delete',
    installationScope: 'webhook_event',
    access: 'subscribe',
    requirement: 'required',
    whyNeeded: 'Detect repository visibility changes, ref changes, content changes, branch/tag create/delete, and index invalidation triggers.',
    dataClassesTouched: ['inherits_repository_class', 'confidential', 'restricted'],
    approvalOwner: 'SCM integration owner',
    productionGate: 'Signature/idempotency tests, source ref/index invalidation fixture',
    denialDefaultBehavior: 'Affected repo/index version is marked stale; retrieval denies until a successful sync refreshes ACL and index metadata.',
  },
  {
    id: 'acl-team-webhooks',
    area: 'ACL and team webhooks',
    githubPermissionOrEvent: 'Webhook events: member, membership, team, team_add, organization where supported for the installation',
    installationScope: 'webhook_event',
    access: 'subscribe',
    requirement: 'required',
    whyNeeded: 'Refresh collaborator, organization, and team-derived grants without waiting for scheduled sync.',
    dataClassesTouched: ['internal', 'confidential'],
    approvalOwner: 'SCM integration owner; Platform security owner',
    productionGate: 'Membership webhook fixture, stale-sync SLO, default-deny fixture',
    denialDefaultBehavior: 'Team/collaborator grants from stale state are denied; no shared fallback identity is allowed.',
  },
  {
    id: 'pull-request-issue-webhooks',
    area: 'PR/issue webhooks',
    githubPermissionOrEvent: 'Webhook events: pull_request, issues',
    installationScope: 'webhook_event',
    access: 'subscribe',
    requirement: 'conditional',
    whyNeeded: 'Invalidate PR/issue context indexes and refresh metadata when PR/issue-aware retrieval is enabled.',
    dataClassesTouched: ['inherits_repository_class', 'confidential'],
    approvalOwner: 'SCM integration owner; Product/Platform owner',
    productionGate: 'Feature flag remains disabled until ACL eval and retrieval eval pass',
    denialDefaultBehavior: 'PR/issue context is not indexed; webhook absence cannot widen source-code access.',
  },
  {
    id: 'write-admin-permissions',
    area: 'Write/admin GitHub permissions',
    githubPermissionOrEvent: 'Contents write, repository administration, webhooks administration, secrets, actions, deployments, checks/status writes, package writes, organization administration, member/team writes',
    installationScope: 'forbidden',
    access: 'not_requested',
    requirement: 'forbidden',
    whyNeeded: 'Not needed for first-release source-of-truth permission sync or read-only retrieval.',
    dataClassesTouched: ['internal', 'confidential', 'restricted'],
    approvalOwner: 'Future ADR plus Platform security owner',
    productionGate: 'New ADR, security review, explicit production gate, and eval/audit coverage',
    denialDefaultBehavior: 'Do not request or provision these permissions; any code path requiring them remains disabled.',
  },
] as const satisfies readonly GithubAppScopeMatrixRow[];

