import { prisma } from '@/lib/db/prisma'
import { enrichClerkUsers } from '@/lib/utils/clerk-helpers'
import type {
  TaskSummaryStats,
  WorkspaceSummaryStats,
  RiskAssessment,
  TopBlockers,
  RiskLevel,
  RiskReason,
} from '@/types/summary'
import {
  computeRisk,
  collectTopBlockers,
  type RiskConfig,
  type RiskSignals,
} from './risk'

const EMPTY_RISK: RiskAssessment = { level: 'healthy', score: 0, reasons: [] }
const EMPTY_BLOCKERS: TopBlockers = {
  overdueTaskIds: [],
  stalledTaskIds: [],
  failingAgentTaskIds: [],
  staleOpenPrNumbers: [],
}

export async function aggregateProjectStats(
  projectId: string,
  config: RiskConfig
): Promise<TaskSummaryStats> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

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
    // New queries for risk signals and top blockers
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
        status: { not: 'DONE' },
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
      },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: { projectId, status: 'DONE' },
      select: { createdAt: true, updatedAt: true },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        parentTaskId: { not: null },
      },
      select: { status: true },
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
        updatedAt: {
          gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: { updatedAt: true },
    }),
    // Stalled candidates: not done/cancelled, updated before stalledDays cutoff
    prisma.task.findMany({
      where: {
        projectId,
        status: { notIn: ['DONE'] },
        updatedAt: {
          lt: new Date(
            now.getTime() - config.stalledDays * 24 * 60 * 60 * 1000
          ),
        },
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
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
      select: { number: true, state: true, createdAt: true },
    }),
  ])

  const statusDistribution: Record<string, number> = {}
  let totalTasks = 0
  for (const g of statusGroups) {
    const count = g._count._all
    statusDistribution[g.status] = count
    totalTasks += count
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
    clerkIds.length > 0 ? await enrichClerkUsers(clerkIds) : new Map()

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

  // Completion trend + week-over-week throughput
  const trendMap = new Map<string, number>()
  let last7dCompleted = 0
  let prev7dCompleted = 0
  for (const t of completedRecently) {
    const dateKey = t.updatedAt.toISOString().slice(0, 10)
    trendMap.set(dateKey, (trendMap.get(dateKey) ?? 0) + 1)
    if (t.updatedAt >= sevenDaysAgo) {
      last7dCompleted++
    } else if (t.updatedAt >= fourteenDaysAgo) {
      prev7dCompleted++
    }
  }
  const completionTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, completed]) => ({ date, completed }))

  let avgCompletionTime: number | null = null
  if (doneTasks.length > 0) {
    const totalMs = doneTasks.reduce(
      (sum, t) => sum + (t.updatedAt.getTime() - t.createdAt.getTime()),
      0
    )
    avgCompletionTime = totalMs / doneTasks.length / (1000 * 60 * 60)
  }

  let subtaskCompletionRate: number | null = null
  if (subtasks.length > 0) {
    const doneSubtasks = subtasks.filter(t => t.status === 'DONE').length
    subtaskCompletionRate = doneSubtasks / subtasks.length
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

  // Assemble the "base" stats (without risk yet)
  const baseStats: Omit<TaskSummaryStats, 'risk' | 'topBlockers'> = {
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

  const stalePrCutoff = new Date(
    now.getTime() - config.stalePrDays * 24 * 60 * 60 * 1000
  )
  const staleOpenPrCount = openPrs.filter(
    p => p.createdAt < stalePrCutoff
  ).length

  const signals: RiskSignals = {
    stalledTaskCount: stalledCandidates.length,
    staleOpenPrCount,
    last7dCompleted,
    prev7dCompleted,
  }

  const risk = computeRisk(
    { ...baseStats, risk: EMPTY_RISK, topBlockers: EMPTY_BLOCKERS },
    signals,
    config
  )

  const topBlockers = collectTopBlockers({
    tasks: stalledCandidates.map(t => ({
      id: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      title: t.title,
      status: t.status,
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
    config,
  })

  // Re-populate overdue blockers from the overdue query (collectTopBlockers
  // only saw the stalled subset)
  topBlockers.overdueTaskIds = overdueTasks
    .slice(0, 10)
    .map(t => ({
      id: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      title: t.title,
    }))

  return { ...baseStats, risk, topBlockers }
}

export async function aggregateWorkspaceStats(
  workspaceId: string,
  workspaceConfig: RiskConfig,
  projectRiskOverrides: Map<string, ProjectRiskOverride | null>
): Promise<WorkspaceSummaryStats> {
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  })

  // Build per-project effective configs via the overrides map
  const projectStatsList = await Promise.all(
    projects.map(async p => {
      const override = projectRiskOverrides.get(p.id) ?? null
      const effective = override
        ? {
            overdueRatio:
              override.riskOverdueRatio ?? workspaceConfig.overdueRatio,
            stalledDays:
              override.riskStalledDays ?? workspaceConfig.stalledDays,
            stalledMinCount:
              override.riskStalledMinCount ?? workspaceConfig.stalledMinCount,
            agentFailRatio:
              override.riskAgentFailRatio ?? workspaceConfig.agentFailRatio,
            stalePrDays:
              override.riskStalePrDays ?? workspaceConfig.stalePrDays,
            throughputDrop:
              override.riskThroughputDrop ?? workspaceConfig.throughputDrop,
          }
        : workspaceConfig
      return { project: p, stats: await aggregateProjectStats(p.id, effective) }
    })
  )

  const projectCounts = await Promise.all(
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
  )

  const merged = mergeStats(projectStatsList.map(ps => ps.stats))

  // Project breakdown enriched with risk
  const riskByProject = new Map<string, RiskAssessment>()
  for (const { project, stats } of projectStatsList) {
    riskByProject.set(project.id, stats.risk)
  }
  const projectBreakdown = projectCounts.map(pc => ({
    ...pc,
    risk: riskByProject.get(pc.projectId) ?? EMPTY_RISK,
  }))

  // Workspace-level risk = max-of-projects (dominant level wins)
  const levels = Array.from(riskByProject.values()).map(r => r.level)
  let workspaceLevel: RiskLevel = 'healthy'
  for (const l of levels) {
    if (l === 'at-risk') {
      workspaceLevel = 'at-risk'
      break
    }
    if (l === 'watch') workspaceLevel = 'watch'
  }

  // Aggregate workspace reasons: top 3 at-risk project names as synthetic reasons
  const atRiskProjects = projectBreakdown
    .filter(p => p.risk.level === 'at-risk')
    .slice(0, 3)
  const aggregateReasons: RiskReason[] = atRiskProjects.map(p => ({
    code: 'overdue_ratio_high', // reuse existing code; narrator will summarize
    detail: `Project "${p.projectName}" is at risk (${p.overdueTasks} overdue)`,
  }))

  const workspaceRisk: RiskAssessment = {
    level: workspaceLevel,
    score: 0,
    reasons: aggregateReasons,
  }

  return {
    ...merged,
    risk: workspaceRisk,
    topBlockers: EMPTY_BLOCKERS, // workspace-level: project tab only
    projectBreakdown,
  }
}

// Helper type to describe project-level override columns (all nullable)
export interface ProjectRiskOverride {
  riskOverdueRatio: number | null
  riskStalledDays: number | null
  riskStalledMinCount: number | null
  riskAgentFailRatio: number | null
  riskStalePrDays: number | null
  riskThroughputDrop: number | null
}

function mergeStats(
  statsList: TaskSummaryStats[]
): Omit<TaskSummaryStats, 'risk' | 'topBlockers'> {
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
