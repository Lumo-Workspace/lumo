/**
 * LUM-776 — the model/config choice for the planner ships on measured
 * evidence, and this test is what holds it to that: `results.json` is the
 * committed read-out of `probe.ts` over ≥16 DISTINCT real prompts, and the
 * variant the shipped code corresponds to must have cleared the bar on it.
 *
 * Re-run the probe and commit its results whenever the planner's model,
 * schema or budget changes; this test does not call any model.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PLAN_FAILURE_SHAPES } from '@/lib/security-scan/hunt/plan-retry'
import { PLAN_HUNT_MAX_ATTEMPTS } from '@/lib/services/security-hunt.config'
import { shippedVariantName, VARIANTS } from '../variants'
import type { ProbeResults } from '../probe'

const results = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'results.json'), 'utf8')
) as ProbeResults

const MIN_PROMPTS = 16
/** ≥ 15/16 of the prompts must produce a plan. */
const MIN_OK_RATE = 15 / 16

describe('LUM-776 planner probe results', () => {
  it('measured at least 16 distinct real prompts', () => {
    expect(results.corpus.length).toBeGreaterThanOrEqual(MIN_PROMPTS)
    const pairs = new Set(results.corpus.map(c => `${c.pr}@${c.headSha}`))
    expect(pairs.size).toBe(results.corpus.length)
    const hashes = new Set(results.corpus.map(c => c.promptSha256))
    expect(hashes.size).toBe(results.corpus.length)
    // Real prompts, not slim fixtures: LUM-766's synthetic ones under-reported
    // the failure rate by a factor of two.
    for (const c of results.corpus) expect(c.promptChars).toBeGreaterThan(1_000)
  })

  it('the shipped configuration is one of the measured variants and ran every prompt', () => {
    const shipped = shippedVariantName()
    expect(VARIANTS.map(v => v.name)).toContain(shipped)
    const v = results.variants[shipped]
    expect(v).toBeDefined()
    expect(v!.calls).toHaveLength(results.corpus.length)
    // …with the retry production gives a transient failure, not single-shot.
    expect(v!.attemptsAllowed).toBe(PLAN_HUNT_MAX_ATTEMPTS)
    for (const c of v!.calls)
      expect(c.attempts).toBeLessThanOrEqual(PLAN_HUNT_MAX_ATTEMPTS)
  })

  it('the shipped configuration parses a plan on at least 15/16 of the real prompts', () => {
    const v = results.variants[shippedVariantName()]!
    const ok = v.calls.filter(c => c.ok).length
    expect(ok / v.calls.length).toBeGreaterThanOrEqual(MIN_OK_RATE)
  })

  it('the shipped configuration does not hunt less than the pre-LUM-776 model answers did', () => {
    // A planner that "succeeds" by always answering [] has not been fixed, it
    // has been silenced. The bar is the current call's own successful plans.
    const shipped = results.variants[shippedVariantName()]!.calls.filter(
      c => c.ok
    )
    // The shipped call as it was before LUM-776's envelope repair (relaxed
    // schema only, single-shot): the plans the current model produced when it
    // produced one. A repaired `{}` counts as an empty plan on the shipped
    // side, so this bar is not gamed by the repair.
    const baseline = results.variants[
      'flash-reasoning-pre-repair'
    ]!.calls.filter(c => c.ok)
    const nonEmpty = (calls: typeof shipped) =>
      calls.filter(c => (c.tasks ?? 0) > 0).length / Math.max(1, calls.length)
    expect(nonEmpty(shipped)).toBeGreaterThanOrEqual(nonEmpty(baseline))
  })

  it('every recorded failure carries a stable shape', () => {
    for (const v of Object.values(results.variants))
      for (const c of v.calls)
        if (!c.ok) expect(PLAN_FAILURE_SHAPES).toContain(c.failure?.shape)
  })
})
