/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      update: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const mockUpdate = prisma.pullRequest.update as jest.Mock

beforeEach(() => jest.clearAllMocks())

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
