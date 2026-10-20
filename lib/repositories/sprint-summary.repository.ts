import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

export interface SprintSummaryData {
  stats: SprintStats
  tldr: string
  report: string
}

export interface SprintStats {
  totalTasks: number
  done: number
  spillover: number
  byPriority: Record<string, number>
  byAssignee: Record<string, number>
}

export interface SprintStatsData {
  stats: SprintStats
  tasks: Array<{
    id: string
    status: string
    priority: string
    assigneeActorId: string | null
    title: string
  }>
}

export const sprintSummaryRepository = {
  async findBySprintId(sprintId: string) {
    return prisma.sprintSummary.findUnique({ where: { sprintId } })
  },

  async save(sprintId: string, data: SprintSummaryData) {
    const payload = {
      stats: data.stats as unknown as Prisma.InputJsonValue,
      tldr: data.tldr,
      report: data.report,
    }
    return prisma.sprintSummary.upsert({
      where: { sprintId },
      create: { sprintId, ...payload },
      update: { ...payload, generatedAt: new Date() },
    })
  },

  /**
   * Load tasks and spillover activities for the given sprint, then aggregate
   * the stats snapshot persisted on SprintSummary. Service calls this then
   * hands tasks + stats to the LLM.
   */
  async computeStatsData(sprintId: string): Promise<SprintStatsData> {
    // BACKLOG is unscheduled work and stays out of sprint stats (LUM-1057);
    // CANCELED is not delivered work and stays out too (LUM-1282).
    const tasks = (await taskRepository.listBySprintForStats(sprintId)).filter(
      t => t.status !== 'BACKLOG' && t.status !== 'CANCELED'
    )
    const spilloverActivities =
      await activityRepository.listSpilloverFromSprint(sprintId)
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
    return { stats, tasks }
  },
}
