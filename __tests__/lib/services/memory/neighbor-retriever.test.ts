import {
  lexicalNeighborRetriever,
  NEIGHBOR_K,
} from '@/lib/services/memory/neighbor-retriever'

const pool = [
  {
    id: 'm_enum',
    category: 'TRAP' as const,
    content: {
      trigger: 'add a postgres enum value and use it same migration',
      outcome: 'P3009',
    },
  },
  {
    id: 'm_zod',
    category: 'CONVENTION' as const,
    content: { rule: 'new schemas use zod', scope: 'all new schemas' },
  },
]

const dummyScope = { kind: 'TASK' as const, taskId: 't' }

describe('lexicalNeighborRetriever', () => {
  it('NEIGHBOR_K is 10', () => {
    expect(NEIGHBOR_K).toBe(10)
  })

  it('ranks the lexically-closest pool item first', async () => {
    const out = await lexicalNeighborRetriever.retrieve({
      query: {
        category: 'TRAP',
        text: 'adding a postgres enum value in the same migration fails',
      },
      pool,
      scope: dummyScope,
      k: 10,
    })
    expect(out[0]!.id).toBe('m_enum')
  })

  it('returns at most k items', async () => {
    const big = Array.from({ length: 25 }, (_, i) => ({
      id: `m_${i}`,
      category: 'TRAP' as const,
      content: { trigger: 'enum value same migration fails', outcome: 'P3009' },
    }))
    const out = await lexicalNeighborRetriever.retrieve({
      query: { category: 'TRAP', text: 'enum value same migration fails' },
      pool: big,
      scope: dummyScope,
      k: 10,
    })
    expect(out).toHaveLength(10)
  })

  it('drops items below the floor (totally unrelated)', async () => {
    const out = await lexicalNeighborRetriever.retrieve({
      query: {
        category: 'TRAP',
        text: 'zzzzz qqqqq wwwww unrelated gibberish',
      },
      pool: [
        {
          id: 'm_x',
          category: 'TRAP' as const,
          content: { trigger: 'kubernetes pod eviction', outcome: 'oom' },
        },
      ],
      scope: dummyScope,
      k: 10,
    })
    expect(out).toHaveLength(0)
  })

  it('boosts a same-category item over an equally-similar cross-category one', async () => {
    const same = {
      id: 'same',
      category: 'TRAP' as const,
      content: { trigger: 'token budget overflow', outcome: 'x' },
    }
    const cross = {
      id: 'cross',
      category: 'DECISION' as const,
      content: { what: 'token budget overflow', why: 'x' },
    }
    const out = await lexicalNeighborRetriever.retrieve({
      query: { category: 'TRAP', text: 'token budget overflow' },
      pool: [cross, same],
      scope: dummyScope,
      k: 10,
    })
    expect(out[0]!.id).toBe('same')
  })

  it('returns an empty array for an empty pool', async () => {
    expect(
      await lexicalNeighborRetriever.retrieve({
        query: { category: 'TRAP', text: 'anything' },
        pool: [],
        scope: dummyScope,
        k: 10,
      })
    ).toEqual([])
  })
})
