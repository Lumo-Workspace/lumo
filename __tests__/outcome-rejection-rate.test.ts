import {
  computeOutcomeRejectionRate,
  formatOutcomeRejectionReport,
  DEFAULT_MIN_SAMPLES,
  type DeliveryOutcome,
} from '@/lib/outcome/rejection-rate'

/**
 * LUM-603 — the trust × post-hoc-fate join, at the query layer.
 *
 * These tests pin the falsifier-not-verifier discipline the task's own 铁律
 * demands: the join must REFUSE to invent a rate or a direction off a thin
 * sample, and a delivery the well never rejected must read as INCONCLUSIVE
 * (absence of rejection), never as a "satisfied" pass. They verify the
 * SKELETON's honesty logic — the real correlation is a deferred PENDING_OUTCOME
 * that lands only once the well accumulates signals.
 */

/** n deliveries in a bracket (samples → confidence), `rejected` of them rejected. */
function bracket(
  samples: number[],
  n: number,
  rejected: number
): DeliveryOutcome[] {
  return Array.from({ length: n }, (_, i) => ({
    confidenceSamples: samples,
    rejected: i < rejected,
  }))
}

describe('computeOutcomeRejectionRate', () => {
  it('reports insufficient brackets and inconclusive comparison on thin samples', () => {
    // high bracket: 5 deliveries; low bracket: 4 — both below the floor (10).
    const deliveries = [
      ...bracket([12], 5, 2), // 'high'
      ...bracket([3], 4, 1), // 'low'
    ]
    const report = computeOutcomeRejectionRate(deliveries)

    expect(report.minSamples).toBe(DEFAULT_MIN_SAMPLES)
    const high = report.brackets.find(b => b.bracket === 'high')!
    const low = report.brackets.find(b => b.bracket === 'low')!

    // Thin samples → never a numeric rate or interval.
    expect(high.status).toBe('insufficient')
    expect(high.rejectionRate).toBeNull()
    expect(high.interval).toBeNull()
    expect(high.delivered).toBe(5) // raw counts are still surfaced honestly
    expect(low.status).toBe('insufficient')
    expect(low.rejectionRate).toBeNull()

    // The comparison must not assert a direction off too few samples.
    expect(report.comparison.status).toBe('inconclusive')
    expect(report.comparison.direction).toBeNull()
  })

  it('counts zero-signal deliveries as not-rejected and never satisfied', () => {
    // 12 high-bracket deliveries, none rejected by the well (zero signals each).
    const allClean = bracket([12], 12, 0)
    const report = computeOutcomeRejectionRate(allClean)
    const high = report.brackets.find(b => b.bracket === 'high')!

    // A zero-signal delivery counts in the DENOMINATOR (INCONCLUSIVE, not absent)…
    expect(high.delivered).toBe(12)
    // …but is never counted as rejected, and the rate is a lower bound of 0 —
    // crucially NOT a "satisfied"/pass verdict. The report carries no such field.
    expect(high.rejected).toBe(0)
    expect(high.rejectionRate).toBe(0)
    expect(high.status).toBe('measured')
    expect('satisfied' in (high as object)).toBe(false)
    expect('pass' in (report as object)).toBe(false)

    // Rejection is keyed purely off signal presence (count > 0), nothing else:
    // flip 3 to rejected and the rate is exactly 3/12.
    const mixed = bracket([12], 12, 3)
    const mixedHigh = computeOutcomeRejectionRate(mixed).brackets.find(
      b => b.bracket === 'high'
    )!
    expect(mixedHigh.rejected).toBe(3)
    expect(mixedHigh.rejectionRate).toBeCloseTo(0.25, 10)
  })

  it('same frozen inputs always map to the same bracket', () => {
    // Replayability: bracket is a pure function of the FROZEN snapshot inputs.
    const run = () =>
      computeOutcomeRejectionRate([
        ...bracket([12], 1, 0),
        ...bracket([6], 1, 0),
        ...bracket([3], 1, 0),
      ]).brackets.map(b => ({ bracket: b.bracket, delivered: b.delivered }))

    const a = run()
    const b = run()
    expect(a).toEqual(b)
    // cohortSize/tokenCostBasis 12 → high, 6 → medium, 3 → low (deriveConfidence).
    expect(a.find(x => x.delivered === 1 && x.bracket === 'high')).toBeDefined()
    const byBracket = Object.fromEntries(
      computeOutcomeRejectionRate([
        ...bracket([12], 1, 0),
        ...bracket([6], 1, 0),
        ...bracket([3], 1, 0),
      ]).brackets.map(b => [b.bracket, b.delivered])
    )
    expect(byBracket).toEqual({ high: 1, medium: 1, low: 1 })
  })

  it('emits a high-vs-low direction only when both brackets are measured and CIs are disjoint', () => {
    // high: 40 deliveries, 2 rejected (5%); low: 40 deliveries, 30 rejected (75%).
    // Wide separation → disjoint Wilson intervals → a real, earned direction.
    const deliveries = [...bracket([12], 40, 2), ...bracket([3], 40, 30)]
    const report = computeOutcomeRejectionRate(deliveries)
    expect(report.comparison.status).toBe('measured')
    expect(report.comparison.direction).toBe('low-rejected-more')

    // Same N but nearly-equal rates → overlapping CIs → inconclusive, no direction.
    const close = [...bracket([12], 40, 19), ...bracket([3], 40, 21)]
    const closeReport = computeOutcomeRejectionRate(close)
    expect(closeReport.comparison.status).toBe('inconclusive')
    expect(closeReport.comparison.direction).toBeNull()
  })

  it('format echoes N and the inconclusive verdict honestly', () => {
    const out = formatOutcomeRejectionReport(
      computeOutcomeRejectionRate([
        ...bracket([12], 3, 1),
        ...bracket([3], 2, 0),
      ])
    )
    expect(out).toMatch(/inconclusive/i)
    expect(out).toMatch(/insufficient/i)
    // honest lower-bound framing surfaced, not a "failure rate" claim
    expect(out).toMatch(/lower bound/i)
  })
})
