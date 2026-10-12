import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  reportRepository,
  type DoneTransitionRow,
  type ReportTaskRow,
} from '@/lib/repositories/report.repository'
import {
  attributeOperationCost,
  type OperationCostRow,
} from '@/lib/agent-run/operation-cost'
import type { ModelUsage } from '@/lib/services/model-cost'
import { parseStatusPayload } from '@/lib/summaries/burnup-replay'
import type {
  ReportCompletedTask,
  ReportMemberRow,
  ReportModelRow,
  ReportResponse,
  ReportTokenTotals,
} from '@/types/report'

export const REPORT_DEFAULT_WINDOW_DAYS = 7
/** Widest window one request may ask for (bounds the hook-event scan). */
export const REPORT_MAX_WINDOW_DAYS = 366
export const REPORT_DEFAULT_LIMIT = 50
export const REPORT_MAX_LIMIT = 500
/** byMember key for completed tasks with no human owner. */
export const UNASSIGNED_LABEL = '(unassigned)'

const DAY_MS = 24 * 60 * 60 * 1000

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export interface ReportInput {
  since: Date
  until: Date
  memberId?: string | undefined
  projectRef?: string | undefined
  limit?: number | undefined
}

// ── pure folds ─────────────────────────────────────────────────────────────

/**
 * Completion time of each task = its LAST transition into DONE. A task that
 * went DONE → reopened → DONE counts once, at the final DONE; a task whose
 * last DONE is after the window is not "completed in" the window even if an
 * earlier DONE was. (The repository only returns tasks that are DONE now.)
 */
export function lastDoneAt(rows: DoneTransitionRow[]): Map<string, Date> {
  const out = new Map<string, Date>()
  for (const r of rows) {
    if (parseStatusPayload(r.payload)?.to !== 'DONE') continue
    const cur = out.get(r.taskId)
    if (!cur || r.createdAt.getTime() > cur.getTime())
      out.set(r.taskId, r.createdAt)
  }
  return out
}

/** Tasks whose completion falls in the half-open window [since, until). */
export function completionsInWindow(
  doneAt: Map<string, Date>,
  since: Date,
  until: Date
): Map<string, Date> {
  const out = new Map<string, Date>()
  for (const [id, at] of doneAt) {
    const t = at.getTime()
    if (t >= since.getTime() && t < until.getTime()) out.set(id, at)
  }
  return out
}

function zeroTotals(): ReportTokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }
}

function addRow(t: ReportTokenTotals, r: OperationCostRow): void {
  t.input += r.input
  t.output += r.output
  t.cacheRead += r.cacheRead
  t.cacheCreation += r.cacheCreation
  t.total += r.input + r.output + r.cacheRead + r.cacheCreation
}

export interface SessionEventLike {
  sessionId: string | null
  workspaceMemberId: string | null
  usageByModel: unknown
}

/**
 * Sessions seen per member, and which of them never recorded token usage.
 * An unmetered session is NOT a zero-token session — it is reported as a
 * separate count so a total never silently understates (null ≠ 0).
 */
export function sessionCoverage(
  events: SessionEventLike[]
): Map<string, { sessions: Set<string>; metered: Set<string> }> {
  const out = new Map<string, { sessions: Set<string>; metered: Set<string> }>()
  for (const e of events) {
    if (!e.sessionId) continue
    const key = e.workspaceMemberId ?? ''
    const cur = out.get(key) ?? { sessions: new Set(), metered: new Set() }
    cur.sessions.add(e.sessionId)
    if (e.usageByModel != null) cur.metered.add(e.sessionId)
    out.set(key, cur)
  }
  return out
}

export interface BuildReportInput {
  since: Date
  until: Date
  memberId: string | null
  projectId: string | null
  limit: number
  costRows: OperationCostRow[]
  coverage: Map<string, { sessions: Set<string>; metered: Set<string> }>
  completions: Map<string, Date>
  tasks: ReportTaskRow[]
  memberLabels: Map<string, string>
}

