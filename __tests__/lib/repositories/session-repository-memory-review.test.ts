/** @jest-environment node */
const mockUpdate = jest.fn()
const mockFindFirst = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    session: {
      update: (...a: any[]) => mockUpdate(...a),
      findFirst: (...a: any[]) => mockFindFirst(...a),
    },
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'

beforeEach(() => jest.clearAllMocks())

describe('sessionRepository.setLastMemoryReviewAt', () => {
  it('updates the watermark column for the session', async () => {
    mockUpdate.mockResolvedValue({ id: 's1' })
    const at = new Date('2026-06-01T10:00:00.000Z')
    await sessionRepository.setLastMemoryReviewAt('s1', at)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { lastMemoryReviewAt: at },
      select: { id: true },
    })
  })
})

describe('sessionRepository.findProgressContextForMember', () => {
  it('returns lastMemoryReviewAt alongside the progress watermark', async () => {
    mockFindFirst.mockResolvedValue({
      lastProgressCommentAt: null,
      lastMemoryReviewAt: new Date('2026-06-01T09:00:00.000Z'),
      task: null,
    })
    const ctx = await sessionRepository.findProgressContextForMember('s1', 'm1')
    expect(ctx).toMatchObject({
      lastMemoryReviewAt: new Date('2026-06-01T09:00:00.000Z'),
    })
  })
})
