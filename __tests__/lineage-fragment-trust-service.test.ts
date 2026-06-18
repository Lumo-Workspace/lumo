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
    edges.judgedUsageByFragments.mockResolvedValue([])
  })

  it('returns {} for empty input without hitting the DB', async () => {
    const out = await lineageService.fragmentTrustForMemories([])
    expect(out).toEqual({})
    expect(edges.judgedUsageByFragments).not.toHaveBeenCalled()
  })

  it('maps a canonical judged-used verdict back to the original memory id', async () => {
    prov.resolveCanonicalFragment.mockImplementation(async (_t, id) =>
      id === 'raw' ? 'canon' : id
    )
    edges.judgedUsageByFragments.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'canon',
        judgedUsedTasks: 4,
        auditedTasks: 5,
        appearanceTasks: 7,
      },
    ])
    const out = await lineageService.fragmentTrustForMemories(['raw'])
    expect(out).toEqual({
      raw: {
        judgedUsedTasks: 4,
        auditedTasks: 5,
        appearanceTasks: 7,
        usefulnessPct: 80,
        qualified: true,
      },
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
