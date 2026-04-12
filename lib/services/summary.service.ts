import { Prisma } from '@prisma/client'
import { summaryRepository } from '@/lib/repositories/summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

// ── Types ───────────────────────────────────────────────────────────────────

interface GetSummariesOptions {
  limit: number
  before?: string | undefined
}

// ── Summary Service ─────────────────────────────────────────────────────────

export const summaryService = {
  /** Fetch paginated workspace summaries. */
  async getWorkspaceSummaries(
    workspaceId: string,
    options: GetSummariesOptions
  ) {
    return summaryRepository.findWorkspaceSummaries(workspaceId, options)
  },

  /** Fetch paginated project summaries. */
  async getProjectSummaries(projectId: string, options: GetSummariesOptions) {
    return summaryRepository.findProjectSummaries(projectId, options)
  },

  /** Find workspaces eligible for summary generation. */
  async findSummaryEnabledWorkspaces(workspaceId?: string) {
    return summaryRepository.findSummaryEnabledWorkspaces(workspaceId)
  },

  /** Create a project summary record. */
  async createProjectSummary(
    projectId: string,
    stats: Prisma.InputJsonValue,
    tldr: string,
    report: string
  ) {
    return summaryRepository.createProjectSummary({
      projectId,
      stats,
      tldr,
      report,
    })
  },

  /** Create a workspace summary record. */
  async createWorkspaceSummary(
    workspaceId: string,
    stats: Prisma.InputJsonValue,
    tldr: string,
    report: string
  ) {
    return summaryRepository.createWorkspaceSummary({
      workspaceId,
      stats,
      tldr,
      report,
    })
  },

  /** Check if a workspace is due for summary generation based on frequency. */
  isDueForGeneration(frequency: string, lastGenerated: Date | null): boolean {
    if (!lastGenerated) return true

    const now = new Date()
    const diffMs = now.getTime() - lastGenerated.getTime()
    const diffHours = diffMs / (1000 * 60 * 60)

    switch (frequency) {
      case 'DAILY':
        return diffHours >= 24
      case 'EVERY_TWO_DAYS':
        return diffHours >= 48
      case 'WEEKLY':
        return diffHours >= 168
      default:
        return true
    }
  },

  async requestGeneration(
    type: 'project' | 'workspace',
    targetId: string,
    cooldownMinutes = 5
  ): Promise<{ jobId: string } | { retryAfter: number }> {
    const recent = await generationJobRepository.findRecentByTarget(
      targetId,
      cooldownMinutes
    )
    if (recent) {
      const elapsed = Date.now() - recent.createdAt.getTime()
      const retryAfter = Math.ceil(
        (cooldownMinutes * 60 * 1000 - elapsed) / 1000
      )
      return { retryAfter: Math.max(retryAfter, 1) }
    }

    const job = await generationJobRepository.create(type, targetId)
    return { jobId: job.id }
  },

  async getJobStatus(jobId: string) {
    const job = await generationJobRepository.findById(jobId)
    if (!job) return null
    return { status: job.status, summaryId: job.summaryId ?? null }
  },
}
