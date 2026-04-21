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
 * Floor a date to UTC midnight of the same day.
 */
export function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * First UTC midnight on or after `from` whose weekday equals `weekday`
 * (0 = Sun … 6 = Sat). If `from` already falls on the target weekday, returns
 * that day's UTC midnight.
 */
export function nextUtcWeekdayMidnight(from: Date, weekday: number): Date {
  const base = utcMidnight(from)
  const delta = (weekday - base.getUTCDay() + 7) % 7
  return addDays(base, delta)
}

export interface SprintCadence {
  durationDays: number
  cooldownDays: number
  startWeekday: number
}

export interface SprintWindow {
  startDate: Date
  endDate: Date
}

/**
 * Compute the next sprint's [startDate, endDate] window.
 *
 * Convention: `endDate` is the INCLUSIVE last day of the sprint, so a
 * `durationDays = N` sprint covers exactly N calendar days from startDate
 * through `startDate + N - 1`. This matches the inclusive-endpoint overlap
 * guard in sprintService.updateMeta.
 *
 * - If `lastEndDate` is null or already in the past relative to `now`, the
 *   window starts on the next occurrence of `startWeekday` at/after `now`
 *   (fresh bootstrap — a stale historical anchor must not produce sprints
 *   that are already in the past).
 * - Otherwise the next window starts `cooldownDays + 1` days after the
 *   previous sprint's inclusive last day, so cooldown=0 means the new
 *   sprint begins the day after the previous one ends.
 *
 * When `durationDays` and `cooldownDays` are both multiples of 7 (the UI
 * only offers those), `startDate` stays locked on `startWeekday` sprint
 * after sprint.
 */
export function computeNextSprintWindow(
  cadence: SprintCadence,
  lastEndDate: Date | null,
  now: Date = new Date()
): SprintWindow {
  const usableAnchor =
    lastEndDate && lastEndDate.getTime() >= utcMidnight(now).getTime()
      ? lastEndDate
      : null
  const startDate = usableAnchor
    ? addDays(utcMidnight(usableAnchor), cadence.cooldownDays + 1)
    : nextUtcWeekdayMidnight(now, cadence.startWeekday)
  return {
    startDate,
    endDate: addDays(startDate, cadence.durationDays - 1),
  }
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
