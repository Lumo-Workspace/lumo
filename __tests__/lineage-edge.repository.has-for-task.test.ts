/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { findFirst: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

const mockFindFirst = prisma.lineageEdge.findFirst as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('lineageEdgeRepository.hasForTask', () => {
  it('checks existence with the same task filter as listByTaskWithCost', async () => {
    mockFindFirst.mockResolvedValue({ id: 'edge-1' })

    const result = await lineageEdgeRepository.hasForTask('task-1')

    expect(result).toBe(true)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { taskId: 'task-1' },
      select: { id: true },
    })
  })

  it('returns false when the task has no lineage edges', async () => {
    mockFindFirst.mockResolvedValue(null)

    const result = await lineageEdgeRepository.hasForTask('task-1')

    expect(result).toBe(false)
  })
})
