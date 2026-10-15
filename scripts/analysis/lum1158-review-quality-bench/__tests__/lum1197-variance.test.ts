/**
 * LUM-1197 — run-to-run noise of the review benchmark: per-arm run stats,
 * agreement across runs, the paired PR × run bootstrap of an F1 difference,
 * the target-fix hit test, and the detectable-effect rule of thumb.
 */
import { seededRandom, type PrScore } from '../bench-lib'
import {
  armStats,
  bootstrapF1Delta,
  detectableDelta,
  fisherOneSidedGreater,
  deltaVerdict,
  foundByEveryRun,
  holmAdjust,
  parseCount,
  targetFixHits,
  targetFixTests,
} from '../variance-lib'

const s = (
  findings: number,
  matchedFindings: number,
  fixes: number,
  matchedFixIds: string[]
): PrScore => ({
  findings,
  matchedFindings,
  fixes,
  matchedFixes: matchedFixIds.length,
  noise: findings - matchedFindings,
  matchedFixIds,
})

describe('LUM-1197 armStats', () => {
  it('pools each run over its PRs and reports mean, sample SD and spread of F1', () => {
    // run A: P 2/4, R 2/4 → F1 50; run B: P 1/1, R 1/4 → F1 40.
    const runA = [s(2, 1, 2, ['A1']), s(2, 1, 2, ['A1'])]
    const runB = [s(1, 1, 2, ['A1']), s(0, 0, 2, [])]
    const st = armStats([runA, runB])
    expect(st.f1.map(x => Math.round(x * 10) / 10)).toEqual([50, 40])
    expect(st.mean).toBeCloseTo(45, 6)
    expect(st.sd).toBeCloseTo(Math.sqrt(50), 6)
    expect(st.spread).toBeCloseTo(10, 6)
    expect(st.noisePerPr).toEqual([1, 0])
  })

  it('a single run has SD 0', () => {
    expect(armStats([[s(1, 1, 1, ['A1'])]]).sd).toBe(0)
  })
})

describe('LUM-1197 foundByEveryRun', () => {
  it('counts fixes found by every run out of fixes found by any run, per PR', () => {
    const r0 = [s(2, 2, 3, ['A1', 'A2']), s(1, 1, 1, ['A1'])]
    const r1 = [s(1, 1, 3, ['A1']), s(1, 1, 1, ['A1'])]
    // PR0: A1 both, A2 only r0; PR1: A1 both (a different fix from PR0's A1).
    expect(foundByEveryRun([r0, r1])).toEqual({ every: 2, any: 3 })
  })
})

describe('LUM-1197 bootstrapF1Delta', () => {
  const good = () => [
    s(1, 1, 1, ['A1']),
    s(1, 1, 1, ['A1']),
    s(1, 1, 1, ['A1']),
  ]
  const bad = () => [s(1, 0, 1, []), s(1, 0, 1, []), s(1, 0, 1, [])]

  it('identical arms give a zero difference whose interval contains 0', () => {
    const arm = [good(), bad()]
    const d = bootstrapF1Delta(arm, arm, {
      iterations: 500,
      rand: seededRandom(1),
    })
    expect(d.delta).toBe(0)
    expect(d.lo).toBeLessThanOrEqual(0)
    expect(d.hi).toBeGreaterThanOrEqual(0)
  })

  it('a variant better on every run and PR has an interval above 0', () => {
    const d = bootstrapF1Delta([bad(), bad()], [good(), good()], {
      iterations: 500,
      rand: seededRandom(2),
    })
    expect(d.delta).toBe(100)
    expect(d.lo).toBeGreaterThan(0)
    expect(d.pBetter).toBe(1)
  })

  it('is reproducible with the same seed', () => {
    const base = [good(), bad()]
    const variant = [good(), good(), bad()]
    const a = bootstrapF1Delta(base, variant, {
      iterations: 300,
      rand: seededRandom(7),
    })
    const b = bootstrapF1Delta(base, variant, {
      iterations: 300,
      rand: seededRandom(7),
    })
    expect(a).toEqual(b)
  })

  it('refuses arms scored on different PR lists', () => {
    expect(() =>
      bootstrapF1Delta([good()], [good().slice(1)], {
        iterations: 10,
        rand: seededRandom(1),
      })
    ).toThrow(/same PRs/)
  })
})

describe('LUM-1197 fisherOneSidedGreater', () => {
  it('3/3 variant hits vs 0/4 baseline hits is p = 1/35', () => {
    expect(fisherOneSidedGreater(3, 0, 0, 4)).toBeCloseTo(1 / 35, 10)
  })

  it('equal rates are not significant', () => {
    expect(fisherOneSidedGreater(1, 1, 2, 2)).toBeGreaterThan(0.5)
  })

  it('no trials → p = 1', () => {
    expect(fisherOneSidedGreater(0, 0, 0, 0)).toBe(1)
  })
})

