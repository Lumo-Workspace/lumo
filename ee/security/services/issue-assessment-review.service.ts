/**
 * LUM-1149 — flags the requirements the linked task / issue assessment
 * found Not addressed as one review comment on the PR (event COMMENT: it
 * annotates, never approves or requests changes — the check's own mode and
 * the verdict service decide that). Posted once per distinct set of unmet
 * requirements: the body carries a marker keyed on the set, and an existing
 * review of Lumo's own with that marker means nothing new is posted (a push that leaves
 * the same items unmet stays quiet).
 *
 * The body follows the assessment's privacy rule (issue-assessment.ts): a
 * private task's text is quoted only where the result says it may be.
 * Never throws.
 */
import { logger } from '@/lib/logger'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import {
  ISSUE_ASSESSMENT_CHECK_ID,
  buildUnmetRequirementsReview,
  hasUnmetMarker,
  unmetKey,
} from '@/ee/security/security-scan/issue-assessment'
import type { PreMergeChecksRecord } from '@/ee/security/security-scan/pre-merge-checks'

/**
 * Only Lumo's own reviews count for the dedupe — anyone else quoting the
 * marker (e.g. the PR's author) must not silence the comment. Same rule as
 * `isLumoBotComment` in security-pr-review.service.ts (not imported: that
 * module imports this one): GitHub types every App's bot user `Bot`; Lumo's
 * App posts as `<GITHUB_APP_SLUG>[bot]` (without the slug — dev, tests —
 * the type is all there is to go on).
 */
export function isLumoReview(r: {
  user: { type?: string; login?: string } | null
}): boolean {
  if (r.user?.type !== 'Bot') return false
  const slug = process.env.GITHUB_APP_SLUG
  return slug ? r.user.login === `${slug}[bot]` : true
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const issueAssessmentReviewService = {
  /** Post the unmet requirements of `record` (this head's), once. */
  async flagUnmet(input: {
    repo: { owner: string; name: string }
    prNumber: number
    token: string
    headSha: string
    record: PreMergeChecksRecord | null
  }): Promise<'posted' | 'already_posted' | 'nothing'> {
    const where = `pr=#${input.prNumber}`
    const result = input.record?.results.find(
      r => r.id === ISSUE_ASSESSMENT_CHECK_ID && r.verdict === 'failed'
    )
    const key = unmetKey(result?.requirements)
    if (!result || !key) return 'nothing'
    try {
      const reviews = await prCommentClient.listReviews({
        repo: input.repo,
        prNumber: input.prNumber,
        token: input.token,
      })
      if (
        hasUnmetMarker(
          reviews.filter(isLumoReview).map(r => r.body),
          key
        )
      )
        return 'already_posted'
      const body = buildUnmetRequirementsReview({
        assessments: result.requirements,
        headSha: input.headSha,
        mode: result.mode,
      })
      if (!body) return 'nothing'
      await prCommentClient.createReview({
        repo: input.repo,
        prNumber: input.prNumber,
        token: input.token,
        commitId: input.headSha,
        body,
        event: 'COMMENT',
        comments: [],
      })
      return 'posted'
    } catch (error) {
      logger.warn(
        `[issue-assessment] unmet requirements not flagged ${where}: ${describe(error)}`
      )
      return 'nothing'
    }
  },
}
