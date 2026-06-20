# GitHub App Scope Matrix

Status: Track 0.6 governance artifact  
Scope: first-release GitHub App permissions, webhook events, approval gates, and fail-closed behavior for repository-aware retrieval  
Production capability: this document does not provision a production GitHub App, create secrets, install an app, enable repository retrieval, or grant production access.

## Locked first-release posture

GitHub is the first-release SCM and the source-of-truth permission graph for repository content. Repository visibility, collaborator access, team membership, branch/ref metadata, and CODEOWNERS-derived context are synced from the GitHub App installation and must be evaluated before repository content is indexed, retrieved, cached, assembled into prompts, or displayed.

Platform roles can grant portal visibility and administrative workflow access, but they cannot exceed GitHub restrictions for private repository content. If GitHub says a principal cannot access private repository content, a platform role must not widen that access.

Shared anonymous team keys are forbidden for retrieval. Repository retrieval must resolve an auditable principal GitHub account link, installation, repository, ACL scope hash, and index version; unresolved or shared identities fail closed.

## Data class defaults

| GitHub data | First-release data class default |
|---|---|
| Public repository content and public issue/PR text | `public`, unless the project marks the source higher. |
| Private repository metadata, installation inventory, teams, members, collaborators, and CODEOWNER ownership graph | `internal` minimum; `confidential` when it reveals private repository structure or access. |
| Private repository content, private PRs/issues, source snapshots, chunks, symbols, graph edges, context packs, and retrieval caches | Inherits repository/project classification; `confidential` by default and `restricted` when the project/repo is marked restricted. |
| Webhook payloads | Store minimally; inherit the touched repository data class, with secrets/signatures excluded from persisted payloads. |

## Least-privilege scope matrix

