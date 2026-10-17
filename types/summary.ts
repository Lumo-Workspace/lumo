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
  /** Drives the priority dot the Signal rows lead with. */
  priority: TaskPriority
}

/** Mirrors the Prisma `Priority` enum; declared here so this module stays
 *  free of workspace-UI imports. */
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

/** An open PR that has been awaiting review past the stale threshold. */
export interface StalePrItem {
  number: number
  /** ISO string — when the PR was opened, for the "in review Nd" read-out. */
  openedAt: string
  /** GitHub URL, so a stale PR is one click from being unblocked. */
  url: string
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
   * Stalled tasks whose stalling actually costs something — either declared
   * important (URGENT/HIGH priority) or already carrying heavy accumulated
   * agent context. A subset of `stalledTaskIds`, surfaced separately so the
   * ones that matter stay visible above the full table.
   */
  highStakesTaskIds: StalledBlockerItem[]
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
  agentStats: {
    total: number
    completed: number
    failed: number
    working: number
  }
  prStats: { total: number; merged: number; open: number }
  topBlockers: TopBlockers
}

export interface ApiProjectSummary {
  id: string
  projectId: string
  stats: TaskSummaryStats
  tldr: string
  report: string
  generatedAt: string
}
