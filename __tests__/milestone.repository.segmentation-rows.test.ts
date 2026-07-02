jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const taskFindMany = prisma.task.findMany as jest.Mock

beforeEach(() => {
  taskFindMany.mockReset()
})

describe('milestoneRepository.segmentationRows', () => {
  it('selects the grouping basis (priority / sprint / tags) plus ref fields, in number order', async () => {
    const rows = [
      {
        id: 't1',
        number: 283,
        title: 'Bundle diet',
        status: 'DONE',
        priority: 'HIGH',
        sprintId: 's3',
        team: { identifier: 'LUM' },
        taskTags: [{ tag: { id: 'tag-a', name: 'perf' } }],
      },
    ]
    taskFindMany.mockResolvedValue(rows)

    const result = await milestoneRepository.segmentationRows('m-1')

    expect(taskFindMany).toHaveBeenCalledWith({
      where: { milestoneId: 'm-1' },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        sprintId: true,
        team: { select: { identifier: true } },
        taskTags: { select: { tag: { select: { id: true, name: true } } } },
      },
      orderBy: { number: 'asc' },
    })
    expect(result).toEqual(rows)
  })
})
