import type { Sprint } from '@prisma/client'

/** Whole days from `now` (ms epoch) until `date`; negative if past. */
export function daysFromNow(date: Date | string, now: number): number {
  const ms = new Date(date).getTime() - now
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

/**
 * Percentage (0–100) of the sprint's calendar that has already elapsed.
 * Used to compare "time used" against "work done" so the eye can read
 * ahead-of / behind-schedule at a glance.
 */
export function timeElapsedPct(
  start: Date | string,
  end: Date | string,
  now: number
): number {
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (now <= s) return 0
  if (now >= e) return 100
  return Math.round(((now - s) / (e - s)) * 100)
}

export type SprintBucket = 'current' | 'upcoming' | 'completed'

/**
 * Partition sprints purely by date so the landing never lies about what's
 * "current" vs "upcoming" just because nobody clicked a state-transition
 * button. Completed is newest-first; upcoming is soonest-first.
 */
export function partitionSprints(sprints: Sprint[], now: number) {
  const byStart = sprints
    .slice()
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    )
  const current = byStart.find(
    s =>
      new Date(s.startDate).getTime() <= now &&
      now <= new Date(s.endDate).getTime()
  )
  const upcoming = byStart.filter(s => new Date(s.startDate).getTime() > now)
  const completed = byStart
    .filter(s => new Date(s.endDate).getTime() < now)
    .reverse()
  return { current, upcoming, completed }
}
