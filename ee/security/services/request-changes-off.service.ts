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
 * Best effort: neither entry point throws.
 *
 * Layering: service — DB through repositories, GitHub through
 * `pr-review-verdict.service` / `@/lib/integrations/github/*`.
 */
import { logger } from '@/lib/logger'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import {
  isRateLimited,
  prReviewVerdictService,
} from '@/ee/security/services/pr-review-verdict.service'

/** Most open PRs one bulk pass visits (the rest: at their next review). */
export const BULK_MAX_PRS = 50
/** Wall-clock budget of one bulk pass (it runs after the response). */
export const BULK_TIME_BUDGET_MS = 20_000

export interface WithdrawPr {
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    repo,
    prNumber: pr.number,
    token,
  })
}

const tokenFor = (workspaceId: string, repo: string) =>
  getRepoToken(workspaceId, repo, REPO_TOKEN_PERMISSIONS.pullRequestWrite)

export const requestChangesOffService = {
  /**
   * The lazy path: a review sync of `pr` with the mode off. `token` is the
   * sync's own pull-request-write token when it has one. Never throws.
   */
  async withdrawOnPullRequest(pr: WithdrawPr, token?: string): Promise<number> {
    try {
      const n = await withdraw(
        pr,
        token ?? (await tokenFor(pr.workspaceId, pr.repo))
      )
      if (n > 0)
        logger.info(
          `[request-changes-off] dismissed ${n} change request(s) pr=#${pr.number}`
        )
      return n
    } catch (error) {
      logger.warn(
        `[request-changes-off] withdraw failed pr=#${pr.number}: ${describe(error)}`
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
    now: () => number = Date.now
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
      const tokens = new Map<string, Promise<string>>()
      for (const row of prs) {
        if (now() > deadline) {
          result.stopped = 'time_budget'
          break
        }
        const pr = { ...row, workspaceId }
        result.checked++
        try {
          let token = tokens.get(pr.repo)
          if (!token) {
            token = tokenFor(workspaceId, pr.repo)
            tokens.set(pr.repo, token)
          }
          result.dismissed += await withdraw(pr, await token)
        } catch (error) {
          if (isRateLimited(error)) {
            result.stopped = 'rate_limited'
            break
          }
          logger.warn(
            `[request-changes-off] withdraw failed pr=#${pr.number}: ${describe(error)}`
          )
        }
      }
    } catch (error) {
      logger.warn(
        `[request-changes-off] bulk pass failed workspace=${workspaceId}: ${describe(error)}`
      )
    }
    logger.info(
      `[request-changes-off] workspace=${workspaceId} checked=${result.checked} dismissed=${result.dismissed} stopped=${result.stopped ?? 'no'}`
    )
    return result
  },
}
