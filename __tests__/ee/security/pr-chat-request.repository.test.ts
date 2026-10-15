/**
 * @jest-environment node
 *
 * LUM-1154 — the PR chat claim / hourly-bound rows. Prisma is mocked.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prChatRequest: {
      create: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { prChatRequestRepository } from '@/ee/security/repositories/pr-chat-request.repository'

const m = prisma.prChatRequest as unknown as Record<string, jest.Mock>
const claim = {
  workspaceId: 'ws',
  pullRequestId: 'pr1',
  source: 'review' as const,
  commentId: '9',
  authorLogin: 'alice',
}

beforeEach(() => jest.clearAllMocks())

describe('prChatRequestRepository', () => {
  it('claim creates the row', async () => {
    m.create!.mockResolvedValue({ id: 'c1' })
    await expect(prChatRequestRepository.claim(claim)).resolves.toEqual({
      id: 'c1',
    })
    expect(m.create).toHaveBeenCalledWith({ data: claim, select: { id: true } })
  })

  it('a second claim of the same comment is null; other errors throw', async () => {
    m.create!.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 'P2002' })
    )
    await expect(prChatRequestRepository.claim(claim)).resolves.toBeNull()
    m.create!.mockRejectedValueOnce(new Error('db down'))
    await expect(prChatRequestRepository.claim(claim)).rejects.toThrow(
      'db down'
    )
  })

  it('countSince filters by PR, window and status', async () => {
    m.count!.mockResolvedValue(3)
    const since = new Date('2026-10-15T00:00:00Z')
    await expect(
      prChatRequestRepository.countSince('pr1', since, ['CLAIMED', 'ANSWERED'])
    ).resolves.toBe(3)
    expect(m.count).toHaveBeenCalledWith({
      where: {
        pullRequestId: 'pr1',
        createdAt: { gte: since },
        status: { in: ['CLAIMED', 'ANSWERED'] },
      },
    })
  })

  it('setStatus and release', async () => {
    await prChatRequestRepository.setStatus('c1', 'ANSWERED')
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ANSWERED' },
      select: { id: true },
    })
    await prChatRequestRepository.release('c1')
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1' } })
  })
})
