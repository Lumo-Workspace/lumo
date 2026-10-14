/**
 * LUM-1100 — `GET /api/report` payload: token usage + completed tasks over a
 * time window. Versioned so agents parsing `lumo report --json` can detect a
 * shape change. Token figures use the same attribution as `lumo cost`.
 */

export interface ReportTokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}

export interface ReportModelRow extends ReportTokenTotals {
  model: string
}

export interface ReportCompletedTask {
  identifier: string
  title: string
  /** ISO instant of the task's LAST transition into DONE. */
  completedAt: string
  /** Member credited with the task (assignee, or the owner of a personal agent). */
  memberId: string | null
  /** Display label of the assignee (member label or agent name); null = unassigned. */
  assignee: string | null
}

export interface ReportMemberRow {
  /** null = completed tasks with no human owner (unassigned / shared agent). */
  memberId: string | null
  label: string
  tokens: ReportTokenTotals
  /**
   * LUM-1123: the member's tokens split per model, total desc. The cells sum
   * exactly to `tokens` (each cell is made whole once; coarser figures are sums
   * of those whole cells). Empty when the member recorded no token usage.
   */
  byModel: ReportModelRow[]
  /** Sessions with activity in the window. */
  sessions: number
  /** Sessions with activity but no recorded token usage — NOT counted as 0 tokens. */
  unmeteredSessions: number
  completedCount: number
}

export interface ReportResponse {
  version: 1
  /** Half-open window [since, until), ISO instants. */
  window: { since: string; until: string }
  filter: { memberId: string | null; projectId: string | null }
  team: {
    tokens: ReportTokenTotals
    sessions: number
    unmeteredSessions: number
    completedCount: number
    byModel: ReportModelRow[]
  }
  /** Per-member split, sorted by total tokens desc then completed count desc. */
  byMember: ReportMemberRow[]
  completedTasks: {
    /** Tasks completed in the window (before `limit` truncation). */
    total: number
    /** Newest completion first, at most `limit` rows. */
    items: ReportCompletedTask[]
  }
}
