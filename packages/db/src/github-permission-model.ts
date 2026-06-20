export const githubPermissionModelContractVersion = '0.1.0' as const;

export const githubPermissionModelProductionPosture = {
  status: 'track_0_6_governance_only',
  migrationsEnabled: false,
  githubSyncEnabled: false,
  repositoryAwareRetrievalEnabled: false,
} as const;

export const githubPermissionEntityNames = [
  'github_installation',
  'github_organization',
  'repository',
  'repository_ref',
  'github_team',
  'github_collaborator',
  'codeowner_rule',
  'principal_github_account_link',
  'platform_role',
  'permission_grant',
  'github_permission_sync_run',
  'github_permission_sync_stale_marker',
] as const;

export type GitHubPermissionEntityName = (typeof githubPermissionEntityNames)[number];

export type GitHubPermissionExternalReference = 'project' | 'principal' | 'audit_event';
export type GitHubPermissionReferenceTarget = GitHubPermissionEntityName | GitHubPermissionExternalReference;
export type GitHubPermissionOnDelete = 'restrict' | 'cascade' | 'set_null';
export type GitHubPermissionColumnRole =
  | 'primary_key'
  | 'foreign_key'
  | 'tenant_boundary'
  | 'external_source_id'
  | 'acl_scope'
  | 'index_version'
  | 'source_reference'
  | 'lifecycle'
  | 'audit'
  | 'metadata';

export interface GitHubPermissionColumnMetadata {
  name: string;
  sqlType: string;
  nullable: boolean;
  roles: readonly GitHubPermissionColumnRole[];
  description: string;
  references?: {
    table: GitHubPermissionReferenceTarget;
    column: string;
    onDelete: GitHubPermissionOnDelete;
  };
}

export interface GitHubPermissionUniqueConstraintMetadata {
  name: string;
  columns: readonly string[];
  appliesWhen: string;
  convention: string;
}

export interface GitHubPermissionIndexMetadata {
  name: string;
  columns: readonly string[];
  reason: string;
}

export interface GitHubPermissionRelationshipMetadata {
  name: string;
  from: GitHubPermissionEntityName;
  to: GitHubPermissionReferenceTarget;
  columns: readonly string[];
  onDelete: GitHubPermissionOnDelete;
  convention: string;
}

export interface GitHubPermissionTenantIsolationMetadata {
  projectId: 'required' | 'nullable_for_system_global_role';
  uniqueness: 'project_scoped' | 'system_global_slug';
  crossProjectAuthorization: 'forbidden';
  note: string;
}

export interface GitHubPermissionAclMetadata {
  required: boolean;
  columns: readonly string[];
  appliesTo: readonly string[];
  defaultDenyWhenMissing: boolean;
}

export interface GitHubPermissionEntityMetadata {
  entity: GitHubPermissionEntityName;
  tableName: GitHubPermissionEntityName;
  description: string;
  tenantIsolation: GitHubPermissionTenantIsolationMetadata;
  acl: GitHubPermissionAclMetadata;
  columns: readonly GitHubPermissionColumnMetadata[];
  uniqueConstraints: readonly GitHubPermissionUniqueConstraintMetadata[];
  indexes: readonly GitHubPermissionIndexMetadata[];
  relationships: readonly GitHubPermissionRelationshipMetadata[];
}

export type GitHubPermissionRetrievalHookName =
  | 'resolve_project_and_principal'
  | 'resolve_principal_github_account_link'
  | 'resolve_repository_and_ref_acl_scope'
  | 'check_sync_stale_marker'
  | 'check_acl_scope_hash_and_index_version'
  | 'enforce_github_private_content_ceiling'
  | 'repeat_acl_check_before_prompt_assembly';

export interface GitHubPermissionRetrievalHookMetadata {
  hook: GitHubPermissionRetrievalHookName;
  requiredBefore: 'repository_aware_retrieval' | 'prompt_assembly' | 'semantic_cache_reuse' | 'context_pack_build';
  reads: readonly GitHubPermissionEntityName[];
  deniesWhen: readonly string[];
  behavior: 'default_deny';
}

const idColumn = (description: string): GitHubPermissionColumnMetadata => ({
  name: 'id',
  sqlType: 'BIGINT GENERATED ALWAYS AS IDENTITY',
  nullable: false,
  roles: ['primary_key'],
  description,
});

const projectIdColumn: GitHubPermissionColumnMetadata = {
  name: 'project_id',
  sqlType: 'BIGINT',
  nullable: false,
  roles: ['tenant_boundary', 'foreign_key'],
  description: 'Owning project/tenant boundary for permission isolation.',
  references: { table: 'project', column: 'id', onDelete: 'restrict' },
};

const createdAtColumn: GitHubPermissionColumnMetadata = {
  name: 'created_at',
  sqlType: 'TIMESTAMPTZ',
  nullable: false,
  roles: ['audit'],
  description: 'Creation instant.',
};

const updatedAtColumn: GitHubPermissionColumnMetadata = {
  name: 'updated_at',
  sqlType: 'TIMESTAMPTZ',
  nullable: false,
  roles: ['audit'],
  description: 'Last metadata update instant.',
};