describe('LUM-1197 targetFixHits', () => {
  it('counts how many runs found each target fix', () => {
    const r0 = [s(1, 1, 2, ['A1']), s(1, 1, 1, ['A1'])]
    const r1 = [s(1, 1, 2, ['A2']), s(0, 0, 1, [])]
    const out = targetFixHits(
      [r0, r1],
      ['oss-01', 'oss-02'],
      [
        { prId: 'oss-01', fixId: 'A1' },
        { prId: 'oss-02', fixId: 'A1' },
        { prId: 'oss-09', fixId: 'A1' },
      ]
    )
    expect(out).toEqual({
      hits: 2,
      trials: 4,
      perFix: [
        { prId: 'oss-01', fixId: 'A1', hits: 1 },
        { prId: 'oss-02', fixId: 'A1', hits: 1 },
      ],
      missing: ['oss-09:A1'],
    })
  })
})

describe('LUM-1197 detectableDelta', () => {
  it('is 2.8 × run SD × √(2/n): 95% two-sided, 80% power, n runs per arm', () => {
    expect(detectableDelta(3.67, 2)).toBeCloseTo(10.276, 3)
    expect(detectableDelta(3.67, 8)).toBeCloseTo(5.138, 3)
  })
})

describe('LUM-1197 deltaVerdict', () => {
  const above = { delta: 5, lo: 1, hi: 9, pBetter: 0.99 }
  const below = { delta: -5, lo: -9, hi: -1, pBetter: 0.01 }
  const across = { delta: 1, lo: -3, hi: 5, pBetter: 0.6 }

  it('gives no verdict when either arm has fewer than 2 runs', () => {
    expect(deltaVerdict(above, 1, 3)).toBe(
      'insufficient runs (need ≥ 2 per arm, 3 recommended)'
    )
    expect(deltaVerdict(below, 3, 1)).toBe(
      'insufficient runs (need ≥ 2 per arm, 3 recommended)'
    )
  })

  it('reads the interval only with ≥ 2 runs per arm', () => {
    expect(deltaVerdict(above, 2, 2)).toBe('better beyond run noise')
    expect(deltaVerdict(below, 3, 3)).toBe('worse beyond run noise')
    expect(deltaVerdict(across, 4, 3)).toBe('inside run noise')
  })
})

describe('LUM-1197 holmAdjust', () => {
  it('multiplies the k-th smallest p by (m − k + 1), keeps order monotone, caps at 1', () => {
    const adj = holmAdjust([0.01, 0.04, 0.03])
    ;[0.03, 0.06, 0.06].forEach((x, i) => expect(adj[i]).toBeCloseTo(x, 12))
    expect(holmAdjust([0.5, 0.6])).toEqual([1, 1])
    expect(holmAdjust([])).toEqual([])
  })
})

describe('LUM-1197 targetFixTests', () => {
  it('tests each target fix on its own runs, Holm-adjusted across fixes', () => {
    // fix A1 on oss-01: base 0/4 runs, variant 3/3; fix A1 on oss-02: 1/4 vs 1/3.
    const hit = (ids: string[]) => s(1, ids.length ? 1 : 0, 1, ids)
    const base = [0, 1, 2, 3].map(r => [hit([]), hit(r === 0 ? ['A1'] : [])])
    const variant = [0, 1, 2].map(r => [
      hit(['A1']),
      hit(r === 0 ? ['A1'] : []),
    ])
    const out = targetFixTests(
      base,
      variant,
      ['oss-01', 'oss-02'],
      [
        { prId: 'oss-01', fixId: 'A1' },
        { prId: 'oss-02', fixId: 'A1' },
      ]
    )
    expect(out.perFix.map(f => [f.baseHits, f.variantHits])).toEqual([
      [0, 3],
      [1, 1],
    ])
    expect(out.perFix[0]!.p).toBeCloseTo(1 / 35, 10)
    expect(out.perFix[0]!.pHolm).toBeCloseTo(2 / 35, 10)
    expect(out.perFix[1]!.pHolm).toBeGreaterThan(0.5)
    expect(out.missing).toEqual([])
  })
})

describe('LUM-1197 parseCount', () => {
  it('accepts whole numbers at or above the minimum', () => {
    expect(parseCount('iterations', '4000', 1)).toBe(4000)
    expect(parseCount('seed', '0', 0)).toBe(0)
  })

  it('rejects non-numbers, fractions and values below the minimum', () => {
    expect(() => parseCount('iterations', 'abc', 1)).toThrow(/--iterations/)
    expect(() => parseCount('iterations', '2.5', 1)).toThrow(/whole number/)
    expect(() => parseCount('iterations', '0', 1)).toThrow(/≥ 1/)
    expect(() => parseCount('seed', '', 0)).toThrow(/--seed/)
  })
})
