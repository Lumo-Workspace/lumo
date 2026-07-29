import { prisma } from '@/lib/db/prisma'
import type { TaskStatus } from '@prisma/client'

export interface BurnupInputs {
  tasks: Array<{
    id: string
    sprintId: string | null
    status: TaskStatus
    createdAt: Date
  }>
  activities: Array<{
    taskId: string
    type: 'STATUS_CHANGED'
    payload: unknown
    createdAt: Date
  }>
}

export const sprintBurnupRepository = {
  /**
   * Load the sprint's task set + their status timelines. The set is the
   * sprint's CURRENT members — a task that has been moved to another sprint is
   * that sprint's work, not this one's, so it is not loaded at all (LUM-717).
   */
  async loadInputs(sprintId: string): Promise<BurnupInputs> {
    const tasks = await prisma.task.findMany({
      where: { sprintId },
      select: { id: true, sprintId: true, status: true, createdAt: true },
    })

    if (tasks.length === 0) return { tasks: [], activities: [] }

    const activities = await prisma.taskActivity.findMany({
      where: {
        taskId: { in: tasks.map(t => t.id) },
        type: 'STATUS_CHANGED',
      },
      select: { taskId: true, type: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    return {
      tasks,
      activities: activities as unknown as BurnupInputs['activities'],
    }
  },
}
