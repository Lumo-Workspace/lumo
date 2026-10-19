/**
 * LUM-1144 — what the AI review reads when a PR is over its size cap.
 *
 * Until now a diff over the review's top tier got NO AI review at all
 * (JUDGE_OVER_CAP). Now the reviewable files that fit are reviewed and the
 * rest are skipped, by name, on every surface; the whole review is skipped
 * only when more than a quarter of the reviewable files would be left out —
 * a review of a small corner of a large change reads as more than it is.
 *
 * Input is the diff AFTER the repository's path filters (lockfiles,
 * generated code and build output are already gone, so they never count
 * towards the cap), and after the incremental scope.
 *
 * The cap is two numbers: at most `JUDGE_MAX_REVIEWED_FILES` files and at
 * most the top tier's characters (`JUDGE_DIFF_BUDGET_TIERS`).
 *
 * Selection order (deterministic — the same diff always gives the same
 * selection):
 *   1. files with a security signal (the hunt trigger's sites),
 *   2. other source files,
 *   3. tests and fixtures,
 *   4. docs (`*.md`, `docs/`, …);
 * within a rank smaller sections first (more files reviewed for the same
 * budget, so fewer are dropped), then path order. Greedy with
 * skip-and-continue: one huge file does not starve the files behind it.
 *
 * PURE.
 */
import { splitDiffByFile } from './diff-lines'
import { isTestPath } from './review-context'

/** The most files one AI review reads (the user's 2026-09-25 ruling). */
export const JUDGE_MAX_REVIEWED_FILES = 150

/**
 * Over the cap, the AI review runs on the files that fit unless MORE than
 * this share of the reviewable files would be dropped; then it is skipped
 * whole (JUDGE_OVER_CAP) and the customer is told to narrow or split the PR.
 */
export const JUDGE_MAX_DROPPED_SHARE = 0.25

const DOC_PATH = /(^|\/)(docs?)\/|\.(md|mdx|markdown|rst|adoc|txt)$/i

/** 0 signal · 1 source · 2 test / fixture · 3 docs. Lower is reviewed first. */
export function partialReviewRank(
  path: string,
  priority: ReadonlySet<string>
): number {
  if (priority.has(path)) return 0
  if (isTestPath(path)) return 2
  if (DOC_PATH.test(path)) return 3
  return 1
}

export type PartialReviewPlan =
  /** Within the cap: review the diff as it is. */
  | { kind: 'WHOLE'; totalFiles: number }
  /** Over the cap, at most a quarter dropped: review `diff`, skip the rest. */
  | {
      kind: 'PARTIAL'
      /** The selected sections, in diff order. */
      diff: string
      /** Files reviewed, in diff order. */
      reviewed: string[]
      /** Files not reviewed, in diff order. */
      skipped: string[]
      totalFiles: number
    }
  /** Over the cap and more than a quarter would be dropped: no AI review. */
  | {
      kind: 'OVER_CAP'
      reviewed: string[]
      skipped: string[]
      totalFiles: number
    }

export function planPartialReview(
  diff: string,
  opts: {
    readonly maxChars: number
    readonly maxFiles?: number
    readonly maxDroppedShare?: number
    readonly priorityPaths?: readonly string[]
  }
): PartialReviewPlan {
  const maxFiles = opts.maxFiles ?? JUDGE_MAX_REVIEWED_FILES
  const maxDropped = opts.maxDroppedShare ?? JUDGE_MAX_DROPPED_SHARE
  const sections = splitDiffByFile(diff)
  const named = sections
    .map((s, i) => ({ ...s, i }))
    .filter(
      (s): s is { path: string; text: string; i: number } => s.path !== null
    )
  const totalFiles = named.length
  if (diff.length <= opts.maxChars && totalFiles <= maxFiles)
    return { kind: 'WHOLE', totalFiles }

  const priority = new Set(opts.priorityPaths ?? [])
  const order = [...named].sort(
    (a, b) =>
      partialReviewRank(a.path, priority) -
        partialReviewRank(b.path, priority) ||
      a.text.length - b.text.length ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : a.i - b.i)
  )
  const taken = new Set<number>()
  let used = 0
  for (const s of order) {
    if (taken.size >= maxFiles) break
    const cost = s.text.length + 1
    if (used + cost > opts.maxChars) continue
    used += cost
    taken.add(s.i)
  }
  // Sections no file owns (a deletion, text before the first header) ride
  // along when they still fit: never counted as files, never required.
  sections.forEach((s, i) => {
    if (s.path !== null) return
    const cost = s.text.length + 1
    if (used + cost > opts.maxChars) return
    used += cost
    taken.add(i)
  })

  const reviewed = named.filter(s => taken.has(s.i)).map(s => s.path)
  const skipped = named.filter(s => !taken.has(s.i)).map(s => s.path)
  if (reviewed.length === 0 || skipped.length > totalFiles * maxDropped)
    return { kind: 'OVER_CAP', reviewed, skipped, totalFiles }
  return {
    kind: 'PARTIAL',
    diff: sections
      .filter((_, i) => taken.has(i))
      .map(s => s.text)
      .join('\n'),
    reviewed,
    skipped,
    totalFiles,
  }
}
