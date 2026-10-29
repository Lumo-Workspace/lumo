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
  /** Insert the review, or overwrite every field of the stored row. */
  async upsert(review: PullRequestReviewWrite) {
    const { pullRequestId, githubReviewId, ...fields } = review
    return prisma.pullRequestReview.upsert({
      where: {
        pullRequestId_githubReviewId: { pullRequestId, githubReviewId },
      },
      create: review,
      update: fields,
      select: { id: true },
    })
  },

  /** Insert the review; a row already stored for its id is left as it is. */
  async createIfAbsent(review: PullRequestReviewWrite) {
    const { pullRequestId, githubReviewId } = review
    return prisma.pullRequestReview.upsert({
      where: {
        pullRequestId_githubReviewId: { pullRequestId, githubReviewId },
      },
      create: review,
      update: {},
      select: { id: true },
    })
  },

  /** Overwrite the stored row's fields unless it is in state `keep`. */
  async updateUnlessState(
    review: PullRequestReviewWrite,
    keep: PullRequestReviewWrite['state']
  ) {
    const { pullRequestId, githubReviewId, ...fields } = review
    await prisma.pullRequestReview.updateMany({
      where: { pullRequestId, githubReviewId, state: { not: keep } },
      data: fields,
    })
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
