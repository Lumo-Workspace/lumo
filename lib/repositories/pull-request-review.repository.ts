import { prisma } from '@/lib/db/prisma'

/** LUM-1334: one GitHub review as the `pull_request_review` webhook reports it. */
export interface PullRequestReviewWrite {
  pullRequestId: string
  githubReviewId: string
  reviewerLogin: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED'
  commitSha: string
  submittedAt: Date
}

export const pullRequestReviewRepository = {
  /**
   * One row per GitHub review id. GitHub only ever moves a review to
   * dismissed, so a dismissal is final: a late-delivered earlier event (the
   * approval arriving after its dismissal) never brings the approval back.
   */
  async upsert(review: PullRequestReviewWrite) {
    const { pullRequestId, githubReviewId, ...fields } = review
    const where = {
      pullRequestId_githubReviewId: { pullRequestId, githubReviewId },
    }
    if (review.state === 'DISMISSED')
      return prisma.pullRequestReview.upsert({
        where,
        create: review,
        update: fields,
        select: { id: true },
      })
    const row = await prisma.pullRequestReview.upsert({
      where,
      create: review,
      update: {},
      select: { id: true },
    })
    await prisma.pullRequestReview.updateMany({
      where: { pullRequestId, githubReviewId, state: { not: 'DISMISSED' } },
      data: fields,
    })
    return row
  },

  /** The stored reviews of these PRs, oldest first. */
  async listByPullRequestIds(pullRequestIds: string[]) {
    if (pullRequestIds.length === 0) return []
    return prisma.pullRequestReview.findMany({
      where: { pullRequestId: { in: pullRequestIds } },
      select: {
        pullRequestId: true,
        reviewerLogin: true,
        state: true,
        commitSha: true,
        submittedAt: true,
      },
      orderBy: { submittedAt: 'asc' },
    })
  },
}
