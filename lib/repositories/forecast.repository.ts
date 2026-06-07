import { prisma } from '@/lib/db/prisma'
import type { ForecastInputs, ForecastCandidate } from '@/lib/forecast/types'

export const forecastRepository = {
  /**
   * Load the target task plus all DONE candidate tasks in the same project
   * that have at least one Claude Code session (real execution data). Returns
   * null if the target task does not exist. Sessions — not the legacy AgentRun
   * model — are where execution history lives today, so cohorts built off
   * AgentRun were near-empty (see LUM-304).
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
        sessions: { some: {} },
      },
      select: {
        id: true,
        title: true,
        number: true,
        team: { select: { identifier: true } },
        taskTags: { select: { tag: { select: { name: true } } } },
        // Session has no finishedAt; lastActivityAt is the completion proxy.
        // Token columns are cumulative per-session totals (LUM-281), null until
        // a STOP carries usage; summed here into a per-task tokenCost.
        sessions: {
          select: {
            startedAt: true,
            lastActivityAt: true,
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
          },
        },
        pullRequests: {
          where: { state: 'merged' },
          select: { mergedAt: true },
        },
      },
    })

    const candidates: ForecastCandidate[] = rows.map(r => {
      // A task has cost data only if at least one session carries usage.
      const hasUsage = r.sessions.some(s => s.outputTokens !== null)
      const tokenCost = hasUsage
        ? r.sessions.reduce(
            (sum, s) =>
              sum +
              (s.inputTokens ?? 0) +
              (s.outputTokens ?? 0) +
              (s.cacheReadTokens ?? 0) +
              (s.cacheCreationTokens ?? 0),
            0
          )
        : null

      return {
        id: r.id,
        title: r.title,
        identifier: `${r.team.identifier}-${r.number}`,
        tags: r.taskTags.map(tt => tt.tag.name),
        runs: r.sessions.map(s => ({
          startedAt: s.startedAt,
          finishedAt: s.lastActivityAt,
        })),
        mergedPrAt: r.pullRequests.map(p => p.mergedAt),
        tokenCost,
      }
    })

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
