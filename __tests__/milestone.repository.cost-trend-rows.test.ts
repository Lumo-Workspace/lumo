jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn() },
    taskActivity: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const taskFindMany = prisma.task.findMany as jest.Mock
const activityFindMany = prisma.taskActivity.findMany as jest.Mock

beforeEach(() => {
  taskFindMany.mockReset()
  activityFindMany.mockReset()
})

describe('milestoneRepository.costTrendRows', () => {
  it('selects member tasks and their STATUS_CHANGED trail oldest-first', async () => {
    const tasks = [
      {
        id: 't1',
        status: 'DONE',
        createdAt: new Date('2026-01-04T00:00:00Z'),
        sprintId: 's1',
      },
    ]
    const activities = [
      {
        taskId: 't1',
        payload: { from: 'IN_PROGRESS', to: 'DONE' },
        createdAt: new Date('2026-01-07T00:00:00Z'),
      },
    ]
    taskFindMany.mockResolvedValue(tasks)
    activityFindMany.mockResolvedValue(activities)

    const result = await milestoneRepository.costTrendRows('m-1')

    expect(taskFindMany).toHaveBeenCalledWith({
      where: { milestoneId: 'm-1' },
      select: { id: true, status: true, createdAt: true, sprintId: true },
    })
    expect(activityFindMany).toHaveBeenCalledWith({
      where: { taskId: { in: ['t1'] }, type: 'STATUS_CHANGED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { taskId: true, payload: true, createdAt: true },
    })
    expect(result).toEqual({ tasks, activities })
  })

  it('returns empty rows without querying activities when the milestone has no tasks', async () => {
    taskFindMany.mockResolvedValue([])
    const result = await milestoneRepository.costTrendRows('m-1')
    expect(result).toEqual({ tasks: [], activities: [] })
    expect(activityFindMany).not.toHaveBeenCalled()
  })
})
