import { prisma } from '@/lib/db/prisma'

export interface TaskComplexityUpsert {
  taskId: string
  teamId: string
  totalDurationMs: number
  changedFileCount: number
  agentRunCount: number
}

export const taskComplexityRepository = {
  async upsert(data: TaskComplexityUpsert) {
    const { taskId, ...rest } = data
    return prisma.taskComplexity.upsert({
      where: { taskId },
      create: { taskId, ...rest },
      update: { ...rest, computedAt: new Date() },
    })
  },

  async findByTaskId(taskId: string) {
    return prisma.taskComplexity.findUnique({ where: { taskId } })
  },

  /**
   * Batched change-surface rows for a task set (LUM-632 milestone delivery
   * rollup). Only the sum's inputs — a task with no row is simply absent, so
   * the caller can bucket it as unmeasured instead of a fake 0.
   */
  async listByTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) return []
    return prisma.taskComplexity.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, changedFileCount: true },
    })
  },

  /** team 内全部已沉淀行，作为读时分桶的 cohort。 */
  async listByTeam(teamId: string) {
    return prisma.taskComplexity.findMany({
      where: { teamId },
      select: { taskId: true, totalDurationMs: true, changedFileCount: true },
    })
  },
}
