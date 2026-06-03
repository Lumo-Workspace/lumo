import type { TaskStatus } from '@prisma/client'

export interface BurndownTaskInput {
  id: string
  sprintId: string | null
  status: TaskStatus
}

export interface BurndownActivityInput {
  taskId: string
  type: 'STATUS_CHANGED' | 'SPRINT_CHANGED'
  payload: unknown
  createdAt: Date
}

export interface BurndownComputeInput {
  sprintId: string
  startDate: Date
  endDate: Date
  status: 'ACTIVE' | 'CLOSED'
  now: Date
  tasks: BurndownTaskInput[]
  activities: BurndownActivityInput[]
}

export interface BurndownPoint {
  date: string
  remaining: number | null
  ideal: number
}

export interface BurndownSeries {
  sprintId: string
  start: string
  end: string
  unit: 'tasks'
  total: number
  series: BurndownPoint[]
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
  return {
    fromSprintId: (from as string | null) ?? null,
    toSprintId: (to as string | null) ?? null,
  }
}

/** State of a step-function at time tMs: last event whose createdAt <= tMs. */
function statusAt(
  events: StatusEvt[],
  tMs: number,
  fallback: TaskStatus
): TaskStatus {
  if (events.length === 0) return fallback
  let chosen: StatusEvt | null = null
  for (const e of events) {
    if (e.createdAt.getTime() <= tMs) chosen = e
    else break
  }
  return chosen ? chosen.to : events[0].from
}

function sprintAt(
  events: SprintEvt[],
  tMs: number,
  fallback: string | null
): string | null {
  if (events.length === 0) return fallback
  let chosen: SprintEvt | null = null
  for (const e of events) {
    if (e.createdAt.getTime() <= tMs) chosen = e
    else break
  }
  return chosen ? chosen.toSprintId : events[0].fromSprintId
}

export function computeBurndownSeries(
  input: BurndownComputeInput
): BurndownSeries {
  const { sprintId, startDate, endDate, status, now, tasks, activities } = input

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

  function countRemaining(eodMs: number): number {
    let count = 0
    for (const id of candidates) {
      const fallbackSprint = taskById.get(id)?.sprintId ?? null
      if (
        sprintAt(sprintByTask.get(id) ?? [], eodMs, fallbackSprint) !== sprintId
      )
        continue
      const fallbackStatus = taskById.get(id)?.status ?? 'TODO'
      if (
        statusAt(statusByTask.get(id) ?? [], eodMs, fallbackStatus) !== 'DONE'
      )
        count++
    }
    return count
  }

  const days = enumerateUtcDays(startDate, endDate)
  const nowMs = now.getTime()

  const firstEod = days.length ? utcMidnight(days[0]) + DAY_MS - 1 : 0
  const total = days.length ? countRemaining(firstEod) : 0

  const n = days.length
  const series: BurndownPoint[] = days.map((day, idx) => {
    const eod = utcMidnight(day) + DAY_MS - 1
    const isFuture = utcMidnight(day) > nowMs
    const remaining =
      status === 'ACTIVE' && isFuture ? null : countRemaining(eod)
    const ideal =
      n === 1
        ? total
        : Math.round(((total * (n - 1 - idx)) / (n - 1)) * 100) / 100
    return { date: toUtcDateKey(day), remaining, ideal }
  })

  return {
    sprintId,
    start: days.length ? toUtcDateKey(days[0]) : toUtcDateKey(startDate),
    end: days.length ? toUtcDateKey(days[n - 1]) : toUtcDateKey(endDate),
    unit: 'tasks',
    total,
    series,
  }
}
