import { Prisma } from '@prisma/client'
import { summaryRepository } from '@/lib/repositories/summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { aggregateWorkspaceStats } from '@/lib/summaries/stats'
import { generateWorkspaceReport } from '@/lib/summaries/report'

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

  /**
   * Generate workspace summaries for all eligible workspaces (called by cron).
   * Project-level reports are no longer generated — see the note inside.
   */
  async generateCronSummaries() {
    const workspaces = await this.findSummaryEnabledWorkspaces()
    const results = []

    for (const workspace of workspaces) {
      const lastGenerated = workspace.summaries[0]?.generatedAt ?? null
      if (!this.isDueForGeneration(workspace.summaryFrequency, lastGenerated)) {
        results.push({ workspaceId: workspace.id, skipped: true })
        continue
      }

      // LUM-699 retired the project-level report: the project Signal tab reads
      // live stats and renders no prose, and nothing else in the product (UI,
      // Slack, digests) consumes a project summary. Generating one per project
      // per cycle was an LLM call per project whose only reader was the
      // database. Workspace reports are unaffected — those are still rendered
      // on the Dashboard.
      const workspaceStats = await aggregateWorkspaceStats(workspace.id)
      const { tldr, report } = await generateWorkspaceReport(workspaceStats, {
        workspaceName: workspace.name,
        // LUM-1117: the workspace's one language field.
        locale: workspace.defaultLocale,
      })

      const workspaceSummary = await this.createWorkspaceSummary(
        workspace.id,
        workspaceStats as unknown as Prisma.InputJsonValue,
        tldr,
        report
      )
      await generationJobRepository
        .create('workspace', workspace.id)
        .then(job =>
          generationJobRepository.updateStatus(
            job.id,
            'completed',
            workspaceSummary.id
          )
        )

      results.push({
        workspaceId: workspace.id,
        workspaceSummaryId: workspaceSummary.id,
      })
    }

    await generationJobRepository.deleteOlderThan(7)
    return results
  },
}
