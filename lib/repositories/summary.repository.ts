import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'

// ── Types ───────────────────────────────────────────────────────────────────

interface FindSummariesOptions {
  limit: number
  before?: string | undefined
}

interface CreateProjectSummaryData {
  projectId: string
  stats: Prisma.InputJsonValue
  tldr: string
  report: string
}

// ── Summary Repository ──────────────────────────────────────────────────────

export const summaryRepository = {
  /** Find project summaries with optional cursor-based pagination. */
  async findProjectSummaries(projectId: string, options: FindSummariesOptions) {
    return prisma.projectSummary.findMany({
      where: {
        projectId,
        ...(options.before
          ? { generatedAt: { lt: new Date(options.before) } }
          : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: options.limit,
    })
  },

  /** Create a project summary record. */
  async createProjectSummary(data: CreateProjectSummaryData) {
    return prisma.projectSummary.create({ data })
  },
}
