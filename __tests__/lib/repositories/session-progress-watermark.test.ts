/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { session: { findFirst: jest.fn(), update: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'

const findFirst = prisma.session.findFirst as jest.Mock
const update = prisma.session.update as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('findProgressContextForMember', () => {
  it('returns null when the session is not owned by the member', async () => {
    findFirst.mockResolvedValue(null)
    const r = await sessionRepository.findProgressContextForMember('s1', 'm1')
    expect(r).toBeNull()
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 's1', workspaceMemberId: 'm1' })
  })

  it('flattens task identifier and returns the watermark', async () => {
    findFirst.mockResolvedValue({
      lastProgressCommentAt: new Date('2026-06-01T09:00:00Z'),
      task: { id: 't1', number: 42, title: 'Fix bug', team: { identifier: 'LUM' } },
    })
    const r = await sessionRepository.findProgressContextForMember('s1', 'm1')
    expect(r).toEqual({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Fix bug',
      lastProgressCommentAt: new Date('2026-06-01T09:00:00Z'),
    })
  })

  it('returns null task fields when the session has no binding', async () => {
    findFirst.mockResolvedValue({ lastProgressCommentAt: null, task: null })
    const r = await sessionRepository.findProgressContextForMember('s1', 'm1')
    expect(r).toEqual({
      taskId: null,
      taskIdentifier: null,
      taskTitle: null,
      lastProgressCommentAt: null,
    })
  })
})

describe('setLastProgressCommentAt', () => {
  it('updates the watermark for the session', async () => {
    update.mockResolvedValue({ id: 's1' })
    const at = new Date('2026-06-01T10:00:00Z')
    await sessionRepository.setLastProgressCommentAt('s1', at)
    expect(update.mock.calls[0][0]).toEqual({
      where: { id: 's1' },
      data: { lastProgressCommentAt: at },
      select: { id: true },
    })
  })
})