/** Assemble the versioned payload. Pure: no clock, no I/O. */
export function buildReport(input: BuildReportInput): ReportResponse {
  const teamTokens = zeroTotals()
  const byModel = new Map<string, ReportModelRow>()
  const members = new Map<string | null, ReportMemberRow>()
  const labelOf = (id: string | null) =>
    id === null ? UNASSIGNED_LABEL : (input.memberLabels.get(id) ?? id)
  const member = (id: string | null): ReportMemberRow => {
    let row = members.get(id)
    if (!row) {
      row = {
        memberId: id,
        label: labelOf(id),
        tokens: zeroTotals(),
        sessions: 0,
        unmeteredSessions: 0,
        completedCount: 0,
      }
      members.set(id, row)
    }
    return row
  }

  for (const r of input.costRows) {
    addRow(teamTokens, r)
    const m = byModel.get(r.model) ?? { model: r.model, ...zeroTotals() }
    addRow(m, r)
    byModel.set(r.model, m)
    addRow(member(r.workspaceMemberId).tokens, r)
  }

  let sessions = 0
  let unmetered = 0
  for (const [key, cov] of input.coverage) {
    const row = member(key === '' ? null : key)
    row.sessions += cov.sessions.size
    row.unmeteredSessions += cov.sessions.size - cov.metered.size
    sessions += cov.sessions.size
    unmetered += cov.sessions.size - cov.metered.size
  }

  const taskById = new Map(input.tasks.map(t => [t.id, t]))
  const completed: ReportCompletedTask[] = []
  for (const [id, at] of input.completions) {
    const t = taskById.get(id)
    if (!t) continue
    if (input.memberId && t.assigneeMemberId !== input.memberId) continue
    member(t.assigneeMemberId).completedCount += 1
    completed.push({
      identifier: t.identifier,
      title: t.title,
      completedAt: at.toISOString(),
      memberId: t.assigneeMemberId,
      assignee: t.assigneeMemberId
        ? labelOf(t.assigneeMemberId)
        : t.assigneeAgentName,
    })
  }
  completed.sort(
    (a, b) =>
      b.completedAt.localeCompare(a.completedAt) ||
      a.identifier.localeCompare(b.identifier)
  )

  // --member: the member's own row always shows, even with no activity.
  if (input.memberId) member(input.memberId)

  const byMember = [...members.values()]
    .filter(m => !input.memberId || m.memberId === input.memberId)
    .sort(
      (a, b) =>
        b.tokens.total - a.tokens.total ||
        b.completedCount - a.completedCount ||
        a.label.localeCompare(b.label)
    )

  return {
    version: 1,
    window: {
      since: input.since.toISOString(),
      until: input.until.toISOString(),
    },
    filter: { memberId: input.memberId, projectId: input.projectId },
    team: {
      tokens: teamTokens,
      sessions,
      unmeteredSessions: unmetered,
      completedCount: completed.length,
      byModel: [...byModel.values()].sort((a, b) => b.total - a.total),
    },
    byMember,
    completedTasks: {
      total: completed.length,
      items: completed.slice(0, input.limit),
    },
  }
}

/** Validate the window + limit; throws a 400-status Error when invalid. */
export function validateReportInput(input: ReportInput): number {
  const s = input.since.getTime()
  const u = input.until.getTime()
  if (Number.isNaN(s) || Number.isNaN(u)) httpError(400, 'Invalid date')
  if (s >= u) httpError(400, '`since` must be before `until`')
  if (u - s > REPORT_MAX_WINDOW_DAYS * DAY_MS)
    httpError(400, `Window too wide (max ${REPORT_MAX_WINDOW_DAYS} days)`)
  const limit = input.limit ?? REPORT_DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > REPORT_MAX_LIMIT)
    httpError(400, `limit must be an integer 1–${REPORT_MAX_LIMIT}`)
  return limit
}

// ── orchestration ──────────────────────────────────────────────────────────

export const reportService = {
  async getReport(
    workspaceId: string,
    input: ReportInput
  ): Promise<ReportResponse> {
    const limit = validateReportInput(input)
    const memberId = input.memberId ?? null

    if (memberId) {
      const m = await memberRepository.findById(memberId)
      // Tenancy guard: never label / report a member of another workspace.
      if (!m || m.workspaceId !== workspaceId)
        httpError(404, 'member not found')
    }

    let projectId: string | null = null
    if (input.projectRef) {
      const { resolveProjectId } =
        await import('@/lib/services/task-cli.service')
      projectId = await resolveProjectId(workspaceId, input.projectRef)
    }
    const taskIds = projectId
      ? await reportRepository.listProjectTaskIds(workspaceId, projectId)
      : undefined

    const [events, transitions] = await Promise.all([
      taskIds && taskIds.length === 0
        ? Promise.resolve([])
        : hookEventRepository.findToolAttributionEvents({
            workspaceId,
            since: input.since,
            until: input.until,
            workspaceMemberId: memberId ?? undefined,
            taskIds,
          }),
      reportRepository.listDoneTransitionsSince({
        workspaceId,
        since: input.since,
        projectId: projectId ?? undefined,
      }),
    ])

    const { rows } = attributeOperationCost(
      events.map(e => ({
        sessionId: e.sessionId,
        workspaceMemberId: e.workspaceMemberId,
        type: e.type,
        toolName: e.toolName,
        toolDetail: e.toolDetail,
        toolVerb: e.toolVerb,
        usageByModel: e.usageByModel as Record<string, ModelUsage> | null,
        createdAt: e.createdAt,
      }))
    )

    const completions = completionsInWindow(
      lastDoneAt(transitions),
      input.since,
      input.until
    )
    const tasks = await reportRepository.findTasksForReport(workspaceId, [
      ...completions.keys(),
    ])

    const ids = new Set<string>()
    for (const r of rows) if (r.workspaceMemberId) ids.add(r.workspaceMemberId)
    for (const t of tasks) if (t.assigneeMemberId) ids.add(t.assigneeMemberId)
    if (memberId) ids.add(memberId)
    const memberLabels = await memberRepository.labelsByIds([...ids])

    return buildReport({
      since: input.since,
      until: input.until,
      memberId,
      projectId,
      limit,
      costRows: rows,
      coverage: sessionCoverage(events),
      completions,
      tasks,
      memberLabels,
    })
  },
}

/** Default window when the caller sends none: the last 7×24h up to `now`. */
export function defaultReportWindow(now: Date): { since: Date; until: Date } {
  return {
    since: new Date(now.getTime() - REPORT_DEFAULT_WINDOW_DAYS * DAY_MS),
    until: now,
  }
}
