import type { Sprint } from '@prisma/client'
import {
  DAY_MS,
  calendarDayKey,
  viewerDayKey,
} from '@/lib/services/sprint-date'

/**
 * Whole calendar days from the viewer's today until `date`; negative if past.
 *
 * Counted between calendar days, not between instants: sprint dates are UTC
 * midnights while `now` is a wall-clock instant, so a raw difference lands a
 * fraction of a day off and rounds the wrong way (a sprint starting the day
 * after tomorrow reading "starts in 1 day").
 */
export function daysFromNow(date: Date | string, now: number): number {
  return (calendarDayKey(date) - viewerDayKey(now)) / DAY_MS
}

/**
 * Percentage (0–100) of the sprint's calendar that has already elapsed.
 * Used to compare "time used" against "work done" so the eye can read
 * ahead-of / behind-schedule at a glance.
 *
 * `endDate` is the sprint's INCLUSIVE last day, so the span runs through the
 * end of that day — the bar reads 100% once the sprint is actually over, not
 * at the start of its final day.
 */
export function timeElapsedPct(
  start: Date | string,
  end: Date | string,
  now: number
): number {
  const s = calendarDayKey(start)
  const e = calendarDayKey(end) + DAY_MS
  const today = viewerDayKey(now)
  if (today <= s) return 0
  if (today >= e) return 100
  return Math.round(((today - s) / (e - s)) * 100)
}

export type SprintBucket = 'current' | 'upcoming' | 'completed'

/**
 * Partition sprints purely by date so the landing never lies about what's
 * "current" vs "upcoming" just because nobody clicked a state-transition
 * button. Completed is newest-first; upcoming is soonest-first.
 *
 * Both endpoints are inclusive calendar days, compared against the viewer's
 * own calendar day — a sprint stays current through the whole of the last day
 * printed on its card.
 */
export function partitionSprints(sprints: Sprint[], now: number) {
  const today = viewerDayKey(now)
  const byStart = sprints
    .slice()
    .sort((a, b) => calendarDayKey(a.startDate) - calendarDayKey(b.startDate))
  const current = byStart.find(
    s =>
      calendarDayKey(s.startDate) <= today && today <= calendarDayKey(s.endDate)
  )
  const upcoming = byStart.filter(s => calendarDayKey(s.startDate) > today)
  const completed = byStart
    .filter(s => calendarDayKey(s.endDate) < today)
    .reverse()
  return { current, upcoming, completed }
}
