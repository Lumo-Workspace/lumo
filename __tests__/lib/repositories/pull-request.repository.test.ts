/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const mockUpdate = prisma.pullRequest.update as jest.Mock
const mockFindMany = prisma.pullRequest.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('pullRequestRepository.listIdAndNumberByTask', () => {
  it('selects id + number for a task, newest first', async () => {
    mockFindMany.mockResolvedValue([{ id: 'pr_1', number: 7 }])
    const r = await pullRequestRepository.listIdAndNumberByTask('tsk_1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 'tsk_1' },
      select: { id: true, number: true },
      orderBy: { updatedAt: 'desc' },
    })
    expect(r).toEqual([{ id: 'pr_1', number: 7 }])
  })
})

describe('pullRequestRepository.updateState', () => {
  it('updates PR state and timestamps', async () => {
    const mergedAt = new Date('2026-04-07T10:00:00Z')
    mockUpdate.mockResolvedValue({ id: 'pr-1', state: 'merged' })

    await pullRequestRepository.updateState('pr-1', {
      state: 'merged',
      mergedAt,
      closedAt: null,
      isDraft: false,
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { state: 'merged', mergedAt, closedAt: null, isDraft: false },
    })
  })
})
