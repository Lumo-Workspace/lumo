/**
 * LUM-1130 — the request-changes / approve workflow: with the workspace's mode on, Lumo's
 * review is "Changes requested" while any open Lumo review thread or
 * DONE-blocking finding remains, and Lumo approves once the latest head has
 * a complete review and nothing is open. Off by default — with the mode off
 * Lumo only ever posts COMMENT reviews.
 *
 * Approve requires ALL of:
 *   · the mode on;
 *   · the latest head reviewed by every enabled layer: the scan finished
 *     (CLEAN / FINDINGS), is not partial, and no layer is PAUSED, PENDING,
 *     PARTIAL, FAILED or SUPERSEDED (a layer the workspace turned off —
 *     DISABLED — or that does not apply — SKIPPED / NOT_CONFIGURED — is not
 *     enabled, so it does not hold approval back);
 *   · zero open Lumo threads;
 *   · zero DONE-blocking findings (`isBlockingFinding`) — a blocking finding
 *     whose thread a human resolved on GitHub still blocks (LUM-1128 ruling:
 *     resolving a conversation is not a disposition);
 *   · zero failed `error` pre-merge checks (LUM-1148) — unless the checks
 *     were overridden on the PR; an inconclusive check never counts;
 *   · every actionable finding already on the PR as a thread (none held for
 *     the verifier / the suggestion pass, none over the inline cap);
 *   · the head unchanged when the approval is submitted (`canSubmitApproval`).
 *
 * Pure and dependency-light: the decision is unit-tested on its own; the
 * GitHub side lives in `pr-review-verdict.service.ts`.
 */
import { isLumoActor } from '@/ee/security/services/pr-finding-thread.service'
import type { ListedReview } from '@/lib/integrations/github/pr-comment-client'
import type { ScanStatus } from '@/ee/security/repositories/pr-security-scan.repository'
import type {
  ScanStageState,
  ScanStages,
} from '@/ee/security/security-scan/types'

export type { ListedReview }

/** Lumo's standing verdict on the PR, as GitHub shows it. */
export type LumoVerdictState = 'APPROVED' | 'CHANGES_REQUESTED' | null

export interface StandingReview {
  state: LumoVerdictState
  /** The commit the standing verdict was given on. */
  commitId: string | null
}

export interface VerdictScan {
  status: ScanStatus
  partial: boolean
  stages: ScanStages | null
}

export interface VerdictInput {
  /** The workspace's request-changes mode. */
  enabled: boolean
  headSha: string
  scan: VerdictScan
  /** Lumo threads still open on the PR after this sync. */
  openThreads: number
  /** Open findings that block DONE (resolved-on-GitHub ones included). */
  blocking: number
  /** Actionable findings with no thread on the PR yet (held, over the cap, failed post). */
  unpostedActionable: number
  /**
   * LUM-1148 — failed `error` pre-merge checks still holding approval back
   * (`blockingCheckCount`: 0 once overridden). Absent = 0.
   */
  failingChecks?: number
  standing: StandingReview
}

export type Verdict =
  | { kind: 'APPROVE' }
  | { kind: 'REQUEST_CHANGES' }
  | { kind: 'NONE'; reason: string }

/** Layer states that mean an enabled layer has not reviewed this head whole. */
const NOT_REVIEWED: ReadonlySet<ScanStageState> = new Set([
  'PAUSED',
  'PENDING',
  'PARTIAL',
  'FAILED',
  'SUPERSEDED',
])

/** Did every enabled layer review this head, whole? */
export function isReviewComplete(scan: VerdictScan): boolean {
  if (scan.status !== 'CLEAN' && scan.status !== 'FINDINGS') return false
  if (scan.partial) return false
  if (!scan.stages) return false
  return !Object.values(scan.stages).some(s => s && NOT_REVIEWED.has(s))
}

export function decideReviewVerdict(input: VerdictInput): Verdict {
  if (!input.enabled) return { kind: 'NONE', reason: 'mode off' }

  if (
    input.openThreads > 0 ||
    input.blocking > 0 ||
    (input.failingChecks ?? 0) > 0
  ) {
    // One "Changes requested" stands until Lumo approves — no repeat review
    // on every sync (new inline comments carry their own).
    if (input.standing.state === 'CHANGES_REQUESTED')
      return { kind: 'NONE', reason: 'changes already requested' }
    return { kind: 'REQUEST_CHANGES' }
  }
  if (input.unpostedActionable > 0)
    return { kind: 'NONE', reason: 'findings not yet on the PR' }
  if (!isReviewComplete(input.scan))
    return { kind: 'NONE', reason: 'review incomplete' }
  if (
    input.standing.state === 'APPROVED' &&
    input.standing.commitId === input.headSha
  )
    return { kind: 'NONE', reason: 'already approved' }
  return { kind: 'APPROVE' }
}

/**
 * The last guard before submitting an approval: the PR's live head, re-read
 * from GitHub right before the submit, is still the head that was reviewed
 * (and the PR still open). A head that cannot be read means no approval.
 */
export function canSubmitApproval(
  reviewedSha: string,
  live: { sha: string; state: string } | null
): boolean {
  return !!live && live.state === 'open' && live.sha === reviewedSha
}

/**
 * Lumo's standing verdict (its last APPROVED / CHANGES_REQUESTED review —
 * comments and dismissed reviews do not count), plus every Lumo
 * CHANGES_REQUESTED review not yet dismissed — what an approval dismisses so
 * GitHub stops showing "changes requested". `reviews` in GitHub's order
 * (oldest first).
 */
export function standingLumoReview(
  reviews: ListedReview[]
): StandingReview & { changesRequestedIds: number[] } {
  const mine = reviews.filter(r => isLumoActor(r.user))
  const verdicts = mine.filter(
    r => r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED'
  )
  const last = verdicts[verdicts.length - 1]
  return {
    state: (last?.state as LumoVerdictState | undefined) ?? null,
    commitId: last?.commit_id ?? null,
    changesRequestedIds: mine
      .filter(r => r.state === 'CHANGES_REQUESTED')
      .map(r => r.id),
  }
}
