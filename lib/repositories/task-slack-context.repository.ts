import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import type { SlackContextSnapshot } from '@/types/slack-context'
import type { ContentSignals } from '@/shared/src/untrusted-content'
import { contentSignalsData } from './content-signals-column'

export interface CreateTaskSlackContextInput {
  taskId: string
  workspaceId: string
  permalink: string
  slackTeamId: string
  slackChannelId: string
  slackChannelName: string | null
  rootTs: string
  threadTs: string | null
  isThread: boolean
  snapshot: SlackContextSnapshot
  snapshotAt: Date
  createdById: string
  /** LUM-783: scan of the snapshot text; null = clean, omit = not scanned. */
  contentSignals?: ContentSignals | null
}

export const taskSlackContextRepository = {
  async create(input: CreateTaskSlackContextInput) {
    const { contentSignals, snapshot, ...rest } = input
    return prisma.taskSlackContext.create({
      data: {
        ...rest,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        ...contentSignalsData(contentSignals),
      },
    })
  },

  async listByTask(taskId: string) {
    return prisma.taskSlackContext.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    })
  },

  async getById(id: string) {
    return prisma.taskSlackContext.findUnique({ where: { id } })
  },

  /**
   * Two modes:
   * - Success: pass the new snapshot, clears refreshError, updates snapshotAt.
   * - Failure: pass null + error string; preserves the existing snapshot/snapshotAt
   *   so a refresh failure never destroys the cached content.
   */
  async updateSnapshot(
    id: string,
    snapshot: SlackContextSnapshot | null,
    refreshError: string | null,
    /** LUM-783: scan of the NEW snapshot; only written on success. */
    contentSignals?: ContentSignals | null
  ) {
    const data: Prisma.TaskSlackContextUpdateInput = snapshot
      ? {
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          snapshotAt: new Date(),
          refreshError,
          ...contentSignalsData(contentSignals),
        }
      : { refreshError }
    return prisma.taskSlackContext.update({ where: { id }, data })
  },

  async updateSummary(id: string, summary: string) {
    return prisma.taskSlackContext.update({
      where: { id },
      data: { summary, summaryGeneratedAt: new Date() },
    })
  },

  async delete(id: string) {
    return prisma.taskSlackContext.delete({ where: { id } })
  },
}
