import type { TaskStatus } from '@prisma/client'

export interface BurnupTaskInput {
  id: string
  sprintId: string | null
  status: TaskStatus
  createdAt: Date
}

export interface BurnupActivityInput {
  taskId: string
  type: 'STATUS_CHANGED' | 'SPRINT_CHANGED'
  payload: unknown
  createdAt: Date
}

export interface BurnupComputeInput {
  sprintId: string
  startDate: Date
  /** When the sprint actually transitioned DRAFT→ACTIVE. Window starts here (falls back to startDate when null) so pre-start empty days don't dominate. */
  startedAt?: Date | null
  endDate: Date
  status: 'ACTIVE' | 'CLOSED'
  now: Date
  tasks: BurnupTaskInput[]
  activities: BurnupActivityInput[]
}

export interface BurnupPoint {
  date: string
  /** Committed work known by end-of-day: candidates created on or before this day. */
  scope: number
  /** Candidates DONE at end-of-day. null for future days of an ACTIVE sprint. */
  completed: number | null
  /** Projection segment only: linear from today's completed to (end, scopeTotal). null elsewhere. */
  projected: number | null
}

export interface BurnupSeries {
  sprintId: string
  start: string
  end: string
  unit: 'tasks'
  /** Final scope = y-axis max. */
  scopeTotal: number
  series: BurnupPoint[]
}

interface StatusEvt {
  createdAt: Date
  from: TaskStatus
  to: TaskStatus
}
interface SprintEvt {
  createdAt: Date
  fromSprintId: string | null
  toSprintId: string | null
}

const DAY_MS = 86_400_000

function toUtcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
function enumerateUtcDays(start: Date, end: Date): Date[] {
  const days: Date[] = []
  let cur = utcMidnight(start)
  const last = utcMidnight(end)
  while (cur <= last) {
    days.push(new Date(cur))
    cur += DAY_MS
  }
  return days
}

function parseStatusPayload(
  p: unknown
): { from: TaskStatus; to: TaskStatus } | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (typeof o.from !== 'string' || typeof o.to !== 'string') return null
  // Cast unchecked: only `=== 'DONE'` is compared downstream, so an unexpected
  // enum value safely counts as "not done" rather than throwing.
  return { from: o.from as TaskStatus, to: o.to as TaskStatus }
}

function parseSprintPayload(
  p: unknown
): { fromSprintId: string | null; toSprintId: string | null } | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (!('fromSprintId' in o) || !('toSprintId' in o)) return null
  const from = o.fromSprintId
  const to = o.toSprintId
  const okFrom = from === null || typeof from === 'string'
  const okTo = to === null || typeof to === 'string'
  if (!okFrom || !okTo) return null
  return { fromSprintId: from as string | null, toSprintId: to as string | null }
}

/** State of a step-function at time tMs: last event whose createdAt <= tMs. */
function statusAt(events: StatusEvt[], tMs: number, fallback: TaskStatus): TaskStatus {
  const first = events[0]
  if (!first) return fallback
  let chosen: StatusEvt | null = null
  for (const e of events) {
    if (e.createdAt.getTime() <= tMs) chosen = e
    else break
  }
  return chosen ? chosen.to : first.from
}

export function computeBurnupSeries(input: BurnupComputeInput): BurnupSeries {
  const { sprintId, startDate, startedAt, endDate, status, now, tasks, activities } =
    input
  const effectiveStart = startedAt ?? startDate

  const statusByTask = new Map<string, StatusEvt[]>()
  const sprintByTask = new Map<string, SprintEvt[]>()
  for (const a of activities) {
    if (a.type === 'STATUS_CHANGED') {
      const p = parseStatusPayload(a.payload)
      if (!p) continue
      const arr = statusByTask.get(a.taskId) ?? []
      arr.push({ createdAt: a.createdAt, from: p.from, to: p.to })
      statusByTask.set(a.taskId, arr)
    } else if (a.type === 'SPRINT_CHANGED') {
      const p = parseSprintPayload(a.payload)
      if (!p) continue
      const arr = sprintByTask.get(a.taskId) ?? []
      arr.push({
        createdAt: a.createdAt,
        fromSprintId: p.fromSprintId,
        toSprintId: p.toSprintId,
      })
      sprintByTask.set(a.taskId, arr)
    }
  }
  for (const arr of statusByTask.values())
    arr.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
  for (const arr of sprintByTask.values())
    arr.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())

  const taskById = new Map(tasks.map(t => [t.id, t]))
  const candidates = new Set<string>()
  for (const t of tasks) if (t.sprintId === sprintId) candidates.add(t.id)
  for (const [taskId, evts] of sprintByTask) {
    if (evts.some(e => e.fromSprintId === sprintId || e.toSprintId === sprintId)) {
      candidates.add(taskId)
    }
  }

  /** Candidates created on or before eodMs. */
  function countScope(eodMs: number): number {
    let count = 0
    for (const id of candidates) {
      const created = taskById.get(id)?.createdAt.getTime()
      if (created !== undefined && created <= eodMs) count++
    }
    return count
  }
  /** Candidates created on or before eodMs AND DONE at eodMs. Always <= countScope. */
  function countCompleted(eodMs: number): number {
    let count = 0
    for (const id of candidates) {
      const t = taskById.get(id)
      if (!t || t.createdAt.getTime() > eodMs) continue
      if (statusAt(statusByTask.get(id) ?? [], eodMs, t.status) === 'DONE') count++
    }
    return count
  }

  const days = enumerateUtcDays(effectiveStart, endDate)
  const firstDay = days[0]
  if (!firstDay) {
    return {
      sprintId,
      start: toUtcDateKey(effectiveStart),
      end: toUtcDateKey(endDate),
      unit: 'tasks',
      scopeTotal: 0,
      series: [],
    }
  }
  const lastDay = days[days.length - 1] ?? firstDay
  const nowMs = now.getTime()
  const n = days.length
  const scopeTotal = countScope(utcMidnight(lastDay) + DAY_MS - 1)

  const series: BurnupPoint[] = days.map(day => {
    const eod = utcMidnight(day) + DAY_MS - 1
    const isFuture = utcMidnight(day) > nowMs
    const scope = countScope(eod)
    const completed = status === 'ACTIVE' && isFuture ? null : countCompleted(eod)
    return { date: toUtcDateKey(day), scope, completed, projected: null }
  })

  if (status === 'ACTIVE') {
    // Last day that is not in the future = the anchor for the projection.
    let lastActualIdx = -1
    for (let i = 0; i < n; i++) {
      const d = days[i]
      if (d && utcMidnight(d) <= nowMs) lastActualIdx = i
    }
    const anchor = lastActualIdx >= 0 ? series[lastActualIdx] : undefined
    if (anchor && anchor.completed !== null && lastActualIdx < n - 1) {
      const startVal = anchor.completed
      const span = n - 1 - lastActualIdx
      for (let i = lastActualIdx; i < n; i++) {
        const p = series[i]
        if (!p) continue
        const v = startVal + ((scopeTotal - startVal) * (i - lastActualIdx)) / span
        p.projected = Math.round(v * 100) / 100
      }
    }
  }

  return {
    sprintId,
    start: toUtcDateKey(firstDay),
    end: toUtcDateKey(lastDay),
    unit: 'tasks',
    scopeTotal,
    series,
  }
}
