/**
 * LUM-1130 — the GitHub side of the request-changes / approve workflow
 * (decision: `pr-review-verdict.ts`). Two entry points:
 *
 *   · `apply` — after each PR write-back with the mode on: read Lumo's
 *     standing review, decide, then request changes or approve. An approval
 *     re-reads the PR's head right before submitting and gives up if it
 *     moved; after approving it dismisses Lumo's earlier "changes requested"
 *     reviews so GitHub stops showing them (`approveAndDismiss` — shared by
 *     both approval paths, and confirmed from a fresh review listing).
 *   · `approveByCommand` — `@<app> approve` (the caller has already checked
 *     the asker, the mode and the blocking findings).
 *   · `withdrawChangeRequests` — LUM-1140: the mode is off, so Lumo's
 *     standing "changes requested" reviews are dismissed (never approves).
 *
 * Best effort: `apply` never throws (a failed verdict must not fail a scan's
 * write-back); the next sync decides again.
 *
 * Layering: service — the PR's Git platform through the `GitProvider` port
 * (LUM-1318) only.
 */
import { logger } from '@/lib/logger'
import {
  gitProviderFor,
  gitProviderRefOf,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'
import type { GitApiError, ListedReview } from '@/lib/integrations/git-provider'
import {
  canSubmitApproval,
  changeRequestsSupersededBy,
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
  failingChecks?: number
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
  const checks = input.failingChecks ?? 0
  // LUM-1148: failed `error` pre-merge checks.
  if (checks > 0)
    parts.push(
      plural(checks, 'failed pre-merge check', 'failed pre-merge checks')
    )
  return [
    `🛡️ Lumo requests changes — ${parts.join(' · ')}.`,
    '',
    "Lumo approves once its latest complete review leaves nothing open: push a fix or resolve the threads; findings that block DONE are cleared only by a disposition in Lumo (`lumo finding disposition` or the PR's security panel).",
    ...(checks > 0
      ? [
          '',
          'Failed `error` pre-merge checks clear when they pass on a later push or edit, or when a reviewer overrides them on this PR — an override never clears a finding.',
        ]
      : []),
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

export interface VerdictSyncInput extends GitProviderRef {
  repo: Repo
  prNumber: number
  /** Installation token with `pull_requests: write`. */
  token: string
  headSha: string
  scan: VerdictScan
  openThreads: number
  blocking: number
  unpostedActionable: number
  /** LUM-1148: failed `error` pre-merge checks not overridden (absent = 0). */
  failingChecks?: number
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

/**
 * GitHub said slow down (primary or secondary rate limit): a
 * platform API error (`GitApiError`) carrying the moment the limit lifts.
 */
export function isRateLimited(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as Partial<GitApiError>).rateLimitResetAt instanceof Date
  )
}

/**
 * LUM-1140 — one line for a failed GitHub call, for the logs: the HTTP status
 * (`none` when the request never got a response), the error's own message
 * (GitHub's `message` for an API error) and the chain of causes. Octokit (the
 * token mint) reports a network failure as `status=500` with its cause's
 * message, which for a refused or timed-out connection is EMPTY — the cause
 * chain (`AggregateError ETIMEDOUT`) is what says what happened. Nothing here
 * reads request headers, so no token reaches the log.
 */
export function describeGithubFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return `status=none non-error ${typeof error}: ${String(error) || '(empty)'}`
  }
  const status = (error as { status?: unknown }).status
  const parts = [
    `status=${typeof status === 'number' ? status : 'none'}`,
    `${error.name}: ${error.message || '(no message)'}`,
  ]
  let cause: unknown = (error as { cause?: unknown }).cause
  for (let depth = 0; cause && depth < 3; depth++) {
    if (cause instanceof Error) {
      const code = (cause as { code?: unknown }).code
      parts.push(
        `cause=${cause.name}${typeof code === 'string' ? ` ${code}` : ''}${
          cause.message ? `: ${cause.message}` : ''
        }`
      )
      cause = (cause as { cause?: unknown }).cause
    } else {
      parts.push(`cause=${String(cause)}`)
      break
    }
  }
  // GitHub's `errors` detail of a 422 — what `message` alone does not say.
  const detail = githubErrorsOf(error)
  if (detail) parts.push(`errors=${detail}`)
  return parts.join(' ').slice(0, 500)
}