const aclScopeHashColumn: GitHubPermissionColumnMetadata = {
  name: 'acl_scope_hash',
  sqlType: 'TEXT',
  nullable: false,
  roles: ['acl_scope'],
  description: 'Stable hash of the GitHub ACL scope used for retrieval/cache isolation.',
};

const sourceRefColumn: GitHubPermissionColumnMetadata = {
  name: 'source_ref',
  sqlType: 'TEXT',
  nullable: false,
  roles: ['source_reference'],
  description: 'Provider source reference used to tie permission facts to indexed content.',
};

const indexVersionColumn: GitHubPermissionColumnMetadata = {
  name: 'index_version',
  sqlType: 'TEXT',
  nullable: false,
  roles: ['index_version'],
  description: 'Permission/index version that produced or confirmed the ACL-bearing row.',
};

const activeColumn: GitHubPermissionColumnMetadata = {
  name: 'active',
  sqlType: 'BOOLEAN',
  nullable: false,
  roles: ['lifecycle'],
  description: 'Whether the source fact is active for future grant derivation.',
};

const syncedAtColumn: GitHubPermissionColumnMetadata = {
  name: 'synced_at',
  sqlType: 'TIMESTAMPTZ',
  nullable: false,
  roles: ['audit'],
  description: 'Most recent sync instant that confirmed this row.',
};

const projectTenantIsolation: GitHubPermissionTenantIsolationMetadata = {
  projectId: 'required',
  uniqueness: 'project_scoped',
  crossProjectAuthorization: 'forbidden',
  note: 'All uniqueness and authorization checks include project_id before GitHub IDs or slugs.',
};

const projectTenantAcl = (appliesTo: readonly string[]): GitHubPermissionAclMetadata => ({
  required: true,
  columns: ['project_id', 'acl_scope_hash', 'source_ref', 'index_version'],
  appliesTo,
  defaultDenyWhenMissing: true,
});

const tenantOnlyAcl: GitHubPermissionAclMetadata = {
  required: false,
  columns: ['project_id'],
  appliesTo: ['tenant isolation only; not a direct retrieval grant'],
  defaultDenyWhenMissing: true,
};

const systemRoleTenantIsolation: GitHubPermissionTenantIsolationMetadata = {
  projectId: 'nullable_for_system_global_role',
  uniqueness: 'system_global_slug',
  crossProjectAuthorization: 'forbidden',
  note: 'System-global role definitions may have project_id null, but role grants remain project-scoped.',
};

const grantStateColumn: GitHubPermissionColumnMetadata = {
  name: 'grant_state',
  sqlType: 'TEXT',
  nullable: false,
  roles: ['lifecycle'],
  description: 'Future CHECK-constrained state such as active, stale, revoked, or superseded.',
};

