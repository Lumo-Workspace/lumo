import { prisma } from '@/lib/db/prisma'
import { enrichUsers } from '@/lib/auth/user-profiles'
import type { TaskSummaryStats, TopBlockers } from '@/types/summary'
import { collectTopBlockers, stalledCutoff } from './top-blockers'
import { selectHighStakesStalls, type TaskContextSample } from './high-stakes'
import { inferredUsageForTasks } from '@/lib/repositories/inferred-usage.repository'
import { usageMapTotal } from '@/lib/services/model-cost'
import { inferredTopLevelSessionsForTasks } from '@/lib/repositories/task-attribution-where'
import {
  CLOSED_TASK_STATUSES,
  countsTowardCompletion,
} from '@/lib/task/status-semantics'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export async function aggregateProjectStats(
  projectId: string
): Promise<TaskSummaryStats> {
  const now = new Date()

  const [
    statusGroups,
    priorityGroups,
    overdueTasks,
    assigneeGroups,
    doneTasks,
    agentGroups,
    prTotal,
    prMerged,
    prOpen,
    completedRecently,
    // Queries backing the top-blockers panel
    stalledCandidates,
    failingAgentTasks,
    openPrs,
  ] = await Promise.all([
    prisma.task.groupBy({
      by: ['status'],
      where: { projectId },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['priority'],
      where: { projectId },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        dueDate: { lt: now },
        status: { notIn: [...CLOSED_TASK_STATUSES] },
      },
      select: {
        id: true,
        number: true,
        title: true,
        team: { select: { identifier: true } },
      },
    }),
    prisma.task.groupBy({
      by: ['assigneeActorId', 'status'],
      where: {
        projectId,
        assigneeActorId: { not: null },
        // LUM-1282: canceled work is neither assigned load nor completed.
        status: { not: 'CANCELED' },
      },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: { projectId, status: 'DONE' },
      select: { createdAt: true, updatedAt: true, completedAt: true },
    }),
    prisma.task.groupBy({
      by: ['agentStatus'],
      where: {
        projectId,
        agentStatus: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.pullRequest.count({ where: { task: { projectId } } }),
    prisma.pullRequest.count({
      where: { task: { projectId }, state: 'merged' },
    }),
    prisma.pullRequest.count({
      where: { task: { projectId }, state: 'open' },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        status: 'DONE',
        // LUM-1282: the completion stamp; updatedAt only for a row the
        // backfill has not reached.
        OR: [
          { completedAt: { gte: new Date(now.getTime() - THIRTY_DAYS_MS) } },
          {
            completedAt: null,
            updatedAt: { gte: new Date(now.getTime() - THIRTY_DAYS_MS) },
          },
        ],
      },
      select: { updatedAt: true, completedAt: true },
    }),
    // Stalled candidates: not done/canceled, untouched past the stalled cutoff
    prisma.task.findMany({
      where: {
        projectId,
        status: { notIn: [...CLOSED_TASK_STATUSES] },
        updatedAt: { lt: stalledCutoff(now) },
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        updatedAt: true,
        team: { select: { identifier: true } },
      },
    }),
    // Failing agent tasks (for top blockers)
    prisma.task.findMany({
      where: { projectId, agentStatus: 'FAILED' },
      select: {
        id: true,
        number: true,
        title: true,
        agentStatus: true,
        team: { select: { identifier: true } },
      },
    }),
    // Open PRs (for stale PR signal + top blockers)
    prisma.pullRequest.findMany({
      where: { task: { projectId }, state: 'open' },
      select: { number: true, state: true, createdAt: true, url: true },
    }),
  ])

  const statusDistribution: Record<string, number> = {}
  let totalTasks = 0
  for (const g of statusGroups) {
    const count = g._count._all
    statusDistribution[g.status] = count
    // LUM-1282: CANCELED is shown in the distribution but is not in the total.
    if (countsTowardCompletion(g.status)) totalTasks += count
  }

  const priorityDistribution: Record<string, number> = {}
  for (const g of priorityGroups) {
    priorityDistribution[g.priority] = g._count._all
  }

  const overdueTaskIds = overdueTasks.map(t => t.id)
  // overdueTasks from query now also has title, used later for topBlockers

  const actorIdSet = new Set(
    (assigneeGroups as Array<{ assigneeActorId: string | null }>)
      .map(g => g.assigneeActorId)
      .filter((id): id is string => id !== null)
  )

  const actors =
    actorIdSet.size > 0
      ? await prisma.actor.findMany({
          where: { id: { in: Array.from(actorIdSet) } },
          select: {
            id: true,
            type: true,
            member: { select: { clerkId: true } },
            agent: { select: { name: true } },
          },
        })
      : []

  const actorNameMap = new Map<string, string>()
  const clerkIds = actors
    .filter(a => a.type !== 'AGENT' && a.member?.clerkId)
    .map(a => a.member!.clerkId)
  const clerkNameMap =
    clerkIds.length > 0 ? await enrichUsers(clerkIds) : new Map()

  for (const actor of actors) {
    let name: string
    if (actor.type === 'AGENT' && actor.agent) {
      name = actor.agent.name
    } else if (actor.member?.clerkId) {
      name =
        clerkNameMap.get(actor.member.clerkId)?.name ?? actor.member.clerkId
    } else {
      name = actor.id
    }
    actorNameMap.set(actor.id, name)
  }

  const workloadMap = new Map<string, { assigned: number; completed: number }>()
  for (const g of assigneeGroups as Array<{
    assigneeActorId: string | null
    status: string
    _count: { _all: number }
  }>) {
    if (!g.assigneeActorId) continue
    const entry = workloadMap.get(g.assigneeActorId) ?? {
      assigned: 0,
      completed: 0,
    }
    entry.assigned += g._count._all
    if (g.status === 'DONE') entry.completed += g._count._all
    workloadMap.set(g.assigneeActorId, entry)
  }

  const memberWorkload = Array.from(workloadMap.entries()).map(
    ([actorId, counts]) => ({
      actorId,
      name: actorNameMap.get(actorId) ?? actorId,
      ...counts,
    })
  )

  // Completion trend
  const trendMap = new Map<string, number>()
  for (const t of completedRecently) {
    const dateKey = (t.completedAt ?? t.updatedAt).toISOString().slice(0, 10)
    trendMap.set(dateKey, (trendMap.get(dateKey) ?? 0) + 1)
  }
  const completionTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, completed]) => ({ date, completed }))

  let avgCompletionTime: number | null = null
  if (doneTasks.length > 0) {
    const totalMs = doneTasks.reduce(
      (sum, t) =>
        sum +
        ((t.completedAt ?? t.updatedAt).getTime() - t.createdAt.getTime()),
      0
    )
    avgCompletionTime = totalMs / doneTasks.length / (1000 * 60 * 60)
  }

  const agentStats = { total: 0, completed: 0, failed: 0, working: 0 }
  for (const g of agentGroups as Array<{
    agentStatus: string | null
    _count: { _all: number }
  }>) {
    const count = g._count._all
    agentStats.total += count
    if (g.agentStatus === 'COMPLETED') agentStats.completed += count
    else if (g.agentStatus === 'FAILED') agentStats.failed += count
    else if (g.agentStatus === 'WORKING') agentStats.working += count
  }

  // Assemble the "base" stats (without blockers yet)
  const baseStats: Omit<TaskSummaryStats, 'topBlockers'> = {
    totalTasks,
    statusDistribution,
    priorityDistribution,
    overdueTasks: { count: overdueTaskIds.length, taskIds: overdueTaskIds },
    memberWorkload,
    completionTrend,
    avgCompletionTime,
    agentStats,
    prStats: { total: prTotal, merged: prMerged, open: prOpen },
  }

  const topBlockers = collectTopBlockers({
    tasks: stalledCandidates.map(t => ({
      id: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      updatedAt: t.updatedAt,
    })),
    agents: failingAgentTasks.map(t => ({
      taskId: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      title: t.title,
      agentStatus: t.agentStatus,
    })),
    prs: openPrs,
    now,
  })

  // Re-populate overdue blockers from the overdue query (collectTopBlockers
  // only saw the stalled subset)
  topBlockers.overdueTaskIds = overdueTasks.slice(0, 10).map(t => ({
    id: t.id,
    identifier: `${t.team.identifier}-${t.number}`,
    title: t.title,
  }))

  // Promote the stalls that actually matter — declared important, or already
  // expensive enough that restarting them is a real cost.
  topBlockers.highStakesTaskIds = selectHighStakesStalls({
    stalled: topBlockers.stalledTaskIds,
    context: await loadTaskContextSamples(
      topBlockers.stalledTaskIds.map(t => t.id)
    ),
  })

  return { ...baseStats, topBlockers }
}

