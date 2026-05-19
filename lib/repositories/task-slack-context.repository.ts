import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import type { SlackContextSnapshot } from '@/types/slack-context'

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
}

export const taskSlackContextRepository = {
  async create(input: CreateTaskSlackContextInput) {
    return prisma.taskSlackContext.create({
      data: {
        ...input,
        snapshot: input.snapshot as unknown as Prisma.InputJsonValue,
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
    refreshError: string | null
  ) {
    const data: Prisma.TaskSlackContextUpdateInput = snapshot
      ? {
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          snapshotAt: new Date(),
          refreshError,
        }
      : { refreshError }
    return prisma.taskSlackContext.update({ where: { id }, data })
  },

  async delete(id: string) {
    return prisma.taskSlackContext.delete({ where: { id } })
  },
}
