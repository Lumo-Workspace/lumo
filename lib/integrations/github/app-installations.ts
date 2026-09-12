import { getGithubAppJwt, createInstallationToken } from './auth'

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
 * The repositories an installation can reach, as `owner/name`. Uses the
 * installation token — this is the App acting as the installation.
 */
export async function fetchInstallationRepositories(
  installationId: number
): Promise<string[]> {
  const token = await createInstallationToken(installationId)
  const names: string[] = []
  // GitHub caps page size at 100; a handful of pages is plenty and bounds the
  // work a single callback can do.
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `${GH_API}/installation/repositories?per_page=100&page=${page}`,
      { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `GitHub fetchInstallationRepositories failed ${res.status}: ${body.slice(0, 200)}`
      )
    }
    const data = (await res.json()) as {
      repositories?: { full_name?: string }[]
    }
    const page_names = (data.repositories ?? [])
      .map(r => r.full_name)
      .filter((n): n is string => Boolean(n))
    names.push(...page_names)
    if (page_names.length < 100) break
  }
  return names
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
