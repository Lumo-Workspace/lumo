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
      data: { status: 'DEAD_LETTER', lastError: error.slice(0, 1000) },
    })
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

  async findDueByPullRequest(pullRequestId: string, { limit }: { limit: number }) {
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
