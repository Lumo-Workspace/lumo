/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { hookEvent: { findMany: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const findMany = prisma.hookEvent.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('findTurnSummariesBySession', () => {
  it('queries STOP/STOP_FAILURE rows with a non-null turnSummary, oldest-first', async () => {
    findMany.mockResolvedValue([
      { id: 'e1', turnSummary: '改了 a.ts', createdAt: new Date('2026-06-01T10:00:00Z') },
    ])
    const rows = await hookEventRepository.findTurnSummariesBySession('sess_1')
    expect(rows).toHaveLength(1)
    const arg = findMany.mock.calls[0][0]
    expect(arg.where.sessionId).toBe('sess_1')
    expect(arg.where.type.in).toEqual(['STOP', 'STOP_FAILURE'])
    expect(arg.where.turnSummary.not).toBeNull()
    expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
    expect(arg.select).toEqual({ id: true, turnSummary: true, createdAt: true })
  })

  it('adds a createdAt > since filter when since is given', async () => {
    findMany.mockResolvedValue([])
    const since = new Date('2026-06-01T09:00:00Z')
    await hookEventRepository.findTurnSummariesBySession('sess_1', since)
    expect(findMany.mock.calls[0][0].where.createdAt).toEqual({ gt: since })
  })

  it('omits the createdAt filter when since is undefined', async () => {
    findMany.mockResolvedValue([])
    await hookEventRepository.findTurnSummariesBySession('sess_1')
    expect(findMany.mock.calls[0][0].where.createdAt).toBeUndefined()
  })
})
