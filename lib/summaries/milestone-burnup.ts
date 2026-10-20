import type { TaskStatus } from '@prisma/client'
import { countsTowardCompletion } from '@/lib/task/status-semantics'
import {
  DAY_MS,
  type StatusEvt,
  enumerateUtcDays,
  parseStatusPayload,
  statusAt,
  toUtcDateKey,
  utcMidnight,
} from '@/lib/summaries/burnup-replay'

export interface MilestoneBurnupTaskRow {
  id: string
  status: TaskStatus
  createdAt: Date
}

/** A STATUS_CHANGED activity row (payload = `{ from, to }`). */
export interface MilestoneBurnupActivityRow {
  taskId: string
  payload: unknown
  createdAt: Date
}

/** Window metadata for a sprint covering ≥1 milestone task. */
export interface MilestoneBurnupSprintRow {
  id: string
  number: number
  name: string
  startDate: Date
  endDate: Date
}

export interface MilestoneBurnupPoint {
  /** UTC calendar day, 'YYYY-MM-DD'. */
  date: string
  /** Milestone tasks created on or before this day (end-of-day). */
  scope: number
  /** Milestone tasks DONE at end-of-day, replayed from STATUS_CHANGED. */
  completed: number
}

export interface MilestoneBurnupSprintWindow {
  sprintId: string
  number: number
  name: string
  start: string
  end: string
}

export interface MilestoneBurnup {
  start: string
  end: string
  unit: 'tasks'
  /** Final scope = y-axis max. */
  scopeTotal: number
  series: MilestoneBurnupPoint[]
  /** Covering sprints' calendar windows, sorted by start — the cross-sprint
   * context bands. May extend past `end` (an ACTIVE sprint's future days);
   * the renderer clamps. */
  sprintWindows: MilestoneBurnupSprintWindow[]
}

export interface MilestoneBurnupInput {
  tasks: MilestoneBurnupTaskRow[]
  activities: MilestoneBurnupActivityRow[]
  sprints: MilestoneBurnupSprintRow[]
  now: Date
}

/**
 * LUM-627 — the milestone Overview's cross-sprint burnup trajectory. Backward
 * replay, not a snapshot: per UTC day, `scope` counts member tasks created by
 * end-of-day and not CANCELED at end-of-day (LUM-1282), and `completed`
 * counts tasks DONE at end-of-day replayed from the
 * append-only STATUS_CHANGED log (a later reopen decrements the curve again).
 *
 * Candidate set = the milestone's CURRENT member tasks: membership changes have
 * no activity trail (there is no MILESTONE_CHANGED TaskActivity), so past
 * membership is not replayable — the same current-membership basis every other
 * Overview rollup (sprint coverage, outcome) uses. The window runs from the
 * earlier of (first task created, first covering-sprint start) to today; no
 * future days and no projection — a milestone's target date is routinely unset,
 * so a linear projection would be theater rather than a forecast.
 */
export function computeMilestoneBurnup(
  input: MilestoneBurnupInput
): MilestoneBurnup {
  const { tasks, activities, sprints, now } = input

  const sprintWindows: MilestoneBurnupSprintWindow[] = [...sprints]
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    .map(s => ({
      sprintId: s.id,
      number: s.number,
      name: s.name,
      start: toUtcDateKey(s.startDate),
      end: toUtcDateKey(s.endDate),
    }))

  if (tasks.length === 0) {
    const today = toUtcDateKey(now)
    return {
      start: today,
      end: today,
      unit: 'tasks',
      scopeTotal: 0,
      series: [],
      sprintWindows,
    }
  }

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

  let earliest = tasks[0]!.createdAt
  for (const t of tasks) {
    if (t.createdAt.getTime() < earliest.getTime()) earliest = t.createdAt
  }
  for (const s of sprints) {
    if (s.startDate.getTime() < earliest.getTime()) earliest = s.startDate
  }

  const days = enumerateUtcDays(earliest, now)
  const series: MilestoneBurnupPoint[] = days.map(day => {
    const eod = utcMidnight(day) + DAY_MS - 1
    let scope = 0
    let completed = 0
    for (const t of tasks) {
      if (t.createdAt.getTime() > eod) continue
      const status = statusAt(statusByTask.get(t.id) ?? [], eod, t.status)
      // LUM-1282: a task CANCELED at end-of-day leaves the scope that day (it
      // is back in scope on the days before the cancel, and after a reopen).
      if (!countsTowardCompletion(status)) continue
      scope++
      if (status === 'DONE') completed++
    }
    return { date: toUtcDateKey(day), scope, completed }
  })

  const first = series[0]
  const last = series[series.length - 1]
  return {
    start: first ? first.date : toUtcDateKey(now),
    end: last ? last.date : toUtcDateKey(now),
    unit: 'tasks',
    scopeTotal: last ? last.scope : 0,
    series,
    sprintWindows,
  }
}
