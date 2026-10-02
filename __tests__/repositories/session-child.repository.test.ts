/**
 * @jest-environment node
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
    hookEvent: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
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

const tx = (
  prisma as unknown as {
    __tx: {
      session: Record<
        | 'findUnique'
        | 'create'
        | 'upsert'
        | 'update'
        | 'findMany'
        | 'updateMany',
        jest.Mock
      >
      hookEvent: Record<'findFirst' | 'update' | 'updateMany', jest.Mock>
    }
  }
).__tx
const now = new Date('2026-10-02T00:00:00Z')
const base = { workspaceId: 'ws', workspaceMemberId: 'wm', now }

beforeEach(() => {
  for (const model of Object.values(tx))
    for (const fn of Object.values(model)) fn.mockReset()
})

describe('upsertChildForHookEvent', () => {
  it('creates a missing parent and inherits the parent binding', async () => {
    tx.session.findUnique.mockResolvedValueOnce(null) // parent missing
    tx.session.create.mockResolvedValueOnce({ id: 'P', taskId: null })
    tx.session.upsert.mockResolvedValueOnce({ id: 'P:a1', taskId: null })
    const r = await sessionRepository.upsertChildForHookEvent({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      agentType: 'Explore',
      cwd: '/r',
    })
    expect(tx.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: 'P', eventCount: 0 }),
      })
    )
    expect(tx.session.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'P:a1' },
        create: expect.objectContaining({
          parentSessionId: 'P',
          agentId: 'a1',
          agentType: 'Explore',
          taskId: null,
          bindingSource: null,
        }),
      })
    )
    expect(r).toEqual({ id: 'P:a1', taskId: null })
  })

  it('stamps INHERITED when the parent is bound', async () => {
    tx.session.findUnique.mockResolvedValueOnce({ id: 'P', taskId: 't1' })
    tx.session.upsert.mockResolvedValueOnce({ id: 'P:a1', taskId: 't1' })
    await sessionRepository.upsertChildForHookEvent({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      agentType: null,
      cwd: null,
    })
    expect(tx.session.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          taskId: 't1',
          bindingSource: 'INHERITED',
        }),
      })
    )
  })
})

describe('inheritTaskToUnboundChildren', () => {
  it('binds only unbound children and retags their untagged events', async () => {
    tx.session.findMany.mockResolvedValueOnce([{ id: 'P:a1' }, { id: 'P:a2' }])
    tx.session.updateMany.mockResolvedValueOnce({ count: 2 })
    tx.hookEvent.updateMany.mockResolvedValueOnce({ count: 7 })
    const r = await sessionRepository.inheritTaskToUnboundChildren('P', 't1')
    expect(tx.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentSessionId: 'P', taskId: null } })
    )
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['P:a1', 'P:a2'] } },
      data: { taskId: 't1', bindingSource: 'INHERITED' },
    })
    expect(tx.hookEvent.updateMany).toHaveBeenCalledWith({
      where: { sessionId: { in: ['P:a1', 'P:a2'] }, taskId: null },
      data: { taskId: 't1' },
    })
    expect(r).toEqual({ childCount: 2, retaggedEventCount: 7 })
  })
})

describe('settleChildUsage', () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    byModel: {
      sonnet: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
    },
  }

  it('adds the delta onto the latest SUBAGENT_STOP row and overwrites the cumulative', async () => {
    tx.session.findUnique.mockResolvedValueOnce({ id: 'P', taskId: null }) // parent
    tx.session.upsert.mockResolvedValueOnce({
      id: 'P:a1',
      taskId: null,
      usageByModel: null,
    })
    tx.hookEvent.findFirst.mockResolvedValueOnce({
      id: 'he9',
      usageByModel: null,
    })
    const r = await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage,
    })
    expect(tx.hookEvent.update).toHaveBeenCalledWith({
      where: { id: 'he9' },
      data: { usageByModel: usage.byModel },
    })
    expect(tx.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'P:a1' },
        data: expect.objectContaining({
          inputTokens: 100,
          usageByModel: usage.byModel,
        }),
      })
    )
    expect(r).toEqual({ settled: true })
  })

  it('is idempotent: the same cumulative twice adds nothing the second time', async () => {
    tx.session.findUnique.mockResolvedValueOnce({ id: 'P', taskId: null })
    tx.session.upsert.mockResolvedValueOnce({
      id: 'P:a1',
      taskId: null,
      usageByModel: usage.byModel,
    })
    const r = await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage,
    })
    expect(tx.hookEvent.update).not.toHaveBeenCalled()
    expect(tx.session.update).not.toHaveBeenCalled()
    expect(r).toEqual({ settled: false })
  })

  it('defers when the child has no SUBAGENT_STOP yet', async () => {
    tx.session.findUnique.mockResolvedValueOnce({ id: 'P', taskId: null })
    tx.session.upsert.mockResolvedValueOnce({
      id: 'P:a1',
      taskId: null,
      usageByModel: null,
    })
    tx.hookEvent.findFirst.mockResolvedValueOnce(null)
    const r = await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage,
    })
    expect(tx.session.update).not.toHaveBeenCalled()
    expect(r).toEqual({ settled: false })
  })
})