| Area | Required GitHub App permission or event | Why needed | Data class touched | Approval owner | Production gate | Denial/default behavior if absent |
|---|---|---|---|---|---|---|
| Repository metadata and installation inventory | Repository permission: `Metadata` read-only | Resolve installation, repository IDs, visibility, default branch, archival state, and repository inventory. GitHub App metadata read is the minimum required baseline. | `internal`; private repo metadata may be `confidential` | SCM integration owner; Platform security owner reviews production use | Signed installation sync, freshness SLO, immutable audit event, and ACL safety eval gate pass | Repository is omitted from portal retrieval/indexing; private content remains hidden. |
| Repository content snapshots | Repository permission: `Contents` read-only | Read files, trees, blobs, source references, and source snapshots for indexing and retrieval. | Inherits repository/project class; private content is `confidential` by default | SCM integration owner; Platform security owner | ACL-first indexing, source snapshot audit, index versioning, stale-sync default-deny test, retrieval eval gate pass | No content indexing or retrieval; existing index versions for the repo are treated stale and denied. |
| CODEOWNERS context | Repository permission: `Contents` read-only for CODEOWNERS paths only through the content reader policy | Parse `CODEOWNERS` from `.github\CODEOWNERS`, `CODEOWNERS`, or `docs\CODEOWNERS` to enrich ACL and reviewer context. | `internal`/`confidential`, inherits private repo class when paths expose sensitive structure | SCM integration owner | CODEOWNER parser fixture, ACL precedence fixture, source ref and index version audit | CODEOWNER-specific grants are ignored; retrieval falls back to collaborator/team permissions only, never allow-by-default. |
| Organization teams and membership | Organization permission: `Members` read-only, only for installed orgs | Map GitHub teams, org members, team slugs, and membership changes into permission grants needed for private repo ACLs. | `internal`/`confidential` identity and ACL metadata | SCM integration owner; Platform security owner | Principal account-link check, team membership freshness SLO, membership webhook signature/idempotency tests | Team-derived access is denied; platform roles may show portal shell only, not private repo content. |
| Repository collaborators | Repository metadata APIs plus org member/team sync; no write/admin permission | Resolve direct collaborators and outside collaborators for repositories in an installation. | `internal`/`confidential` ACL metadata | SCM integration owner | Collaborator sync audit and stale-deny fixture | Direct-collaborator grants are absent; retrieval denies unless another fresh GitHub grant exists. |
| Pull request context | Repository permission: `Pull requests` read-only, conditional for PR-aware retrieval or CODEOWNER review context | Read PR title/body/state, base/head refs, changed files metadata, review ownership context, and linked source refs when PR-aware answers are enabled. | Inherits repository/project class; private PR text is `confidential` by default | SCM integration owner; Product/Platform owner approves feature use | PR fixture coverage, ACL check immediately before prompt assembly, retrieval eval gate | PR-aware retrieval is disabled; source code permissions do not imply PR text access if the permission is absent. |
| Issue context | Repository permission: `Issues` read-only, conditional for issue-aware retrieval | Read issue title/body/labels/state only when issue-aware support/product workflows are explicitly enabled. | Inherits repository/project class; private issue text is `confidential` by default | SCM integration owner; Product/Platform owner approves feature use | Issue fixture coverage, ACL check immediately before prompt assembly, retrieval eval gate | Issue-aware retrieval is disabled; no issue text is indexed or shown. |
| Installation inventory webhooks | Events: `installation`, `installation_repositories` | Keep installation and repository inventory current when repos are added/removed or app permissions change. | `internal`/`confidential` installation metadata | SCM integration owner | Webhook secret configured outside this repo, signature verification, idempotency key, audit event | Event is ignored if unsigned/invalid; affected installation is marked stale and repo-aware retrieval denies. |
| Repository change webhooks | Events: `repository`, `push`, `create`, `delete` | Detect repository visibility changes, ref changes, content changes, branch/tag create/delete, and index invalidation triggers. | Inherits touched repo data class | SCM integration owner | Signature/idempotency tests, source ref/index invalidation fixture | Affected repo/index version is marked stale; retrieval denies until a successful sync refreshes ACL and index metadata. |
| ACL and team webhooks | Events: `member`, `membership`, `team`, `team_add`, `organization` where GitHub supports them for the installation | Refresh collaborator, org, and team-derived grants without waiting for scheduled sync. | `internal`/`confidential` identity and ACL metadata | SCM integration owner; Platform security owner | Membership webhook fixture, stale-sync SLO, default-deny fixture | Team/collaborator grants from stale state are denied; no shared fallback identity is allowed. |
| PR/issue webhooks | Events: `pull_request`, `issues`, conditional on read permissions above | Invalidate PR/issue context indexes and refresh metadata when PR/issue-aware retrieval is enabled. | Inherits touched repo data class | SCM integration owner; Product/Platform owner | Feature flag remains disabled until ACL eval and retrieval eval pass | PR/issue context is not indexed; webhook absence cannot widen source-code access. |

## Explicitly out of first-release scope

The first release must not request GitHub App write/admin permissions unless a future ADR, security review, and production gate explicitly add them. Out-of-scope examples include `Contents` write, repository administration, webhooks administration, secrets, actions, deployments, checks/status writes, package writes, organization administration, and member/team writes.

No production GitHub App provisioning, private key, webhook secret, installation ID, or other GitHub secret is stored in this repository. Track 0.6 defines only the governance baseline and inert TypeScript constants.

## Enforcement rules

1. Resolve principal, project, GitHub account link, installation, repository, ACL scope hash, and index version before any repo-aware retrieval.
2. Deny repository-aware retrieval when permission sync lag exceeds the SLO, the sync run is unverifiable, webhook signatures fail, or the index version was built from stale ACL state.
3. Repeat ACL checks immediately before prompt assembly, display, semantic-cache lookup, context-pack use, memory use, graph traversal, and tool execution.
4. Store ACL scope and index version on every chunk, entity, relation, memory item, source snapshot, and context pack.
5. Never use shared anonymous team keys for retrieval. Team grants must resolve to a GitHub-synced team and an auditable principal.
6. Portal roles may expose navigation, project lists, or admin workflows, but private repository content requires fresh GitHub-derived permission.
7. Missing optional PR/issues permissions disables only that feature area; it must not block source retrieval that has fresh content permission, and must not synthesize issue/PR access.
8. Missing required metadata/content/team permission denies the affected private repository content by default.

