import { logger } from '@/lib/logger'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'

/**
 * Opportunistic reconcile of stale-looking PR state (LUM-699).
 *
 * `PullRequest.state` is maintained by the `pull_request` webhook alone — there
 * is no reconciliation anywhere. One missed delivery (webhook failure, a PR
 * merged while the integration was disconnected, a PR predating the
 * integration) leaves the row `open` forever, and a merged PR then shows up as
 * a stale PR needing review. That wrong `open` is read by dependency detection,
 * the per-task open-PR list and the project/sprint `prStats.open` counts too —
 * so this corrects the row rather than filtering at the read site.
 *
 * Mirrors the sprint-state pattern: reconcile on the read path, bounded to the
 * rows the reader is about to show. Deliberately narrow — only PRs already past
 * the stale threshold are candidates, so the request cost is a handful of
 * parallel GitHub reads, not a repo-wide sync.
 *
 * Fail-soft throughout: no token, no network, a 500 from GitHub — every failure
 * keeps the stored value and lets the page render. A stale row is a nuisance;
 * a stats endpoint that 500s because GitHub is down is worse.
 */

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'uselumo/1.0',
}

/** Never issue more than this many GitHub reads for one page load. */
const MAX_RECONCILED = 10

interface StalePrRow {
  id: string
  repo: string
  number: number
}

/** GitHub's terminal state for a PR, or null when it could not be determined. */
interface ObservedPrState {
  state: 'open' | 'merged' | 'closed'
  mergedAt: Date | null
  closedAt: Date | null
  isDraft: boolean
}

async function fetchPrState(
  token: string,
  pr: StalePrRow
): Promise<ObservedPrState | null> {
  const [owner, repo] = pr.repo.split('/')
  if (!owner || !repo) return null

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`,
      { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return null

    const body = (await res.json()) as {
      state: string
      merged_at: string | null
      closed_at: string | null
      draft?: boolean
    }
    // merged_at is the reliable merged indicator — GitHub reports merged PRs as
    // state "closed". Same derivation as the webhook and the sync path.
    const state = body.merged_at
      ? ('merged' as const)
      : body.state === 'closed'
        ? ('closed' as const)
        : ('open' as const)

    return {
      state,
      mergedAt: body.merged_at ? new Date(body.merged_at) : null,
      closedAt: body.closed_at ? new Date(body.closed_at) : null,
      isDraft: body.draft ?? false,
    }
  } catch {
    return null
  }
}

/**
 * Re-check the project's stale-looking open PRs against GitHub and correct any
 * whose stored state has drifted. Returns the number of rows corrected (0 when
 * nothing drifted, or when the check could not run at all).
 */
export async function reconcileStaleProjectPrs(
  projectId: string,
  workspaceId: string,
  stalePrDays: number
): Promise<number> {
  const cutoff = new Date(Date.now() - stalePrDays * 24 * 60 * 60 * 1000)

  const candidates: StalePrRow[] =
    await pullRequestRepository.findStaleOpenByProject(
      projectId,
      cutoff,
      MAX_RECONCILED
    )

  if (candidates.length === 0) return 0

  let getRepoToken: typeof import('@/lib/integrations/github/auth').getRepoToken
  try {
    // Imported lazily on purpose. The GitHub App auth module pulls in
    // @octokit/auth-app, which ships ESM that jest does not transform — a
    // static import here would break every suite that transitively loads the
    // stats service. It is also only needed once something actually looks
    // stale, which is the uncommon path.
    ;({ getRepoToken } = await import('@/lib/integrations/github/auth'))
  } catch {
    return 0
  }

  // One token per repository, minted only for a repository the workspace
  // still has confirmed (LUM-883). A refused mint (App not installed, or the
  // repository left the list) leaves that repository's rows alone.
  const tokens = new Map<string, Promise<string | null>>()
  const tokenFor = (repo: string) => {
    const key = repo.toLowerCase()
    let token = tokens.get(key)
    if (!token) {
      token = getRepoToken(
        workspaceId,
        repo,
        REPO_TOKEN_PERMISSIONS.pullRequestRead
      ).catch(() => null)
      tokens.set(key, token)
    }
    return token
  }

  const results = await Promise.allSettled(
    candidates.map(async pr => {
      const token = await tokenFor(pr.repo)
      if (!token) return false
      const actual = await fetchPrState(token, pr)
      // null = could not determine. Not the same as "still open" — writing
      // anything here would launder a failed lookup into a confirmed state.
      if (!actual || actual.state === 'open') return false

      await pullRequestRepository.updateState(pr.id, {
        state: actual.state,
        mergedAt: actual.mergedAt,
        closedAt: actual.closedAt,
        isDraft: actual.isDraft,
      })
      return true
    })
  )

  const corrected = results.filter(
    r => r.status === 'fulfilled' && r.value
  ).length

  if (corrected > 0) {
    logger.info(
      `reconcileStaleProjectPrs: corrected ${corrected} drifted PR state(s) for project ${projectId}`
    )
  }
  return corrected
}
