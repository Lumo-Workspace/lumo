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
  /** One row per GitHub review id; a later event (e.g. dismissed) replaces its state. */
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
