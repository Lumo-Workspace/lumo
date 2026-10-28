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

/**
 * LUM-1330 — the workspace's record of renamed repositories: old `owner/name`
 * (ASCII-folded) → the name it was renamed to (`GitHubAppInstallation.
 * repositoryAliases`, written with every rename). Local clones keep the old
 * remote for good (GitHub redirects git), so a CLI that names a repository
 * by its remote may send the old name.
 */
export type RepositoryAliases = Record<string, string>

/** The stored Json, minus anything that is not a string → string entry. PURE. */
export function parseRepositoryAliases(json: unknown): RepositoryAliases {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const out: RepositoryAliases = {}
  for (const [from, to] of Object.entries(json as Record<string, unknown>)) {
    const key = foldAscii(from)
    if (key !== null && typeof to === 'string' && foldAscii(to) !== null)
      out[key] = to
  }
  return out
}

/**
 * The record after `from` was renamed to `to`. Earlier names that led to
 * `from` now lead to `to` (a chain A → B → C resolves in one step), and a
 * name that is current again (renamed back) stops being an alias. PURE.
 */
export function nextRepositoryAliases(
  aliases: RepositoryAliases,
  from: string,
  to: string
): RepositoryAliases {
  const fromKey = foldAscii(from)
  const toKey = foldAscii(to)
  if (fromKey === null || toKey === null || fromKey === toKey) return aliases
  const out: RepositoryAliases = {}
  for (const [old, target] of Object.entries(aliases)) {
    const next = foldAscii(target) === fromKey ? to : target
    if (old !== toKey) out[old] = next
  }
  out[fromKey] = to
  return out
}

/**
 * The confirmed repository `repository` was renamed to, or null. A name that
 * is itself confirmed is never redirected (a new repository may reuse an old
 * name), and the target must still be on the confirmed list. PURE.
 */
export function resolveRenamedRepository(
  confirmed: readonly string[],
  aliases: RepositoryAliases,
  repository: string
): string | null {
  if (canonicalConfirmedRepository(confirmed, repository) !== null) return null
  const key = foldAscii(repository)
  const target = key === null ? undefined : aliases[key]
  return target === undefined
    ? null
    : canonicalConfirmedRepository(confirmed, target)
}

/** `resolveRenamedRepository` over one workspace's installation row. */
export async function loadRenamedRepository(
  workspaceId: string,
  repository: string
): Promise<string | null> {
  const row = workspaceId
    ? await githubAppInstallationRepository.findRenameState(workspaceId)
    : null
  if (!row) return null
  return resolveRenamedRepository(
    row.repositories,
    parseRepositoryAliases(row.repositoryAliases),
    repository
  )
}
