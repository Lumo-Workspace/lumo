import type { GitHubAppPermissionName, RepoTokenPermissions } from './auth'

/**
 * LUM-886 — the permissions each kind of repository call mints its token with.
 *
 * LUM-883 narrowed every installation token to one confirmed repository; this
 * narrows what the token may do there. Each set is the minimum GitHub's
 * "Permissions required for GitHub Apps" table lists for the endpoints its
 * callers hit, and was probed live against a real installation
 * (`scripts/analysis/lum886-token-permissions/probe.ts`).
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
} as const satisfies Record<string, RepoTokenPermissions>

/**
 * LUM-890 — the permissions each installation-wide token (no repository
 * narrowing, `createInstallationToken`) is minted with. These are the calls
 * that must see the whole installation: listing what it reaches, and asking
 * GitHub whether a verifier still reads a repository. Both are served under
 * `metadata: read`, the one permission every App has (probed live:
 * `scripts/analysis/lum886-token-permissions/probe.ts`).
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
 * The production App's (`lumo-agent`, App ID 3207183) repository permissions,
 * as `gh api apps/lumo-agent --jq .permissions` returned them on 2026-09-28.
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
