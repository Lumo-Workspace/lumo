import type { GitHubAppPermissionName, RepoTokenPermissions } from './auth'

/**
 * LUM-886 — the permissions each kind of repository call mints its token with.
 *
 * LUM-883 narrowed every installation token to one confirmed repository; this
 * narrows what the token may do there. Each set is the minimum GitHub's
 * "Permissions required for GitHub Apps" table lists for the endpoints its
 * callers hit, and was probed live against a real installation
 * (internal LUM-886 token-permissions probe).
 *
 * Every set must stay inside `PRODUCTION_APP_PERMISSIONS`: asking for a
 * permission the installation was not granted makes GitHub refuse the mint
 * with 422, which takes the whole feature down, not just the extra scope.
 */
export const REPO_TOKEN_PERMISSIONS = {
  /**
   * File contents, the repository record and its branch refs — and a pull
   * request's `.diff` media type, which GitHub serves under `contents` (probed:
   * `pull_requests: read` alone gets 403 for the diff, 200 for the JSON).
   */
  contentsRead: { contents: 'read' },
  /**
   * A pull request's JSON and its file list.
   */
  pullRequestRead: { pull_requests: 'read' },
  /**
   * Writing on a pull request: its conversation comments (the
   * `/issues/{n}/comments` endpoints accept `pull_requests: write` for a pull
   * request, so `issues` is not needed), review-line comments and reviews.
   */
  pullRequestWrite: { pull_requests: 'write' },
  /**
   * LUM-1127 — resolving / unresolving a review thread (GraphQL
   * `resolveReviewThread` / `unresolveReviewThread`) and the thread notes and
   * listings around it. GitHub refuses those mutations to an installation
   * token holding only `pull_requests: write` ("Resource not accessible by
   * integration" — seen in production on PR 1451, and probed live: the same
   * no-op `unresolveReviewThread` is FORBIDDEN with `pull_requests: write`
   * and with `contents: read` added, and succeeds once `contents: write` is
   * added). Reading threads works with the pull-request set alone.
   */
  reviewThreadWrite: { pull_requests: 'write', contents: 'write' },
  /**
   * LUM-1129 — `GET /repos/{r}/collaborators/{login}/permission` for one
   * repository: may this commenter drive Lumo's reviewer from the PR? Served
   * under `metadata: read`, the permission every App has.
   */
  collaboratorPermission: { metadata: 'read' },
  /**
   * LUM-1134 — `GET /repos/{owner}/{repo}` for the repository's visibility
   * (the learnings scope's `auto`). The repository record is served under
   * `metadata: read`, the permission every App has.
   */
  repositoryMetadata: { metadata: 'read' },
  /**
   * LUM-1149 — `GET /repos/{owner}/{repo}/issues/{n}`: an issue a PR's
   * description closes or links, read for the linked issue assessment. The
   * production App holds `issues: write`, which includes this.
   */
  issueRead: { issues: 'read' },
} as const satisfies Record<string, RepoTokenPermissions>

/**
 * LUM-890 — the permissions each installation-wide token (no repository
 * narrowing, `createInstallationToken`) is minted with. These are the calls
 * that must see the whole installation: listing what it reaches, and asking
 * GitHub whether a verifier still reads a repository. Both are served under
 * `metadata: read`, the one permission every App has (probed live:
 * internal LUM-886 token-permissions probe).
 */
export const INSTALLATION_TOKEN_PERMISSIONS = {
  /** `GET /installation/repositories` — the repositories an installation reaches. */
  repositoryList: { metadata: 'read' },
  /**
   * `GET /repos/{r}/collaborators/{login}/permission` (the LUM-882 access
   * recheck) and `GET /users/{login}`, which is public.
   */
  collaboratorAccess: { metadata: 'read' },
} as const satisfies Record<string, RepoTokenPermissions>

/**
 * The production App's (`uselumo`, App ID 3207183) repository permissions,
 * as `gh api apps/uselumo --jq .permissions` returned them on 2026-10-08.
 * The only production installation (Lumo-Workspace) carries exactly these.
 * A test holds every set above to this list, and the probe script re-reads the
 * live App to catch the list itself going stale.
 */
export const PRODUCTION_APP_PERMISSIONS: RepoTokenPermissions = {
  actions: 'read',
  checks: 'read',
  code_quality: 'read',
  contents: 'write',
  issues: 'write',
  metadata: 'read',
  pull_requests: 'write',
  statuses: 'read',
}

/** `write` includes `read`; anything the App lacks is outside it. */
export function isWithinPermissions(
  requested: RepoTokenPermissions,
  granted: RepoTokenPermissions
): boolean {
  return Object.entries(requested).every(([name, level]) => {
    const have = granted[name as GitHubAppPermissionName]
    return have === 'write' || (have === 'read' && level === 'read')
  })
}
