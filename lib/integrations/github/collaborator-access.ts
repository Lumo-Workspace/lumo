/**
 * LUM-882 — does a given GitHub login still read a repository? Asked with an
 * *installation* token, so no user credential is involved: GitHub serves
 * `GET /repos/{owner}/{repo}/collaborators/{username}/permission` under the
 * Metadata read permission every App has, and the answer already folds in
 * repository, team, organization-base and enterprise grants.
 *
 * Probed against the dev App (metadata read only): an org admin comes back
 * `admin`, a non-member `none`, and an unknown login 404.
 */

const GH_API = 'https://api.github.com'
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

/** Legacy base roles that include read. `none` (and anything unknown) does not. */
const READ_ROLES = new Set(['read', 'triage', 'write', 'maintain', 'admin'])

/**
 * - `readable` / `unreadable` — GitHub answered; 404 (unknown user, or a
 *   repository the installation no longer reaches) is unreadable: fail closed.
 * - `rate_limited` — stop the run; nothing about this repository is known.
 * - `unknown` — any other failure; the caller keeps the repository.
 *
 * `remaining` is the installation's rate-limit headroom after the call, when
 * GitHub reported it.
 */
export interface RepositoryReadAccess {
  access: 'readable' | 'unreadable' | 'rate_limited' | 'unknown'
  remaining: number | null
}

function remainingOf(res: Response): number | null {
  const raw = res.headers.get('x-ratelimit-remaining')
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export async function checkRepositoryReadAccess(
  installationToken: string,
  repositoryFullName: string,
  login: string
): Promise<RepositoryReadAccess> {
  let res: Response
  try {
    res = await fetch(
      `${GH_API}/repos/${repositoryFullName}/collaborators/${encodeURIComponent(login)}/permission`,
      {
        headers: {
          ...GH_HEADERS,
          Authorization: `Bearer ${installationToken}`,
        },
      }
    )
  } catch {
    return { access: 'unknown', remaining: null }
  }
  const remaining = remainingOf(res)

  if (res.status === 200) {
    const data = (await res.json().catch(() => ({}))) as {
      permission?: string
    }
    return {
      access: READ_ROLES.has(data.permission ?? '') ? 'readable' : 'unreadable',
      remaining,
    }
  }
  if (res.status === 404) return { access: 'unreadable', remaining }
  if (res.status === 429 || (res.status === 403 && remaining === 0)) {
    return { access: 'rate_limited', remaining }
  }
  return { access: 'unknown', remaining }
}

/**
 * LUM-888 — who the verifier is on GitHub *now*. By id (`GET /user/{id}`)
 * when the id is on record: a renamed account comes back under its new login,
 * and a login someone else registered later never matches. By login
 * (`GET /users/{login}`) only for rows verified before the id was recorded —
 * the answer carries the id so the caller can record it from then on.
 *
 * `'gone'` only when GitHub says the account does not exist (404); `null`
 * when it could not be asked. One call instead of one 404 per repository.
 */
export type GitHubUserLookup = { id: number; login: string } | 'gone' | null

export async function lookupGitHubUser(
  installationToken: string,
  who: { id: number } | { login: string }
): Promise<GitHubUserLookup> {
  const path =
    'id' in who ? `/user/${who.id}` : `/users/${encodeURIComponent(who.login)}`
  try {
    const res = await fetch(`${GH_API}${path}`, {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${installationToken}` },
    })
    if (res.status === 404) return 'gone'
    if (res.status !== 200) return null
    const data = (await res.json().catch(() => ({}))) as {
      id?: number
      login?: string
    }
    if (typeof data.id !== 'number' || !data.login) return null
    return { id: data.id, login: data.login }
  } catch {
    return null
  }
}
