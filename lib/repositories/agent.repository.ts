import { prisma } from '@/lib/db/prisma'

const CLARIFY_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24 hours

export const agentRepository = {
  /** Find the active (WORKING) agent run for a task. */
  async findActiveRun(taskId: string) {
    return prisma.agentRun.findFirst({
      where: { taskId, status: 'WORKING' },
      select: { id: true, sandboxId: true },
    })
  },

  /** Cancel an agent run by ID. */
  async cancelRun(runId: string) {
    return prisma.agentRun.update({
      where: { id: runId },
      data: { status: 'CANCELED', finishedAt: new Date() },
    })
  },

  /** Mark an agent run as failed with error details. */
  async failRun(runId: string, errorCode: string, errorMessage: string) {
    return prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        errorCode,
        errorMessage,
        finishedAt: new Date(),
      },
    })
  },

  /** Find tasks that have been in INPUT_REQUIRED for longer than 24 hours. */
  async findTimedOutTasks() {
    const cutoff = new Date(Date.now() - CLARIFY_TIMEOUT_MS)
    return prisma.task.findMany({
      where: {
        agentStatus: 'INPUT_REQUIRED',
        updatedAt: { lt: cutoff },
      },
      select: { id: true, projectId: true },
    })
  },
}
