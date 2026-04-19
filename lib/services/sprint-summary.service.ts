import { prisma } from '@/lib/db/prisma'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { sprintSummaryRepository } from '@/lib/repositories/sprint-summary.repository'
import { callSprintSummaryLLM } from '@/lib/llm/sprint-summary-client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SprintStats {
  totalTasks: number
  done: number
  spillover: number
  byPriority: Record<string, number>
  byAssignee: Record<string, number>
}

// ── Service ───────────────────────────────────────────────────────────────────

export const sprintSummaryService = {
  async generate(sprintId: string) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (sprint.status !== 'CLOSED') httpError(400, 'sprint is not closed')

    const tasks = await prisma.task.findMany({
      where: { sprintId },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeActorId: true,
        title: true,
      },
    })

    const spilloverActivities = await prisma.taskActivity.findMany({
      where: {
        type: 'SPRINT_CHANGED',
        payload: { path: ['fromSprintId'], equals: sprintId },
      },
      select: { taskId: true, payload: true },
    })
    const spilloverCount = spilloverActivities.length

    const stats: SprintStats = {
      totalTasks: tasks.length + spilloverCount,
      done: tasks.filter(t => t.status === 'DONE').length,
      spillover: spilloverCount,
      byPriority: tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.priority] = (acc[t.priority] ?? 0) + 1
        return acc
      }, {}),
      byAssignee: tasks.reduce<Record<string, number>>((acc, t) => {
        const key = t.assigneeActorId ?? 'unassigned'
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
    }

    const { tldr, report } = await callSprintSummaryLLM({
      subject: sprint.name,
      window: { start: sprint.startDate, end: sprint.endDate },
      stats,
      tasks,
    })

    return sprintSummaryRepository.save(sprintId, {
      stats: stats as unknown as import('@prisma/client').Prisma.InputJsonValue,
      tldr,
      report,
    })
  },
}
