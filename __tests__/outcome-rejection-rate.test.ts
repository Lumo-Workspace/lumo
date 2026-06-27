import {
  computeOutcomeRejectionRate,
  formatOutcomeRejectionReport,
  DEFAULT_MIN_SAMPLES,
  type DeliveryOutcome,
} from '@/lib/outcome/rejection-rate'

/**
 * LUM-603 / LUM-606 — the trust × post-hoc-fate join, at the query layer.
 *
 * These tests pin the falsifier-not-verifier discipline the task's own 铁律
 * demands: the join must REFUSE to invent a rate or a direction off a thin
 * sample, and a delivery the well never rejected must read as INCONCLUSIVE
 * (absence of rejection), never as a "satisfied" pass. The trust axis is now the
 * frozen verification-friction scalars (LUM-606), bracketed value-neutrally —
 * the saturating sample-size axis (deriveConfidence) is retired from this join.
 */

/** Friction templates for each value-neutral bucket. */
const NO_VERIFICATION = { verificationRounds: null, sendBackCount: null }
const SINGLE_ROUND = { verificationRounds: 1, sendBackCount: 0 }
const MULTI_OR_SENDBACK = { verificationRounds: 3, sendBackCount: 1 }

/** n deliveries with one friction template, `rejected` of them rejected. */
function bucket(
  friction: { verificationRounds: number | null; sendBackCount: number | null },
  n: number,
  rejected: number
): DeliveryOutcome[] {
  return Array.from({ length: n }, (_, i) => ({
    ...friction,
    rejected: i < rejected,
  }))
}

