/**
 * @jest-environment node
 */
import { taskRepository } from '@/lib/repositories/task.repository'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'

const mockFindMany = prisma.task.findMany as jest.Mock

beforeEach(() => mockFindMany.mockReset())

describe('taskRepository.findByMilestone', () => {
  it('filters by milestoneId only when no assignee is given', async () => {
    mockFindMany.mockResolvedValue([])
    await taskRepository.findByMilestone({ milestoneId: 'm-1' })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 'm-1' },
        orderBy: { order: 'asc' },
      })
    )
  })

  it('adds assigneeActorId filter when provided', async () => {
    mockFindMany.mockResolvedValue([])
    await taskRepository.findByMilestone({
      milestoneId: 'm-1',
      assigneeActorId: 'actor-1',
    })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 'm-1', assigneeActorId: 'actor-1' },
      })
    )
  })
})
