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

describe('daysFromNow', () => {
  const now = 1_000_000_000_000

  it('returns positive whole days for a future date', () => {
    expect(daysFromNow(new Date(now + 5 * DAY), now)).toBe(5)
  })

  it('returns negative days for a past date', () => {
    expect(daysFromNow(new Date(now - 3 * DAY), now)).toBe(-3)
  })

  it('rounds up partial days (ceil)', () => {
    expect(daysFromNow(new Date(now + 1.2 * DAY), now)).toBe(2)
  })
})

describe('timeElapsedPct', () => {
  const start = 0
  const end = 10 * DAY

  it('clamps to 0 before the sprint starts', () => {
    expect(timeElapsedPct(new Date(start), new Date(end), -DAY)).toBe(0)
  })

  it('clamps to 100 after the sprint ends', () => {
    expect(timeElapsedPct(new Date(start), new Date(end), end + DAY)).toBe(100)
  })

  it('reports the midpoint at 50%', () => {
    expect(timeElapsedPct(new Date(start), new Date(end), 5 * DAY)).toBe(50)
  })
})

describe('partitionSprints', () => {
  const now = 100 * DAY
  const past1 = sprint('past1', 0, 10 * DAY)
  const past2 = sprint('past2', 20 * DAY, 30 * DAY)
  const current = sprint('current', 95 * DAY, 105 * DAY)
  const next1 = sprint('next1', 110 * DAY, 120 * DAY)
  const next2 = sprint('next2', 130 * DAY, 140 * DAY)

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
})
