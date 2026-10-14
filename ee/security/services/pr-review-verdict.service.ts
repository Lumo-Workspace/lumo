/**
 * LUM-1130 — the GitHub side of the request-changes / approve workflow
 * (decision: `pr-review-verdict.ts`). Two entry points:
 *
 *   · `apply` — after each PR write-back with the mode on: read Lumo's
 *     standing review, decide, then request changes or approve. An approval
 *     re-reads the PR's head right before submitting and gives up if it
 *     moved; after approving it dismisses Lumo's earlier "changes requested"
 *     reviews so GitHub stops showing them.
 *   · `approveByCommand` — `@<app> approve` (the caller has already checked
 *     the asker, the mode and the blocking findings).
 *   · `withdrawChangeRequests` — LUM-1140: the mode is off, so Lumo's
 *     standing "changes requested" reviews are dismissed (never approves).
 *
 * Best effort: `apply` never throws (a failed verdict must not fail a scan's
 * write-back); the next sync decides again.
 *
 * Layering: service — GitHub through `@/lib/integrations/github/*` only.
 */
import { logger } from '@/lib/logger'
import {
  prCommentClient,
  type GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import {
  canSubmitApproval,
  decideReviewVerdict,
  standingLumoReview,
  type VerdictScan,
} from '@/ee/security/services/pr-review-verdict'

interface Repo {
  owner: string
  name: string
}

/** Hidden marker on Lumo's verdict reviews. */
export const VERDICT_MARKER = '<!-- lumo-security:verdict -->'

const short = (sha: string): string => sha.slice(0, 7)

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function buildRequestChangesBody(input: {
  openThreads: number
  blocking: number
}): string {
  const parts: string[] = []
  if (input.openThreads > 0)
    parts.push(
      plural(input.openThreads, 'open review thread', 'open review threads')
    )
  if (input.blocking > 0)
    parts.push(
      plural(
        input.blocking,
        'finding that blocks DONE',
        'findings that block DONE'
      )
    )
  return [
    `🛡️ Lumo requests changes — ${parts.join(' · ')}.`,
    '',
    "Lumo approves once its latest complete review leaves nothing open: push a fix or resolve the threads; findings that block DONE are cleared only by a disposition in Lumo (`lumo finding disposition` or the PR's security panel).",
    '',
    VERDICT_MARKER,
  ].join('\n')
}

export function buildApproveBody(headSha: string, login?: string): string {
  const lead = login
    ? `✅ Lumo approves \`${short(headSha)}\` at the request of @${login} — no finding that blocks DONE is open.`
    : `✅ Lumo approves \`${short(headSha)}\` — its complete review of this commit leaves no open threads and no findings that block DONE.`
  return `${lead}\n\n${VERDICT_MARKER}`
}

export function dismissMessage(headSha: string): string {
  return `Superseded by Lumo's approval of ${short(headSha)}.`
}

/** LUM-1140 — why a change request is withdrawn with the mode off. */
export const WITHDRAW_MESSAGE =
  "Lumo's request-changes workflow is turned off for this workspace — this change request no longer applies."

export interface VerdictSyncInput {
  repo: Repo
  prNumber: number
  /** Installation token with `pull_requests: write`. */
  token: string
  headSha: string
  scan: VerdictScan
  openThreads: number
  blocking: number
  unpostedActionable: number
}

export type VerdictOutcome =
  | 'approved'
  | 'changes_requested'
  | 'none'
  | 'head_moved'
  | 'failed'

export type ApproveByCommandResult =
  | { ok: true; sha: string }
  | { ok: false; reason: 'head_moved' }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * GitHub said slow down (primary or secondary rate limit): a
 * `GithubApiError` carrying the moment the limit lifts.
 */
export function isRateLimited(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as Partial<GithubApiError>).rateLimitResetAt instanceof Date
  )
}

/** Approve `sha`, then dismiss Lumo's earlier change requests. */
async function approveAndDismiss(input: {
  repo: Repo
  prNumber: number
  token: string
  sha: string
  body: string
  changesRequestedIds: number[]
}): Promise<void> {
  await prCommentClient.submitReview({
    repo: input.repo,
    prNumber: input.prNumber,
    token: input.token,
    commitId: input.sha,
    body: input.body,
    event: 'APPROVE',
  })
  for (const reviewId of input.changesRequestedIds) {
    try {
      await prCommentClient.dismissReview({
        repo: input.repo,
        prNumber: input.prNumber,
        reviewId,
        message: dismissMessage(input.sha),
        token: input.token,
      })
    } catch (error) {
      logger.warn(
        `[pr-review-verdict] dismiss failed pr=#${input.prNumber} review=${reviewId}: ${describe(error)}`
      )
    }
  }
}

