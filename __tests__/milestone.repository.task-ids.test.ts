/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const taskFindMany = prisma.task.findMany as jest.Mock

beforeEach(() => taskFindMany.mockReset())

describe('milestoneRepository.taskIds', () => {
  it('returns the member task ids only — the delivery-stats fan-out basis', async () => {
    taskFindMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
    const ids = await milestoneRepository.taskIds('m-1')
    expect(taskFindMany).toHaveBeenCalledWith({
      where: { milestoneId: 'm-1' },
      select: { id: true },
    })
    expect(ids).toEqual(['t1', 't2'])
  })
})
