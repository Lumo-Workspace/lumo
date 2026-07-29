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

/** A signal that did not fire, or a standing healthy fact. */
export type ClearNote =
  | { key: SignalKey; kind: 'signal' }
  | { key: 'completion'; kind: 'completion'; done: number; total: number }

export interface SignalView {
  anomalies: AnomalyCard[]
  clear: ClearNote[]
}

const TONES: Record<SignalKey, SignalTone> = {
  stalled: 'danger',
  highStakes: 'warning',
  stalePrs: 'warning',
  overdue: 'danger',
}

/**
 * Split the tracked signals into "needs a card" and "collapses to one line".
 *
 * The page is built around anomalies, not a fixed dashboard: a signal earns a
 * card only by firing. Everything currently fine drops to a single row of green
 * checks, so a healthy project degrades to one quiet line instead of a wall of
 * zeroes — and the cards that *are* there always mean something.
 */
export function buildSignalView(stats: TaskSummaryStats): SignalView {
  const counts: Record<SignalKey, number> = {
    stalled: stats.topBlockers.stalledTaskIds.length,
    highStakes: stats.topBlockers.highStakesTaskIds.length,
    stalePrs: stats.topBlockers.staleOpenPrs.length,
    overdue: stats.overdueTasks.count,
  }

  const order: SignalKey[] = ['stalled', 'highStakes', 'stalePrs', 'overdue']

  const anomalies: AnomalyCard[] = []
  const clear: ClearNote[] = []

  for (const key of order) {
    const count = counts[key]
    if (count > 0) {
      anomalies.push({ key, tone: TONES[key], count })
    } else {
      clear.push({ key, kind: 'signal' })
    }
  }

  const total = stats.totalTasks
  const done = stats.statusDistribution['DONE'] ?? 0
  if (total > 0) {
    clear.push({ key: 'completion', kind: 'completion', done, total })
  }

  return { anomalies, clear }
}

/**
 * How many individual items are currently asking for attention — the sum of
 * every firing signal's count.
 *
 * The Project tab's badge reads from here rather than counting rows itself, so
 * the number on the tab and the numbers in the health row can never disagree:
 * both are derived from the same `SignalView`. Zero means nothing fired, and
 * the badge is not rendered at all.
 */
export function signalAttentionCount(view: SignalView): number {
  return view.anomalies.reduce((sum, card) => sum + card.count, 0)
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
