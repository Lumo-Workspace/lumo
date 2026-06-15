import { recordFragmentPull } from '@/lib/services/lineage-pull.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
jest.mock('@/lib/repositories/lineage-edge.repository')
jest.mock('@/lib/repositories/memory-provenance.repository')

describe('recordFragmentPull', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Identity by default: resolve returns the id it was given.
    ;(
      memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
    ).mockImplementation(async (_type: string, id: string) => id)
  })

  it('records a pull via the repo and returns the count (identity resolve)', async () => {
    ;(lineageEdgeRepository.recordPull as jest.Mock).mockResolvedValue(1)
    const n = await recordFragmentPull({
      sessionId: 's1',
      fragmentType: 'MEMORY',
      fragmentId: 'm1',
    })
    expect(n).toBe(1)
    expect(lineageEdgeRepository.recordPull).toHaveBeenCalledWith(
      { sessionId: 's1', fragmentType: 'MEMORY', fragmentId: 'm1' },
      expect.any(Date)
    )
  })

  it('canonicalizes the fragment id before stamping (consolidated memory)', async () => {
    ;(lineageEdgeRepository.recordPull as jest.Mock).mockResolvedValue(1)
    ;(
      memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
    ).mockResolvedValue('m_canonical')
    await recordFragmentPull({
      sessionId: 's1',
      fragmentType: 'MEMORY',
      fragmentId: 'm_original',
    })
    expect(
      memoryProvenanceRepository.resolveCanonicalFragment
    ).toHaveBeenCalledWith('MEMORY', 'm_original')
    expect(lineageEdgeRepository.recordPull).toHaveBeenCalledWith(
      { sessionId: 's1', fragmentType: 'MEMORY', fragmentId: 'm_canonical' },
      expect.any(Date)
    )
  })
})
