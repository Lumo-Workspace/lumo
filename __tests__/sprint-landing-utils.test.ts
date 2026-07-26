import type { Sprint } from '@prisma/client'
import {
  daysFromNow,
  timeElapsedPct,
  partitionSprints,
} from '@/app/workspace/[workspaceUrl]/sprints/components/sprintLandingUtils'

const DAY = 24 * 60 * 60 * 1000

/** Minimal Sprint stub — partition only reads name/startDate/endDate. */
function sprint(name: string, start: number, end: number): Sprint {
  return {
    id: name,
    teamId: 't',
    number: 1,
    name,
    status: 'ACTIVE',
    startDate: new Date(start),
    endDate: new Date(end),
    startedAt: null,
    closedAt: null,
    createdAt: new Date(start),
    updatedAt: new Date(start),
  } as Sprint
}

/** A sprint addressed by the calendar days it prints on its card. */
function sprintOn(name: string, start: string, end: string): Sprint {
  return sprint(
    name,
    Date.parse(`${start}T00:00:00Z`),
    Date.parse(`${end}T00:00:00Z`)
  )
}

/**
 * Run `fn` as if the viewer's browser were in `tz`. Setting `process.env.TZ`
 * has no effect inside jest's VM context (the date cache is never invalidated),
 * so the viewer's offset is stubbed instead — that is the only ambient input
 * these helpers read. Offsets are the July 2026 (summer) values.
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

describe('daysFromNow', () => {
  const now = Date.parse('2026-07-25T12:00:00Z')

  it('returns positive whole days for a future date', () => {
    expect(daysFromNow(new Date(now + 5 * DAY), now)).toBe(5)
  })

  it('returns negative days for a past date', () => {
    expect(daysFromNow(new Date(now - 3 * DAY), now)).toBe(-3)
  })

  it('counts whole calendar days on the viewer local day basis', () => {
    // Sat Jul 25, 18:08 in Los Angeles = Sun Jul 26 01:08 UTC. A sprint
    // starting Mon Jul 27 is two calendar days out for that viewer — the raw
    // instant difference (1.58 days) used to round to "starts in 1 day".
    const instant = Date.parse('2026-07-26T01:08:00Z')
    const jul27 = new Date('2026-07-27T00:00:00Z')
    expect(
      inTimezone('America/Los_Angeles', () => daysFromNow(jul27, instant))
    ).toBe(2)
    // The same instant is already Jul 26 in Shanghai, so it is one day out.
    expect(inTimezone('Asia/Shanghai', () => daysFromNow(jul27, instant))).toBe(
      1
    )
    // Today itself is always 0, never a fraction rounded up to 1.
    expect(
      inTimezone('America/Los_Angeles', () =>
        daysFromNow(new Date('2026-07-25T00:00:00Z'), instant)
      )
    ).toBe(0)
  })
})

describe('timeElapsedPct', () => {
  // Jul 13 – Jul 26 inclusive: a 14-day sprint.
  const start = new Date('2026-07-13T00:00:00Z')
  const end = new Date('2026-07-26T00:00:00Z')
  const at = (day: string) => Date.parse(`${day}T12:00:00Z`)

  it('clamps to 0 before the sprint starts', () => {
    expect(timeElapsedPct(start, end, at('2026-07-12'))).toBe(0)
  })

  it('clamps to 100 only once the inclusive last day is over', () => {
    // Still on the last day → not yet fully elapsed (13 of 14 days).
    expect(timeElapsedPct(start, end, at('2026-07-26'))).toBe(93)
    expect(timeElapsedPct(start, end, at('2026-07-27'))).toBe(100)
  })

  it('reports the midpoint at 50%', () => {
    expect(timeElapsedPct(start, end, at('2026-07-20'))).toBe(50)
  })
})

describe('partitionSprints', () => {
  const now = Date.parse('2026-07-25T12:00:00Z')
  const past1 = sprintOn('past1', '2026-05-18', '2026-05-31')
  const past2 = sprintOn('past2', '2026-06-29', '2026-07-12')
  const current = sprintOn('current', '2026-07-13', '2026-07-26')
  const next1 = sprintOn('next1', '2026-07-27', '2026-08-09')
  const next2 = sprintOn('next2', '2026-08-10', '2026-08-23')

  it('finds the sprint whose window contains now', () => {
    const { current: c } = partitionSprints([past1, current, next1], now)
    expect(c?.name).toBe('current')
  })

  it('orders upcoming soonest-first and completed newest-first', () => {
    const { upcoming, completed } = partitionSprints(
      [past1, past2, current, next2, next1],
      now
    )
    expect(upcoming.map(s => s.name)).toEqual(['next1', 'next2'])
    expect(completed.map(s => s.name)).toEqual(['past2', 'past1'])
  })

  it('returns no current when nothing spans now', () => {
    const { current: c } = partitionSprints([past1, next1], now)
    expect(c).toBeUndefined()
  })

  it('keeps a sprint current through the whole of its inclusive last day', () => {
    // 23:30 UTC on Jul 26 — long past the endDate instant (Jul 26 00:00Z),
    // but Jul 26 is still the day printed on the card and still running.
    const lastDay = Date.parse('2026-07-26T23:30:00Z')
    const { current: c, completed } = inTimezone('UTC', () =>
      partitionSprints([past2, current, next1], lastDay)
    )
    expect(c?.name).toBe('current')
    expect(completed.map(s => s.name)).toEqual(['past2'])

    // It only leaves the Current bucket once the next day has begun.
    const dayAfter = Date.parse('2026-07-27T00:30:00Z')
    const after = inTimezone('UTC', () =>
      partitionSprints([past2, current, next1], dayAfter)
    )
    expect(after.current?.name).toBe('next1')
    expect(after.completed.map(s => s.name)).toEqual(['current', 'past2'])
  })

  it('buckets a sprint the same way for UTC-7, UTC and UTC+8 viewers', () => {
    // One fixed instant: Sat Jul 25 18:08 in Los Angeles / Sun Jul 26 01:08
    // UTC / Sun Jul 26 09:08 in Shanghai. Every one of those local days falls
    // inside Jul 13–26, so every viewer must see the same running sprint —
    // and none of them may see it filed under Completed.
    const instant = Date.parse('2026-07-26T01:08:00Z')
    const all = [past1, past2, current, next1, next2]
    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Shanghai']) {
      const {
        current: c,
        completed,
        upcoming,
      } = inTimezone(tz, () => partitionSprints(all, instant))
      expect([tz, c?.name]).toEqual([tz, 'current'])
      expect([tz, completed.map(s => s.name)]).toEqual([tz, ['past2', 'past1']])
      expect([tz, upcoming.map(s => s.name)]).toEqual([tz, ['next1', 'next2']])
    }
  })
})
