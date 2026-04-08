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

interface CreateWorkspaceSummaryData {
  workspaceId: string
  stats: Prisma.InputJsonValue
  tldr: string
  report: string
}

// ── Summary Repository ──────────────────────────────────────────────────────

export const summaryRepository = {
  /** Find workspace summaries with optional cursor-based pagination. */
  async findWorkspaceSummaries(
    workspaceId: string,
    options: FindSummariesOptions
  ) {
    return prisma.workspaceSummary.findMany({
      where: {
        workspaceId,
        ...(options.before
          ? { generatedAt: { lt: new Date(options.before) } }
          : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: options.limit,
    })
  },

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

  /** Find workspaces that have summaries enabled, with latest summary. */
  async findSummaryEnabledWorkspaces(workspaceId?: string) {
    return prisma.workspace.findMany({
      where: {
        summaryEnabled: true,
        ...(workspaceId ? { id: workspaceId } : {}),
      },
      include: {
        projects: true,
        summaries: {
          orderBy: { generatedAt: 'desc' },
          take: 1,
        },
      },
    })
  },

  /** Create a project summary record. */
  async createProjectSummary(data: CreateProjectSummaryData) {
    return prisma.projectSummary.create({ data })
  },

  /** Create a workspace summary record. */
  async createWorkspaceSummary(data: CreateWorkspaceSummaryData) {
    return prisma.workspaceSummary.create({ data })
  },
}
