/**
 * What stage A hands the AI review for one PR diff, in production's order
 * (`ee/security/services/pr-security-scan.service.ts`), for a full review of
 * a repository with default settings (no path filters, diagrams on):
 *
 *   1. the default path filters (LUM-1143/1144: lockfiles, generated code,
 *      build output never reach the review);
 *   2. the size cap's plan (`planPartialReview`, LUM-1144): within the cap the
 *      whole reviewable diff, over it the files that fit — unless more than a
 *      quarter would be dropped, then no review at all;
 *   3. whether the review is also asked for the call-flow diagram (LUM-1155:
 *      `sequenceDiagramEligible` over the whole reviewable diff), which
 *      switches the review to the schema with the diagram field.
 *
 * `priorityPaths` is empty: production ranks the hunt trigger's sites first,
 * which only matters when a diff is over the cap. PURE.
 */
import { splitDiffByFile } from '@/ee/security/security-scan/diff-lines'
import { planPartialReview } from '@/ee/security/security-scan/partial-review'
import {
  filterReviewableDiff,
  reviewablePathPredicate,
} from '@/ee/security/security-scan/reviewable-path'
import { sequenceDiagramEligible } from '@/ee/security/security-scan/sequence-diagram'
import { JUDGE_DIFF_BUDGET_TIERS } from '@/ee/security/security-scan/truncate'
import { diffFileStats } from '@/ee/security/services/pr-whole-summary.service'

export type ReplayReviewInput =
  | { kind: 'OVER_CAP'; totalFiles: number; skipped: string[] }
  | {
      kind: 'WHOLE' | 'PARTIAL'
      /** The diff the review's tier / packing starts from. */
      judgeDiff: string
      /** Files the default path filters removed, in diff order. */
      excluded: string[]
      /** Files the size cap skipped (PARTIAL only), in diff order. */
      skipped: string[]
      /** Ask for the sequence diagram (the schema with the diagram field). */
      withSequenceDiagram: boolean
      /** Every path the PR changes — never re-sent as server config. */
      changedPaths: string[]
    }

export function replayReviewInput(diff: string): ReplayReviewInput {
  const isReviewable = reviewablePathPredicate([])
  const reviewable = filterReviewableDiff(diff, isReviewable)
  const plan = planPartialReview(reviewable.diff, {
    maxChars:
      JUDGE_DIFF_BUDGET_TIERS[JUDGE_DIFF_BUDGET_TIERS.length - 1]!.chars,
    priorityPaths: [],
  })
  if (plan.kind === 'OVER_CAP')
    return {
      kind: 'OVER_CAP',
      totalFiles: plan.totalFiles,
      skipped: plan.skipped,
    }
  return {
    kind: plan.kind,
    judgeDiff: plan.kind === 'PARTIAL' ? plan.diff : reviewable.diff,
    excluded: reviewable.excluded,
    skipped: plan.kind === 'PARTIAL' ? plan.skipped : [],
    withSequenceDiagram: sequenceDiagramEligible(
      diffFileStats(reviewable.diff)
    ),
    changedPaths: splitDiffByFile(diff)
      .map(s => s.path)
      .filter((p): p is string => p !== null),
  }
}
