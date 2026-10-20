import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { sprintProcessStagesRepository } from '@/lib/repositories/sprint-process-stages.repository'
import {
  computeProcessStages,
  type ProcessStagesStats,
} from '@/lib/summaries/sprint-process-stages'
import { assembleStageInputs } from '@/lib/summaries/sprint-process-stages-inputs'

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
  /** LUM-1280: median dwell per neutral stage, frozen at close (raw hook
   *  payloads get pruned later). Optional: summaries written before it lack
   *  it. Closed-sprint retro only — never shown on a live sprint. */
  processStages?: ProcessStagesStats
  /** LUM-1280: tasks verified at close (`lib/summaries/sprint-verified.ts`). */
  verifiedCount?: number
}

export interface ComputeStatsOptions {
  /** Open security-plugin DONE blockers for a task (the gate's plugin plane).
   *  Asked only for DONE tasks; omitted → no plugin, 0 blockers. */
  securityBlocking?: (taskId: string) => Promise<number>
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
  async computeStatsData(
    sprintId: string,
    options: ComputeStatsOptions = {}
  ): Promise<SprintStatsData> {
    // BACKLOG is unscheduled work and stays out of sprint stats (LUM-1057).
    const tasks = (await taskRepository.listBySprintForStats(sprintId)).filter(
      t => t.status !== 'BACKLOG'
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

    // LUM-1280: process stages + verified count, frozen at close.
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      select: {
        startDate: true,
        endDate: true,
        startedAt: true,
        closedAt: true,
        team: { select: { workspaceId: true } },
      },
    })
    if (sprint) {
      const taskIds = tasks.map(t => t.id)
      const securityBlockingByTask = new Map<string, number>()
      const { securityBlocking } = options
      if (securityBlocking) {
        const done = tasks.filter(t => t.status === 'DONE')
        const counts = await Promise.all(done.map(t => securityBlocking(t.id)))
        done.forEach((t, i) => securityBlockingByTask.set(t.id, counts[i] ?? 0))
      }
      const rows = await sprintProcessStagesRepository.loadInputs(
        sprint.team.workspaceId,
        taskIds
      )
      const { stageTasks, verifiedCount } = assembleStageInputs(
        tasks,
        rows,
        securityBlockingByTask
      )
      stats.processStages = computeProcessStages(stageTasks, {
        start: sprint.startedAt ?? sprint.startDate,
        end: sprint.closedAt ?? sprint.endDate,
        crossingGateEnabled: rows.crossingGateEnabled,
      })
      stats.verifiedCount = verifiedCount
    }
    return { stats, tasks }
  },
}
