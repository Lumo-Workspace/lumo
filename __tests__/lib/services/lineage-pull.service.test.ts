import { recordFragmentPull } from '@/lib/services/lineage-pull.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
jest.mock('@/lib/repositories/lineage-edge.repository')

describe('recordFragmentPull', () => {
  it('records a pull via the repo and returns the count', async () => {
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
})
