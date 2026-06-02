import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

export const generationJobRepository = {
  async findRecentByTarget(targetId: string, cooldownMinutes: number) {
    const since = new Date(Date.now() - cooldownMinutes * 60 * 1000)
    return prisma.generationJob.findFirst({
      where: {
        targetId,
        status: { in: ['pending', 'completed'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    })
  },

  async create(type: 'project' | 'workspace', targetId: string) {
    return prisma.generationJob.create({
      data: { type, targetId },
    })
  },

  async updateStatus(
    id: string,
    status: 'completed' | 'failed',
    summaryId?: string
  ) {
    return prisma.generationJob.update({
      where: { id },
      data: { status, ...(summaryId ? { summaryId } : {}) },
    })
  },

  async findById(id: string) {
    return prisma.generationJob.findFirst({
      where: { id },
    })
  },

  async deleteOlderThan(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return prisma.generationJob.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
  },

  // ── Sprint-domain additions ──────────────────────────────────────────────

  /**
   * Create a pending GenerationJob for a sprint retro. Used both by
   * sprintRepository.closeAtomically (inside its tx) and by the retro-retry
   * route (outside any tx). When `tx` is omitted the row is written via the
   * default client.
   */
  async createSprintPending(sprintId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.generationJob.create({
      data: { type: 'sprint', targetId: sprintId, status: 'pending' },
    })
  },

  /**
   * Most-recent pending GenerationJob for a sprint, if any.
   * sprintSummaryService.generate looks this up to mark completed/failed later.
   */
  async findPendingSprintJob(sprintId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.generationJob.findFirst({
      where: { type: 'sprint', targetId: sprintId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })
  },

  // ── Milestone-domain additions ───────────────────────────────────────────

  /**
   * Create a pending GenerationJob for a milestone retro. Used both by the
   * milestone status→COMPLETED transition and by the retro-retry route. When
   * `tx` is omitted the row is written via the default client.
   */
  async createMilestonePending(
    milestoneId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.generationJob.create({
      data: { type: 'milestone', targetId: milestoneId, status: 'pending' },
    })
  },

  /**
   * Most-recent pending GenerationJob for a milestone, if any.
   * milestoneSummaryService.generate looks this up to mark completed/failed.
   */
  async findPendingMilestoneJob(
    milestoneId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.generationJob.findFirst({
      where: { type: 'milestone', targetId: milestoneId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })
  },

  /** Mark a specific GenerationJob as completed with its produced summary. */
  async markCompleted(
    jobId: string,
    summaryId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.generationJob.update({
      where: { id: jobId },
      data: { status: 'completed', summaryId },
    })
  },

  /** Mark a specific GenerationJob as failed. */
  async markFailed(jobId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.generationJob.update({
      where: { id: jobId },
      data: { status: 'failed' },
    })
  },
}
