/**
 * @jest-environment node
 *
 * LUM-553 — the fail-closed coverage gate. Pure: no LLM, no DB.
 */
import { selectCoveredSources } from '@/lib/services/memory/fold-compute'

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
