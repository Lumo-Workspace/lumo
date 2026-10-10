import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import { taskRepository } from '@/lib/repositories/task.repository'

export interface MilestoneSummaryData {
  stats: MilestoneStats
  tldr: string
  report: string
}

export interface MilestoneStats {
  totalTasks: number
  done: number
  inProgress: number
  byPriority: Record<string, number>
  byAssignee: Record<string, number>
}

export interface MilestoneStatsData {
  stats: MilestoneStats
  tasks: Array<{
    id: string
    status: string
    priority: string
    assigneeActorId: string | null
    title: string
  }>
}

export const milestoneSummaryRepository = {
  async findByMilestoneId(milestoneId: string) {
    return prisma.milestoneSummary.findUnique({ where: { milestoneId } })
  },

  async save(milestoneId: string, data: MilestoneSummaryData) {
    const payload = {
      stats: data.stats as unknown as Prisma.InputJsonValue,
      tldr: data.tldr,
      report: data.report,
    }
    return prisma.milestoneSummary.upsert({
      where: { milestoneId },
      create: { milestoneId, ...payload },
      update: { ...payload, generatedAt: new Date() },
    })
  },

  /**
   * Load tasks for the given milestone, then aggregate the stats snapshot
   * persisted on MilestoneSummary. Service calls this then hands tasks + stats
   * to the LLM. Milestones have no sprint-style "spillover"; the equivalent
   * carry-over signal is the count of tasks still open (not DONE) at close.
   */
  async computeStatsData(milestoneId: string): Promise<MilestoneStatsData> {
    // BACKLOG is unscheduled work and stays out of milestone stats (LUM-1057).
    const tasks = (
      await taskRepository.listByMilestoneForStats(milestoneId)
    ).filter(t => t.status !== 'BACKLOG')

    const stats: MilestoneStats = {
      totalTasks: tasks.length,
      done: tasks.filter(t => t.status === 'DONE').length,
      inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
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
