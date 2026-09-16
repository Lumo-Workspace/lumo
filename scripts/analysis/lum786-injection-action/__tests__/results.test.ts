/**
 * LUM-786 — guards the committed backtest read-out.
 *
 * The acceptance criterion these back: the backtest was actually run over
 * production history and the committed results file carries the scanned
 * interval, the window parameters, the candidate count, the per-evidence-tier
 * breakdown and a sampled true/false adjudication. A spec whose numbers come
 * from a file nobody checked is a spec whose numbers can quietly rot.
 */
import { readFileSync } from 'node:fs'
import { candidateKey, summarize, type Adjudication } from '../adjudicate'

const DIR = 'scripts/analysis/lum786-injection-action'
const results = JSON.parse(readFileSync(`${DIR}/results.json`, 'utf8'))
const adjudications: Adjudication[] = JSON.parse(
  readFileSync(`${DIR}/adjudications.json`, 'utf8')
)

describe('backtest results shape', () => {
  it('names the interval it scanned and the window it used', () => {
    expect(typeof results.generatedAt).toBe('string')
    expect(Date.parse(results.window.scannedFrom)).not.toBeNaN()
    expect(Date.parse(results.window.scannedTo)).not.toBeNaN()
    expect(Date.parse(results.window.scannedFrom)).toBeLessThan(
      Date.parse(results.window.scannedTo)
    )
    // The window decision itself is part of the read-out, not folded away.
    expect(results.window.correlationWindow).toMatch(/end of session/)
  })

  it('reports a real production corpus, not a fixture', () => {
    const c = results.corpus
    expect(c.edges).toBeGreaterThan(1000)
    expect(c.sessionsProcessed).toBeGreaterThan(50)
    expect(c.actionsScanned).toBeGreaterThan(1000)
    expect(c.fragmentsWithLiterals).toBeGreaterThan(0)
    expect(Object.keys(c.edgesByType).length).toBeGreaterThan(0)
  })

  it('breaks candidates down per evidence tier, alongside the null model', () => {
    for (const tier of ['NONE', 'TIME_ONLY', 'ADVISORY', 'MEDIUM', 'HIGH']) {
      expect(typeof results.real.byTier[tier]).toBe('number')
    }
    expect(typeof results.real.reportable).toBe('number')
    // The null model (time proximity alone) must be reported, or the reportable
    // count has nothing to be compared against.
    expect(results.real.byTier.TIME_ONLY).toBeGreaterThan(0)
  })

  it('carries a matched placebo arm with its own denominator', () => {
    expect(results.placebo.pairsTried).toBeGreaterThan(0)
    expect(typeof results.placebo.reportable).toBe('number')
    expect(results.placebo.design).toMatch(/matched/i)
  })

  it('records lag and turn distance rather than assuming a cutoff', () => {
    expect(Object.keys(results.lagHistogram).length).toBeGreaterThan(1)
    expect(Object.keys(results.turnHistogram).length).toBeGreaterThan(1)
  })

  it('carries a sampled true/false adjudication of the candidates', () => {
    const s = results.adjudicationSummary
    expect(s.judged).toBeGreaterThan(0)
    expect(s.judged).toBe(s.truePositives + s.falsePositives)
    expect(s.precision).toBeCloseTo(s.truePositives / s.judged, 10)
    // Every escalated candidate is judged — the escalation set is what a human
    // would ever be shown, so leaving one unjudged would hide the decisive case.
    expect(
      results.escalated.every(
        (e: { adjudication: string }) => e.adjudication !== 'UNJUDGED'
      )
    ).toBe(true)
  })

  it('every adjudication points at a candidate that is actually in the file', () => {
    const keys = new Set(
      [...results.escalated, ...results.samples].map(candidateKey)
    )
    for (const a of adjudications) expect(keys.has(a.key)).toBe(true)
  })
})

describe('adjudication summary is derived, not asserted', () => {
  it('recomputes to the same numbers from the raw rows', () => {
    const byKey = new Map(adjudications.map(a => [a.key, a]))
    const recomputed = summarize(
      [...results.escalated, ...results.samples],
      byKey
    )
    expect(recomputed.judged).toBe(results.adjudicationSummary.judged)
    expect(recomputed.truePositives).toBe(
      results.adjudicationSummary.truePositives
    )
    expect(recomputed.precision).toBe(results.adjudicationSummary.precision)
  })

  it('reports no precision at all when nothing was judged, never a fake zero', () => {
    expect(summarize([], new Map()).precision).toBeNull()
  })
})
