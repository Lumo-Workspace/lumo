import { getGithubAppJwt, createInstallationToken } from './auth'
import { INSTALLATION_TOKEN_PERMISSIONS } from './token-permissions'

const GH_API = 'https://api.github.com'
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

export interface AppInstallationAccount {
  accountLogin: string | null
  accountType: string | null
}

/**
 * Reads one installation of the Lumo App. Authenticated with an App JWT (not an
 * installation token): the /app endpoints are the App speaking about itself.
 */
export async function fetchAppInstallation(
  installationId: number
): Promise<AppInstallationAccount> {
  const jwt = await getGithubAppJwt()
  const res = await fetch(`${GH_API}/app/installations/${installationId}`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `GitHub fetchAppInstallation failed ${res.status}: ${body.slice(0, 200)}`
    )
  }
  const data = (await res.json()) as {
    account?: { login?: string; type?: string } | null
  }
  return {
    accountLogin: data.account?.login ?? null,
    accountType: data.account?.type ?? null,
  }
}

/**
 * LUM-902 — what GitHub says about one of our installations, asked with the
 * App JWT. `gone` (404) and `suspended` are GitHub's own answers; any other
 * failure (5xx, network, a JWT that cannot be signed) is `unknown`, so a
 * caller acting on an answer never deletes anything because GitHub failed to
 * give one.
 */
export async function findAppInstallationStatus(
  installationId: number
): Promise<'active' | 'suspended' | 'gone' | 'unknown'> {
  try {
    const jwt = await getGithubAppJwt()
    const res = await fetch(`${GH_API}/app/installations/${installationId}`, {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` },
    })
    if (res.status === 404) return 'gone'
    if (!res.ok) return 'unknown'
    const data = (await res.json()) as { suspended_at?: string | null }
    return data.suspended_at ? 'suspended' : 'active'
  } catch {
    return 'unknown'
  }
}

export interface InstallationRepository {
  fullName: string
  name: string
  private: boolean
}

/** 100 per page × 50 pages — the same cap as the user-side listing (LUM-881). */
const INSTALLATION_REPO_PAGE_CAP = 50

/**
 * Thrown when an installation reaches more repositories than the listing cap.
 * A truncated list would let the repositories past the cap skip every check
 * that compares against it, so the listing is refused instead (LUM-881).
 */
export class InstallationRepositoryLimitError extends Error {
  readonly code = 'too_many_repositories'
  constructor(installationId: number) {
    super(
      `GitHub listInstallationRepositories: more than ${INSTALLATION_REPO_PAGE_CAP * 100} repositories in installation ${installationId}`
    )
    this.name = 'InstallationRepositoryLimitError'
  }
}

/**
 * The repositories an installation can reach. Uses the installation token —
 * this is the App acting as the installation. The set is decided on GitHub's
 * side (the App's repository selection), never in Lumo.
 *
 * Fails closed: past the page cap it throws `InstallationRepositoryLimitError`
 * rather than returning the first pages as if they were the whole list.
 */
export async function listInstallationRepositories(
  installationId: number
): Promise<InstallationRepository[]> {
  const token = await createInstallationToken(
    installationId,
    INSTALLATION_TOKEN_PERMISSIONS.repositoryList
  )
  const repos: InstallationRepository[] = []
  for (let page = 1; page <= INSTALLATION_REPO_PAGE_CAP; page++) {
    const res = await fetch(
      `${GH_API}/installation/repositories?per_page=100&page=${page}`,
      { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `GitHub listInstallationRepositories failed ${res.status}: ${body.slice(0, 200)}`
      )
    }
    const data = (await res.json()) as {
      repositories?: { full_name?: string; name?: string; private?: boolean }[]
    }
    const pageRepos = (data.repositories ?? []).flatMap(r =>
      r.full_name
        ? [
            {
              fullName: r.full_name,
              name: r.name ?? r.full_name,
              private: r.private === true,
            },
          ]
        : []
    )
    repos.push(...pageRepos)
    if (pageRepos.length < 100) return repos
  }
  throw new InstallationRepositoryLimitError(installationId)
}

/** Just the `owner/name` strings — what the installation row stores. */
export async function fetchInstallationRepositories(
  installationId: number
): Promise<string[]> {
  return (await listInstallationRepositories(installationId)).map(
    r => r.fullName
  )
}

/**
 * Uninstalls the App for this installation. Best-effort by design: the caller
 * removes our row either way, so a workspace is never stuck showing an
 * installation it cannot get rid of.
 */
export async function deleteAppInstallation(
  installationId: number
): Promise<void> {
  const jwt = await getGithubAppJwt()
  const res = await fetch(`${GH_API}/app/installations/${installationId}`, {
    method: 'DELETE',
    headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` },
  })
  if (!res.ok && res.status !== 404) {
    const body = await res.text()
    throw new Error(
      `GitHub deleteAppInstallation failed ${res.status}: ${body.slice(0, 200)}`
    )
  }
}
