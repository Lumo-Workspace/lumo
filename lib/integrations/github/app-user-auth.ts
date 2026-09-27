/**
 * LUM-875 — user authorization *for the Lumo GitHub App* (a GitHub App user
 * access token), used only to answer one question during the install callback:
 * can the person in front of us actually access this installation?
 *
 * GitHub documents the `installation_id` on the setup URL as untrusted — anyone
 * can type any integer into it. Everything else the callback does (reading the
 * installation, listing its repositories, backfilling PRs) runs as the App, and
 * the App can read every installation it has, so without this check any Lumo
 * user could bind another organisation's installation to their own workspace.
 *
 * Distinct from the Lumo OAuth App (`GITHUB_CLIENT_ID`): that token belongs to
 * a different client and `GET /user/installations` refuses it. The user token
 * here is never stored — it is exchanged, used for one listing, and revoked.
 */

const GH_API = 'https://api.github.com'
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

/** Thrown when the App's client credentials are missing from env. */
export class GithubAppUserAuthNotConfiguredError extends Error {
  constructor() {
    super(
      'Missing GitHub App client credentials: GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET'
    )
    this.name = 'GithubAppUserAuthNotConfiguredError'
  }
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GITHUB_APP_CLIENT_ID
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new GithubAppUserAuthNotConfiguredError()
  }
  return { clientId, clientSecret }
}

/** Where to send the user to authorize the App (silent if already authorized). */
export function buildAppUserAuthorizeUrl(
  state: string,
  redirectUri: string
): string {
  const { clientId } = clientCredentials()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

/** Exchange the authorization `code` for a GitHub App user access token. */
export async function exchangeAppUserCode(
  code: string,
  redirectUri: string
): Promise<string> {
  const { clientId, clientSecret } = clientCredentials()
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  // GitHub answers a bad code with 200 + `error`, so the body decides.
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error?: string
  }
  if (!res.ok || !data.access_token) {
    throw new Error(
      `GitHub App user code exchange failed ${res.status}: ${data.error ?? 'no access_token'}`
    )
  }
  return data.access_token
}

/**
 * Ids of the Lumo App installations the token's user can access
 * (`GET /user/installations`). Throws on any non-2xx so the caller fails
 * closed — an unreadable list is never an empty "allowed" list.
 */
export async function listUserInstallationIds(
  userToken: string
): Promise<number[]> {
  const ids: number[] = []
  // A user rarely reaches more than a handful of installations of one App;
  // the page cap bounds the work a single callback can do.
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `${GH_API}/user/installations?per_page=100&page=${page}`,
      { headers: { ...GH_HEADERS, Authorization: `Bearer ${userToken}` } }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `GitHub listUserInstallations failed ${res.status}: ${body.slice(0, 200)}`
      )
    }
    const data = (await res.json()) as { installations?: { id?: number }[] }
    const pageIds = (data.installations ?? []).flatMap(i =>
      typeof i.id === 'number' ? [i.id] : []
    )
    ids.push(...pageIds)
    if (pageIds.length < 100) break
  }
  return ids
}

/** 100 per page × 50 pages — past this the listing is refused, not truncated. */
const USER_REPO_PAGE_CAP = 50

/**
 * LUM-880 — full names of the repositories in `installationId` that the
 * token's user can read (`GET /user/installations/{id}/repositories`). GitHub
 * lists an installation for a user who can read any one of its repositories,
 * so the caller compares this set against the installation's own list.
 *
 * Fails closed: a non-2xx or a listing longer than the page cap throws — a
 * partial list would read as "the user cannot see these", which is the safe
 * direction, but an error must never be mistaken for an answer.
 */
export async function listUserInstallationRepositories(
  userToken: string,
  installationId: number
): Promise<string[]> {
  const names: string[] = []
  for (let page = 1; page <= USER_REPO_PAGE_CAP; page++) {
    const res = await fetch(
      `${GH_API}/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      { headers: { ...GH_HEADERS, Authorization: `Bearer ${userToken}` } }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `GitHub listUserInstallationRepositories failed ${res.status}: ${body.slice(0, 200)}`
      )
    }
    const data = (await res.json()) as {
      repositories?: { full_name?: string }[]
    }
    const pageNames = (data.repositories ?? []).flatMap(r =>
      typeof r.full_name === 'string' ? [r.full_name] : []
    )
    names.push(...pageNames)
    if (pageNames.length < 100) return names
  }
  throw new Error(
    `GitHub listUserInstallationRepositories: more than ${USER_REPO_PAGE_CAP * 100} repositories in installation ${installationId}`
  )
}

/**
 * Revoke the user token once the check is done — Lumo keeps no user credential
 * from this flow. Best-effort: never throws, never logs the token.
 */
export async function revokeAppUserToken(userToken: string): Promise<void> {
  try {
    const { clientId, clientSecret } = clientCredentials()
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    await fetch(`${GH_API}/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: {
        ...GH_HEADERS,
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: userToken }),
    })
  } catch {
    // The token expires on its own (8h); a failed revoke changes nothing here.
  }
}
