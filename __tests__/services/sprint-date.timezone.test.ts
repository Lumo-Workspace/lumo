import { computeNextSprintWindow } from '@/lib/services/sprint-date'

const cadence = {
  durationDays: 14,
  cooldownDays: 0,
  startWeekday: 1, // Monday
  timeZone: 'America/Los_Angeles',
}

describe('computeNextSprintWindow (timezone-aware)', () => {
  test('bootstrap starts on the next Monday at LA local midnight', () => {
    const now = new Date('2026-07-01T20:00:00Z') // Wed
    const w = computeNextSprintWindow(cadence, null, now)
    // Next Monday 2026-07-06 local midnight = 07:00Z (PDT)
    expect(w.startDate.toISOString()).toBe('2026-07-06T07:00:00.000Z')
    // 14-day inclusive window → last day is start + 13 calendar days, local midnight
    expect(w.endDate.toISOString()).toBe('2026-07-19T07:00:00.000Z')
  })

  test('cooldown=0 window begins the day after the previous inclusive end, at local midnight', () => {
    const now = new Date('2026-07-06T20:00:00Z')
    const lastEnd = new Date('2026-07-19T07:00:00Z') // previous inclusive last day (LA midnight)
    const w = computeNextSprintWindow(cadence, lastEnd, now)
    expect(w.startDate.toISOString()).toBe('2026-07-20T07:00:00.000Z')
    expect(w.endDate.toISOString()).toBe('2026-08-02T07:00:00.000Z')
  })

  test('a stale past anchor bootstraps from now, not from the past', () => {
    const now = new Date('2026-07-01T20:00:00Z')
    const staleEnd = new Date('2025-01-01T08:00:00Z')
    const w = computeNextSprintWindow(cadence, staleEnd, now)
    expect(w.startDate.toISOString()).toBe('2026-07-06T07:00:00.000Z')
  })
})
