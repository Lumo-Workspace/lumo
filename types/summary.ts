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
}

export interface WorkspaceSummaryStats extends TaskSummaryStats {
  projectBreakdown: Array<{
    projectId: string
    projectName: string
    totalTasks: number
    completedTasks: number
    overdueTasks: number
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
