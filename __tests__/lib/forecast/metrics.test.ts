import { extractMetrics } from '@/lib/forecast/metrics'
import type { ForecastCandidate } from '@/lib/forecast/types'

function candidate(over: Partial<ForecastCandidate>): ForecastCandidate {
  return {
    id: 't1',
    title: 'x',
    identifier: 'LUM-1',
    tags: [],
    runs: [],
    mergedPrAt: [],
    tokenCost: null,
    interactionRounds: 0,
    ...over,
  }
}

const h = (n: number) => new Date(2026, 0, 1, n, 0, 0) // n-th hour of the day

describe('extractMetrics', () => {
  it('counts runs (sessions) as iterations', () => {
    const m = extractMetrics(
      candidate({
        runs: [
          { startedAt: h(0), finishedAt: h(1) },
          { startedAt: h(2), finishedAt: h(3) },
        ],
      })
    )
    expect(m.iterations).toBe(2)
  })

  it('counts merged PRs', () => {
    const m = extractMetrics(
      candidate({
        mergedPrAt: [h(5), h(6)],
        runs: [{ startedAt: h(0), finishedAt: h(1) }],
      })
    )
    expect(m.mergedPrs).toBe(2)
  })

  it('anchors cycle from first run start to latest merged PR', () => {
    const m = extractMetrics(
      candidate({
        runs: [
          { startedAt: h(1), finishedAt: h(2) },
          { startedAt: h(3), finishedAt: h(4) },
        ],
        mergedPrAt: [h(5)],
      })
    )
    expect(m.cycleHours).toBeCloseTo(4)
  })

  it('falls back to latest run finish when there is no merged PR', () => {
    const m = extractMetrics(
      candidate({
        runs: [
          { startedAt: h(1), finishedAt: h(2) },
          { startedAt: h(3), finishedAt: h(7) },
        ],
      })
    )
    expect(m.mergedPrs).toBe(0)
    expect(m.cycleHours).toBeCloseTo(6)
  })

  it('returns null cycle when no merged PR and no run finish', () => {
    const m = extractMetrics(
      candidate({ runs: [{ startedAt: h(1), finishedAt: null }] })
    )
    expect(m.cycleHours).toBeNull()
  })

  it('returns null cycle when there are no runs', () => {
    const m = extractMetrics(candidate({ runs: [], mergedPrAt: [h(5)] }))
    expect(m.cycleHours).toBeNull()
  })

  it('passes through tokenCost', () => {
    expect(extractMetrics(candidate({ tokenCost: 1234 })).tokenCost).toBe(1234)
    expect(extractMetrics(candidate({ tokenCost: null })).tokenCost).toBeNull()
  })
})

it('passes interactionRounds through from the candidate', () => {
  const c: ForecastCandidate = {
    id: 'a',
    title: 'X',
    identifier: 'LUM-1',
    tags: [],
    runs: [],
    mergedPrAt: [],
    tokenCost: null,
    interactionRounds: 4,
  }
  expect(extractMetrics(c).interactionRounds).toBe(4)
})
