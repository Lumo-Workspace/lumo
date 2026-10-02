/**
 * @jest-environment node
 *
 * LUM-932 P3: every binding write bumps the family ROOT's attributionVersion
 * inside its own transaction, so a concurrent recompute (which commits only
 * at the version it loaded) conflicts and re-reads instead of backfilling a
 * session that has just become explicitly bound (or a steward).
 */
jest.mock('@/lib/db/prisma', () => {
  const tx = {
    session: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    hookEvent: { findMany: jest.fn(), updateMany: jest.fn() },
    boundaryCrossing: { updateMany: jest.fn() },
  }
  return {
    prisma: {
      ...tx,
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

type Mocks<K extends string> = Record<K, jest.Mock>
const tx = (
  prisma as unknown as {
    __tx: {
      session: Mocks<
        | 'findUnique'
        | 'create'
        | 'upsert'
        | 'update'
        | 'findMany'
        | 'updateMany'
      >
      hookEvent: Mocks<'findMany' | 'updateMany'>
      boundaryCrossing: Mocks<'updateMany'>
    }
  }
).__tx
const now = new Date('2026-10-02T00:00:00Z')
const base = { workspaceId: 'ws', workspaceMemberId: 'wm', now }

const bumpOf = (rootId: string) => ({
  where: { id: rootId },
  data: { attributionVersion: { increment: 1 } },
})

beforeEach(() => {
  for (const model of Object.values(tx))
    for (const fn of Object.values(model)) fn.mockReset()
  tx.session.updateMany.mockResolvedValue({ count: 1 })
  tx.hookEvent.findMany.mockResolvedValue([])
  tx.session.findMany.mockResolvedValue([])
  tx.hookEvent.updateMany.mockResolvedValue({ count: 0 })
  tx.boundaryCrossing.updateMany.mockResolvedValue({ count: 0 })
})

describe('binding writes bump the family root attributionVersion', () => {
  it('root task attach (new row) bumps the root itself', async () => {
    tx.session.findUnique.mockResolvedValueOnce(null)
    tx.session.create.mockResolvedValueOnce({ id: 'R', taskId: 't1' })
    await sessionRepository.upsertWithTaskId({
      ...base,
      id: 'R',
      taskId: 't1',
    })
    expect(tx.session.updateMany).toHaveBeenCalledWith(bumpOf('R'))
  })

  it('child task attach (existing row) bumps the parent root', async () => {
    tx.session.upsert.mockResolvedValueOnce({ id: 'R', taskId: null })
    tx.session.findUnique.mockResolvedValueOnce({ workspaceMemberId: 'wm' })
    tx.session.update.mockResolvedValueOnce({ id: 'R:a1', taskId: 't1' })
    await sessionRepository.upsertWithTaskId({
      ...base,
      id: 'R:a1',
      taskId: 't1',
      parentSessionId: 'R',
      agentId: 'a1',
    })
    expect(tx.session.updateMany).toHaveBeenCalledWith(bumpOf('R'))
  })

  it('an attach refused as owned-by-other bumps nothing', async () => {
    tx.session.findUnique.mockResolvedValueOnce({ workspaceMemberId: 'other' })
    await sessionRepository.upsertWithTaskId({
      ...base,
      id: 'R',
      taskId: 't1',
    })
    expect(tx.session.updateMany).not.toHaveBeenCalled()
  })

  it('steward attach bumps the root', async () => {
    tx.session.findUnique.mockResolvedValueOnce({ workspaceMemberId: 'wm' })
    tx.session.update.mockResolvedValueOnce({ id: 'R', milestoneId: 'ms' })
    await sessionRepository.upsertWithMilestoneId({
      ...base,
      id: 'R',
      milestoneId: 'ms',
    })
    expect(tx.session.updateMany).toHaveBeenCalledWith(bumpOf('R'))
  })

  it('steward attach on a new row bumps the root', async () => {
    tx.session.findUnique.mockResolvedValueOnce(null)
    tx.session.create.mockResolvedValueOnce({ id: 'R', milestoneId: 'ms' })
    await sessionRepository.upsertWithMilestoneId({
      ...base,
      id: 'R',
      milestoneId: 'ms',
    })
    expect(tx.session.updateMany).toHaveBeenCalledWith(bumpOf('R'))
  })

  it('inherit-to-children bumps the parent root', async () => {
    tx.session.findMany.mockResolvedValueOnce([{ id: 'R:a1' }])
    await sessionRepository.inheritTaskToUnboundChildren('R', 't1')
    expect(tx.session.updateMany).toHaveBeenCalledWith(bumpOf('R'))
  })

  it('late inherit of an existing unbound child bumps the parent root', async () => {
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'R', taskId: 't1' })
      .mockResolvedValueOnce({ id: 'R:a1', taskId: null })
    await sessionRepository.upsertChildForHookEvent({
      ...base,
      parentSessionId: 'R',
      agentId: 'a1',
      agentType: null,
      cwd: null,
    })
    expect(tx.session.updateMany).toHaveBeenCalledWith(bumpOf('R'))
  })

  it('the explicit retag of an attached child bumps the parent root', async () => {
    await hookEventRepository.retagSessionEventsToExplicitTask('R:a1', 't1')
    expect(tx.session.updateMany).toHaveBeenCalledWith(bumpOf('R'))
  })
})
