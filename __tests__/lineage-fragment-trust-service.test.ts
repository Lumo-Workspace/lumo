import { lineageService } from '@/lib/services/lineage.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'

jest.mock('@/lib/repositories/lineage-edge.repository')
jest.mock('@/lib/repositories/memory-provenance.repository')

const edges = lineageEdgeRepository as jest.Mocked<typeof lineageEdgeRepository>
const prov = memoryProvenanceRepository as jest.Mocked<
  typeof memoryProvenanceRepository
>

describe('lineageService.fragmentTrustForMemories', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    edges.countResolvedTasks.mockResolvedValue(10)
    edges.mergeRateByFragments.mockResolvedValue([])
    edges.usageMergeRateByFragments.mockResolvedValue([])
  })

  it('returns {} for empty input without hitting the DB', async () => {
    const out = await lineageService.fragmentTrustForMemories([])
    expect(out).toEqual({})
    expect(edges.countResolvedTasks).not.toHaveBeenCalled()
  })

  it('maps a canonical verdict back to the original memory id', async () => {
    prov.resolveCanonicalFragment.mockImplementation(async (_t, id) =>
      id === 'raw' ? 'canon' : id
    )
    edges.usageMergeRateByFragments.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'canon',
        usedResolvedTasks: 4,
        usedMergedTasks: 3,
      },
    ])
    const out = await lineageService.fragmentTrustForMemories(['raw'])
    expect(out).toEqual({
      raw: { kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 },
    })
  })

  it('omits ids that do not qualify', async () => {
    prov.resolveCanonicalFragment.mockImplementation(async (_t, id) => id)
    const out = await lineageService.fragmentTrustForMemories(['none'])
    expect(out).toEqual({})
  })

  it('degrades to {} on repository failure', async () => {
    prov.resolveCanonicalFragment.mockRejectedValue(new Error('boom'))
    const out = await lineageService.fragmentTrustForMemories(['x'])
    expect(out).toEqual({})
  })
})