export const githubPermissionEntities = [
  {
    entity: 'github_installation',
    tableName: 'github_installation',
    description: 'GitHub App installation scoped to one project/tenant.',
    tenantIsolation: projectTenantIsolation,
    acl: tenantOnlyAcl,
    columns: [
      idColumn('Internal GitHub installation row ID.'),
      projectIdColumn,
      {
        name: 'github_installation_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'GitHub installation ID from the App installation payload.',
      },
      {
        name: 'account_login_lower',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Lower-cased installation account login for uniqueness and lookup.',
      },
      {
        name: 'account_type',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'GitHub account type such as organization, enterprise, or user.',
      },
      activeColumn,
      syncedAtColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'github_installation_project_installation_id_unique',
        columns: ['project_id', 'github_installation_id'],
        appliesWhen: 'all rows',
        convention: 'GitHub installation IDs are scoped by project to prevent tenant collisions.',
      },
      {
        name: 'github_installation_project_account_login_unique',
        columns: ['project_id', 'account_login_lower'],
        appliesWhen: 'active rows',
        convention: 'Only one active installation account login is allowed per project.',
      },
    ],
    indexes: [
      {
        name: 'github_installation_project_active_idx',
        columns: ['project_id', 'active'],
        reason: 'Find active installations for future sync planning without crossing projects.',
      },
    ],
    relationships: [
      {
        name: 'github_installation_project_fk',
        from: 'github_installation',
        to: 'project',
        columns: ['project_id'],
        onDelete: 'restrict',
        convention: 'Projects cannot be deleted while installation permission facts exist.',
      },
    ],
  },
  {
    entity: 'github_organization',
    tableName: 'github_organization',
    description: 'GitHub organization or enterprise account connected through an installation.',
    tenantIsolation: projectTenantIsolation,
    acl: tenantOnlyAcl,
    columns: [
      idColumn('Internal GitHub organization row ID.'),
      projectIdColumn,
      {
        name: 'github_installation_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Owning GitHub installation row.',
        references: { table: 'github_installation', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_organization_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'GitHub organization or enterprise account ID.',
      },
      {
        name: 'login_lower',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Lower-cased organization login.',
      },
      activeColumn,
      syncedAtColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'github_organization_project_org_id_unique',
        columns: ['project_id', 'github_organization_id'],
        appliesWhen: 'all rows',
        convention: 'GitHub org IDs are project-scoped.',
      },
      {
        name: 'github_organization_project_login_unique',
        columns: ['project_id', 'login_lower'],
        appliesWhen: 'active rows',
        convention: 'Only one active org login may resolve inside a project.',
      },
    ],
    indexes: [
      {
        name: 'github_organization_installation_idx',
        columns: ['project_id', 'github_installation_id'],
        reason: 'List organizations under an installation.',
      },
    ],
    relationships: [
      {
        name: 'github_organization_installation_fk',
        from: 'github_organization',
        to: 'github_installation',
        columns: ['github_installation_id'],
        onDelete: 'restrict',
        convention: 'Organization rows are archived before installation removal.',
      },
    ],
  },
  {
    entity: 'repository',
    tableName: 'repository',
    description: 'GitHub repository metadata and repository-level ACL scope.',
    tenantIsolation: projectTenantIsolation,
    acl: projectTenantAcl(['repository metadata retrieval', 'repository content retrieval', 'semantic cache keying']),
    columns: [
      idColumn('Internal repository row ID.'),
      projectIdColumn,
      {
        name: 'github_installation_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Owning GitHub installation row.',
        references: { table: 'github_installation', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_organization_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Owning GitHub organization row.',
        references: { table: 'github_organization', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_repository_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'GitHub repository ID.',
      },
      {
        name: 'owner_login_lower',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Lower-cased repository owner login.',
      },
      {
        name: 'name_lower',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Lower-cased repository name.',
      },
      {
        name: 'visibility',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'GitHub visibility such as public, private, or internal.',
      },
      aclScopeHashColumn,
      sourceRefColumn,
      indexVersionColumn,
      activeColumn,
      syncedAtColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'repository_project_github_repository_id_unique',
        columns: ['project_id', 'github_repository_id'],
        appliesWhen: 'all rows',
        convention: 'Repository ID uniqueness never crosses projects.',
      },
      {
        name: 'repository_project_owner_name_unique',
        columns: ['project_id', 'owner_login_lower', 'name_lower'],
        appliesWhen: 'active rows',
        convention: 'Active repository full names are unique per project.',
      },
      {
        name: 'repository_project_acl_index_unique',
        columns: ['project_id', 'id', 'acl_scope_hash', 'index_version'],
        appliesWhen: 'ACL-bearing rows',
        convention: 'Retrieval joins must match repository, ACL hash, and index version.',
      },
    ],
    indexes: [
      {
        name: 'repository_acl_scope_idx',
        columns: ['project_id', 'acl_scope_hash', 'index_version'],
        reason: 'Default-deny retrieval checks and ACL-scoped cache isolation.',
      },
      {
        name: 'repository_installation_org_idx',
        columns: ['project_id', 'github_installation_id', 'github_organization_id'],
        reason: 'Future installation/org sync traversal.',
      },
    ],
    relationships: [
      {
        name: 'repository_installation_fk',
        from: 'repository',
        to: 'github_installation',
        columns: ['github_installation_id'],
        onDelete: 'restrict',
        convention: 'Repositories are disabled before installation deletion.',
      },
      {
        name: 'repository_organization_fk',
        from: 'repository',
        to: 'github_organization',
        columns: ['github_organization_id'],
        onDelete: 'restrict',
        convention: 'Repositories remain tied to their owning organization row.',
      },
    ],
  },
  {
    entity: 'repository_ref',
    tableName: 'repository_ref',
    description: 'Branch, tag, or pull-request ref with its own ACL scope and index version.',
    tenantIsolation: projectTenantIsolation,
    acl: projectTenantAcl(['branch/ref content retrieval', 'CODEOWNER matching', 'context-pack source filtering']),
    columns: [
      idColumn('Internal repository ref row ID.'),
      projectIdColumn,
      {
        name: 'repository_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Owning repository row.',
        references: { table: 'repository', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'ref_type',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'Future CHECK-constrained ref type such as branch, tag, or pull_request.',
      },
      {
        name: 'ref_name',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Canonical GitHub ref name.',
      },
      {
        name: 'protected',
        sqlType: 'BOOLEAN',
        nullable: false,
        roles: ['metadata'],
        description: 'Whether GitHub reports the ref as protected.',
      },
      aclScopeHashColumn,
      sourceRefColumn,
      indexVersionColumn,
      activeColumn,
      syncedAtColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'repository_ref_project_repo_type_name_unique',
        columns: ['project_id', 'repository_id', 'ref_type', 'ref_name'],
        appliesWhen: 'active rows',
        convention: 'A repository cannot have duplicate active refs of the same canonical type/name.',
      },
      {
        name: 'repository_ref_project_acl_index_unique',
        columns: ['project_id', 'repository_id', 'acl_scope_hash', 'index_version'],
        appliesWhen: 'ACL-bearing rows',
        convention: 'Ref-aware retrieval must match repository, ref ACL hash, and index version.',
      },
    ],
    indexes: [
      {
        name: 'repository_ref_acl_scope_idx',
        columns: ['project_id', 'repository_id', 'acl_scope_hash', 'index_version'],
        reason: 'Fast ref ACL lookup before retrieval and prompt assembly.',
      },
    ],
    relationships: [
      {
        name: 'repository_ref_repository_fk',
        from: 'repository_ref',
        to: 'repository',
        columns: ['repository_id'],
        onDelete: 'restrict',
        convention: 'Refs are end-dated or archived before repository deletion.',
      },
    ],
  },
  {
    entity: 'github_team',
    tableName: 'github_team',
    description: 'GitHub team used as a permission subject and membership source.',
    tenantIsolation: projectTenantIsolation,
    acl: tenantOnlyAcl,
    columns: [
      idColumn('Internal GitHub team row ID.'),
      projectIdColumn,
      {
        name: 'github_organization_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Owning GitHub organization row.',
        references: { table: 'github_organization', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_team_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'GitHub team ID.',
      },
      {
        name: 'slug_lower',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Lower-cased GitHub team slug.',
      },
      {
        name: 'parent_github_team_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Optional parent team for nested-team inheritance.',
        references: { table: 'github_team', column: 'id', onDelete: 'set_null' },
      },
      activeColumn,
      syncedAtColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'github_team_project_team_id_unique',
        columns: ['project_id', 'github_team_id'],
        appliesWhen: 'all rows',
        convention: 'GitHub team IDs are unique only inside a project boundary.',
      },
      {
        name: 'github_team_project_org_slug_unique',
        columns: ['project_id', 'github_organization_id', 'slug_lower'],
        appliesWhen: 'active rows',
        convention: 'Active team slugs are unique under an organization.',
      },
    ],
    indexes: [
      {
        name: 'github_team_org_active_idx',
        columns: ['project_id', 'github_organization_id', 'active'],
        reason: 'Resolve active teams for future grant derivation.',
      },
    ],
    relationships: [
      {
        name: 'github_team_organization_fk',
        from: 'github_team',
        to: 'github_organization',
        columns: ['github_organization_id'],
        onDelete: 'restrict',
        convention: 'Teams are disabled before organization deletion.',
      },
    ],
  },
  {
    entity: 'github_collaborator',
    tableName: 'github_collaborator',
    description: 'Direct repository collaborator or outside collaborator GitHub account.',
    tenantIsolation: projectTenantIsolation,
    acl: tenantOnlyAcl,
    columns: [
      idColumn('Internal GitHub collaborator row ID.'),
      projectIdColumn,
      {
        name: 'repository_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Repository where the collaborator has direct access.',
        references: { table: 'repository', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_account_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'GitHub user account ID.',
      },
      {
        name: 'github_login_lower',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Lower-cased GitHub login.',
      },
      {
        name: 'principal_github_account_link_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Resolved internal principal link when known.',
        references: { table: 'principal_github_account_link', column: 'id', onDelete: 'set_null' },
      },
      {
        name: 'affiliation',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'GitHub affiliation such as direct, outside, or organization_member.',
      },
      activeColumn,
      syncedAtColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'github_collaborator_project_repo_account_unique',
        columns: ['project_id', 'repository_id', 'github_account_id'],
        appliesWhen: 'active rows',
        convention: 'A GitHub account appears once as an active direct collaborator for a repository.',
      },
    ],
    indexes: [
      {
        name: 'github_collaborator_link_idx',
        columns: ['project_id', 'principal_github_account_link_id'],
        reason: 'Resolve direct collaborator grants for an internal principal.',
      },
      {
        name: 'github_collaborator_repo_login_idx',
        columns: ['project_id', 'repository_id', 'github_login_lower'],
        reason: 'Find collaborator facts by repository and login.',
      },
    ],
    relationships: [
      {
        name: 'github_collaborator_repository_fk',
        from: 'github_collaborator',
        to: 'repository',
        columns: ['repository_id'],
        onDelete: 'restrict',
        convention: 'Collaborator rows are marked inactive before repository deletion.',
      },
      {
        name: 'github_collaborator_principal_link_fk',
        from: 'github_collaborator',
        to: 'principal_github_account_link',
        columns: ['principal_github_account_link_id'],
        onDelete: 'set_null',
        convention: 'Principal unlinking removes internal mapping without losing source GitHub collaborator facts.',
      },
    ],
  },
  {
    entity: 'codeowner_rule',
    tableName: 'codeowner_rule',
    description: 'Parsed CODEOWNERS rule for a repository, ref, path pattern, and owner subject.',
    tenantIsolation: projectTenantIsolation,
    acl: projectTenantAcl(['path-level ownership checks', 'review-context retrieval filters']),
    columns: [
      idColumn('Internal CODEOWNER rule row ID.'),
      projectIdColumn,
      {
        name: 'repository_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Repository containing the CODEOWNERS file.',
        references: { table: 'repository', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'repository_ref_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Ref where the CODEOWNERS file was parsed.',
        references: { table: 'repository_ref', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'path_pattern',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'CODEOWNERS path pattern.',
      },
      {
        name: 'owner_kind',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'Owner subject kind such as team, user, or email_alias.',
      },
      {
        name: 'github_team_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Team owner when the rule targets a GitHub team.',
        references: { table: 'github_team', column: 'id', onDelete: 'set_null' },
      },
      {
        name: 'principal_github_account_link_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Principal owner when the rule resolves to a linked GitHub user.',
        references: { table: 'principal_github_account_link', column: 'id', onDelete: 'set_null' },
      },
      {
        name: 'owner_token_lower',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Lower-cased raw CODEOWNER owner token for deterministic uniqueness.',
      },
      aclScopeHashColumn,
      sourceRefColumn,
      indexVersionColumn,
      activeColumn,
      syncedAtColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'codeowner_rule_project_repo_ref_pattern_owner_unique',
        columns: ['project_id', 'repository_id', 'repository_ref_id', 'path_pattern', 'owner_token_lower', 'index_version'],
        appliesWhen: 'active rows',
        convention: 'A parsed owner token appears once per repository/ref/path/index version.',
      },
    ],
    indexes: [
      {
        name: 'codeowner_rule_acl_scope_idx',
        columns: ['project_id', 'repository_id', 'repository_ref_id', 'acl_scope_hash', 'index_version'],
        reason: 'Path-level ACL checks must use the same ACL hash and index version as indexed content.',
      },
      {
        name: 'codeowner_rule_owner_lookup_idx',
        columns: ['project_id', 'github_team_id', 'principal_github_account_link_id'],
        reason: 'Derive CODEOWNER grants for team or principal subjects.',
      },
    ],
    relationships: [
      {
        name: 'codeowner_rule_repository_fk',
        from: 'codeowner_rule',
        to: 'repository',
        columns: ['repository_id'],
        onDelete: 'restrict',
        convention: 'Rules are disabled before repository deletion.',
      },
      {
        name: 'codeowner_rule_ref_fk',
        from: 'codeowner_rule',
        to: 'repository_ref',
        columns: ['repository_ref_id'],
        onDelete: 'restrict',
        convention: 'Rules are versioned by ref and index version.',
      },
    ],
  },
  {
    entity: 'principal_github_account_link',
    tableName: 'principal_github_account_link',
    description: 'Mapping between an internal principal and a GitHub account within an installation.',
    tenantIsolation: projectTenantIsolation,
    acl: tenantOnlyAcl,
    columns: [
      idColumn('Internal principal GitHub link row ID.'),
      projectIdColumn,
      {
        name: 'principal_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Internal principal row.',
        references: { table: 'principal', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_installation_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Installation where the GitHub account is linked.',
        references: { table: 'github_installation', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_account_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'GitHub user account ID.',
      },
      {
        name: 'github_login_lower',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Lower-cased GitHub login.',
      },
      {
        name: 'link_state',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['lifecycle'],
        description: 'Future CHECK-constrained link state such as active, pending, revoked, or disabled.',
      },
      {
        name: 'verified_at',
        sqlType: 'TIMESTAMPTZ',
        nullable: true,
        roles: ['audit'],
        description: 'Time the GitHub account link was verified.',
      },
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'principal_github_link_project_principal_install_account_unique',
        columns: ['project_id', 'principal_id', 'github_installation_id', 'github_account_id'],
        appliesWhen: 'active rows',
        convention: 'A principal can link a GitHub account once per installation in a project.',
      },
      {
        name: 'principal_github_link_project_install_login_unique',
        columns: ['project_id', 'github_installation_id', 'github_login_lower'],
        appliesWhen: 'active rows',
        convention: 'A GitHub login resolves to one active internal principal per installation/project.',
      },
    ],
    indexes: [
      {
        name: 'principal_github_link_principal_idx',
        columns: ['project_id', 'principal_id', 'link_state'],
        reason: 'Resolve active GitHub account links before retrieval.',
      },
    ],
    relationships: [
      {
        name: 'principal_github_link_principal_fk',
        from: 'principal_github_account_link',
        to: 'principal',
        columns: ['principal_id'],
        onDelete: 'restrict',
        convention: 'Principal deletion requires link revocation first.',
      },
      {
        name: 'principal_github_link_installation_fk',
        from: 'principal_github_account_link',
        to: 'github_installation',
        columns: ['github_installation_id'],
        onDelete: 'restrict',
        convention: 'Installation deletion requires link revocation first.',
      },
    ],
  },
  {
    entity: 'platform_role',
    tableName: 'platform_role',
    description: 'Platform role definition for portal visibility and non-GitHub controls.',
    tenantIsolation: systemRoleTenantIsolation,
    acl: {
      required: false,
      columns: ['project_id'],
      appliesTo: ['portal visibility only; cannot authorize private GitHub content by itself'],
      defaultDenyWhenMissing: true,
    },
    columns: [
      idColumn('Internal platform role row ID.'),
      {
        name: 'project_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['tenant_boundary', 'foreign_key'],
        description: 'Owning project for project-scoped roles; null only for system-global role definitions.',
        references: { table: 'project', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'role_slug',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['external_source_id'],
        description: 'Stable role slug.',
      },
      {
        name: 'role_scope',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'Future CHECK-constrained scope such as system, project, or repository_portal.',
      },
      {
        name: 'can_grant_portal_visibility',
        sqlType: 'BOOLEAN',
        nullable: false,
        roles: ['metadata'],
        description: 'Whether the role can make repository metadata visible in the portal.',
      },
      {
        name: 'can_grant_private_repo_content',
        sqlType: 'BOOLEAN',
        nullable: false,
        roles: ['metadata'],
        description: 'Must remain false; private content requires GitHub-derived permission grants.',
      },
      activeColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'platform_role_project_slug_unique',
        columns: ['project_id', 'role_slug'],
        appliesWhen: 'project_id is not null',
        convention: 'Project role slugs are unique inside a project.',
      },
      {
        name: 'platform_role_system_slug_unique',
        columns: ['role_slug'],
        appliesWhen: 'project_id is null',
        convention: 'System role slugs are globally unique definitions, not grants.',
      },
    ],
    indexes: [
      {
        name: 'platform_role_project_active_idx',
        columns: ['project_id', 'active'],
        reason: 'Resolve project-scoped portal roles.',
      },
    ],
    relationships: [
      {
        name: 'platform_role_project_fk',
        from: 'platform_role',
        to: 'project',
        columns: ['project_id'],
        onDelete: 'restrict',
        convention: 'Project-scoped roles are disabled before project deletion.',
      },
    ],
  },
  {
    entity: 'permission_grant',
    tableName: 'permission_grant',
    description: 'Effective permission fact used by authorization and retrieval default-deny checks.',
    tenantIsolation: projectTenantIsolation,
    acl: projectTenantAcl(['repository-aware retrieval', 'semantic cache reuse', 'prompt assembly']),
    columns: [
      idColumn('Internal permission grant row ID.'),
      projectIdColumn,
      {
        name: 'principal_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Internal principal receiving the grant, when grant is principal-specific.',
        references: { table: 'principal', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'principal_github_account_link_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'GitHub account link that supports a principal grant.',
        references: { table: 'principal_github_account_link', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'repository_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Repository covered by the grant.',
        references: { table: 'repository', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'repository_ref_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Optional ref covered by the grant.',
        references: { table: 'repository_ref', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_team_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Team source/subject for team-derived grants.',
        references: { table: 'github_team', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'github_collaborator_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Collaborator source for direct collaborator grants.',
        references: { table: 'github_collaborator', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'codeowner_rule_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'CODEOWNER source for path ownership grants.',
        references: { table: 'codeowner_rule', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'platform_role_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Platform role source for portal visibility grants only.',
        references: { table: 'platform_role', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'grant_source_kind',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'Future CHECK-constrained source such as team, collaborator, codeowner_rule, or platform_role.',
      },
      {
        name: 'permission_level',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'Future CHECK-constrained level such as read, triage, write, maintain, admin, codeowner_review, or portal_visibility.',
      },
      {
        name: 'content_scope',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['acl_scope'],
        description: 'Scope authorized by the grant: portal, repository_metadata, repository_content, or branch_content.',
      },
      {
        name: 'private_content_allowed',
        sqlType: 'BOOLEAN',
        nullable: false,
        roles: ['acl_scope'],
        description: 'True only for GitHub-derived grants; platform role grants alone must not set this true.',
      },
      grantStateColumn,
      aclScopeHashColumn,
      sourceRefColumn,
      indexVersionColumn,
      {
        name: 'effective_at',
        sqlType: 'TIMESTAMPTZ',
        nullable: false,
        roles: ['audit'],
        description: 'Start time for the effective grant fact.',
      },
      {
        name: 'expires_at',
        sqlType: 'TIMESTAMPTZ',
        nullable: true,
        roles: ['lifecycle'],
        description: 'Optional expiry time for temporary or superseded grants.',
      },
      syncedAtColumn,
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'permission_grant_project_effective_fact_unique',
        columns: [
          'project_id',
          'principal_id',
          'repository_id',
          'repository_ref_id',
          'grant_source_kind',
          'github_team_id',
          'github_collaborator_id',
          'codeowner_rule_id',
          'platform_role_id',
          'permission_level',
          'content_scope',
          'acl_scope_hash',
          'index_version',
        ],
        appliesWhen: 'active grant_state rows',
        convention: 'Duplicate active effective grants are forbidden within a project and ACL index.',
      },
    ],
    indexes: [
      {
        name: 'permission_grant_retrieval_lookup_idx',
        columns: ['project_id', 'principal_id', 'repository_id', 'repository_ref_id', 'acl_scope_hash', 'index_version', 'grant_state'],
        reason: 'Primary lookup for repository-aware retrieval and immediate pre-prompt ACL recheck.',
      },
      {
        name: 'permission_grant_source_idx',
        columns: ['project_id', 'grant_source_kind', 'github_team_id', 'github_collaborator_id', 'codeowner_rule_id', 'platform_role_id'],
        reason: 'Future sync can revoke or supersede grants from changed source facts.',
      },
    ],
    relationships: [
      {
        name: 'permission_grant_repository_fk',
        from: 'permission_grant',
        to: 'repository',
        columns: ['repository_id'],
        onDelete: 'restrict',
        convention: 'Grants are revoked before repository deletion.',
      },
      {
        name: 'permission_grant_platform_role_fk',
        from: 'permission_grant',
        to: 'platform_role',
        columns: ['platform_role_id'],
        onDelete: 'restrict',
        convention: 'Platform role grants cannot authorize private content without a matching GitHub-derived grant.',
      },
    ],
  },
  {
    entity: 'github_permission_sync_run',
    tableName: 'github_permission_sync_run',
    description: 'Sync attempt record that identifies the source event and permission index version.',
    tenantIsolation: projectTenantIsolation,
    acl: {
      required: false,
      columns: ['project_id', 'acl_scope_hash', 'index_version'],
      appliesTo: ['sync freshness evidence for ACL-bearing facts'],
      defaultDenyWhenMissing: true,
    },
    columns: [
      idColumn('Internal sync run row ID.'),
      projectIdColumn,
      {
        name: 'github_installation_id',
        sqlType: 'BIGINT',
        nullable: false,
        roles: ['foreign_key'],
        description: 'Installation targeted by the sync run.',
        references: { table: 'github_installation', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'sync_scope',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'Future CHECK-constrained scope such as installation, organization, repository, ref, principal, or grant.',
      },
      {
        name: 'source_event',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['metadata'],
        description: 'GitHub webhook event, manual run, or scheduled run source label.',
      },
      {
        name: 'source_delivery_id',
        sqlType: 'TEXT',
        nullable: true,
        roles: ['external_source_id'],
        description: 'GitHub delivery ID for idempotency when the source is a webhook.',
      },
      {
        name: 'run_status',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['lifecycle'],
        description: 'Future CHECK-constrained status such as pending, running, succeeded, failed, or stale_blocked.',
      },
      aclScopeHashColumn,
      indexVersionColumn,
      {
        name: 'started_at',
        sqlType: 'TIMESTAMPTZ',
        nullable: false,
        roles: ['audit'],
        description: 'Sync run start time.',
      },
      {
        name: 'completed_at',
        sqlType: 'TIMESTAMPTZ',
        nullable: true,
        roles: ['audit'],
        description: 'Sync run completion time.',
      },
      {
        name: 'stale_after',
        sqlType: 'TIMESTAMPTZ',
        nullable: false,
        roles: ['lifecycle'],
        description: 'Freshness SLO boundary after which repo-aware retrieval defaults to deny.',
      },
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'github_permission_sync_run_delivery_unique',
        columns: ['project_id', 'github_installation_id', 'source_delivery_id'],
        appliesWhen: 'source_delivery_id is not null',
        convention: 'Webhook-originated sync runs are idempotent per project and installation.',
      },
      {
        name: 'github_permission_sync_run_index_scope_unique',
        columns: ['project_id', 'github_installation_id', 'sync_scope', 'acl_scope_hash', 'index_version'],
        appliesWhen: 'succeeded rows',
        convention: 'Only one successful run may claim a scope/hash/index version.',
      },
    ],
    indexes: [
      {
        name: 'github_permission_sync_run_freshness_idx',
        columns: ['project_id', 'github_installation_id', 'run_status', 'stale_after'],
        reason: 'Find stale sync coverage before retrieval.',
      },
    ],
    relationships: [
      {
        name: 'github_permission_sync_run_installation_fk',
        from: 'github_permission_sync_run',
        to: 'github_installation',
        columns: ['github_installation_id'],
        onDelete: 'restrict',
        convention: 'Sync history remains available while permission facts exist.',
      },
    ],
  },
  {
    entity: 'github_permission_sync_stale_marker',
    tableName: 'github_permission_sync_stale_marker',
    description: 'Fail-closed marker that blocks retrieval when permission sync freshness or coverage is unsafe.',
    tenantIsolation: projectTenantIsolation,
    acl: projectTenantAcl(['default-deny stale sync checks before retrieval, cache reuse, and prompt assembly']),
    columns: [
      idColumn('Internal stale marker row ID.'),
      projectIdColumn,
      {
        name: 'github_permission_sync_run_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Sync run that created or last confirmed the stale marker.',
        references: { table: 'github_permission_sync_run', column: 'id', onDelete: 'set_null' },
      },
      {
        name: 'repository_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Repository covered by the stale marker when scope is repository/ref/grant.',
        references: { table: 'repository', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'repository_ref_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Ref covered by the stale marker when scope is ref.',
        references: { table: 'repository_ref', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'principal_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Principal covered by the stale marker when scope is principal or principal grant.',
        references: { table: 'principal', column: 'id', onDelete: 'restrict' },
      },
      {
        name: 'stale_scope',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['lifecycle'],
        description: 'Future CHECK-constrained scope such as project, installation, organization, repository, ref, principal, grant, or acl_scope.',
      },
      {
        name: 'stale_reason',
        sqlType: 'TEXT',
        nullable: false,
        roles: ['lifecycle'],
        description: 'Reason the permission facts are unsafe, such as sync_lag_slo_exceeded or webhook_gap.',
      },
      aclScopeHashColumn,
      sourceRefColumn,
      indexVersionColumn,
      {
        name: 'stale_at',
        sqlType: 'TIMESTAMPTZ',
        nullable: false,
        roles: ['audit'],
        description: 'Instant the marker began forcing default-deny.',
      },
      {
        name: 'default_deny_until',
        sqlType: 'TIMESTAMPTZ',
        nullable: true,
        roles: ['lifecycle'],
        description: 'Optional upper bound for an explicit maintenance window; null means deny until cleared.',
      },
      {
        name: 'cleared_by_sync_run_id',
        sqlType: 'BIGINT',
        nullable: true,
        roles: ['foreign_key'],
        description: 'Successful sync run that cleared the marker.',
        references: { table: 'github_permission_sync_run', column: 'id', onDelete: 'set_null' },
      },
      {
        name: 'cleared_at',
        sqlType: 'TIMESTAMPTZ',
        nullable: true,
        roles: ['audit'],
        description: 'Time the stale marker stopped forcing default-deny.',
      },
      createdAtColumn,
      updatedAtColumn,
    ],
    uniqueConstraints: [
      {
        name: 'github_permission_stale_marker_open_scope_unique',
        columns: ['project_id', 'stale_scope', 'repository_id', 'repository_ref_id', 'principal_id', 'acl_scope_hash', 'index_version'],
        appliesWhen: 'cleared_at is null',
        convention: 'Only one open stale marker exists for a project/scope/principal/repository/ref/ACL index.',
      },
    ],
    indexes: [
      {
        name: 'github_permission_stale_marker_retrieval_idx',
        columns: ['project_id', 'repository_id', 'repository_ref_id', 'principal_id', 'acl_scope_hash', 'index_version', 'cleared_at'],
        reason: 'Fail-closed retrieval lookup before content access, cache reuse, or prompt assembly.',
      },
      {
        name: 'github_permission_stale_marker_scope_idx',
        columns: ['project_id', 'stale_scope', 'cleared_at'],
        reason: 'Find project/installation/org-wide default-deny markers.',
      },
    ],
    relationships: [
      {
        name: 'github_permission_stale_marker_sync_run_fk',
        from: 'github_permission_sync_stale_marker',
        to: 'github_permission_sync_run',
        columns: ['github_permission_sync_run_id'],
        onDelete: 'set_null',
        convention: 'Marker remains effective even if detailed sync-run row is archived later.',
      },
      {
        name: 'github_permission_stale_marker_repository_fk',
        from: 'github_permission_sync_stale_marker',
        to: 'repository',
        columns: ['repository_id'],
        onDelete: 'restrict',
        convention: 'Stale markers are cleared or archived before repository deletion.',
      },
    ],
  },
] as const satisfies readonly GitHubPermissionEntityMetadata[];

export const githubPermissionRelationshipConventions = {
  allForeignKeysDeclareOnDelete: true,
  allForeignKeysRequireIndexes: true,
  projectIdLeadsTenantScopedUniques: true,
  githubExternalIdsNeverAuthorizeAcrossProjects: true,
  sourceFactsAreEndedOrMarkedInactiveBeforeDeletion: true,
  permissionGrantsAreSupersededOrRevokedRatherThanSilentlyDeleted: true,
} as const;

export const githubPermissionRetrievalDefaultDenyHooks = [
  {
    hook: 'resolve_project_and_principal',
    requiredBefore: 'repository_aware_retrieval',
    reads: ['principal_github_account_link'],
    deniesWhen: ['missing_project_id', 'missing_principal_id', 'project_principal_mismatch'],
    behavior: 'default_deny',
  },
  {
    hook: 'resolve_principal_github_account_link',
    requiredBefore: 'repository_aware_retrieval',
    reads: ['principal_github_account_link'],
    deniesWhen: ['missing_active_github_link', 'unverified_github_link', 'link_project_mismatch'],
    behavior: 'default_deny',
  },
  {
    hook: 'resolve_repository_and_ref_acl_scope',
    requiredBefore: 'repository_aware_retrieval',
    reads: ['repository', 'repository_ref'],
    deniesWhen: ['missing_repository', 'missing_required_ref', 'repository_inactive', 'acl_scope_hash_missing'],
    behavior: 'default_deny',
  },
  {
    hook: 'check_sync_stale_marker',
    requiredBefore: 'repository_aware_retrieval',
    reads: ['github_permission_sync_stale_marker'],
    deniesWhen: ['open_project_marker', 'open_repository_marker', 'open_ref_marker', 'open_principal_marker', 'open_grant_marker', 'sync_lag_slo_exceeded'],
    behavior: 'default_deny',
  },
  {
    hook: 'check_acl_scope_hash_and_index_version',
    requiredBefore: 'semantic_cache_reuse',
    reads: ['repository', 'repository_ref', 'permission_grant', 'github_permission_sync_stale_marker'],
    deniesWhen: ['acl_scope_hash_mismatch', 'index_version_mismatch', 'missing_source_ref'],
    behavior: 'default_deny',
  },
  {
    hook: 'enforce_github_private_content_ceiling',
    requiredBefore: 'repository_aware_retrieval',
    reads: ['permission_grant', 'platform_role'],
    deniesWhen: ['platform_role_without_github_private_content_grant', 'anonymous_or_shared_team_key', 'private_content_allowed_false'],
    behavior: 'default_deny',
  },
  {
    hook: 'repeat_acl_check_before_prompt_assembly',
    requiredBefore: 'prompt_assembly',
    reads: ['permission_grant', 'github_permission_sync_stale_marker'],
    deniesWhen: ['grant_revoked_after_retrieval', 'stale_marker_added_after_retrieval', 'acl_scope_changed_before_prompt'],
    behavior: 'default_deny',
  },
] as const satisfies readonly GitHubPermissionRetrievalHookMetadata[];

export type GitHubPermissionEntityMetadataSnapshot = typeof githubPermissionEntities;
export type GitHubPermissionRetrievalDefaultDenyHook =
  (typeof githubPermissionRetrievalDefaultDenyHooks)[number];
