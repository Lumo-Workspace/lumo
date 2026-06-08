/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { memory: { findFirst: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { memoryRepository } from '@/lib/repositories/memory.repository'

const mockFindFirst = prisma.memory.findFirst as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('memoryRepository.hasForTask', () => {
  it('checks existence with the same task filter as listForTask', async () => {
    mockFindFirst.mockResolvedValue({ id: 'm1' })

    const result = await memoryRepository.hasForTask('task-1')

    expect(result).toBe(true)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { taskId: 'task-1' },
      select: { id: true },
    })
  })

  it('returns false when the task has no memories', async () => {
    mockFindFirst.mockResolvedValue(null)

    const result = await memoryRepository.hasForTask('task-1')

    expect(result).toBe(false)
  })
})
