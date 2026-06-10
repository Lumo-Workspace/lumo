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
    mockUpdateMany
      .mockResolvedValueOnce({ count: 546 })
      .mockResolvedValueOnce({ count: 10 })
      .mockResolvedValueOnce({ count: 500 })

    const result = await lineageEdgeRepository.stampDoneTaskEdges(['t-v'])

    expect(result).toEqual({
      count: 546,
      verifiedStamped: 10,
      unverifiedStamped: 500,
    })
    expect(mockUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        // STAMPABLE_FROM.MERGED — UNKNOWN/REJECTED advance; REWORKED excluded.
        outcome: { in: ['UNKNOWN', 'REJECTED'] },
        task: { status: 'DONE' },
      },
      data: { outcome: 'MERGED' },
    })
  })

  it('stratifies strength monotonically: verified upgrades null/false, unverified only fills null (LUM-397)', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })

    await lineageEdgeRepository.stampDoneTaskEdges(['t-v1', 't-v2'])

    // Verified pass: tasks in the all-PASS set, anything not already true.
    expect(mockUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        outcome: 'MERGED',
        task: { status: 'DONE' },
        taskId: { in: ['t-v1', 't-v2'] },
        NOT: { outcomeVerified: true },
      },
      data: { outcomeVerified: true },
    })
    // Unverified pass: only null → false, so a later all-PASS round can still
    // upgrade and a prior true is never downgraded.
    expect(mockUpdateMany).toHaveBeenNthCalledWith(3, {
      where: {
        outcome: 'MERGED',
        task: { status: 'DONE' },
        taskId: { notIn: ['t-v1', 't-v2'] },
        outcomeVerified: null,
      },
      data: { outcomeVerified: false },
    })
  })

  it('runs the sweep against the transaction client when one is passed', async () => {
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 3 })
    const tx = { lineageEdge: { updateMany: txUpdateMany } } as any

    const result = await lineageEdgeRepository.stampDoneTaskEdges([], tx)

    expect(result).toEqual({
      count: 3,
      verifiedStamped: 3,
      unverifiedStamped: 3,
    })
    expect(txUpdateMany).toHaveBeenCalledTimes(3)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })
})
