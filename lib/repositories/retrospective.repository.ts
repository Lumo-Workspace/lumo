import { prisma } from '@/lib/db/prisma'
import type { Interval } from '@/lib/forecast/types'

export interface SnapshotRow {
  iterations: Interval | null
  clarifyRounds: Interval | null
  tokenCost: Interval | null
  cohortSize: number
  tokenCostBasis: number
  capturedAt: Date
}

export interface SnapshotPayload {
  iterations: Interval | null
  clarifyRounds: Interval | null
  tokenCost: Interval | null
  cohortSize: number
  tokenCostBasis: number
}

export interface RetrospectiveActuals {
  projectId: string
  tokenCost: number | null
  iterations: number
  clarifyRounds: number
}

export const retrospectiveRepository = {
  /** 读快照（已转 domain 形状）。无则 null。 */
  async findSnapshot(taskId: string): Promise<SnapshotRow | null> {
    const row = await prisma.taskForecastSnapshot.findUnique({
      where: { taskId },
    })
    if (!row) return null
    return {
      iterations: row.iterations as Interval | null,
      clarifyRounds: row.clarifyRounds as Interval | null,
      tokenCost: row.tokenCost as Interval | null,
      cohortSize: row.cohortSize,
      tokenCostBasis: row.tokenCostBasis,
      capturedAt: row.capturedAt,
    }
  },

  /** keep-first 落库：唯一冲突（P2002）静默吞掉，其他错误抛出。 */
  async createSnapshotIfAbsent(
    taskId: string,
    p: SnapshotPayload
  ): Promise<void> {
    try {
      await prisma.taskForecastSnapshot.create({
        data: {
          taskId,
          iterations: p.iterations ?? undefined,
          clarifyRounds: p.clarifyRounds ?? undefined,
          tokenCost: p.tokenCost ?? undefined,
          cohortSize: p.cohortSize,
          tokenCostBasis: p.tokenCostBasis,
        },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return
      throw e
    }
  },

  /** 实算 actual：token 求和（无 usage→null）、session 数、AGENT_CLARIFY 数。 */
  async loadActuals(taskId: string): Promise<RetrospectiveActuals | null> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        projectId: true,
        sessions: {
          select: {
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
          },
        },
      },
    })
    if (!task) return null

    const hasUsage = task.sessions.some(s => s.outputTokens !== null)
    const tokenCost = hasUsage
      ? task.sessions.reduce(
          (sum, s) =>
            sum +
            (s.inputTokens ?? 0) +
            (s.outputTokens ?? 0) +
            (s.cacheReadTokens ?? 0) +
            (s.cacheCreationTokens ?? 0),
          0
        )
      : null

    const clarifyRounds = await prisma.notification.count({
      where: { taskId, type: 'AGENT_CLARIFY' },
    })

    return {
      projectId: task.projectId,
      tokenCost,
      iterations: task.sessions.length,
      clarifyRounds,
    }
  },

  /** 参考库规模 = 项目内 DONE 且有 session 的任务数（= forecast 候选 universe）。 */
  async countReferenceLibrary(projectId: string): Promise<number> {
    return prisma.task.count({
      where: { projectId, status: 'DONE', sessions: { some: {} } },
    })
  },
}
