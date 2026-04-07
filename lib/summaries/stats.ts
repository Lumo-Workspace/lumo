import { prisma } from '@/lib/db/prisma'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

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
    subtasks,
    agentGroups,
    prTotal,
    prMerged,
    prOpen,
    completedRecently,
  ] = await Promise.all([
    // Status distribution
    prisma.task.groupBy({
      by: ['status'],
      where: { projectId },
      _count: { _all: true },
    }),

    // Priority distribution
    prisma.task.groupBy({
      by: ['priority'],
      where: { projectId },
      _count: { _all: true },
    }),

    // Overdue tasks
    prisma.task.findMany({
      where: {
        projectId,
        dueDate: { lt: now },
        status: { not: 'DONE' },
      },
      select: { id: true },
    }),

    // Member workload grouped by assignee + status
    prisma.task.groupBy({
      by: ['assigneeActorId', 'status'],
      where: {
        projectId,
        assigneeActorId: { not: null },
      },
      _count: { _all: true },
    }),

    // DONE tasks for avg completion time
    prisma.task.findMany({
      where: { projectId, status: 'DONE' },
      select: { createdAt: true, updatedAt: true },
    }),

    // Subtasks for completion rate
    prisma.task.findMany({
      where: {
        projectId,
        parentTaskId: { not: null },
      },
      select: { status: true },
    }),

    // Agent stats
    prisma.task.groupBy({
      by: ['agentStatus'],
      where: {
        projectId,
        agentStatus: { not: null },
      },
      _count: { _all: true },
    }),

    // PR total
    prisma.pullRequest.count({
      where: { task: { projectId } },
    }),

    // PR merged
    prisma.pullRequest.count({
      where: { task: { projectId }, state: 'merged' },
    }),

    // PR open
    prisma.pullRequest.count({
      where: { task: { projectId }, state: 'open' },
    }),

    // Completed tasks in last 30 days for trend
    prisma.task.findMany({
      where: {
        projectId,
        status: 'DONE',
        updatedAt: {
          gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: { updatedAt: true },
    }),
  ])

  // Build status distribution
  const statusDistribution: Record<string, number> = {}
  let totalTasks = 0
  for (const g of statusGroups) {
    const count = g._count._all
    statusDistribution[g.status] = count
    totalTasks += count
  }

  // Build priority distribution
  const priorityDistribution: Record<string, number> = {}
  for (const g of priorityGroups) {
    priorityDistribution[g.priority] = g._count._all
  }

  // Overdue tasks
  const overdueTaskIds = overdueTasks.map(t => t.id)

  // Member workload
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
  for (const actor of actors) {
    const name =
      actor.type === 'AGENT' && actor.agent
        ? actor.agent.name
        : (actor.member?.clerkId ?? actor.id)
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
    if (g.status === 'DONE') {
      entry.completed += g._count._all
    }
    workloadMap.set(g.assigneeActorId, entry)
  }

  const memberWorkload = Array.from(workloadMap.entries()).map(
    ([actorId, counts]) => ({
      actorId,
      name: actorNameMap.get(actorId) ?? actorId,
      ...counts,
    })
  )

  // Completion trend: group by date string
  const trendMap = new Map<string, number>()
  for (const t of completedRecently) {
    const dateKey = t.updatedAt.toISOString().slice(0, 10)
    trendMap.set(dateKey, (trendMap.get(dateKey) ?? 0) + 1)
  }
  const completionTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, completed]) => ({ date, completed }))

  // Avg completion time in hours
  let avgCompletionTime: number | null = null
  if (doneTasks.length > 0) {
    const totalMs = doneTasks.reduce(
      (sum, t) => sum + (t.updatedAt.getTime() - t.createdAt.getTime()),
      0
    )
    avgCompletionTime = totalMs / doneTasks.length / (1000 * 60 * 60)
  }

  // Subtask completion rate
  let subtaskCompletionRate: number | null = null
  if (subtasks.length > 0) {
    const doneSubtasks = subtasks.filter(t => t.status === 'DONE').length
    subtaskCompletionRate = doneSubtasks / subtasks.length
  }

  // Agent stats
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

  return {
    totalTasks,
    statusDistribution,
    priorityDistribution,
    overdueTasks: { count: overdueTaskIds.length, taskIds: overdueTaskIds },
    memberWorkload,
    completionTrend,
    avgCompletionTime,
    subtaskCompletionRate,
    agentStats,
    prStats: { total: prTotal, merged: prMerged, open: prOpen },
  }
}

