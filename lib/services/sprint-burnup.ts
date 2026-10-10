import type { TaskStatus } from '@prisma/client'
import {
  DAY_MS,
  type StatusEvt,
  enumerateUtcDays,
  parseStatusPayload,
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
  type: 'STATUS_CHANGED'
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
  /** Member tasks created on or before this day (end-of-day). */
  scope: number
  /** Member tasks DONE at end-of-day. null for future days of an ACTIVE sprint. */
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
  for (const a of activities) {
    const p = parseStatusPayload(a.payload)
    if (!p) continue
    const arr = statusByTask.get(a.taskId) ?? []
    arr.push({ createdAt: a.createdAt, from: p.from, to: p.to })
    statusByTask.set(a.taskId, arr)
  }
  for (const arr of statusByTask.values())
    arr.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())

  /**
   * The chart records THIS sprint's tasks — the ones sitting in it now, and
   * only those. A task that was moved to another sprint is not this sprint's
   * work and is left out of every day, including the days it happened to be
   * here (LUM-717: a sprint holding 12 tasks charted a ceiling of 13 because
   * one moved-out task stayed in scope forever, and — being DONE — inflated
   * `completed` too). Status is still replayed day by day, so the curve itself
   * stays an honest record of when those tasks were finished.
   */
  const members = tasks.filter(t => t.sprintId === sprintId)

  /**
   * Member tasks created on or before eodMs and not in BACKLOG at eodMs —
   * backlog work is unscheduled and stays out of scope (LUM-1057).
   */
  function countScope(eodMs: number): number {
    let count = 0
    for (const t of members) {
      if (t.createdAt.getTime() > eodMs) continue
      if (statusAt(statusByTask.get(t.id) ?? [], eodMs, t.status) === 'BACKLOG')
        continue
      count++
    }
    return count
  }
  /** Member tasks created by eodMs AND DONE at eodMs. Always <= countScope. */
  function countCompleted(eodMs: number): number {
    let count = 0
    for (const t of members) {
      if (t.createdAt.getTime() > eodMs) continue
      if (statusAt(statusByTask.get(t.id) ?? [], eodMs, t.status) === 'DONE')
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
