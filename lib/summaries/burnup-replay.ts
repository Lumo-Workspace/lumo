import type { TaskStatus } from '@prisma/client'

/**
 * Shared backward-replay primitives for burnup trajectories (sprint- and
 * milestone-level). Cumulative metrics over time are always replayed from the
 * append-only activity log — never read from current state (the team's
 * backward-replay convention for burnup/burndown/coverage).
 */

export interface StatusEvt {
  createdAt: Date
  from: TaskStatus
  to: TaskStatus
}

export const DAY_MS = 86_400_000

export function toUtcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function enumerateUtcDays(start: Date, end: Date): Date[] {
  const days: Date[] = []
  let cur = utcMidnight(start)
  const last = utcMidnight(end)
  while (cur <= last) {
    days.push(new Date(cur))
    cur += DAY_MS
  }
  return days
}

export function parseStatusPayload(
  p: unknown
): { from: TaskStatus; to: TaskStatus } | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (typeof o.from !== 'string' || typeof o.to !== 'string') return null
  // Cast unchecked: only `=== 'DONE'` is compared downstream, so an unexpected
  // enum value safely counts as "not done" rather than throwing.
  return { from: o.from as TaskStatus, to: o.to as TaskStatus }
}

/** State of a step-function at time tMs: last event whose createdAt <= tMs. */
export function statusAt(
  events: StatusEvt[],
  tMs: number,
  fallback: TaskStatus
): TaskStatus {
  const first = events[0]
  if (!first) return fallback
  let chosen: StatusEvt | null = null
  for (const e of events) {
    if (e.createdAt.getTime() <= tMs) chosen = e
    else break
  }
  return chosen ? chosen.to : first.from
}

export interface SprintEvt {
  createdAt: Date
  fromSprintId: string | null
  toSprintId: string | null
}

/**
 * Which sprint a task sat in at time tMs — the membership analogue of
 * {@link statusAt}, same backward-replay convention: the last event at or
 * before `tMs` decides, and before the first event the task sat wherever that
 * event moved it *from*. `fallback` (the task's current sprint) applies only
 * when the task never moved at all.
 */
export function sprintAt(
  events: SprintEvt[],
  tMs: number,
  fallback: string | null
): string | null {
  const first = events[0]
  if (!first) return fallback
  let chosen: SprintEvt | null = null
  for (const e of events) {
    if (e.createdAt.getTime() <= tMs) chosen = e
    else break
  }
  return chosen ? chosen.toSprintId : first.fromSprintId
}
