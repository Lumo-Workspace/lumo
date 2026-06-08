import {
  lexicalNeighborRetriever,
  NEIGHBOR_K,
} from '@/lib/services/memory/neighbor-retriever'

const pool = [
  {
    id: 'm_enum',
    category: 'TRAP' as const,
    content: { trigger: 'add a postgres enum value and use it same migration', outcome: 'P3009' },
  },
  {
    id: 'm_zod',
    category: 'CONVENTION' as const,
    content: { rule: 'new schemas use zod', scope: 'all new schemas' },
  },
]

describe('lexicalNeighborRetriever', () => {
  it('NEIGHBOR_K is 10', () => {
    expect(NEIGHBOR_K).toBe(10)
  })

  it('ranks the lexically-closest pool item first', () => {
    const out = lexicalNeighborRetriever.retrieve(
      { category: 'TRAP', text: 'adding a postgres enum value in the same migration fails' },
      pool,
      10
    )
    expect(out[0]!.id).toBe('m_enum')
  })

  it('returns at most k items', () => {
    const big = Array.from({ length: 25 }, (_, i) => ({
      id: `m_${i}`,
      category: 'TRAP' as const,
      content: { trigger: 'enum value same migration fails', outcome: 'P3009' },
    }))
    const out = lexicalNeighborRetriever.retrieve(
      { category: 'TRAP', text: 'enum value same migration fails' },
      big,
      10
    )
    expect(out).toHaveLength(10)
  })

  it('drops items below the floor (totally unrelated)', () => {
    const out = lexicalNeighborRetriever.retrieve(
      { category: 'TRAP', text: 'zzzzz qqqqq wwwww unrelated gibberish' },
      [{ id: 'm_x', category: 'TRAP' as const, content: { trigger: 'kubernetes pod eviction', outcome: 'oom' } }],
      10
    )
    expect(out).toHaveLength(0)
  })

  it('boosts a same-category item over an equally-similar cross-category one', () => {
    const same = { id: 'same', category: 'TRAP' as const, content: { trigger: 'token budget overflow', outcome: 'x' } }
    const cross = { id: 'cross', category: 'DECISION' as const, content: { what: 'token budget overflow', why: 'x' } }
    const out = lexicalNeighborRetriever.retrieve(
      { category: 'TRAP', text: 'token budget overflow' },
      [cross, same],
      10
    )
    expect(out[0]!.id).toBe('same')
  })

  it('returns an empty array for an empty pool', () => {
    expect(
      lexicalNeighborRetriever.retrieve({ category: 'TRAP', text: 'anything' }, [], 10)
    ).toEqual([])
  })
})
