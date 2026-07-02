/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn() },
    outcomeSignal: { groupBy: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const taskFindMany = prisma.task.findMany as jest.Mock
const signalGroupBy = prisma.outcomeSignal.groupBy as jest.Mock

beforeEach(() => {
  taskFindMany.mockReset()
  signalGroupBy.mockReset()
})

describe('milestoneRepository.memberDeliveryRows', () => {
  it('fetches claim fields + assignee resolution and the outcome-well signal groupBy', async () => {
    const tasks = [
      {
        id: 't1',
        number: 1,
        title: 'T1',
        status: 'DONE',
        claimSnapshot: 'c',
        claimSnapshotSource: 'AGENT',
        team: { identifier: 'LUM' },
        assignee: { type: 'AGENT', memberId: null, agent: { memberId: 'mA' } },
      },
    ]
    taskFindMany.mockResolvedValue(tasks)
    signalGroupBy.mockResolvedValue([
      { taskId: 't1', kind: 'REVERTED', _count: { _all: 2 } },
    ])

    const out = await milestoneRepository.memberDeliveryRows('m-1')

    // Claim fields use the SAME select as outcomeRollupRows (same-source
    // discipline), plus the flat assignee-resolution fields.
    expect(taskFindMany).toHaveBeenCalledWith({
      where: { milestoneId: 'm-1' },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        claimSnapshot: true,
        claimSnapshotSource: true,
        team: { select: { identifier: true } },
        assignee: {
          select: {
            type: true,
            memberId: true,
            agent: { select: { memberId: true } },
          },
        },
      },
      orderBy: { number: 'asc' },
    })
    expect(signalGroupBy).toHaveBeenCalledWith({
      by: ['taskId', 'kind'],
      where: { taskId: { in: ['t1'] } },
      _count: { _all: true },
    })
    expect(out).toEqual({
      tasks,
      signalCounts: [{ taskId: 't1', kind: 'REVERTED', count: 2 }],
    })
  })

  it('short-circuits an empty milestone without the signal groupBy', async () => {
    taskFindMany.mockResolvedValue([])
    const out = await milestoneRepository.memberDeliveryRows('m-1')
    expect(out).toEqual({ tasks: [], signalCounts: [] })
    expect(signalGroupBy).not.toHaveBeenCalled()
  })
})
