import {
  computeNextSprintWindow,
  nextUtcWeekdayMidnight,
  utcMidnight,
  addDays,
} from '@/lib/services/sprint-date'

describe('utcMidnight', () => {
  it('floors to UTC midnight of the same day', () => {
    const d = new Date('2026-04-20T15:30:00Z')
    expect(utcMidnight(d).toISOString()).toBe('2026-04-20T00:00:00.000Z')
  })
})

describe('nextUtcWeekdayMidnight', () => {
  // 2026-04-20 is a Monday (UTC).
  it('returns same day at UTC midnight when already on target weekday', () => {
    const mon = new Date('2026-04-20T05:00:00Z')
    expect(nextUtcWeekdayMidnight(mon, 1).toISOString()).toBe(
      '2026-04-20T00:00:00.000Z'
    )
  })

  it('advances to the next occurrence when ahead of target weekday', () => {
    // Mon 2026-04-20 → next Friday = 2026-04-24.
    const mon = new Date('2026-04-20T00:00:00Z')
    expect(nextUtcWeekdayMidnight(mon, 5).toISOString()).toBe(
      '2026-04-24T00:00:00.000Z'
    )
  })

  it('wraps across the weekend when target weekday is earlier in the week', () => {
    // Fri 2026-04-24 → next Monday = 2026-04-27.
    const fri = new Date('2026-04-24T12:00:00Z')
    expect(nextUtcWeekdayMidnight(fri, 1).toISOString()).toBe(
      '2026-04-27T00:00:00.000Z'
    )
  })
})

describe('computeNextSprintWindow', () => {
  it('bootstraps from `now` when there is no prior sprint (endDate inclusive)', () => {
    // Mon 2026-04-20 → 14-day sprint covers Apr 20 through Sun May 3.
    const now = new Date('2026-04-20T08:00:00Z')
    const window = computeNextSprintWindow(
      { durationDays: 14, cooldownDays: 0, startWeekday: 1 },
      null,
      now
    )
    expect(window.startDate.toISOString()).toBe('2026-04-20T00:00:00.000Z')
    expect(window.endDate.toISOString()).toBe('2026-05-03T00:00:00.000Z')
  })

  it('chains from the previous inclusive endDate with cooldown=0 (startDate stays on Monday)', () => {
    // Previous sprint ran Mon Apr 20 → Sun May 3 (inclusive).
    // cooldown=0 → next starts Mon May 4.
    const lastEnd = new Date('2026-05-03T00:00:00Z')
    const window = computeNextSprintWindow(
      { durationDays: 14, cooldownDays: 0, startWeekday: 1 },
      lastEnd,
      new Date('2026-04-20T00:00:00Z')
    )
    expect(window.startDate.toISOString()).toBe('2026-05-04T00:00:00.000Z')
    expect(window.endDate.toISOString()).toBe('2026-05-17T00:00:00.000Z')
  })

  it('applies cooldown=7 as a full one-week gap (still aligned to Monday)', () => {
    // Sprint 1: Mon Apr 20 → Sun Apr 26 (7 days inclusive).
    // cooldown 7 days → Sprint 2 starts Mon May 4.
    const lastEnd = new Date('2026-04-26T00:00:00Z')
    const window = computeNextSprintWindow(
      { durationDays: 7, cooldownDays: 7, startWeekday: 1 },
      lastEnd,
      new Date('2026-04-20T00:00:00Z')
    )
    expect(window.startDate.toISOString()).toBe('2026-05-04T00:00:00.000Z')
    expect(window.endDate.toISOString()).toBe('2026-05-10T00:00:00.000Z')
  })

  it('handles month and year boundaries cleanly', () => {
    // 1-week sprint ending Sun Dec 27, cooldown=0 → next starts Mon Dec 28.
    const lastEnd = new Date('2026-12-27T00:00:00Z')
    const window = computeNextSprintWindow(
      { durationDays: 7, cooldownDays: 0, startWeekday: 1 },
      lastEnd,
      new Date('2026-12-20T00:00:00Z')
    )
    expect(window.startDate.toISOString()).toBe('2026-12-28T00:00:00.000Z')
    expect(window.endDate.toISOString()).toBe('2027-01-03T00:00:00.000Z')
  })

  it('bootstraps on the requested weekday from a mid-week `now`', () => {
    // Wed 2026-04-22 → next Monday = 2026-04-27. 14-day sprint ends Sun May 10.
    const now = new Date('2026-04-22T14:00:00Z')
    const window = computeNextSprintWindow(
      { durationDays: 14, cooldownDays: 0, startWeekday: 1 },
      null,
      now
    )
    expect(window.startDate.toISOString()).toBe('2026-04-27T00:00:00.000Z')
    expect(window.endDate.toISOString()).toBe('2026-05-10T00:00:00.000Z')
  })

  it('ignores a stale anchor already in the past and bootstraps from `now`', () => {
    // Historical CLOSED sprint ended Sun Mar 15, now is Mon Apr 20.
    // Do NOT chain off the old anchor — that would produce already-expired sprints.
    const staleEnd = new Date('2026-03-15T00:00:00Z')
    const now = new Date('2026-04-20T09:00:00Z')
    const window = computeNextSprintWindow(
      { durationDays: 14, cooldownDays: 0, startWeekday: 1 },
      staleEnd,
      now
    )
    expect(window.startDate.toISOString()).toBe('2026-04-20T00:00:00.000Z')
    expect(window.endDate.toISOString()).toBe('2026-05-03T00:00:00.000Z')
  })

  it('keeps a future anchor even when its startDate is in the past (ACTIVE sprint)', () => {
    // ACTIVE sprint started Mon Apr 13, ends Sun Apr 26 — endDate is still
    // in the future relative to `now` = Apr 20, so chain normally.
    const futureEnd = new Date('2026-04-26T00:00:00Z')
    const now = new Date('2026-04-20T09:00:00Z')
    const window = computeNextSprintWindow(
      { durationDays: 14, cooldownDays: 0, startWeekday: 1 },
      futureEnd,
      now
    )
    expect(window.startDate.toISOString()).toBe('2026-04-27T00:00:00.000Z')
    expect(window.endDate.toISOString()).toBe('2026-05-10T00:00:00.000Z')
  })
})

describe('addDays', () => {
  it('advances a UTC date across month boundary', () => {
    const d = new Date('2026-04-30T00:00:00Z')
    expect(addDays(d, 1).toISOString()).toBe('2026-05-01T00:00:00.000Z')
  })
})
