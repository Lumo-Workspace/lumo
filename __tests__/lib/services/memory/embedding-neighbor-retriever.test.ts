jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { findNeighborEmbeddings: jest.fn() },
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'
import {
  embeddingNeighborRetriever,
  compositeNeighborRetriever,
  EMBEDDING_SCORE_FLOOR,
} from '@/lib/services/memory/embedding-neighbor-retriever'

const find = memoryRepository.findNeighborEmbeddings as jest.Mock

// Pool item: "x y" via memoryContentToText → shares bigrams with query "x outcome"
const ctx = (vector?: number[]) => ({
  query: {
    category: 'TRAP' as const,
    text: 'postgres enum migration fails',
    vector,
  },
  pool: [
    {
      id: 'lex1',
      category: 'TRAP' as const,
      content: { trigger: 'postgres enum migration', outcome: 'fails' },
    },
  ],
  scope: { kind: 'TASK' as const, taskId: 'task_1' },
  k: 10,
})

beforeEach(() => {
  find.mockReset()
})

describe('EMBEDDING_SCORE_FLOOR', () => {
  it('is distinct from the lexical 0.3 floor and higher', () => {
    expect(EMBEDDING_SCORE_FLOOR).toBeGreaterThanOrEqual(0.5)
  })
})

describe('embeddingNeighborRetriever', () => {
  it('keeps neighbors at/above the floor, drops below, preserves desc order', async () => {
    find.mockResolvedValue({
      neighbors: [
        { id: 'hi', category: 'TRAP', content: {}, score: 0.92 },
        {
          id: 'mid',
          category: 'TRAP',
          content: {},
          score: EMBEDDING_SCORE_FLOOR,
        },
        {
          id: 'lo',
          category: 'TRAP',
          content: {},
          score: EMBEDDING_SCORE_FLOOR - 0.2,
        },
      ],
      scopeHasEmbeddings: true,
    })
    const out = await embeddingNeighborRetriever.retrieve(ctx([0.1, 0.2]))
    expect(out.map(n => n.id)).toEqual(['hi', 'mid']) // 'lo' dropped, order kept
  })
})

describe('compositeNeighborRetriever fallback', () => {
  it('falls back to lexical when the query has no vector', async () => {
    const out = await compositeNeighborRetriever.retrieve(ctx(undefined))
    expect(find).not.toHaveBeenCalled()
    expect(out.map(n => n.id)).toEqual(['lex1']) // lexical pool match
  })

  it('falls back to lexical when scopeHasEmbeddings is false (cold/backfilling corpus)', async () => {
    find.mockResolvedValue({ neighbors: [], scopeHasEmbeddings: false })
    const out = await compositeNeighborRetriever.retrieve(ctx([0.1, 0.2]))
    expect(out.map(n => n.id)).toEqual(['lex1'])
  })

  it('falls back to lexical when the embedding retriever throws', async () => {
    find.mockRejectedValue(new Error('db down'))
    const out = await compositeNeighborRetriever.retrieve(ctx([0.1, 0.2]))
    expect(out.map(n => n.id)).toEqual(['lex1'])
  })

  it('does NOT fall back when scope is embedded but no neighbor passes the floor (genuine empty)', async () => {
    find.mockResolvedValue({ neighbors: [], scopeHasEmbeddings: true })
    const out = await compositeNeighborRetriever.retrieve(ctx([0.1, 0.2]))
    expect(out).toEqual([]) // genuine no-neighbor → empty (candidate becomes ADD); lexical NOT consulted
  })
})
