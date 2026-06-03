import { extractMetrics } from '@/lib/forecast/metrics'
import type { ForecastCandidate } from '@/lib/forecast/types'

function candidate(over: Partial<ForecastCandidate>): ForecastCandidate {
  return {
    id: 't1',
    title: 'x',
    identifier: 'LUM-1',
    tags: [],
    agentRuns: [],
    mergedPrAt: [],
    ...over,
  }
}

const h = (n: number) => new Date(2026, 0, 1, n, 0, 0) // n-th hour of the day

describe('extractMetrics', () => {
  it('counts agent runs as iterations', () => {
    const m = extractMetrics(
      candidate({
        agentRuns: [
          { startedAt: h(0), finishedAt: h(1) },
          { startedAt: h(2), finishedAt: h(3) },
        ],
      })
    )
    expect(m.iterations).toBe(2)
  })

  it('counts merged PRs', () => {
    const m = extractMetrics(
      candidate({ mergedPrAt: [h(5), h(6)], agentRuns: [{ startedAt: h(0), finishedAt: h(1) }] })
    )
    expect(m.mergedPrs).toBe(2)
  })

  it('anchors cycle from first run start to latest merged PR', () => {
    const m = extractMetrics(
      candidate({
        agentRuns: [
          { startedAt: h(1), finishedAt: h(2) },
          { startedAt: h(3), finishedAt: h(4) },
        ],
        mergedPrAt: [h(5)],
      })
    )
    expect(m.cycleHours).toBeCloseTo(4)
  })

  it('falls back to latest finishedAt when there is no merged PR', () => {
    const m = extractMetrics(
      candidate({
        agentRuns: [
          { startedAt: h(1), finishedAt: h(2) },
          { startedAt: h(3), finishedAt: h(7) },
        ],
      })
    )
    expect(m.mergedPrs).toBe(0)
    expect(m.cycleHours).toBeCloseTo(6)
  })

  it('returns null cycle when no merged PR and no finishedAt', () => {
    const m = extractMetrics(
      candidate({ agentRuns: [{ startedAt: h(1), finishedAt: null }] })
    )
    expect(m.cycleHours).toBeNull()
  })

  it('returns null cycle when there are no agent runs', () => {
    const m = extractMetrics(candidate({ agentRuns: [], mergedPrAt: [h(5)] }))
    expect(m.cycleHours).toBeNull()
  })
})
