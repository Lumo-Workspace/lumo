/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const findMany = prisma.pullRequest.findMany as jest.Mock

beforeEach(() => findMany.mockReset())

describe('pullRequestRepository.listStatesByTaskIds', () => {
  it('projects (taskId, state) for the task set — the delivery-stats bucketing basis', async () => {
    findMany.mockResolvedValue([
      { taskId: 't1', state: 'merged' },
      { taskId: 't1', state: 'open' },
    ])
    const rows = await pullRequestRepository.listStatesByTaskIds(['t1', 't2'])
    expect(findMany).toHaveBeenCalledWith({
      where: { taskId: { in: ['t1', 't2'] } },
      select: { taskId: true, state: true },
    })
    expect(rows).toEqual([
      { taskId: 't1', state: 'merged' },
      { taskId: 't1', state: 'open' },
    ])
  })

  it('short-circuits an empty task set without querying', async () => {
    expect(await pullRequestRepository.listStatesByTaskIds([])).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })
})