export const prReviewVerdictService = {
  async apply(input: VerdictSyncInput): Promise<VerdictOutcome> {
    const where = `pr=#${input.prNumber} head=${short(input.headSha)}`
    try {
      const standing = standingLumoReview(
        await prCommentClient.listReviews({
          repo: input.repo,
          prNumber: input.prNumber,
          token: input.token,
        })
      )
      const verdict = decideReviewVerdict({
        enabled: true,
        headSha: input.headSha,
        scan: input.scan,
        openThreads: input.openThreads,
        blocking: input.blocking,
        unpostedActionable: input.unpostedActionable,
        standing,
      })
      if (verdict.kind === 'NONE') return 'none'

      if (verdict.kind === 'REQUEST_CHANGES') {
        await prCommentClient.submitReview({
          repo: input.repo,
          prNumber: input.prNumber,
          token: input.token,
          commitId: input.headSha,
          body: buildRequestChangesBody(input),
          event: 'REQUEST_CHANGES',
        })
        logger.info(`[pr-review-verdict] changes requested ${where}`)
        return 'changes_requested'
      }

      // APPROVE — the head must not have moved since this review.
      const live = await prCommentClient.getPullRequestHead({
        repo: input.repo,
        prNumber: input.prNumber,
        token: input.token,
      })
      if (!canSubmitApproval(input.headSha, live)) {
        logger.info(`[pr-review-verdict] head moved — no approval ${where}`)
        return 'head_moved'
      }
      await approveAndDismiss({
        repo: input.repo,
        prNumber: input.prNumber,
        token: input.token,
        sha: input.headSha,
        body: buildApproveBody(input.headSha),
        changesRequestedIds: standing.changesRequestedIds,
      })
      logger.info(`[pr-review-verdict] approved ${where}`)
      return 'approved'
    } catch (error) {
      logger.warn(`[pr-review-verdict] failed ${where}: ${describe(error)}`)
      return 'failed'
    }
  },

  /**
   * `@<app> approve` of `sha` — the head the caller checked. The head is
   * re-read right before the submit; a push in between means no approval.
   * Throws on a GitHub failure (the command path turns that into its own
   * outcome).
   */
  async approveByCommand(input: {
    repo: Repo
    prNumber: number
    token: string
    login: string
    sha: string
  }): Promise<ApproveByCommandResult> {
    const standing = standingLumoReview(
      await prCommentClient.listReviews(input)
    )
    const live = await prCommentClient.getPullRequestHead(input)
    if (!canSubmitApproval(input.sha, live))
      return { ok: false, reason: 'head_moved' }
    await approveAndDismiss({
      repo: input.repo,
      prNumber: input.prNumber,
      token: input.token,
      sha: input.sha,
      body: buildApproveBody(input.sha, input.login),
      changesRequestedIds: standing.changesRequestedIds,
    })
    return { ok: true, sha: input.sha }
  },

  /**
   * LUM-1140 — the request-changes workflow is off: dismiss every Lumo
   * "changes requested" review still standing on the PR (only reviews by
   * Lumo's App — `standingLumoReview`; a human's review is never touched,
   * and nothing is approved). Returns how many were dismissed. A listing
   * error or a rate limit throws (the caller decides); any other failed
   * dismissal is logged and the rest still go.
   */
  async withdrawChangeRequests(input: {
    repo: Repo
    prNumber: number
    token: string
  }): Promise<number> {
    const { changesRequestedIds } = standingLumoReview(
      await prCommentClient.listReviews(input)
    )
    let dismissed = 0
    for (const reviewId of changesRequestedIds) {
      try {
        await prCommentClient.dismissReview({
          repo: input.repo,
          prNumber: input.prNumber,
          reviewId,
          message: WITHDRAW_MESSAGE,
          token: input.token,
        })
        dismissed++
      } catch (error) {
        if (isRateLimited(error)) throw error
        logger.warn(
          `[pr-review-verdict] withdraw failed pr=#${input.prNumber} review=${reviewId}: ${describe(error)}`
        )
      }
    }
    return dismissed
  },
}
