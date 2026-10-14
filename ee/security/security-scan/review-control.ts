/**
 * LUM-1056 / LUM-1137 — the automatic-review budget of one PR, CodeRabbit's
 * `auto_incremental_review` + `auto_pause_after_reviewed_commits`: every push
 * is reviewed until N commits have been reviewed (default 5; 0 = never
 * pause). A head is reserved once; its retries cost nothing. Failed attempts
 * keep their reservation; a superseded head is released (the next head's
 * commits then include its commits). Resume resets the budget. Manual
 * reviews neither consume nor reset it.
 *
 * "Reviewed commits" are the commits each admitted head added to the PR:
 * the first head counts every commit on the PR, a later head the commits
 * since the previous admitted head (at least one — a force-push that shrank
 * the PR still reviewed a new head). A head whose commit count is unknown
 * (stored as 0, or admitted before LUM-1137) counts as one commit.
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

/** The commits the head at `index` added (see the module comment). */
function commitsAddedAt(commits: readonly number[], index: number): number {
  const at = commits[index] ?? 0
  if (at <= 0) return 1
  if (index === 0) return at
  const before = commits[index - 1] ?? 0
  if (before <= 0) return 1
  return Math.max(1, at - before)
}

/** How many commits the admitted heads of this PR reviewed. */
export function reviewedCommits(
  control: Pick<ReviewControl, 'reviewHeads' | 'reviewHeadCommits'>
): number {
  let total = 0
  for (let i = 0; i < control.reviewHeads.length; i++)
    total += commitsAddedAt(control.reviewHeadCommits, i)
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
