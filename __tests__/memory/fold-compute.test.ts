/**
 * @jest-environment node
 *
 * LUM-553 — the fail-closed coverage gate. Pure: no LLM, no DB.
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: jest.fn(() => 'model') }))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { findActiveProjectMemories: jest.fn() },
}))

import {
  mapWithConcurrency,
  selectCoveredSources,
  computeProjectFoldProposals,
} from '@/lib/services/memory/fold-compute'
import { coarseCardSchemaFor } from '@/lib/memory/fold-schemas'
import { generateObject } from 'ai'
import { memoryRepository } from '@/lib/repositories/memory.repository'

const mGen = generateObject as jest.Mock
const mActive = memoryRepository.findActiveProjectMemories as jest.Mock

const trapCards = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    category: 'TRAP',
    content: {
      trigger: `trigger ${i}`,
      outcome: `outcome ${i}`,
      workaround: `fix ${i}`,
    },
  }))

describe('computeProjectFoldProposals surfaces a degraded LLM pipeline (LUM-555)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mActive.mockResolvedValue(trapCards(4)) // one foldable TRAP bucket
  })

  it('reports degraded true on clustering error and false when genuinely empty', async () => {
    // A clustering LLM call that errors (retries exhausted) → the pipeline is
    // degraded: we cannot tell whether there was anything to fold.
    mGen.mockRejectedValue(new Error('gateway down'))
    const errored = await computeProjectFoldProposals('proj-1', {
      maxProposals: 6,
    })
    expect(errored.proposals).toEqual([])
    expect(errored.degraded).toBe(true)

    // A clustering call that SUCCEEDS but legitimately finds no clusters → not
    // degraded: there is genuinely nothing to fold, prune may proceed.
    mGen.mockReset()
    mGen.mockResolvedValue({ object: { clusters: [] } })
    const empty = await computeProjectFoldProposals('proj-1', {
      maxProposals: 6,
    })
    expect(empty.proposals).toEqual([])
    expect(empty.degraded).toBe(false)
  })
})

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
