import { evalSet } from '@/scripts/eval/memory/eval-set'
import { validateEvalCase, isPositiveCase } from '@/scripts/eval/memory/types'

describe('eval-set corpus', () => {
  it('has 50–60 cases', () => {
    expect(evalSet.length).toBeGreaterThanOrEqual(50)
    expect(evalSet.length).toBeLessThanOrEqual(60)
  })

  it('every case is structurally valid with unique ids', () => {
    const seen = new Set<string>()
    const errs: string[] = []
    for (const c of evalSet) {
      errs.push(...validateEvalCase(c, seen))
      seen.add(c.id)
    }
    expect(errs).toEqual([])
  })

  it('covers all four relationships with ≥10 each', () => {
    const counts: Record<string, number> = {}
    for (const c of evalSet)
      counts[c.relationship] = (counts[c.relationship] ?? 0) + 1
    for (const r of ['CONTRADICTION', 'REFINEMENT', 'DUPLICATE', 'UNRELATED']) {
      expect(counts[r] ?? 0).toBeGreaterThanOrEqual(10)
    }
  })

  it('covers all four categories', () => {
    expect(new Set(evalSet.map(c => c.category)).size).toBe(4)
  })

  it('has a non-trivial distractor pool for positive cases', () => {
    // every positive case competes against ≥40 other existing members
    expect(evalSet.filter(isPositiveCase).length).toBeGreaterThanOrEqual(35)
  })
})
