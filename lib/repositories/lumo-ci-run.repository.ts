import { prisma } from '@/lib/db/prisma'
import type { LumoCiRunStatus } from '@/lib/services/lumo-ci.config'

/** LUM-746 — the managed CI run ledger (one row per PR head sha). */
export interface NewLumoCiRun {
  workspaceId: string
  taskId: string
  pullRequestId: string
  prNumber: number
  headSha: string
}

export interface SupersedableCiRun {
  id: string
  headSha: string
  runId: string | null
}

export const lumoCiRunRepository = {
  /**
   * Insert a PENDING row; on the (pullRequestId, headSha) unique collision
   * return the existing row with `created: false` — the "same sha runs
   * once" rule, decided by the database so concurrent webhooks cannot both
   * win.
   */
  async create(input: NewLumoCiRun): Promise<{ id: string; created: boolean }> {
    try {
      const row = await prisma.lumoCiRun.create({
        data: { ...input, status: 'PENDING' },
        select: { id: true },
      })
      return { id: row.id, created: true }
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      const existing = await prisma.lumoCiRun.findUnique({
        where: {
          pullRequestId_headSha: {
            pullRequestId: input.pullRequestId,
            headSha: input.headSha,
          },
        },
        select: { id: true },
      })
      if (!existing) throw error
      return { id: existing.id, created: false }
    }
  },

  async setRunId(id: string, runId: string): Promise<void> {
    await prisma.lumoCiRun.update({ where: { id }, data: { runId } })
  },

  /** Terminal stamp. `error` is a harness reason, never a gate verdict. */
  async finish(
    id: string,
    input: { status: Exclude<LumoCiRunStatus, 'PENDING'>; error?: string }
  ): Promise<void> {
    await prisma.lumoCiRun.update({
      where: { id },
      data: {
        status: input.status,
        error: input.error ?? null,
        finishedAt: new Date(),
      },
    })
  },

  /** The PR's other still-PENDING runs (supersede candidates). */
  async findPendingByPullRequest(
    pullRequestId: string,
    exceptId: string
  ): Promise<SupersedableCiRun[]> {
    return prisma.lumoCiRun.findMany({
      where: { pullRequestId, id: { not: exceptId }, status: 'PENDING' },
      select: { id: true, headSha: true, runId: true },
    })
  },

  /** Runs this workspace actually started since `since` (hourly cap). */
  async countStartedSince(workspaceId: string, since: Date): Promise<number> {
    return prisma.lumoCiRun.count({
      where: { workspaceId, runId: { not: null }, startedAt: { gte: since } },
    })
  },
}
