import { prisma } from '@/lib/db/prisma'

export interface TaskComplexityUpsert {
  taskId: string
  teamId: string
  totalDurationMs: number
  changedFileCount: number
  agentRunCount: number
}

export const taskComplexityRepository = {
  /** 该 task 所有已完成 AgentRun 的复杂度信号字段。 */
  async listRunSignalsForTask(taskId: string) {
    return prisma.agentRun.findMany({
      where: { taskId, finishedAt: { not: null } },
      select: { durationMs: true, changedFiles: true },
    })
  },

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

  /** team 内全部已沉淀行，作为读时分桶的 cohort。 */
  async listByTeam(teamId: string) {
    return prisma.taskComplexity.findMany({
      where: { teamId },
      select: { taskId: true, totalDurationMs: true, changedFileCount: true },
    })
  },
}
