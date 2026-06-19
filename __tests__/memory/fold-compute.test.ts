/**
 * @jest-environment node
 *
 * LUM-553 — the fail-closed coverage gate. Pure: no LLM, no DB.
 */
import {
  mapWithConcurrency,
  selectCoveredSources,
} from '@/lib/services/memory/fold-compute'
import { coarseCardSchemaFor } from '@/lib/memory/fold-schemas'

describe('selectCoveredSources', () => {
  it('fold coverage gate is fail-closed and supersede set equals covered set', () => {
    const coarseText =
      'prisma migrate dev rejects P3008 drift; workaround is db execute then migrate resolve. ' +
      'jest by-name checkpointers fake-pass on zero match; use scripts/jest-t.ts.'
    const sources = [
      { id: 'covered-real', text: 'P3008 drift workaround' },
      { id: 'covered-but-quote-absent', text: 'something' },
      { id: 'judged-uncovered', text: 'unrelated' },
      { id: 'no-verdict', text: 'orphan' },
      { id: 'empty-quote', text: 'x' },
    ]
    const verdicts = [
      {
        sourceMemoryId: 'covered-real',
        covered: true,
        evidenceQuote: 'db execute then migrate resolve',
      },
      {
        sourceMemoryId: 'covered-but-quote-absent',
        covered: true,
        evidenceQuote: 'this phrase is not in the coarse card',
      },
      {
        sourceMemoryId: 'judged-uncovered',
        covered: false,
        evidenceQuote: 'jest by-name checkpointers',
      },
      { sourceMemoryId: 'empty-quote', covered: true, evidenceQuote: '' },
      // 'no-verdict' deliberately omitted
    ]

    const covered = selectCoveredSources(coarseText, sources, verdicts)

    // Only the source whose verdict is covered=true AND whose quote is actually
    // present in the coarse card survives. Everything uncertain is dropped.
    expect(covered).toEqual(['covered-real'])
  })
})

describe('coarseCardSchemaFor enforces the per-category coarse-card shape', () => {
  it('accepts a structured TRAP coarse card and rejects a free {id,text} blob', () => {
    const schema = coarseCardSchemaFor('TRAP')

    // Structured per-category content → valid (the model is forced into this).
    expect(
      schema.safeParse({
        summary: 'Prisma migrations',
        trigger: 'applying migrations across environments',
        outcome: 'schema drift / 500s',
        workaround: '(1) migrate deploy on prod (2) regenerate client',
      }).success
    ).toBe(true)

    // The LUM-553 dogfood failure shape: a free {id,text} blob → rejected, so it
    // can never reach parseMemoryContent and silently fold nothing.
    expect(
      schema.safeParse({ id: 'coarse-prisma', text: '(1)… (2)… (3)…' }).success
    ).toBe(false)
  })
})

describe('mapWithConcurrency', () => {
  it('preserves order, processes all items, and never exceeds the cap', async () => {
    let active = 0
    let peak = 0
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return n * 2
    })

    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]) // order preserved, all run
    expect(peak).toBeLessThanOrEqual(3) // cap respected
    expect(peak).toBeGreaterThan(1) // actually concurrent (not serialized)
  })
})