/**
 * Aggregate per-task agent context across the task's sessions.
 *
 * Token columns stay null until a STOP hook carries usage and historical rows
 * are never backfilled, so an all-null sum is reported as `null` ("never
 * measured") rather than collapsed to 0 — a task nobody measured must not read
 * as a task that cost nothing.
 */
export async function loadTaskContextSamples(
  taskIds: string[]
): Promise<Map<string, TaskContextSample>> {
  if (taskIds.length === 0) return new Map()

  const [groups, topLevelGroups, inferredSessions, inferred] =
    await Promise.all([
      prisma.session.groupBy({
        by: ['taskId'],
        where: { taskId: { in: taskIds } },
        _count: { _all: true },
        _sum: {
          loopCount: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
        },
      }),
      // LUM-932 P3: sessionCount = distinct TOP-LEVEL sessions — explicit ones
      // bound to the task + unattached ones inferred onto it (never children).
      prisma.session.groupBy({
        by: ['taskId'],
        where: { taskId: { in: taskIds }, parentSessionId: null },
        _count: { _all: true },
      }),
      prisma.session.findMany({
        where: inferredTopLevelSessionsForTasks(taskIds),
        select: {
          attributionSegments: {
            where: { taskId: { in: taskIds }, source: 'INFERRED' },
            select: { taskId: true },
          },
        },
      }),
      inferredUsageForTasks(taskIds),
    ])
  const sessionCountByTask = new Map<string, number>()
  for (const g of topLevelGroups) {
    if (g.taskId) sessionCountByTask.set(g.taskId, g._count._all)
  }
  for (const s of inferredSessions) {
    for (const taskId of new Set(s.attributionSegments.map(g => g.taskId))) {
      sessionCountByTask.set(taskId, (sessionCountByTask.get(taskId) ?? 0) + 1)
    }
  }
  // LUM-932 P3 hybrid cost: unattached work's per-turn usage per task, added
  // on top of the explicit sessions' cumulative columns.
  const inferredByTask = new Map<string, number>()
  for (const r of inferred) {
    inferredByTask.set(
      r.taskId,
      (inferredByTask.get(r.taskId) ?? 0) + usageMapTotal(r.usageByModel)
    )
  }

  const samples = new Map<string, TaskContextSample>()
  for (const g of groups) {
    if (!g.taskId) continue
    const sums = g._sum
    const tokenParts = [
      sums.inputTokens,
      sums.outputTokens,
      sums.cacheReadTokens,
      sums.cacheCreationTokens,
    ]
    const explicitTokens = tokenParts.every(p => p === null)
      ? null
      : tokenParts.reduce<number>((acc, p) => acc + (p ?? 0), 0)
    const inferredTokens = inferredByTask.get(g.taskId)
    const totalTokens =
      inferredTokens === undefined
        ? explicitTokens
        : (explicitTokens ?? 0) + inferredTokens

    samples.set(g.taskId, {
      taskId: g.taskId,
      sessionCount: sessionCountByTask.get(g.taskId) ?? 0,
      loopCount: sums.loopCount,
      totalTokens,
    })
  }
  // Tasks worked on only through unattached sessions: cost is measured and
  // the inferred sessions are counted; there is no explicit loop count.
  for (const [taskId, tokens] of inferredByTask) {
    if (samples.has(taskId)) continue
    samples.set(taskId, {
      taskId,
      sessionCount: sessionCountByTask.get(taskId) ?? 0,
      loopCount: null,
      totalTokens: tokens,
    })
  }
  return samples
}

