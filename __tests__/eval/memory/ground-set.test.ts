/**
 * LUM-396 grounding corpus — deterministic structural guard (the live
 * interception run is key-gated in scripts/eval/memory/ground-runner.ts and
 * can't run in CI). Also pins the LUM-336 lesson: grounding cases live in
 * their own corpus, NOT in evalSet, so vectors.fixture.json never needs
 * regenerating when one is added.
 */
import {
  groundEvalSet,
  validateGroundEvalSet,
} from '@/scripts/eval/memory/ground-set'
import { evalSet } from '@/scripts/eval/memory/eval-set'
import { parseMemoryContent } from '@/lib/memory/schemas'

describe('ground-set corpus', () => {
  it('is structurally valid (unique ids, non-empty sources, annotated candidates)', () => {
    expect(validateGroundEvalSet(groundEvalSet)).toEqual([])
  })

  it('contains hallucination (UNSUPPORTED) candidates and grounded (SUPPORTED) ones', () => {
    const all = groundEvalSet.flatMap(c => c.candidates)
    expect(all.filter(x => x.expected === 'UNSUPPORTED').length).toBeGreaterThanOrEqual(5)
    expect(all.filter(x => x.expected === 'SUPPORTED').length).toBeGreaterThanOrEqual(5)
  })

  it('covers both layer shapes (L1 turn log, L2 memory window)', () => {
    const shapes = new Set(groundEvalSet.map(c => c.layerShape))
    expect(shapes).toEqual(new Set(['L1', 'L2']))
  })

  it('every candidate content validates against its category schema', () => {
    for (const c of groundEvalSet) {
      for (const cand of c.candidates) {
        expect(() => parseMemoryContent(cand.category, cand.content)).not.toThrow()
      }
    }
  })

  it('stays out of the embedded evalSet (no fixture regeneration needed)', () => {
    const embeddedIds = new Set(evalSet.map(c => c.id))
    for (const c of groundEvalSet) {
      expect(embeddedIds.has(c.id)).toBe(false)
    }
  })
})
