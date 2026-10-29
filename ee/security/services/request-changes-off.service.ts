/**
 * LUM-1140 — turning the request-changes workflow (LUM-1130) off must not
 * leave PRs blocked by Lumo. Two paths dismiss Lumo's standing "changes
 * requested" reviews (never a human's, never an approval):
 *
 *   · `withdrawAcrossWorkspace` — right after the switch goes on → off, a
 *     bounded background pass over the workspace's open PRs (at most
 *     `BULK_MAX_PRS`, within `BULK_TIME_BUDGET_MS`, one PR at a time, and it
 *     stops at GitHub's rate limit);
 *   · `withdrawOnPullRequest` — every review sync while the mode is off, so
 *     a PR the bulk pass missed (over the cap, rate-limited, failed) is
 *     caught at its next review.
 *
 * Tenant isolation: only this workspace's PullRequest rows, tokens minted
 * for this workspace's confirmed repositories (`getRepoToken`), and a PR
 * another workspace holds with the mode on is left alone — Lumo's App
 * reviews as one bot for every workspace sharing the installation.
 *
 * Best effort: neither entry point throws. A transient GitHub failure (no
 * response, or a 5xx) is retried (`RETRY_DELAYS_MS`): the bulk pass is the
 * only thing that withdraws on an idle PR — the lazy path waits for a review
 * sync that may never come — so one dropped connection must not leave the PR
 * blocked (LUM-1140 production: the token mint for lumo-agent-test#24 failed
 * once with Octokit's empty-message network error and the pass moved on).
 *
 * Layering: service — DB through repositories, the PR's Git platform
 * through `pr-review-verdict.service` / the `GitProvider` port (LUM-1318).
 */
import { logger } from '@/lib/logger'
import {
  gitProviderFor,
  gitProviderRefOf,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import {
  describeGithubFailure,
  isRateLimited,
  isTransientGithubFailure,
  prReviewVerdictService,
} from '@/ee/security/services/pr-review-verdict.service'

/** Most open PRs one bulk pass visits (the rest: at their next review). */
export const BULK_MAX_PRS = 50
/** Wall-clock budget of one bulk pass (it runs after the response). */
export const BULK_TIME_BUDGET_MS = 20_000
/** Waits before each retry of a transient failure on one PR. */
export const RETRY_DELAYS_MS = [500, 2_000] as const

export type Sleep = (ms: number) => Promise<void>
const realSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export interface WithdrawPr extends GitProviderRef {
  id: string
  workspaceId: string
  /** "owner/repo" */
  repo: string
  number: number
}

export interface BulkWithdrawResult {
  /** PRs looked at. */
  checked: number
  /** Lumo reviews dismissed. */
  dismissed: number
  /** Why the pass stopped early, if it did. */
  stopped: 'mode_on' | 'rate_limited' | 'time_budget' | null
}

function parseRepo(repo: string): { owner: string; name: string } | null {
  const [owner, name, ...rest] = repo.split('/')
  return owner && name && rest.length === 0 ? { owner, name } : null
}

/** Dismiss on one PR; throws (rate limit included) — callers catch. */
async function withdraw(pr: WithdrawPr, token: string): Promise<number> {
  const repo = parseRepo(pr.repo)
  if (!repo) return 0
  if (await prSecurityScanRepository.isRequestChangesOnElsewhere(pr)) return 0
  return prReviewVerdictService.withdrawChangeRequests({
    ...gitProviderRefOf(pr),
    repo,
    prNumber: pr.number,
    token,
  })
}

const tokenFor = (pr: GitProviderRef & { workspaceId: string; repo: string }) =>
  gitProviderFor(pr).getRepoToken(pr.workspaceId, pr.repo, 'pullRequestWrite')

/**
 * `attempt`, again after each of `RETRY_DELAYS_MS` while it fails
 * transiently and `mayWait(ms)` allows the wait. The last error is thrown.
 */
async function withRetry<T>(
  attempt: () => Promise<T>,
  sleep: Sleep,
  mayWait: (ms: number) => boolean = () => true
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt()
    } catch (error) {
      const wait = RETRY_DELAYS_MS[i]
      if (
        wait === undefined ||
        !isTransientGithubFailure(error) ||
        !mayWait(wait)
      )
        throw error
      await sleep(wait)
    }
  }
}

export const requestChangesOffService = {
  /**
   * The lazy path: a review sync of `pr` with the mode off. `token` is the
   * sync's own pull-request-write token when it has one. Never throws.
   */
  async withdrawOnPullRequest(
    pr: WithdrawPr,
    token?: string,
    sleep: Sleep = realSleep
  ): Promise<number> {
    try {
      const n = await withRetry(
        async () => withdraw(pr, token ?? (await tokenFor(pr))),
        sleep
      )
      if (n > 0)
        logger.info(
          `[request-changes-off] dismissed ${n} change request(s) pr=#${pr.number}`
        )
      return n
    } catch (error) {
      logger.warn(
        `[request-changes-off] withdraw failed pr=#${pr.number}: ${describeGithubFailure(error)}`
      )
      return 0
    }
  },

  /**
   * The bulk path, after the switch went on → off. Re-reads the switch first
   * (turned back on meanwhile ⇒ nothing). Never throws.
   */
  async withdrawAcrossWorkspace(
    workspaceId: string,
    now: () => number = Date.now,
    sleep: Sleep = realSleep
  ): Promise<BulkWithdrawResult> {
    const result: BulkWithdrawResult = {
      checked: 0,
      dismissed: 0,
      stopped: null,
    }
    try {
      const switches =
        await securityColumnsRepository.findSecuritySwitches(workspaceId)
      if (!switches || switches.securityRequestChangesEnabled) {
        result.stopped = 'mode_on'
        return result
      }
      const prs =
        await prSecurityScanRepository.findOpenPullRequestsOfWorkspace(
          workspaceId,
          BULK_MAX_PRS
        )
      const deadline = now() + BULK_TIME_BUDGET_MS
      // One mint per repository — but a failed mint is not kept, so the
      // retry and the repository's next PR mint afresh. LUM-1318: keyed by
      // platform too — the same `owner/repo` on two platforms is two mints.
      const tokens = new Map<string, Promise<string>>()
      const tokenOf = (pr: WithdrawPr): Promise<string> => {
        const key = `${gitProviderFor(pr).id}\u0000${pr.repo}`
        let token = tokens.get(key)
        if (!token) {
          token = tokenFor(pr)
          tokens.set(key, token)
          token.catch(() => {
            if (tokens.get(key) === token) tokens.delete(key)
          })
        }
        return token
      }
      for (const row of prs) {
        if (now() > deadline) {
          result.stopped = 'time_budget'
          break
        }
        const pr = { ...row, workspaceId }
        result.checked++
        try {
          result.dismissed += await withRetry(
            async () => withdraw(pr, await tokenOf(pr)),
            sleep,
            ms => now() + ms <= deadline
          )
        } catch (error) {
          if (isRateLimited(error)) {
            result.stopped = 'rate_limited'
            break
          }
          logger.warn(
            `[request-changes-off] withdraw failed pr=#${pr.number}: ${describeGithubFailure(error)}`
          )
        }
      }
    } catch (error) {
      logger.warn(
        `[request-changes-off] bulk pass failed workspace=${workspaceId}: ${describeGithubFailure(error)}`
      )
    }
    logger.info(
      `[request-changes-off] workspace=${workspaceId} checked=${result.checked} dismissed=${result.dismissed} stopped=${result.stopped ?? 'no'}`
    )
    return result
  },
}
