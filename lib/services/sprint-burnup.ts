import type { TaskStatus } from '@prisma/client'
import {
  DAY_MS,
  type SprintEvt,
  type StatusEvt,
  enumerateUtcDays,
  parseStatusPayload,
  sprintAt,
  statusAt,
  toUtcDateKey,
  utcMidnight,
} from '@/lib/summaries/burnup-replay'

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
  /** When the sprint actually transitioned DRAFT→ACTIVE. Only used to extend the
   * window backwards when a sprint was started BEFORE its planned startDate; a
   * late startedAt never truncates the window (work done while still DRAFT must
   * stay on the chart — burnup scope/completed are meaningful before start). */
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
  return {
    fromSprintId: from as string | null,
    toSprintId: to as string | null,
  }
}

export function computeBurnupSeries(input: BurnupComputeInput): BurnupSeries {
  const {
    sprintId,
    startDate,
    startedAt,
    endDate,
    status,
    now,
    tasks,
    activities,
  } = input
  // Anchor at the EARLIER of startDate and startedAt. Normally that's startDate;
  // only an early start (started before the planned date) pulls the window back.
  // A late startedAt (sprint flipped ACTIVE after work already happened in DRAFT)
  // does NOT truncate — otherwise the real ramp collapses to a single point.
  const effectiveStart =
    startedAt && startedAt.getTime() < startDate.getTime()
      ? startedAt
      : startDate

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
    if (
      evts.some(e => e.fromSprintId === sprintId || e.toSprintId === sprintId)
    ) {
      candidates.add(taskId)
    }
  }

  /**
   * Membership is point-in-time, not "ever touched this sprint": a task counts
   * on a given day only if it sat in THIS sprint at end of that day. Without
   * this the scope kept every task that was ever moved out, so a sprint holding
   * 12 tasks charted a ceiling of 13 (LUM-717) — and the moved-out task also
   * kept inflating `completed`.
   */
  function inSprintAt(id: string, eodMs: number): boolean {
    const t = taskById.get(id)
    if (!t || t.createdAt.getTime() > eodMs) return false
    return sprintAt(sprintByTask.get(id) ?? [], eodMs, t.sprintId) === sprintId
  }

  /** Candidates that belonged to the sprint at eodMs. */
  function countScope(eodMs: number): number {
    let count = 0
    for (const id of candidates) if (inSprintAt(id, eodMs)) count++
    return count
  }
  /** In-sprint candidates that were DONE at eodMs. Always <= countScope. */
  function countCompleted(eodMs: number): number {
    let count = 0
    for (const id of candidates) {
      if (!inSprintAt(id, eodMs)) continue
      const t = taskById.get(id)!
      if (statusAt(statusByTask.get(id) ?? [], eodMs, t.status) === 'DONE')
        count++
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
    const completed =
      status === 'ACTIVE' && isFuture ? null : countCompleted(eod)
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
        const v =
          startVal + ((scopeTotal - startVal) * (i - lastActualIdx)) / span
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
