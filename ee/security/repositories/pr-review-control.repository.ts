import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  admitAutomaticReview,
  commitsAfterReserve,
  withoutHead,
} from '@/ee/security/security-scan/review-control'

const CONTROL_SELECT = {
  reviewPaused: true,
  reviewHeads: true,
  reviewHeadCommits: true,
  reviewCommitLimit: true,
} as const

async function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' })
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2034' || attempt >= 2)
        throw error
    }
  }
}

export const prReviewControlRepository = {
  async get(id: string) {
    return prisma.pullRequest.findUniqueOrThrow({
      where: { id },
      select: CONTROL_SELECT,
    })
  },
  /**
   * LUM-1137: admit `head` under the PR's limit, else the workspace's
   * `workspaceLimit` (0 = never pause), recording the PR's commit count at
   * that head (null = unknown, counts as one commit).
   */
  async reserve(
    id: string,
    head: string,
    opts: { commitsAtHead: number | null; workspaceLimit: number }
  ): Promise<boolean> {
    return transaction(async tx => {
      const control = await tx.pullRequest.findUniqueOrThrow({
        where: { id },
        select: CONTROL_SELECT,
      })
      const decision = admitAutomaticReview(control, head, opts.workspaceLimit)
      if (decision.reserve)
        await tx.pullRequest.update({
          where: { id },
          data: {
            reviewHeads: { push: head },
            reviewHeadCommits: commitsAfterReserve(control, opts.commitsAtHead),
          },
        })
      return decision.allowed
    })
  },
  /** Return a round whose head was superseded before its review landed. */
  async release(id: string, head: string): Promise<void> {
    await transaction(async tx => {
      const control = await tx.pullRequest.findUniqueOrThrow({
        where: { id },
        select: { reviewHeads: true, reviewHeadCommits: true },
      })
      if (!control.reviewHeads.includes(head)) return
      await tx.pullRequest.update({
        where: { id },
        data: withoutHead(control, head),
      })
    })
  },
  async update(id: string, action: 'pause' | 'resume', limit?: number) {
    return prisma.pullRequest.update({
      where: { id },
      data: {
        reviewPaused: action === 'pause',
        ...(action === 'resume'
          ? { reviewHeads: [], reviewHeadCommits: [] }
          : {}),
        // LUM-1137: the PR's own pause-after, over the workspace setting.
        ...(limit !== undefined ? { reviewCommitLimit: limit } : {}),
      },
    })
  },
  async baseline(id: string, scanId: string) {
    return prisma.prSecurityScan.findFirst({
      where: {
        pullRequestId: id,
        id: { not: scanId },
        status: { in: ['CLEAN', 'FINDINGS'] },
        judgeStatus: 'RAN',
        truncated: false,
        partial: false,
        OR: [{ verifierStartedAt: null }, { verifiedAt: { not: null } }],
        stages: { path: ['judge'], equals: 'RAN' },
      },
      orderBy: { startedAt: 'desc' },
      select: { headSha: true },
    })
  },
  async priorFindings(id: string, scanId: string) {
    const previous = await prisma.prSecurityScan.findFirst({
      where: {
        pullRequestId: id,
        id: { not: scanId },
        status: { in: ['CLEAN', 'FINDINGS'] },
      },
      orderBy: { startedAt: 'desc' },
      include: {
        findings: {
          where: {
            provenance: 'LLM_JUDGE',
            OR: [{ verifierVerdict: null }, { verifierVerdict: 'CONFIRMED' }],
          },
        },
      },
    })
    return previous?.findings ?? []
  },
}
