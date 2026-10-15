/**
 * LUM-1154 — `PrChatRequest`: one row per question a human asked Lumo on a
 * pull request. The row is the claim (a redelivered webhook for the same
 * comment finds it and stops) and the unit of the per-PR hourly bound. It
 * stores no question or answer text. Queries only.
 */
import { prisma } from '@/lib/db/prisma'

export type PrChatSource = 'review' | 'issue'
export type PrChatStatus = 'CLAIMED' | 'ANSWERED' | 'RATE_LIMITED' | 'FAILED'

export interface PrChatClaim {
  workspaceId: string
  pullRequestId: string
  source: PrChatSource
  commentId: string
  authorLogin: string
}

export const prChatRequestRepository = {
  /**
   * Claim one comment. `null` when it was already claimed (a redelivery, or
   * a concurrent delivery of the same webhook) — the caller then does nothing.
   */
  async claim(input: PrChatClaim): Promise<{ id: string } | null> {
    try {
      return await prisma.prChatRequest.create({
        data: input,
        select: { id: true },
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return null
      throw error
    }
  },

  /** Questions on this PR since `since` whose row is in one of `statuses`. */
  async countSince(
    pullRequestId: string,
    since: Date,
    statuses: PrChatStatus[]
  ): Promise<number> {
    return prisma.prChatRequest.count({
      where: {
        pullRequestId,
        createdAt: { gte: since },
        status: { in: statuses },
      },
    })
  },

  async setStatus(id: string, status: PrChatStatus): Promise<void> {
    await prisma.prChatRequest.update({
      where: { id },
      data: { status },
      select: { id: true },
    })
  },

  /** Give the claim back after a failure, so a redelivery is answered. */
  async release(id: string): Promise<void> {
    await prisma.prChatRequest.deleteMany({ where: { id } })
  },
}
