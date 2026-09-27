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
 * `false` only when GitHub says the login does not exist (a deleted or renamed
 * account); `null` when it could not be asked. One call instead of one 404 per
 * repository.
 */
export async function checkUserExists(
  installationToken: string,
  login: string
): Promise<boolean | null> {
  try {
    const res = await fetch(`${GH_API}/users/${encodeURIComponent(login)}`, {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${installationToken}` },
    })
    if (res.status === 200) return true
    if (res.status === 404) return false
    return null
  } catch {
    return null
  }
}
