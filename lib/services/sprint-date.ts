/** Pure date helpers for sprint scheduling. No external dependencies. */

export function nextUtcMondayMidnight(from: Date): Date {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  )
  const day = d.getUTCDay() // 0 Sun … 6 Sat
  const delta = (8 - day) % 7 || 7
  d.setUTCDate(d.getUTCDate() + delta)
  return d
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + days)
  return r
}

/**
 * Derived sprint state from its date range. The DB status enum
 * (DRAFT/ACTIVE/CLOSED) is legacy plumbing — the user-facing model is
 * strictly time-based.
 */
export type DerivedSprintState = 'UPCOMING' | 'CURRENT' | 'COMPLETED'

export function deriveSprintState(
  sprint: { startDate: Date | string; endDate: Date | string },
  now: Date = new Date()
): DerivedSprintState {
  const start = new Date(sprint.startDate).getTime()
  const end = new Date(sprint.endDate).getTime()
  const t = now.getTime()
  if (t < start) return 'UPCOMING'
  if (t > end) return 'COMPLETED'
  return 'CURRENT'
}
