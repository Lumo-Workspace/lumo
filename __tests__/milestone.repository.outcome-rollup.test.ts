jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn() },
    outcomeSignal: { groupBy: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const findMany = prisma.task.findMany as jest.Mock
const groupBy = prisma.outcomeSignal.groupBy as jest.Mock

beforeEach(() => {
  findMany.mockReset()
  groupBy.mockReset()
})

describe('milestoneRepository.outcomeRollupRows', () => {
  it('selects member tasks (claim fields + team identifier) and flattens the well signal groupBy', async () => {
    const tasks = [
      {
        id: 't1',
        number: 283,
        title: 'Bundle diet',
        status: 'DONE',
        claimSnapshot: '首屏 -298KB',
        claimSnapshotSource: 'AGENT',
        team: { identifier: 'LUM' },
      },
    ]
    findMany.mockResolvedValue(tasks)
    groupBy.mockResolvedValue([
      { taskId: 't1', kind: 'REVERTED', _count: { _all: 2 } },
    ])

    const result = await milestoneRepository.outcomeRollupRows('m-1')

    expect(findMany).toHaveBeenCalledWith({
      where: { milestoneId: 'm-1' },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        claimSnapshot: true,
        claimSnapshotSource: true,
        team: { select: { identifier: true } },
      },
      orderBy: { number: 'asc' },
    })
    // Signal scan covers ALL member tasks (no status filter), so a reopened
    // task's rejection signals stay visible.
    expect(groupBy).toHaveBeenCalledWith({
      by: ['taskId', 'kind'],
      where: { taskId: { in: ['t1'] } },
      _count: { _all: true },
    })
    expect(result).toEqual({
      tasks,
      signalCounts: [{ taskId: 't1', kind: 'REVERTED', count: 2 }],
    })
  })

  it('returns empty rows without querying the well when the milestone has no tasks', async () => {
    findMany.mockResolvedValue([])
    const result = await milestoneRepository.outcomeRollupRows('m-1')
    expect(result).toEqual({ tasks: [], signalCounts: [] })
    expect(groupBy).not.toHaveBeenCalled()
  })
})
