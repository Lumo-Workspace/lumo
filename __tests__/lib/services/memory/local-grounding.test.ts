/**
 * @jest-environment node
 *
 * LUM-773 — the layer1 grounding gate is local and deterministic. The extract
 * pass hands each candidate a verbatim `quote`; this module keeps a candidate
 * only when that quote is actually present in the turn source text. No LLM.
 */
import { groundCandidatesLocally } from '@/lib/services/memory/local-grounding'

const SOURCE = [
  '[12:00:01] Bash "npx prisma migrate dev --name add_status" ERR — stderr: P3009: enum can\'t add value mid-migration',
  '[12:00:05] Read lib/db/prisma.ts (40 lines)',
  '[turn end] "Postgres refuses to add an enum value and use it in one transaction."',
].join('\n')

const trap = {
  category: 'TRAP' as const,
  content: { trigger: 'enum + use in one migration', outcome: 'P3009' },
}

describe('groundCandidatesLocally — quote must appear in the source text', () => {
  it('keeps a candidate whose quote is a verbatim substring of the source', () => {
    const out = groundCandidatesLocally({
      sourceText: SOURCE,
      candidates: [
        { ...trap, quote: "P3009: enum can't add value mid-migration" },
      ],
    })
    expect(out.kept).toHaveLength(1)
    expect(out.discardedCount).toBe(0)
  })

  it('keeps a candidate whose quote differs from the source only in whitespace', () => {
    const out = groundCandidatesLocally({
      sourceText: SOURCE,
      candidates: [
        {
          ...trap,
          quote:
            'Postgres refuses to add an enum value\n  and use it   in one transaction.',
        },
      ],
    })
    expect(out.kept).toHaveLength(1)
    expect(out.discardedCount).toBe(0)
  })

  it('discards a candidate whose quote is absent from the source and counts it', () => {
    const out = groundCandidatesLocally({
      sourceText: SOURCE,
      candidates: [{ ...trap, quote: 'the migration succeeded on retry' }],
    })
    expect(out.kept).toHaveLength(0)
    expect(out.discardedCount).toBe(1)
  })

  it('discards a candidate with a missing or blank quote', () => {
    const out = groundCandidatesLocally({
      sourceText: SOURCE,
      candidates: [{ ...trap }, { ...trap, quote: '   ' }],
    })
    expect(out.kept).toHaveLength(0)
    expect(out.discardedCount).toBe(2)
  })

  it('strips the quote from kept candidates and leaves the rest untouched', () => {
    const out = groundCandidatesLocally({
      sourceText: SOURCE,
      candidates: [{ ...trap, scope: 'PROJECT' as const, quote: 'P3009' }],
    })
    expect(out.kept).toEqual([{ ...trap, scope: 'PROJECT' }])
    expect('quote' in out.kept[0]!).toBe(false)
  })

  it('handles a mixed batch: only the grounded candidates survive, in order', () => {
    const decision = {
      category: 'DECISION' as const,
      content: { what: 'invented', why: 'invented' },
    }
    const out = groundCandidatesLocally({
      sourceText: SOURCE,
      candidates: [
        { ...decision, quote: 'we chose soft delete' },
        { ...trap, quote: 'npx prisma migrate dev' },
        { ...decision },
      ],
    })
    expect(out.kept).toEqual([trap])
    expect(out.discardedCount).toBe(2)
  })

  it('returns an empty result for an empty candidate list', () => {
    expect(
      groundCandidatesLocally({ sourceText: SOURCE, candidates: [] })
    ).toEqual({ kept: [], discardedCount: 0 })
  })
})