/** GitHub's `errors` field of a failed response, as one line ('' if none). */
function githubErrorsOf(error: Error): string {
  const body = (error as { body?: unknown }).body
  if (!body || typeof body !== 'object') return ''
  const errors = (body as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return ''
  return errors
    .map(e =>
      typeof e === 'string'
        ? e
        : e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : JSON.stringify(e)
    )
    .join('; ')
}

/**
 * LUM-1140 — a failure worth one more try: the request never got an answer
 * (fetch's `TypeError`, or Octokit's network failure, which it reports as a
 * 500) or GitHub answered 5xx. A 4xx — refused, not found, not confirmed —
 * would fail the same way again; a rate limit has its own handling.
 */
export function isTransientGithubFailure(error: unknown): boolean {
  if (!(error instanceof Error) || isRateLimited(error)) return false
  const status = (error as { status?: unknown }).status
  if (typeof status === 'number') return status >= 500
  return error instanceof TypeError
}

/**
 * After the APPROVE submit: which change requests to dismiss, read from a
 * fresh listing (`changeRequestsSupersededBy`). GitHub can answer the submit
 * with an error yet record the approval (probe lumo-agent-test#61: a 422,
 * approval on the PR) — the listing, not the submit's answer, says whether
 * Lumo approved. Throws `submitError` when no approval landed.
 */
async function supersededChangeRequests(
  input: GitProviderRef & {
    repo: Repo
    prNumber: number
    token: string
    sha: string
    changesRequestedIds: number[]
    seenReviewIds: number[]
  },
  submitError: unknown
): Promise<number[]> {
  let reviews: ListedReview[]
  try {
    reviews = await gitProviderFor(input).comments.listReviews(input)
  } catch (error) {
    if (submitError !== null) throw submitError
    logger.warn(
      `[pr-review-verdict] re-list after approving failed pr=#${input.prNumber}: ${describeGithubFailure(error)}`
    )
    return input.changesRequestedIds
  }
  const ids = changeRequestsSupersededBy(
    reviews,
    input.sha,
    input.seenReviewIds
  )
  if (ids === null) {
    if (submitError !== null) throw submitError
    // Approved, but the listing does not show it yet: dismiss what stood.
    return input.changesRequestedIds
  }
  if (submitError !== null)
    logger.warn(
      `[pr-review-verdict] approval recorded despite a failed submit pr=#${input.prNumber} head=${short(input.sha)}: ${describeGithubFailure(submitError)}`
    )
  return ids
}

/**
 * Approve `sha`, then dismiss Lumo's earlier change requests — on every
 * approval path, also when GitHub answered the submit with an error but
 * recorded the approval.
 */
async function approveAndDismiss(
  input: GitProviderRef & {
    repo: Repo
    prNumber: number
    token: string
    sha: string
    body: string
    changesRequestedIds: number[]
    /** Every review listed before the submit (an earlier approval is not this one). */
    seenReviewIds: number[]
  }
): Promise<void> {
  let submitError: unknown = null
  try {
    await gitProviderFor(input).comments.submitReview({
      repo: input.repo,
      prNumber: input.prNumber,
      token: input.token,
      commitId: input.sha,
      body: input.body,
      event: 'APPROVE',
    })
  } catch (error) {
    if (isRateLimited(error)) throw error
    submitError = error
  }
  const toDismiss = await supersededChangeRequests(input, submitError)
  for (const reviewId of toDismiss) {
    try {
      await gitProviderFor(input).comments.dismissReview({
        repo: input.repo,
        prNumber: input.prNumber,
        reviewId,
        message: dismissMessage(input.sha),
        token: input.token,
      })
    } catch (error) {
      logger.warn(
        `[pr-review-verdict] dismiss failed pr=#${input.prNumber} review=${reviewId}: ${describeGithubFailure(error)}`
      )
    }
  }
}

export const prReviewVerdictService = {
  async apply(input: VerdictSyncInput): Promise<VerdictOutcome> {
    const where = `pr=#${input.prNumber} head=${short(input.headSha)}`
    try {
      const listed = await gitProviderFor(input).comments.listReviews({
        repo: input.repo,
        prNumber: input.prNumber,
        token: input.token,
      })
      const standing = standingLumoReview(listed)
      const verdict = decideReviewVerdict({
        enabled: true,
        headSha: input.headSha,
        scan: input.scan,
        openThreads: input.openThreads,
        blocking: input.blocking,
        unpostedActionable: input.unpostedActionable,
        failingChecks: input.failingChecks ?? 0,
        standing,
      })
      if (verdict.kind === 'NONE') return 'none'

      if (verdict.kind === 'REQUEST_CHANGES') {
        await gitProviderFor(input).comments.submitReview({
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
      const live = await gitProviderFor(input).comments.getPullRequestHead({
        repo: input.repo,
        prNumber: input.prNumber,
        token: input.token,
      })
      if (!canSubmitApproval(input.headSha, live)) {
        logger.info(`[pr-review-verdict] head moved — no approval ${where}`)
        return 'head_moved'
      }
      await approveAndDismiss({
        ...gitProviderRefOf(input),
        repo: input.repo,
        prNumber: input.prNumber,
        token: input.token,
        sha: input.headSha,
        body: buildApproveBody(input.headSha),
        changesRequestedIds: standing.changesRequestedIds,
        seenReviewIds: listed.map(r => r.id),
      })
      logger.info(`[pr-review-verdict] approved ${where}`)
      return 'approved'
    } catch (error) {
      logger.warn(
        `[pr-review-verdict] failed ${where}: ${describeGithubFailure(error)}`
      )
      return 'failed'
    }
  },

  /**
   * `@<app> approve` of `sha` — the head the caller checked. The head is
   * re-read right before the submit; a push in between means no approval.
   * Throws on a GitHub failure (the command path turns that into its own
   * outcome).
   */
  async approveByCommand(
    input: GitProviderRef & {
      repo: Repo
      prNumber: number
      token: string
      login: string
      sha: string
    }
  ): Promise<ApproveByCommandResult> {
    const listed = await gitProviderFor(input).comments.listReviews(input)
    const standing = standingLumoReview(listed)
    const live = await gitProviderFor(input).comments.getPullRequestHead(input)
    if (!canSubmitApproval(input.sha, live))
      return { ok: false, reason: 'head_moved' }
    await approveAndDismiss({
      ...gitProviderRefOf(input),
      repo: input.repo,
      prNumber: input.prNumber,
      token: input.token,
      sha: input.sha,
      body: buildApproveBody(input.sha, input.login),
      changesRequestedIds: standing.changesRequestedIds,
      seenReviewIds: listed.map(r => r.id),
    })
    return { ok: true, sha: input.sha }
  },

  /**
   * LUM-1140 — the request-changes workflow is off: dismiss every Lumo
   * "changes requested" review still standing on the PR (only reviews by
   * Lumo's App — `standingLumoReview`; a human's review is never touched,
   * and nothing is approved). Returns how many were dismissed. A listing
   * error or a rate limit throws (the caller decides); any other failed
   * dismissal is logged and the rest still go — and if one of those failed
   * transiently (`isTransientGithubFailure`), that error is thrown once the
   * rest are done, so the caller's retry re-lists and dismisses what is still
   * standing (an already-dismissed review is no longer CHANGES_REQUESTED).
   */
  async withdrawChangeRequests(
    input: GitProviderRef & {
      repo: Repo
      prNumber: number
      token: string
    }
  ): Promise<number> {
    const { changesRequestedIds } = standingLumoReview(
      await gitProviderFor(input).comments.listReviews(input)
    )
    let dismissed = 0
    let transient: unknown = null
    for (const reviewId of changesRequestedIds) {
      try {
        await gitProviderFor(input).comments.dismissReview({
          repo: input.repo,
          prNumber: input.prNumber,
          reviewId,
          message: WITHDRAW_MESSAGE,
          token: input.token,
        })
        dismissed++
      } catch (error) {
        if (isRateLimited(error)) throw error
        if (transient === null && isTransientGithubFailure(error))
          transient = error
        logger.warn(
          `[pr-review-verdict] withdraw failed pr=#${input.prNumber} review=${reviewId}: ${describeGithubFailure(error)}`
        )
      }
    }
    if (transient !== null) throw transient
    return dismissed
  },
}
