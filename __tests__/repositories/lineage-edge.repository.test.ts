/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { updateMany: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

const mockUpdateMany = prisma.lineageEdge.updateMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('lineageEdgeRepository.stampDoneTaskEdges', () => {
  it('stamps MERGED on advance-eligible edges of DONE tasks, sparing REWORKED', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 546 })

    const result = await lineageEdgeRepository.stampDoneTaskEdges()

    expect(result).toEqual({ count: 546 })
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        // STAMPABLE_FROM.MERGED — UNKNOWN/REJECTED advance; REWORKED excluded.
        outcome: { in: ['UNKNOWN', 'REJECTED'] },
        task: { status: 'DONE' },
      },
      data: { outcome: 'MERGED' },
    })
  })

  it('runs the sweep against the transaction client when one is passed', async () => {
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 3 })
    const tx = { lineageEdge: { updateMany: txUpdateMany } } as any

    const result = await lineageEdgeRepository.stampDoneTaskEdges(tx)

    expect(result).toEqual({ count: 3 })
    expect(txUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })
})