describe('computeOutcomeRejectionRate', () => {
  it('brackets by friction not confidence: deliveries split into friction buckets, falsifier-only preserved', () => {
    const deliveries = [
      ...bucket(SINGLE_ROUND, 12, 0),
      ...bucket(MULTI_OR_SENDBACK, 12, 5),
    ]
    const report = computeOutcomeRejectionRate(deliveries, { minSamples: 10 })
    const single = report.brackets.find(b => b.bracket === 'single-round')!
    const multi = report.brackets.find(
      b => b.bracket === 'multi-round-or-sendback'
    )!
    expect(single.delivered).toBe(12)
    expect(multi.delivered).toBe(12)
    // The bucket key is friction, never a forecast-confidence bracket.
    expect(report.brackets.map(b => b.bracket)).toEqual([
      'no-verification',
      'single-round',
      'multi-round-or-sendback',
    ])
    // Falsifier-only: a zero-signal bucket counts in the denominator, rate 0.
    expect(single.rejectionRate).toBe(0)
    expect(multi.rejected).toBe(5)
  })

  it('no-verification is its own bucket, never folded into single-round', () => {
    // 11 deliveries with no verification record + 11 genuine single-round.
    const deliveries = [
      ...bucket(NO_VERIFICATION, 11, 0),
      ...bucket(SINGLE_ROUND, 11, 0),
    ]
    const report = computeOutcomeRejectionRate(deliveries)
    const none = report.brackets.find(b => b.bracket === 'no-verification')!
    const single = report.brackets.find(b => b.bracket === 'single-round')!
    expect(none.delivered).toBe(11) // absence is counted as its own bucket…
    expect(single.delivered).toBe(11) // …never merged into single-round.
  })

  it('reports insufficient brackets and inconclusive comparison on thin samples', () => {
    // single-round: 5 deliveries; multi: 4 — both below the floor (10).
    const deliveries = [
      ...bucket(SINGLE_ROUND, 5, 2),
      ...bucket(MULTI_OR_SENDBACK, 4, 1),
    ]
    const report = computeOutcomeRejectionRate(deliveries)

    expect(report.minSamples).toBe(DEFAULT_MIN_SAMPLES)
    const single = report.brackets.find(b => b.bracket === 'single-round')!
    const multi = report.brackets.find(
      b => b.bracket === 'multi-round-or-sendback'
    )!

    // Thin samples → never a numeric rate or interval.
    expect(single.status).toBe('insufficient')
    expect(single.rejectionRate).toBeNull()
    expect(single.interval).toBeNull()
    expect(single.delivered).toBe(5) // raw counts are still surfaced honestly
    expect(multi.status).toBe('insufficient')
    expect(multi.rejectionRate).toBeNull()

    // The comparison must not assert a direction off too few samples.
    expect(report.comparison.status).toBe('inconclusive')
    expect(report.comparison.direction).toBeNull()
  })

  it('counts zero-signal deliveries as not-rejected and never satisfied', () => {
    // 12 single-round deliveries, none rejected by the well (zero signals each).
    const allClean = bucket(SINGLE_ROUND, 12, 0)
    const report = computeOutcomeRejectionRate(allClean)
    const single = report.brackets.find(b => b.bracket === 'single-round')!

    // A zero-signal delivery counts in the DENOMINATOR (INCONCLUSIVE, not absent)…
    expect(single.delivered).toBe(12)
    // …but is never counted as rejected, and the rate is a lower bound of 0 —
    // crucially NOT a "satisfied"/pass verdict. The report carries no such field.
    expect(single.rejected).toBe(0)
    expect(single.rejectionRate).toBe(0)
    expect(single.status).toBe('measured')
    expect('satisfied' in (single as object)).toBe(false)
    expect('pass' in (report as object)).toBe(false)

    // Rejection is keyed purely off signal presence (count > 0), nothing else:
    // flip 3 to rejected and the rate is exactly 3/12.
    const mixed = bucket(SINGLE_ROUND, 12, 3)
    const mixedSingle = computeOutcomeRejectionRate(mixed).brackets.find(
      b => b.bracket === 'single-round'
    )!
    expect(mixedSingle.rejected).toBe(3)
    expect(mixedSingle.rejectionRate).toBeCloseTo(0.25, 10)
  })

  it('same frozen friction always maps to the same bucket', () => {
    // Replayability: bucket is a pure function of the FROZEN friction scalars.
    const run = () =>
      computeOutcomeRejectionRate([
        ...bucket(NO_VERIFICATION, 1, 0),
        ...bucket(SINGLE_ROUND, 1, 0),
        ...bucket(MULTI_OR_SENDBACK, 1, 0),
      ]).brackets.map(b => ({ bracket: b.bracket, delivered: b.delivered }))

    const a = run()
    const b = run()
    expect(a).toEqual(b)
    const byBracket = Object.fromEntries(a.map(x => [x.bracket, x.delivered]))
    expect(byBracket).toEqual({
      'no-verification': 1,
      'single-round': 1,
      'multi-round-or-sendback': 1,
    })
  })

  it('emits a friction-bucket direction only when both brackets are measured and CIs are disjoint', () => {
    // single-round: 40 deliveries, 2 rejected (5%); multi: 40, 30 rejected (75%).
    // Wide separation → disjoint Wilson intervals → a real, earned direction.
    const deliveries = [
      ...bucket(SINGLE_ROUND, 40, 2),
      ...bucket(MULTI_OR_SENDBACK, 40, 30),
    ]
    const report = computeOutcomeRejectionRate(deliveries)
    expect(report.comparison.status).toBe('measured')
    expect(report.comparison.direction).toBe(
      'multi-round-or-sendback-rejected-more'
    )

    // Same N but nearly-equal rates → overlapping CIs → inconclusive, no direction.
    const close = [
      ...bucket(SINGLE_ROUND, 40, 19),
      ...bucket(MULTI_OR_SENDBACK, 40, 21),
    ]
    const closeReport = computeOutcomeRejectionRate(close)
    expect(closeReport.comparison.status).toBe('inconclusive')
    expect(closeReport.comparison.direction).toBeNull()
  })

  it('format echoes N and the inconclusive verdict honestly', () => {
    const out = formatOutcomeRejectionReport(
      computeOutcomeRejectionRate([
        ...bucket(SINGLE_ROUND, 3, 1),
        ...bucket(MULTI_OR_SENDBACK, 2, 0),
      ])
    )
    expect(out).toMatch(/inconclusive/i)
    expect(out).toMatch(/insufficient/i)
    // honest lower-bound framing surfaced, not a "failure rate" claim
    expect(out).toMatch(/lower bound/i)
  })
})