/**
 * Sprint-dimension blockers. Feeds the sprint's task set into the same blocker
 * collection used for project stats. The heavier member/trend aggregation that
 * `aggregateProjectStats` computes is intentionally omitted — add it here if a
 * sprint analytics panel needs it.
 */
export async function aggregateSprintBlockers(
  sprintId: string
): Promise<TopBlockers> {
  const now = new Date()

  const [overdueTasks, stalledCandidates, failingAgentTasks, openPrs] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          sprintId,
          dueDate: { lt: now },
          status: { notIn: [...CLOSED_TASK_STATUSES] },
        },
        select: {
          id: true,
          number: true,
          title: true,
          team: { select: { identifier: true } },
        },
      }),
      prisma.task.findMany({
        where: {
          sprintId,
          status: { notIn: [...CLOSED_TASK_STATUSES] },
          updatedAt: { lt: stalledCutoff(now) },
        },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          updatedAt: true,
          team: { select: { identifier: true } },
        },
      }),
      prisma.task.findMany({
        where: { sprintId, agentStatus: 'FAILED' },
        select: {
          id: true,
          number: true,
          title: true,
          agentStatus: true,
          team: { select: { identifier: true } },
        },
      }),
      prisma.pullRequest.findMany({
        where: { task: { sprintId }, state: 'open' },
        select: { number: true, state: true, createdAt: true, url: true },
      }),
    ])

  const topBlockers = collectTopBlockers({
    tasks: stalledCandidates.map(t => ({
      id: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      updatedAt: t.updatedAt,
    })),
    agents: failingAgentTasks.map(t => ({
      taskId: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      title: t.title,
      agentStatus: t.agentStatus,
    })),
    prs: openPrs,
    now,
  })

  // collectTopBlockers only saw the stalled subset; re-populate overdue
  // blockers from the dedicated overdue query (mirrors aggregateProjectStats).
  topBlockers.overdueTaskIds = overdueTasks.slice(0, 10).map(t => ({
    id: t.id,
    identifier: `${t.team.identifier}-${t.number}`,
    title: t.title,
  }))

  return topBlockers
}
