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

/** Case-insensitive, like GitHub's own repository names. PURE. */
export function isConfirmedRepository(
  confirmed: readonly string[],
  repository: string
): boolean {
  const target = repository.toLowerCase()
  return confirmed.some(name => name.toLowerCase() === target)
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
 */
export async function requireConfirmedRepository(
  workspaceId: string,
  repository: string
): Promise<{ installationId: number }> {
  if (!workspaceId) {
    throw new Error(
      'No workspace given; a GitHub installation token is always per workspace'
    )
  }
  const row = await githubAppInstallationRepository.findByWorkspace(workspaceId)
  if (!row) throw appNotInstalledError()
  if (!isConfirmedRepository(row.repositories, repository)) {
    throw repoNotConfirmedError(repository)
  }
  return { installationId: row.installationId }
}
