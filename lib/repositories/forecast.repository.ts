import { prisma } from '@/lib/db/prisma'
import type { ForecastInputs, ForecastCandidate } from '@/lib/forecast/types'

export const forecastRepository = {
  /**
   * Load the target task plus all DONE candidate tasks in the same project
   * that have at least one agent run (real execution data). Returns null if
   * the target task does not exist.
   */
  async loadForecastInputs(taskId: string): Promise<ForecastInputs | null> {
    const target = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        projectId: true,
        taskTags: { select: { tag: { select: { name: true } } } },
      },
    })
    if (!target) return null

    const rows = await prisma.task.findMany({
      where: {
        projectId: target.projectId,
        status: 'DONE',
        id: { not: taskId },
        agentRuns: { some: {} },
      },
      select: {
        id: true,
        title: true,
        number: true,
        team: { select: { identifier: true } },
        taskTags: { select: { tag: { select: { name: true } } } },
        agentRuns: { select: { startedAt: true, finishedAt: true } },
        pullRequests: {
          where: { state: 'merged' },
          select: { mergedAt: true },
        },
      },
    })

    const candidates: ForecastCandidate[] = rows.map(r => ({
      id: r.id,
      title: r.title,
      identifier: `${r.team.identifier}-${r.number}`,
      tags: r.taskTags.map(tt => tt.tag.name),
      agentRuns: r.agentRuns.map(a => ({
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
      })),
      mergedPrAt: r.pullRequests.map(p => p.mergedAt),
    }))

    return {
      target: {
        id: target.id,
        title: target.title,
        projectId: target.projectId,
        tags: target.taskTags.map(tt => tt.tag.name),
      },
      candidates,
    }
  },
}
