/**
 * LUM-1131 — the learnings a review of this repository reads: the
 * repository's PR-review learnings whose memory is still ACTIVE (an edit in
 * the memory UI is what the review sees; a deleted or retired memory is
 * gone), filtered to the files the review reads, guarded line by line and
 * bounded (`REVIEW_LEARNINGS_MAX_*`). Never throws — a review without its
 * learnings is today's review.
 */
import { logger } from '@/lib/logger'
import { conventionContentSchema } from '@/lib/memory/schemas'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import {
  renderReviewLearnings,
  selectRelevantLearnings,
  type StoredLearning,
} from '@/ee/security/security-scan/thread-reply'

/** Rows read before relevance filtering — bounds the query, not the prompt. */
const READ_LIMIT = 100

export async function loadReviewLearnings(input: {
  workspaceId: string
  repo: string
  reviewedPaths: string[]
}): Promise<string> {
  try {
    const rows = await prReviewLearningRepository.findActiveForRepo(
      input.workspaceId,
      input.repo,
      READ_LIMIT
    )
    const stored: StoredLearning[] = []
    for (const r of rows) {
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
