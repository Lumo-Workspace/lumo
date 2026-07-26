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

/** One calendar day in ms — the spacing between two day keys. */
export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Key for a stored sprint calendar date: UTC midnight of the day it names.
 *
 * Sprint start/end are calendar days, stored at UTC midnight and rendered
 * pinned to UTC (`lib/datetime/format.ts`) so "Jun 1" reads as Jun 1 for every
 * viewer. Comparisons must run in that same frame — see `viewerDayKey`.
 */
export function calendarDayKey(date: Date | string | number): number {
  const d = new Date(date)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Key for "the day the viewer is currently living in", in the same frame as
 * `calendarDayKey` — the viewer's LOCAL calendar day, folded to UTC midnight.
 *
 * Comparing a raw instant against a sprint's UTC-midnight endpoints flips the
 * bucket at UTC midnight, which for a viewer west of UTC lands in the previous
 * local afternoon — a sprint printed as running "through Jul 26" would already
 * read as completed on the afternoon of Jul 24 local. Folding `now` to its
 * local calendar day first keeps bucketing and rendering in one frame.
 */
export function viewerDayKey(now: Date | number = new Date()): number {
  const d = new Date(now)
  // Shift the instant by the viewer's offset (evaluated at that instant, so
  // DST is handled) and floor to the day — the local calendar day expressed in
  // the same UTC-midnight coordinate as `calendarDayKey`.
  const local = d.getTime() - d.getTimezoneOffset() * 60_000
  return Math.floor(local / DAY_MS) * DAY_MS
}

/**
 * Derived sprint state from its date range. The DB status enum
 * (DRAFT/ACTIVE/CLOSED) is legacy plumbing — the user-facing model is
 * strictly time-based.
 *
 * `endDate` is the INCLUSIVE last day (see `computeNextSprintWindow`), so the
 * sprint stays CURRENT for the whole of that day rather than ending at the
 * instant it begins.
 */
export type DerivedSprintState = 'UPCOMING' | 'CURRENT' | 'COMPLETED'

export function deriveSprintState(
  sprint: { startDate: Date | string; endDate: Date | string },
  now: Date = new Date()
): DerivedSprintState {
  const start = calendarDayKey(sprint.startDate)
  const end = calendarDayKey(sprint.endDate)
  const today = viewerDayKey(now)
  if (today < start) return 'UPCOMING'
  if (today > end) return 'COMPLETED'
  return 'CURRENT'
}

interface DatedSprint {
  startDate: Date | string
  endDate: Date | string
}

/**
 * Bucket a team's sprints for the task sprint selector dropdown.
 *
 * - `activeAndUpcoming`: every CURRENT then UPCOMING sprint, each group sorted
 *   by start date ascending.
 * - `past`: collapsed to ONLY the most recently ended sprint (the one whose
 *   `endDate` is closest to `now`). Older completed sprints are dropped so the
 *   dropdown's "已结束 / Past" section doesn't accumulate history. Empty when
 *   no sprint has ended yet.
 *
 * Returns the same sprint object references that were passed in.
 */
export function groupSprintsForTaskField<T extends DatedSprint>(
  sprints: T[],
  now: Date = new Date()
): { activeAndUpcoming: T[]; past: T[] } {
  const current: T[] = []
  const upcoming: T[] = []
  const completed: T[] = []
  for (const s of sprints) {
    const state = deriveSprintState(s, now)
    if (state === 'CURRENT') current.push(s)
    else if (state === 'UPCOMING') upcoming.push(s)
    else completed.push(s)
  }
  const byStartAsc = (a: T, b: T) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  const justEnded = completed.reduce<T | null>((latest, s) => {
    if (!latest) return s
    return new Date(s.endDate).getTime() > new Date(latest.endDate).getTime()
      ? s
      : latest
  }, null)
  return {
    activeAndUpcoming: [
      ...current.sort(byStartAsc),
      ...upcoming.sort(byStartAsc),
    ],
    past: justEnded ? [justEnded] : [],
  }
}
