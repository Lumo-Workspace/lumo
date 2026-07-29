import type { TaskSummaryStats } from '@/types/summary'

/** The signals the Signal tab tracks, in the order they are surfaced. */
export type SignalKey = 'stalled' | 'highStakes' | 'stalePrs' | 'overdue'

export type SignalTone = 'danger' | 'warning'

/** A signal that fired — gets its own card. */
export interface AnomalyCard {
  key: SignalKey
  tone: SignalTone
  count: number
}

export interface SignalView {
  anomalies: AnomalyCard[]
}

const TONES: Record<SignalKey, SignalTone> = {
  stalled: 'danger',
  highStakes: 'warning',
  stalePrs: 'warning',
  overdue: 'danger',
}

/**
 * The signals that fired, in surfacing order.
 *
 * Only firing signals are modelled. A quiet signal used to get a green check,
 * but enumerating what is *not* wrong is noise the reader has to filter: if a
 * problem existed it would already be sitting there as a pill. Absence of pills
 * is the all-clear.
 */
export function buildSignalView(stats: TaskSummaryStats): SignalView {
  const counts: Record<SignalKey, number> = {
    stalled: stats.topBlockers.stalledTaskIds.length,
    highStakes: stats.topBlockers.highStakesTaskIds.length,
    stalePrs: stats.topBlockers.staleOpenPrs.length,
    overdue: stats.overdueTasks.count,
  }

  const order: SignalKey[] = ['stalled', 'highStakes', 'stalePrs', 'overdue']

  return {
    anomalies: order
      .filter(key => counts[key] > 0)
      .map(key => ({ key, tone: TONES[key], count: counts[key] as number })),
  }
}

/**
 * Whole days between `from` and `now` (ms epoch), floored at 0.
 * `now` is passed in rather than read from the clock so callers stay
 * render-pure — feed it from `useNow()`.
 */
export function idleDays(from: string, now: number): number {
  const then = new Date(from).getTime()
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.floor((now - then) / 86_400_000))
}

/**
 * Idle durations past this many days read as severe rather than merely stale —
 * the threshold the design flips the row colour on.
 */
export const IDLE_SEVERE_DAYS = 9
