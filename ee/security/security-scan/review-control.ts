/**
 * LUM-1056 / LUM-1137 — the automatic-review budget of one PR
 * (incremental review of every push, auto-paused after N reviewed commits): every push
 * is reviewed until N commits have been reviewed (default 5; 0 = never
 * pause). A head is reserved once; its retries cost nothing. Failed attempts
 * keep their reservation; a superseded head is released (a later next head
 * then counts its commits; if it was the first review, the next head becomes
 * the first and counts one). Resume resets the budget to a baseline at the
 * PR's current commit count. Manual reviews neither consume nor reset it.
 *
 * "Reviewed commits" are the commits each admitted head added to the PR:
 * the first automatic review counts one commit (not every commit already on
 * the PR — a PR opened with N or more commits still gets N reviews), a later
 * head the commits since the previous admitted head (at least one — a
 * force-push that shrank the PR still reviewed a new head). A head whose
 * commit count is unknown (stored as 0, or admitted before LUM-1137) counts
 * as one commit.
 *
 * Resume records the PR's commit count at that moment as a baseline entry
 * (`RESUME_BASELINE_HEAD`, never a commit SHA) at the front of the arrays: it
 * counts nothing, and the next head is charged only for the commits added
 * since the resume. Without a known count there is no baseline and the next
 * head is the first (one commit).
 *
 * PURE.
 */
export const DEFAULT_AUTO_PAUSE_AFTER = 5
/** The highest pause-after value a workspace or a PR may set. */
export const AUTO_PAUSE_AFTER_MAX = 100

export interface ReviewControl {
  reviewPaused: boolean
  reviewHeads: string[]
  /** The PR's commit count at each admitted head (0 = unknown). */
  reviewHeadCommits: number[]
  /** This PR's own limit (`--resume --limit`); null = the workspace's. */
  reviewCommitLimit: number | null
}

/** The `reviewHeads` entry resume stores with the PR's commit count at
 *  resume time (see the module comment). Not a SHA, so no head matches it. */
export const RESUME_BASELINE_HEAD = 'resume-baseline'

/** The arrays resume stores: a baseline at `commitsAtResume` when known. */
export function resumedHeads(
  commitsAtResume: number | null
): Pick<ReviewControl, 'reviewHeads' | 'reviewHeadCommits'> {
  return commitsAtResume !== null && commitsAtResume > 0
    ? {
        reviewHeads: [RESUME_BASELINE_HEAD],
        reviewHeadCommits: [commitsAtResume],
      }
    : { reviewHeads: [], reviewHeadCommits: [] }
}

/** The commits the head at `index` added (see the module comment). */
function commitsAddedAt(
  control: Pick<ReviewControl, 'reviewHeads' | 'reviewHeadCommits'>,
  index: number
): number {
  if (control.reviewHeads[index] === RESUME_BASELINE_HEAD) return 0
  const at = control.reviewHeadCommits[index] ?? 0
  // The first automatic review counts one commit, however many the PR has.
  if (at <= 0 || index === 0) return 1
  const before = control.reviewHeadCommits[index - 1] ?? 0
  if (before <= 0) return 1
  return Math.max(1, at - before)
}

/** How many commits the admitted heads of this PR reviewed. */
export function reviewedCommits(
  control: Pick<ReviewControl, 'reviewHeads' | 'reviewHeadCommits'>
): number {
  let total = 0
  for (let i = 0; i < control.reviewHeads.length; i++)
    total += commitsAddedAt(control, i)
  return total
}

/** The PR's own limit, else the workspace's pause-after (0 = never). */
export function effectiveCommitLimit(
  control: Pick<ReviewControl, 'reviewCommitLimit'>,
  workspaceLimit: number
): number {
  return control.reviewCommitLimit ?? workspaceLimit
}

export function admitAutomaticReview(
  control: ReviewControl,
  head: string,
  workspaceLimit: number
) {
  if (control.reviewPaused) return { allowed: false, reserve: false }
  if (control.reviewHeads.includes(head))
    return { allowed: true, reserve: false }
  const limit = effectiveCommitLimit(control, workspaceLimit)
  if (limit > 0 && reviewedCommits(control) >= limit)
    return { allowed: false, reserve: false }
  return { allowed: true, reserve: true }
}

/** `reviewHeadCommits` after admitting one more head: padded with 0
 *  (unknown) for heads admitted before the column existed, so the arrays
 *  stay aligned. */
