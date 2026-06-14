import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { updateMany: jest.fn() } },
}))

describe('lineageEdgeRepository.recordPull', () => {
  beforeEach(() => {
    ;(prisma.lineageEdge.updateMany as jest.Mock).mockReset()
  })

  it('stamps pulledAt for the matching unfetched edge', async () => {
    ;(prisma.lineageEdge.updateMany as jest.Mock).mockResolvedValue({
      count: 1,
    })
    const now = new Date('2026-06-14T00:00:00Z')
    const n = await lineageEdgeRepository.recordPull(
      { sessionId: 's1', fragmentType: 'MEMORY', fragmentId: 'm1' },
      now
    )
    expect(n).toBe(1)
    expect(prisma.lineageEdge.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: 's1',
        fragmentType: 'MEMORY',
        fragmentId: 'm1',
        pulledAt: null,
      },
      data: { pulledAt: now },
    })
  })

  it('returns 0 when no matching unfetched edge exists', async () => {
    ;(prisma.lineageEdge.updateMany as jest.Mock).mockResolvedValue({
      count: 0,
    })
    const now = new Date('2026-06-14T00:00:00Z')
    const n = await lineageEdgeRepository.recordPull(
      { sessionId: 's2', fragmentType: 'SESSION', fragmentId: 'sess1' },
      now
    )
    expect(n).toBe(0)
    expect(prisma.lineageEdge.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: 's2',
        fragmentType: 'SESSION',
        fragmentId: 'sess1',
        pulledAt: null,
      },
      data: { pulledAt: now },
    })
  })
})
