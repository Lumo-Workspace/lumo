import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import type { SlackContextSnapshot } from '@/types/slack-context'

export interface CreateIdeaSlackContextInput {
  ideaId: string
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

export const ideaSlackContextRepository = {
  async create(input: CreateIdeaSlackContextInput) {
    return prisma.ideaSlackContext.create({
      data: {
        ...input,
        snapshot: input.snapshot as unknown as Prisma.InputJsonValue,
      },
    })
  },

  async listByIdea(ideaId: string) {
    return prisma.ideaSlackContext.findMany({
      where: { ideaId },
      orderBy: { createdAt: 'desc' },
    })
  },

  async getById(id: string) {
    return prisma.ideaSlackContext.findUnique({ where: { id } })
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
    const data: Prisma.IdeaSlackContextUpdateInput = snapshot
      ? {
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          snapshotAt: new Date(),
          refreshError,
        }
      : { refreshError }
    return prisma.ideaSlackContext.update({ where: { id }, data })
  },

  async updateSummary(id: string, summary: string) {
    return prisma.ideaSlackContext.update({
      where: { id },
      data: { summary, summaryGeneratedAt: new Date() },
    })
  },

  async delete(id: string) {
    return prisma.ideaSlackContext.delete({ where: { id } })
  },
}
