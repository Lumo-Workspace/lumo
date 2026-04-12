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

export interface TopBlockers {
  overdueTaskIds: TopBlockerItem[]
  stalledTaskIds: TopBlockerItem[]
  failingAgentTaskIds: TopBlockerItem[]
  staleOpenPrNumbers: number[]
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
