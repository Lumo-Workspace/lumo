/**
 * @jest-environment node
 *
 * LUM-932 P3: when a session becomes explicitly bound, the explicit task wins
 * over every provisional (inferred) tag — all of the session's events move to
 * it, and their undispositioned crossings follow (mocked prisma query shapes;
 * the real-Postgres twin is explicit-retag.real-postgres.test.ts).
 */
jest.mock('@/lib/db/prisma', () => {
  const tx = {
    hookEvent: { findMany: jest.fn(), updateMany: jest.fn() },
    boundaryCrossing: { updateMany: jest.fn() },
  }
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import { prisma } from '@/lib/db/prisma'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const p = prisma as unknown as {
  $transaction: jest.Mock
  __tx: {
    hookEvent: Record<'findMany' | 'updateMany', jest.Mock>
    boundaryCrossing: Record<'updateMany', jest.Mock>
  }
}
const tx = p.__tx

beforeEach(() => {
  jest.clearAllMocks()
})

describe('hookEventRepository.retagSessionEventsToExplicitTask', () => {
  it('retags every event whose task differs and moves their open crossings, in one transaction', async () => {
    tx.hookEvent.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
    tx.boundaryCrossing.updateMany.mockResolvedValue({ count: 1 })
    tx.hookEvent.updateMany.mockResolvedValue({ count: 5 })

    const r = await hookEventRepository.retagSessionEventsToExplicitTask(
      's1',
      't13'
    )

    expect(p.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.hookEvent.findMany).toHaveBeenCalledWith({
      where: { sessionId: { in: ['s1'] }, taskId: { not: 't13' } },
      select: { id: true },
    })
    expect(tx.boundaryCrossing.updateMany).toHaveBeenCalledWith({
      where: {
        hookEventId: { in: ['e1', 'e2'] },
        disposition: null,
        taskId: { not: 't13' },
      },
      data: { taskId: 't13' },
    })
    expect(tx.hookEvent.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: { in: ['s1'] },
        OR: [{ taskId: null }, { taskId: { not: 't13' } }],
      },
      data: { taskId: 't13' },
    })
    expect(r).toEqual({ eventsUpdated: 5, crossingsMoved: 1 })
  })

  it('skips the crossing move when no event carried another task', async () => {
    tx.hookEvent.findMany.mockResolvedValue([])
    tx.hookEvent.updateMany.mockResolvedValue({ count: 3 })

    const r = await hookEventRepository.retagSessionEventsToExplicitTask(
      's1',
      't13'
    )

    expect(tx.boundaryCrossing.updateMany).not.toHaveBeenCalled()
    expect(r).toEqual({ eventsUpdated: 3, crossingsMoved: 0 })
  })
})
