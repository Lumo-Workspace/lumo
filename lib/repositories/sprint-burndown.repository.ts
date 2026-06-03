import { prisma } from '@/lib/db/prisma'
import type { TaskStatus } from '@prisma/client'

export interface BurndownInputs {
  tasks: Array<{ id: string; sprintId: string | null; status: TaskStatus }>
  activities: Array<{
    taskId: string
    type: 'STATUS_CHANGED' | 'SPRINT_CHANGED'
    payload: unknown
    createdAt: Date
  }>
}

export const sprintBurndownRepository = {
  /**
   * Load the candidate task set + their status/sprint activity timelines.
   * Candidates = tasks currently in the sprint ∪ tasks with any SPRINT_CHANGED
   * whose payload from/to references this sprint (i.e. tasks that left it).
   */
  async loadInputs(sprintId: string): Promise<BurndownInputs> {
    const currentTaskIds = (
      await prisma.task.findMany({
        where: { sprintId },
        select: { id: true },
      })
    ).map(t => t.id)

    const sprintChanges = await prisma.taskActivity.findMany({
      where: {
        type: 'SPRINT_CHANGED',
        OR: [
          { payload: { path: ['fromSprintId'], equals: sprintId } },
          { payload: { path: ['toSprintId'], equals: sprintId } },
        ],
      },
      select: { taskId: true },
    })

    const ids = [
      ...new Set([...currentTaskIds, ...sprintChanges.map(a => a.taskId)]),
    ]

    if (ids.length === 0) return { tasks: [], activities: [] }

    const tasks = await prisma.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, sprintId: true, status: true },
    })

    const activities = await prisma.taskActivity.findMany({
      where: {
        taskId: { in: ids },
        type: { in: ['STATUS_CHANGED', 'SPRINT_CHANGED'] },
      },
      select: { taskId: true, type: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    return {
      tasks,
      activities: activities as unknown as BurndownInputs['activities'],
    }
  },
}
