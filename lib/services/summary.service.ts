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
  /** Fetch paginated project summaries. */
  async getProjectSummaries(projectId: string, options: GetSummariesOptions) {
    return summaryRepository.findProjectSummaries(projectId, options)
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
   * Daily cron housekeeping: drop generation-job rows older than 7 days.
   * LUM-1228: the cron generates nothing — the workspace briefing it used to
   * write (LLM) lost its last readers with the Dashboard. Returns the count.
   */
  async pruneGenerationJobs(): Promise<number> {
    const { count } = await generationJobRepository.deleteOlderThan(7)
    return count
  },
}
