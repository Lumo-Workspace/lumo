import { prisma } from '@/lib/db/prisma'
import type { ForecastInputs, ForecastCandidate } from '@/lib/forecast/types'
import { inferredUsageForTasks } from '@/lib/repositories/inferred-usage.repository'
import { usageMapTotal } from '@/lib/services/model-cost'

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

    // Interaction rounds per candidate = count of USER_PROMPT_SUBMIT hook events
    // attributed to the task (replaces the dead AGENT_CLARIFY notification
    // count). Bare-taskId grouping mirrors the prior aggregation; the per-task
    // actual (retrospective.repository) uses the exact session-fallback count.
    const candidateIds = rows.map(r => r.id)
    const [promptCounts, inferred] = await Promise.all([
      prisma.hookEvent.groupBy({
        by: ['taskId'],
        where: {
          taskId: { in: candidateIds },
          type: 'USER_PROMPT_SUBMIT',
        },
        _count: { _all: true },
      }),
      inferredUsageForTasks(candidateIds),
    ])
    const interactionByTask = new Map<string, number>(
      promptCounts.map(c => [c.taskId as string, c._count._all])
    )
    // LUM-932 P3 hybrid cost: unattached work's per-turn usage per candidate.
    const inferredByTask = new Map<string, number>()
    for (const r of inferred) {
      inferredByTask.set(
        r.taskId,
        (inferredByTask.get(r.taskId) ?? 0) + usageMapTotal(r.usageByModel)
      )
    }

    const candidates: ForecastCandidate[] = rows.map(r => {
      // A task has cost data only if at least one session carries usage or
      // unattached work was attributed to it with per-turn usage.
      const inferredTokens = inferredByTask.get(r.id)
      const hasUsage =
        r.sessions.some(s => s.outputTokens !== null) ||
        inferredTokens !== undefined
      const tokenCost = hasUsage
        ? (inferredTokens ?? 0) +
          r.sessions.reduce(
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
        interactionRounds: interactionByTask.get(r.id) ?? 0,
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
