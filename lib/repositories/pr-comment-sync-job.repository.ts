import { prisma } from '@/lib/db/prisma'
import type { SyncDirection, Prisma } from '@prisma/client'

interface EnqueueInput {
  direction: SyncDirection
  payload: Prisma.InputJsonValue
  commentId?: string | null
  externalId?: string | null
  workspaceId: string
  scheduledFor?: Date
}

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000]

export const prCommentSyncJobRepository = {
  async enqueue(input: EnqueueInput) {
    return prisma.prCommentSyncJob.create({
      data: {
        direction: input.direction,
        payload: input.payload,
        commentId: input.commentId ?? null,
        externalId: input.externalId ?? null,
        workspaceId: input.workspaceId,
        status: 'PENDING',
        scheduledFor: input.scheduledFor ?? new Date(),
      },
    })
  },

  async findDue({ limit }: { limit: number }) {
    return prisma.prCommentSyncJob.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    })
  },

  async recordFailure(id: string, currentAttempts: number, error: string) {
    const nextAttempt = currentAttempts + 1
    const delay =
      BACKOFF_MS[Math.min(nextAttempt - 1, BACKOFF_MS.length - 1)] ??
      BACKOFF_MS[BACKOFF_MS.length - 1]!
    return prisma.prCommentSyncJob.update({
      where: { id },
      data: {
        attempts: nextAttempt,
        lastError: error.slice(0, 1000),
        scheduledFor: new Date(Date.now() + delay),
      },
    })
  },

  async rescheduleAt(id: string, at: Date, note: string) {
    return prisma.prCommentSyncJob.update({
      where: { id },
      data: { scheduledFor: at, lastError: note.slice(0, 1000) },
    })
  },

  async markDeadLetter(id: string, error: string) {
    return prisma.prCommentSyncJob.update({
      where: { id },
      data: {
        status: 'DEAD_LETTER',
        lastError: error.slice(0, 1000),
        // LUM-913: starts the 7-day clock for dropping the webhook payload.
        deadLetteredAt: new Date(),
      },
    })
  },

  /**
   * LUM-913: dead letters whose webhook payload is due to be dropped — entered
   * DEAD_LETTER at or before `before` and not purged yet. Rows dead-lettered
   * before LUM-913 have no `deadLetteredAt` and are never returned.
   */
  async findPurgeableDeadLetters({
    before,
    afterId,
    take,
    workspaceRetentionDays,
  }: {
    before: Date
    afterId: string | null
    take: number
    /**
     * LUM-941: only jobs of workspaces whose `deadLetterRetentionDays`
     * matches — a tier value (`equals`) or "anything but these" (`notIn`,
     * for the default tier, which also takes out-of-tier values).
     */
    workspaceRetentionDays?: { equals: number } | { notIn: number[] }
  }) {
    return prisma.prCommentSyncJob.findMany({
      where: {
        status: 'DEAD_LETTER',
        deadLetteredAt: { not: null, lte: before },
        payloadPurgedAt: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
        ...(workspaceRetentionDays
          ? {
              workspace: {
                is: { deadLetterRetentionDays: workspaceRetentionDays },
              },
            }
          : {}),
      },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, payload: true },
    })
  },

  /**
   * LUM-913: replace a dead letter's payload with its metadata-only form.
   * Guarded on `payloadPurgedAt: null` so a concurrent or repeated run is a
   * no-op. Returns whether the row was purged by this call.
   */
  async purgeDeadLetterPayload(
    id: string,
    payload: Prisma.InputJsonValue,
    now: Date
  ): Promise<boolean> {
    const { count } = await prisma.prCommentSyncJob.updateMany({
      where: { id, status: 'DEAD_LETTER', payloadPurgedAt: null },
      data: { payload, payloadPurgedAt: now },
    })
    return count > 0
  },

  async findDueByTask(taskId: string, { limit }: { limit: number }) {
    return prisma.prCommentSyncJob.findMany({
      where: {
        status: 'PENDING',
        scheduledFor: { lte: new Date() },
        direction: 'OUTBOUND',
        comment: { taskId },
      },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    })
  },

  async findDueByPullRequest(
    pullRequestId: string,
    { limit }: { limit: number }
  ) {
    return prisma.prCommentSyncJob.findMany({
      where: {
        status: 'PENDING',
        scheduledFor: { lte: new Date() },
        direction: 'INBOUND',
        payload: { path: ['pullRequestId'], equals: pullRequestId },
      },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    })
  },

  async delete(id: string) {
    return prisma.prCommentSyncJob.delete({ where: { id } })
  },
}