export async function aggregateWorkspaceStats(
  workspaceId: string
): Promise<WorkspaceSummaryStats> {
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  })

  const [baseStats, projectCounts] = await Promise.all([
    // aggregate all tasks across the workspace using aggregateProjectStats
    // but we need workspace-level stats, so run individual project stats and merge
    Promise.all(projects.map(p => aggregateProjectStats(p.id))),

    // per-project breakdown counts
    Promise.all(
      projects.map(async p => {
        const [total, completed, overdue] = await Promise.all([
          prisma.task.count({ where: { projectId: p.id } }),
          prisma.task.count({ where: { projectId: p.id, status: 'DONE' } }),
          prisma.task.count({
            where: {
              projectId: p.id,
              dueDate: { lt: new Date() },
              status: { not: 'DONE' },
            },
          }),
        ])
        return {
          projectId: p.id,
          projectName: p.name,
          totalTasks: total,
          completedTasks: completed,
          overdueTasks: overdue,
        }
      })
    ),
  ])

  // Merge all project stats into workspace-level stats
  const merged = mergeStats(baseStats)

  const projectBreakdown = projectCounts

  return {
    ...merged,
    projectBreakdown,
  }
}

function mergeStats(statsList: TaskSummaryStats[]): TaskSummaryStats {
  const statusDistribution: Record<string, number> = {}
  const priorityDistribution: Record<string, number> = {}
  let totalTasks = 0
  const overdueTaskIds: string[] = []
  const memberWorkloadMap = new Map<
    string,
    { name: string; assigned: number; completed: number }
  >()
  const trendMap = new Map<string, number>()
  let totalCompletionMs = 0
  let completionCount = 0
  let totalSubtasks = 0
  let doneSubtasks = 0
  const agentStats = { total: 0, completed: 0, failed: 0, working: 0 }
  let prTotal = 0
  let prMerged = 0
  let prOpen = 0

  for (const s of statsList) {
    totalTasks += s.totalTasks

    for (const [k, v] of Object.entries(s.statusDistribution)) {
      statusDistribution[k] = (statusDistribution[k] ?? 0) + v
    }
    for (const [k, v] of Object.entries(s.priorityDistribution)) {
      priorityDistribution[k] = (priorityDistribution[k] ?? 0) + v
    }

    overdueTaskIds.push(...s.overdueTasks.taskIds)

    for (const m of s.memberWorkload) {
      const existing = memberWorkloadMap.get(m.actorId)
      if (existing) {
        existing.assigned += m.assigned
        existing.completed += m.completed
      } else {
        memberWorkloadMap.set(m.actorId, {
          name: m.name,
          assigned: m.assigned,
          completed: m.completed,
        })
      }
    }

    for (const t of s.completionTrend) {
      trendMap.set(t.date, (trendMap.get(t.date) ?? 0) + t.completed)
    }

    if (s.avgCompletionTime !== null) {
      totalCompletionMs += s.avgCompletionTime
      completionCount++
    }

    if (s.subtaskCompletionRate !== null) {
      // approximate by weighting equally (we don't have raw counts here)
      doneSubtasks += s.subtaskCompletionRate
      totalSubtasks++
    }

    agentStats.total += s.agentStats.total
    agentStats.completed += s.agentStats.completed
    agentStats.failed += s.agentStats.failed
    agentStats.working += s.agentStats.working

    prTotal += s.prStats.total
    prMerged += s.prStats.merged
    prOpen += s.prStats.open
  }

  const memberWorkload = Array.from(memberWorkloadMap.entries()).map(
    ([actorId, v]) => ({ actorId, ...v })
  )

  const completionTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, completed]) => ({ date, completed }))

  return {
    totalTasks,
    statusDistribution,
    priorityDistribution,
    overdueTasks: { count: overdueTaskIds.length, taskIds: overdueTaskIds },
    memberWorkload,
    completionTrend,
    avgCompletionTime:
      completionCount > 0 ? totalCompletionMs / completionCount : null,
    subtaskCompletionRate:
      totalSubtasks > 0 ? doneSubtasks / totalSubtasks : null,
    agentStats,
    prStats: { total: prTotal, merged: prMerged, open: prOpen },
  }
}
