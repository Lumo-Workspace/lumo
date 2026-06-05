export interface RetentionRevision {
  id: string
  createdAt: Date
  isManual: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/** UTC calendar-day key, e.g. "2026-06-02". */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** ISO-week key, e.g. "2026-W23". Uses UTC. */
function isoWeekKey(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  )
  // Thursday-based ISO week.
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7
  )
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Decide which auto-revision ids to delete under the time-decay policy:
 *   - <=24h old: keep all
 *   - 1-7 days old: keep newest per UTC calendar day
 *   - >7 days old: keep newest per ISO week
 * Never deletes: manual snapshots, or the single oldest revision (first version).
 *
 * `revisions` need not be pre-sorted. `now` is injected for testability.
 */
export function selectRevisionsToPrune(
  revisions: RetentionRevision[],
  now: Date
): string[] {
  if (revisions.length === 0) return []

  const sorted = [...revisions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  )

  const keep = new Set<string>()
  const oldest = sorted[0]
  if (oldest) keep.add(oldest.id) // first version is protected

  const dayWinners = new Map<string, string>()
  const weekWinners = new Map<string, string>()

  for (const r of sorted) {
    if (r.isManual) {
      keep.add(r.id)
      continue
    }
    const age = now.getTime() - r.createdAt.getTime()
    if (age <= DAY_MS) {
      keep.add(r.id)
    } else if (age <= WEEK_MS) {
      dayWinners.set(dayKey(r.createdAt), r.id) // ascending -> last write wins (newest)
    } else {
      weekWinners.set(isoWeekKey(r.createdAt), r.id)
    }
  }

  for (const id of dayWinners.values()) keep.add(id)
  for (const id of weekWinners.values()) keep.add(id)

  return sorted.filter(r => !keep.has(r.id)).map(r => r.id)
}
