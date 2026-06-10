// __tests__/lineage-edge.repository.last-used.test.ts — LUM-328 recency signal
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

const groupBy = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    lineageEdge: {
      groupBy: (...a: unknown[]) => groupBy(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('lineageEdgeRepository.lastUsedAtByFragments', () => {
  it('returns the most recent used=true vote timestamp per fragment', async () => {
    const t1 = new Date('2026-06-01T00:00:00Z')
    groupBy.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'frag_1',
        _max: { usedAt: t1 },
      },
      {
        fragmentType: 'MEMORY',
        fragmentId: 'frag_2',
        _max: { usedAt: null },
      },
    ])

    const result = await lineageEdgeRepository.lastUsedAtByFragments([
      { fragmentType: 'MEMORY', fragmentId: 'frag_1' },
      { fragmentType: 'MEMORY', fragmentId: 'frag_2' },
    ])

    expect(groupBy).toHaveBeenCalledWith({
      by: ['fragmentType', 'fragmentId'],
      where: {
        used: true,
        OR: [
          { fragmentType: 'MEMORY', fragmentId: 'frag_1' },
          { fragmentType: 'MEMORY', fragmentId: 'frag_2' },
        ],
      },
      _max: { usedAt: true },
    })
    // Rows without a usedAt timestamp are dropped, not returned as null.
    expect(result).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'frag_1', lastUsedAt: t1 },
    ])
  })

  it('short-circuits on an empty fragment list', async () => {
    const result = await lineageEdgeRepository.lastUsedAtByFragments([])
    expect(groupBy).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })
})
