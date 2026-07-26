import {
  computeNextSprintWindow,
  deriveSprintState,
  groupSprintsForTaskField,
  nextUtcWeekdayMidnight,
  utcMidnight,
  addDays,
} from '@/lib/services/sprint-date'

/**
 * Run `fn` as if the viewer's browser were in `tz`. Setting `process.env.TZ`
 * has no effect inside jest's VM context (the date cache is never invalidated),
 * so the viewer's offset is stubbed instead — that is the only ambient input
 * `viewerDayKey` reads. Offsets are the July 2026 (summer) values.
 */
const TZ_OFFSET_MINUTES: Record<string, number> = {
  'America/Los_Angeles': 420, // UTC-7
  UTC: 0,
  'Asia/Shanghai': -480, // UTC+8
}

function inTimezone<T>(tz: string, fn: () => T): T {
  const spy = jest
    .spyOn(Date.prototype, 'getTimezoneOffset')
    .mockReturnValue(TZ_OFFSET_MINUTES[tz] as number)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}

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

describe('deriveSprintState', () => {
  // Sprint 7 from the LUM-700 report: Jul 13 – Jul 26 inclusive.
  const sprint = {
    startDate: new Date('2026-07-13T00:00:00Z'),
    endDate: new Date('2026-07-26T00:00:00Z'),
  }

  it('returns CURRENT on the inclusive last day', () => {
    // Midday on Jul 26 — past the endDate *instant* (Jul 26 00:00Z) but still
    // inside the last day the card prints, in every timezone that agrees it is
    // Jul 26 locally.
    expect(deriveSprintState(sprint, new Date('2026-07-26T12:00:00Z'))).toBe(
      'CURRENT'
    )
    expect(
      inTimezone('Asia/Shanghai', () =>
        deriveSprintState(sprint, new Date('2026-07-26T12:00:00Z'))
      )
    ).toBe('CURRENT')
    // …and COMPLETED only once the day after has begun locally.
    expect(
      inTimezone('UTC', () =>
        deriveSprintState(sprint, new Date('2026-07-27T00:30:00Z'))
      )
    ).toBe('COMPLETED')
  })

  it('reads the viewer local calendar day, not the raw UTC instant', () => {
    // Sat Jul 25, 18:08 in Los Angeles = Sun Jul 26 01:08 UTC. Local Jul 25 is
    // well inside Jul 13–26, so the sprint is running for that viewer.
    const instant = new Date('2026-07-26T01:08:00Z')
    expect(
      inTimezone('America/Los_Angeles', () =>
        deriveSprintState(sprint, instant)
      )
    ).toBe('CURRENT')
  })

  it('reports UPCOMING strictly before the first day', () => {
    expect(
      inTimezone('UTC', () =>
        deriveSprintState(sprint, new Date('2026-07-12T23:00:00Z'))
      )
    ).toBe('UPCOMING')
    expect(
      inTimezone('UTC', () =>
        deriveSprintState(sprint, new Date('2026-07-13T00:00:00Z'))
      )
    ).toBe('CURRENT')
  })
})

describe('groupSprintsForTaskField', () => {
  // now = Mon Jun 1 — Sprint 4 is current, 5/6 upcoming, 1/2/3 ended.
  const now = new Date('2026-06-01T12:00:00Z')
  const mk = (name: string, start: string, end: string) => ({
    name,
    startDate: new Date(start),
    endDate: new Date(end),
  })

  it('collapses `past` to only the most recently ended sprint', () => {
    const s1 = mk('S1', '2026-04-20', '2026-05-03')
    const s2 = mk('S2', '2026-05-04', '2026-05-17')
    const s3 = mk('S3', '2026-05-18', '2026-05-31')
    // Pass out of order to prove selection is by endDate, not input order.
    const { past } = groupSprintsForTaskField([s1, s3, s2], now)
    expect(past.map(s => s.name)).toEqual(['S3'])
  })

  it('orders activeAndUpcoming current-first then upcoming, each by start asc', () => {
    const current = mk('S4', '2026-05-31', '2026-06-13')
    const up1 = mk('S5', '2026-06-14', '2026-06-27')
    const up2 = mk('S6', '2026-06-28', '2026-07-11')
    const ended = mk('S3', '2026-05-18', '2026-05-31')
    const res = groupSprintsForTaskField([up2, ended, up1, current], now)
    expect(res.activeAndUpcoming.map(s => s.name)).toEqual(['S4', 'S5', 'S6'])
    expect(res.past.map(s => s.name)).toEqual(['S3'])
  })

  it('returns an empty `past` when no sprint has ended yet', () => {
    const current = mk('S4', '2026-05-31', '2026-06-13')
    const up = mk('S5', '2026-06-14', '2026-06-27')
    const res = groupSprintsForTaskField([current, up], now)
    expect(res.past).toEqual([])
    expect(res.activeAndUpcoming.map(s => s.name)).toEqual(['S4', 'S5'])
  })

  it('returns empty buckets for empty input', () => {
    expect(groupSprintsForTaskField([], now)).toEqual({
      activeAndUpcoming: [],
      past: [],
    })
  })
})