export function commitsAfterReserve(
  control: Pick<ReviewControl, 'reviewHeads' | 'reviewHeadCommits'>,
  commitsAtHead: number | null
): number[] {
  const aligned = control.reviewHeads.map(
    (_, i) => control.reviewHeadCommits[i] ?? 0
  )
  return [...aligned, commitsAtHead ?? 0]
}

/** The arrays without `head` (a superseded head's reservation). */
export function withoutHead(
  control: Pick<ReviewControl, 'reviewHeads' | 'reviewHeadCommits'>,
  head: string
): Pick<ReviewControl, 'reviewHeads' | 'reviewHeadCommits'> {
  const keep = control.reviewHeads
    .map((h, i) => ({ h, c: control.reviewHeadCommits[i] ?? 0 }))
    .filter(e => e.h !== head)
  return {
    reviewHeads: keep.map(e => e.h),
    reviewHeadCommits: keep.map(e => e.c),
  }
}

/** What the scan panel, `lumo pr scan` and the CLI read about the budget.
 *  `rounds` keeps its LUM-1056 name; it now counts reviewed commits. */
export interface ReviewBudgetView {
  paused: boolean
  rounds: number
  /** 0 = never pauses. */
  limit: number
  unit: 'commits'
}

export function reviewBudgetView(
  control: ReviewControl,
  workspaceLimit: number
): ReviewBudgetView {
  const rounds = reviewedCommits(control)
  const limit = effectiveCommitLimit(control, workspaceLimit)
  return {
    paused: control.reviewPaused || (limit > 0 && rounds >= limit),
    rounds,
    limit,
    unit: 'commits',
  }
}

/** A stored pause-after; anything out of range reads as the default. */
export function parseAutoPauseAfter(value: unknown): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= AUTO_PAUSE_AFTER_MAX
    ? value
    : DEFAULT_AUTO_PAUSE_AFTER
}

/** Include whole PR-diff sections for affected files, with PR-head line
 * numbers. A compare diff alone would lose context and misplace comments.
 */
export function affectedReviewDiff(
  diff: string,
  paths: readonly string[]
): string {
  const affected = new Set(paths)
  const sections = diff.split(/(?=^diff --git )/m)
  // Quoted/nonstandard headers cannot prove exclusion. Fall back to full.
  if (sections.some(section => /^\+\+\+ (?!b\/|\/dev\/null)/m.test(section)))
    return diff
  return sections
    .filter(section => {
      const path = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1]
      return path !== undefined && affected.has(path)
    })
    .join('')
}

/** What `isSettledForManualReview` reads off a scan row. */
export interface ManualReviewRestartRow {
  status: string
  stages: unknown
  verifierStartedAt: Date | null
  verifiedAt: Date | null
}

/**
 * LUM-1152 follow-up — may a manual review restart this head's scan in place
 * now? Only once the scan has settled: a finished status, no layer still
 * PENDING (the managed scanners, the hunt) and no verifier running. A manual
 * review asked for earlier is deferred until then, not dropped
 * (`security-deferred-review`). PURE.
 */
export function isSettledForManualReview(
  row: ManualReviewRestartRow | null
): boolean {
  if (!row) return false
  if (!['CLEAN', 'FINDINGS', 'FAILED'].includes(row.status)) return false
  const stages =
    row.stages && typeof row.stages === 'object'
      ? Object.values(row.stages as Record<string, unknown>)
      : []
  if (stages.includes('PENDING')) return false
  return !(row.verifierStartedAt && !row.verifiedAt)
}

/**
 * LUM-1152 follow-up — what a deferred manual review does with the scan it
 * waited on: keep waiting, dispatch (the scan's AI review was held — ignore,
 * pause, hourly cap — or the scan is gone / FAILED), or nothing (the scan's
 * own AI review ran, which is the review asked for: a repeated request while
 * one is running deduplicates). PURE.
 */
export type DeferredReviewDecision = 'wait' | 'dispatch' | 'covered'

export function deferredReviewDecision(
  row: ManualReviewRestartRow | null
): DeferredReviewDecision {
  if (!row) return 'dispatch'
  if (!isSettledForManualReview(row)) return 'wait'
  if (row.status === 'FAILED') return 'dispatch'
  const judge =
    row.stages && typeof row.stages === 'object'
      ? (row.stages as Record<string, unknown>).judge
      : undefined
  return judge === undefined || judge === 'PAUSED' ? 'dispatch' : 'covered'
}
