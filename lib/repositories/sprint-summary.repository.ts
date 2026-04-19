import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

export interface SprintSummaryData {
  stats: Prisma.InputJsonValue
  tldr: string
  report: string
}

export const sprintSummaryRepository = {
  async findBySprintId(sprintId: string) {
    return prisma.sprintSummary.findUnique({ where: { sprintId } })
  },

  async save(sprintId: string, data: SprintSummaryData) {
    return prisma.sprintSummary.upsert({
      where: { sprintId },
      create: { sprintId, ...data },
      update: { ...data, generatedAt: new Date() },
    })
  },
}
