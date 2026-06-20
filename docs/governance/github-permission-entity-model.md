# GitHub Permission Sync Entity Model

Status: Track 0.6 governance artifact  
Scope: inert entity model for GitHub App permission sync facts, relationships, uniqueness, ACL indexing, and stale-sync retrieval safety hooks  
Production capability: this document does not create migrations, connect to GitHub, run sync jobs, or enable repository-aware retrieval.

## 1. Purpose

GitHub is the first-release source of truth for repository-content permissions. This model defines the rows that future sync code and migrations must represent before private repository content can be indexed or retrieved.

## 2. Required entities

| Entity | Table | Purpose |
|---|---|---|
| GitHub installation | `github_installation` | Tenant-scoped GitHub App installation boundary and source installation ID. |
| GitHub organization | `github_organization` | Organization or enterprise account connected through an installation. |
| Repository | `repository` | Repository metadata and repository-level ACL scope. |
| Branch/ref | `repository_ref` | Branch, tag, or pull-request ref with independent ACL scope and index version. |
| Team | `github_team` | GitHub team membership/source permission subject. |
| Collaborator | `github_collaborator` | Direct repository collaborator or outside collaborator account. |
| CODEOWNER rule | `codeowner_rule` | Parsed CODEOWNERS ownership rule for a repository/ref/path pattern. |
| Principal GitHub account link | `principal_github_account_link` | Internal principal to GitHub account mapping. |
| Platform role | `platform_role` | Portal visibility role that cannot widen GitHub private-content access. |
| Permission grant | `permission_grant` | Effective permission fact used by retrieval authorization. |
| Sync run | `github_permission_sync_run` | Append-style sync attempt record and ACL index version source. |
| Sync stale marker | `github_permission_sync_stale_marker` | Fail-closed marker that blocks repo-aware retrieval when permission data is stale. |

## 3. Global conventions

- All table and column names use singular `snake_case`.
- Internal IDs use `BIGINT GENERATED ALWAYS AS IDENTITY`; public IDs use UUIDv7 or prefixed opaque text only when exposed externally.
- Every GitHub permission table includes `project_id` unless explicitly documented as system-global. Cross-project joins are forbidden for authorization.
- ACL-bearing facts include `acl_scope_hash`, `source_ref`, and `index_version` where the row can affect retrieval, cache reuse, context packing, graph facts, memories, or prompt assembly.
- Unique constraints include `project_id` first unless the row is a system-global platform role. GitHub external IDs are not globally unique across tenants.
- Every FK declares explicit `ON DELETE` behavior and has a supporting index on the referencing column or column set.
- Status/state fields are `TEXT` with future `CHECK` constraints, not custom database enums.
- Metadata JSON is allowed only for non-authoritative provider payload snapshots. ACL decisions, permission levels, stale states, and lifecycle state are columns.

## 4. Relationship and uniqueness conventions

| Relationship | Convention |
|---|---|
| Installation to organization/repository/team | Child rows carry `project_id` and `github_installation_id`; deletion of an installation is restricted until children are archived or disabled. |
| Organization to repository/team | `github_organization_id` is required for organization-owned repos/teams and indexed with `project_id`. |
| Repository to ref/CODEOWNER/grant/stale marker | Repository children use `ON DELETE RESTRICT`; future cleanup must mark rows inactive/stale before deletion. |
| Principal to GitHub account | One active link per `(project_id, principal_id, github_installation_id, github_account_id)` and per `(project_id, github_installation_id, github_login_lower)`. |
| Team/collaborator to grants | Grants reference teams/collaborators as source facts; a future sync deactivation must end-date grants rather than silently deleting them. |
| Platform role to grants | Platform roles can grant portal visibility only; private repository content still requires a GitHub-derived grant for the same principal, repository/ref, ACL hash, and index version. |
| Sync run to indexed facts | Each ACL-bearing fact stores the `index_version` produced or confirmed by a sync run. A failed or stale sync must not advance effective grants. |

## 5. Entity columns

The TypeScript contract in `packages\db\src\github-permission-model.ts` is the source of truth for the exact inert metadata. The minimum column groups are:

- Tenant columns: `project_id`, `created_at`, `updated_at`.
- GitHub source columns: installation, org, repo, team, account, ref, path/rule source IDs and login/name slugs.
- Retrieval ACL columns: `acl_scope_hash`, `source_ref`, `index_version`, and permission-specific scope fields.
- Lifecycle columns: `state`, `active`, `synced_at`, `disabled_at`, or equivalent future migration fields.
- Sync safety columns: sync run status, stale reason, stale scope, stale time, and clear/deny timestamps.

## 6. Stale marker and default-deny retrieval hooks

Repository-aware retrieval must fail closed when any required permission fact is absent, stale, or not indexed with the requested ACL scope:

1. Resolve `project_id` and internal principal.
2. Resolve an active `principal_github_account_link`.
3. Resolve repository/ref facts for the requested source reference.
4. Check `github_permission_sync_stale_marker` for project, installation, organization, repository, ref, principal, grant, or ACL-scope markers.
5. Require matching `acl_scope_hash` and `index_version` on repository/ref grants and indexed content rows.
6. Require a GitHub-derived grant for private repository content; `platform_role` grants alone are insufficient.
7. Repeat the ACL check immediately before prompt assembly.

If any hook cannot be evaluated, the retrieval decision is default-deny. The Phase 0.6 artifact only defines these hooks; it intentionally implements no runtime retrieval or production sync behavior.

## 7. Review checklist

- Are all required entities represented in the TypeScript metadata?
- Does every permission-bearing table include `project_id` and relevant ACL/index columns?
- Do uniqueness rules prevent cross-project collisions and duplicate active facts?
- Are relationship delete behaviors explicit?
- Do stale markers cover project, installation, organization, repository, ref, principal, grant, and ACL-scope cases?
- Can platform roles grant portal visibility without bypassing GitHub private-content restrictions?
- Is the artifact inert, with no database connection, migration, webhook, or sync implementation?
