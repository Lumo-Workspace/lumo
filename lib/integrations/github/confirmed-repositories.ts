import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'

/**
 * LUM-883 — the workspace's confirmed repository list
 * (`GitHubAppInstallation.repositories`, LUM-881) is the boundary for every
 * GitHub read Lumo makes on a workspace's behalf, not just the App webhook and
 * the picker. An installation can reach more repositories than the workspace
 * has confirmed; nothing may be fetched from those.
 *
 * No `@octokit/auth-app` here on purpose: services that only need the check
 * (re-linking an existing PR row, adding a project repository) import this
 * statically without dragging the ESM auth module into their jest graphs.
 */

/**
 * ASCII-only lower-casing. GitHub owner and repository names are ASCII
 * (letters, digits, `-`, `_`, `.`), and `String#toLowerCase` folds some
 * non-ASCII letters onto ASCII ones — the Kelvin sign U+212A becomes `k` —
 * which let `acme/\u212Aey` pass as `acme/key` (LUM-889).
 */
function foldAscii(name: string): string | null {
  if (!/^[\x20-\x7e]+$/.test(name)) return null
  return name.replace(/[A-Z]/g, c => c.toLowerCase())
}

/**
 * The confirmed list's own spelling of `repository` (GitHub's canonical
 * `owner/name`, since the list is read from the installation), or null when
 * it is not on the list. Case-insensitive like GitHub, ASCII only. PURE.
 */
export function canonicalConfirmedRepository(
  confirmed: readonly string[],
  repository: string
): string | null {
  const target = foldAscii(repository)
  if (target === null) return null
  return confirmed.find(name => foldAscii(name) === target) ?? null
}

/** Case-insensitive, like GitHub's own repository names; ASCII only. PURE. */
export function isConfirmedRepository(
  confirmed: readonly string[],
  repository: string
): boolean {
  return canonicalConfirmedRepository(confirmed, repository) !== null
}

export function repoNotConfirmedError(repository: string) {
  return Object.assign(
    new Error(
      `${repository} is not one of this workspace's confirmed GitHub repositories (repo_not_confirmed) — a workspace owner can confirm it under Settings → Integrations`
    ),
    { status: 403, code: 'repo_not_confirmed' as const }
  )
}

export function appNotInstalledError() {
  return Object.assign(
    new Error(
      'GitHub App is not installed for this workspace — install the Lumo GitHub App'
    ),
    { status: 400, code: 'app_not_installed' as const }
  )
}

/**
 * The installation to mint under, but only for a confirmed repository.
 * Throws `app_not_installed` (400) with no installation row and
 * `repo_not_confirmed` (403) for a repository outside the list.
 *
 * `repository` in the result is the list's canonical spelling (LUM-889):
 * callers that key rows by repository name store that, not what a user typed.
 */
export async function requireConfirmedRepository(
  workspaceId: string,
  repository: string
): Promise<{ installationId: number; repository: string }> {
  if (!workspaceId) {
    throw new Error(
      'No workspace given; a GitHub installation token is always per workspace'
    )
  }
  const row = await githubAppInstallationRepository.findByWorkspace(workspaceId)
  if (!row) throw appNotInstalledError()
  const canonical = canonicalConfirmedRepository(row.repositories, repository)
  if (canonical === null) throw repoNotConfirmedError(repository)
  return { installationId: row.installationId, repository: canonical }
}

/**
 * LUM-889 — a reusable, non-throwing view of one workspace's confirmed list,
 * for paths that walk many repositories and must SKIP an unconfirmed one
 * quietly rather than mint (and be refused, and warn) for each: the task
 * page's PR refresh, the SARIF ingest. One installation read per checker.
 * `null` (no installation) confirms nothing.
 */
export async function loadConfirmedRepositories(
  workspaceId: string
): Promise<(repository: string) => string | null> {
  const row = workspaceId
    ? await githubAppInstallationRepository.findByWorkspace(workspaceId)
    : null
  const confirmed = row?.repositories ?? []
  return repository => canonicalConfirmedRepository(confirmed, repository)
}
