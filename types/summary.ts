export type RiskLevel = 'healthy' | 'watch' | 'at-risk'

export type RiskReasonCode =
  | 'overdue_ratio_high'
  | 'stalled_tasks'
  | 'agent_failure_rate'
  | 'stale_open_prs'
  | 'throughput_drop'

export interface RiskReason {
  code: RiskReasonCode
  detail: string
}

export interface RiskAssessment {
  level: RiskLevel
  score: number
  reasons: RiskReason[]
}

export interface TopBlockerItem {
  id: string
  identifier: string
  title: string
}

/**
 * A stalled task, carrying the timestamp the Signal tab's UPDATED / IDLE
 * columns render from. Only the stalled list gets it — overdue and
 * failing-agent items are sourced from queries that don't select `updatedAt`,
 * and neither surface needs an idle duration.
 */
export interface StalledBlockerItem extends TopBlockerItem {
  /** ISO string — the serialized shape, as it crosses the API boundary. */
  updatedAt: string
}

/** An open PR that has been awaiting review past the stale threshold. */
export interface StalePrItem {
  number: number
  /** ISO string — when the PR was opened, for the "in review Nd" read-out. */
  openedAt: string
}

export interface TopBlockers {
  overdueTaskIds: TopBlockerItem[]
  stalledTaskIds: StalledBlockerItem[]
  failingAgentTaskIds: TopBlockerItem[]
  /**
   * Bare PR numbers. Kept as-is deliberately: published @lumoai/cli versions
   * render this list directly (`sprint show`), so the shape is a compatibility
   * contract. Richer detail goes in `staleOpenPrs` alongside it.
   */
  staleOpenPrNumbers: number[]
  staleOpenPrs: StalePrItem[]
  /**
   * Stalled tasks that also carry heavy accumulated agent context — expensive
   * to abandon, expensive to restart. A subset of `stalledTaskIds`, surfaced
   * separately so the costly ones are visible above the full table.
   */
  highContextTaskIds: StalledBlockerItem[]
}

export interface TaskSummaryStats {
  totalTasks: number
  statusDistribution: Record<string, number>
  priorityDistribution: Record<string, number>
  overdueTasks: { count: number; taskIds: string[] }
  memberWorkload: Array<{
    actorId: string
    name: string
    assigned: number
    completed: number
  }>
  completionTrend: Array<{ date: string; completed: number }>
  avgCompletionTime: number | null
  subtaskCompletionRate: number | null
  agentStats: {
    total: number
    completed: number
    failed: number
    working: number
  }
  prStats: { total: number; merged: number; open: number }
  risk: RiskAssessment
  topBlockers: TopBlockers
}

export interface WorkspaceSummaryStats extends TaskSummaryStats {
  projectBreakdown: Array<{
    projectId: string
    projectName: string
    totalTasks: number
    completedTasks: number
    overdueTasks: number
    risk: RiskAssessment
  }>
}

export interface ApiProjectSummary {
  id: string
  projectId: string
  stats: TaskSummaryStats
  tldr: string
  report: string
  generatedAt: string
}

export interface ApiWorkspaceSummary {
  id: string
  workspaceId: string
  stats: WorkspaceSummaryStats
  tldr: string
  report: string
  generatedAt: string
}
