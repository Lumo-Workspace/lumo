/**
 * LUM-1131 — the learnings a review of this repository reads: the
 * repository's PR-review learnings in scope for this PR (its own, and those
 * of merged PRs — `learningInScope`) whose memory is still ACTIVE (an edit in
 * the memory UI is what the review sees; a deleted or retired memory is
 * gone), filtered to the files the review reads, guarded line by line and
 * bounded (`REVIEW_LEARNINGS_MAX_*`). Never throws — a review without its
 * learnings is today's review.
 */
import { logger } from '@/lib/logger'
import { conventionContentSchema } from '@/lib/memory/schemas'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  learningInScope,
  renderReviewLearnings,
  selectRelevantLearnings,
  type StoredLearning,
} from '@/ee/security/security-scan/thread-reply'

/** Rows read before relevance filtering — bounds the query, not the prompt. */
const READ_LIMIT = 100

export async function loadReviewLearnings(input: {
  workspaceId: string
  repo: string
  /** The PR under review: its own learnings apply before it merges. */
  pullRequestId: string
  reviewedPaths: string[]
}): Promise<string> {
  try {
    const rows = await prReviewLearningRepository.findActiveForRepo(
      input.workspaceId,
      input.repo,
      READ_LIMIT
    )
    const sourceIds = [
      ...new Set(
        rows
          .filter(r => !r.repoWideAt && r.sourcePullRequestId)
          .map(r => r.sourcePullRequestId as string)
      ),
    ]
    const states = await pullRequestRepository.findStatesByIds(
      input.workspaceId,
      sourceIds
    )
    const stored: StoredLearning[] = []
    for (const r of rows) {
      if (
        !learningInScope(
          r,
          input.pullRequestId,
          r.sourcePullRequestId ? states.get(r.sourcePullRequestId) : undefined
        )
      )
        continue
      const parsed = conventionContentSchema.safeParse(r.content)
      if (parsed.success)
        stored.push({ text: parsed.data.rule, pathGlob: r.pathGlob })
    }
    return renderReviewLearnings(
      selectRelevantLearnings(stored, input.reviewedPaths),
      guardPromptLineText
    )
  } catch (error) {
    logger.warn(
      `[review-learnings] read failed ${input.repo}: ${error instanceof Error ? error.message : String(error)}`
    )
    return ''
  }
}

/**
 * The source PR merged (into any branch): its learnings apply to the whole
 * repository from now on. Idempotent; returns how many were promoted.
 */
export async function promoteLearningsOnMerge(
  workspaceId: string,
  pullRequestId: string,
  at: Date = new Date()
): Promise<number> {
  return prReviewLearningRepository.markRepoWideForPullRequest(
    workspaceId,
    pullRequestId,
    at
  )
}
