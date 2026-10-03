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
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
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
      hookEvent: Record<
        'findFirst' | 'findMany' | 'update' | 'updateMany',
        jest.Mock
      >
      boundaryCrossing: Record<'updateMany', jest.Mock>
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
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: null }) // parent
      .mockResolvedValueOnce({ id: 'P:a1', taskId: null }) // child
    const r = await sessionRepository.upsertChildForHookEvent({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      agentType: 'Explore',
      cwd: '/r',
    })
    expect(tx.session.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'P' },
        create: expect.objectContaining({ id: 'P', eventCount: 0 }),
        update: {},
      })
    )
    expect(tx.session.create).not.toHaveBeenCalled()
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
    expect(r).toEqual({ id: 'P:a1', taskId: null, steward: false })
  })

  it('stamps INHERITED when the parent is bound', async () => {
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: 't1' })
      .mockResolvedValueOnce({ id: 'P:a1', taskId: 't1' })
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

describe('upsertChildForHookEvent — steward parent (LUM-640)', () => {
  it('reports steward from the parent read it already does', async () => {
    tx.session.upsert
      .mockResolvedValueOnce({
        id: 'P',
        taskId: null,
        role: 'STEWARD',
        milestoneId: 'm1',
      })
      .mockResolvedValueOnce({ id: 'P:a1', taskId: null })
    const r = await sessionRepository.upsertChildForHookEvent({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      agentType: null,
      cwd: null,
    })
    expect(tx.session.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        select: { id: true, taskId: true, role: true, milestoneId: true },
      })
    )
    expect(r).toEqual({ id: 'P:a1', taskId: null, steward: true })
    expect(tx.session.findUnique).not.toHaveBeenCalled()
  })
})

describe('upsertChildForHookEvent — late parent binding', () => {
  it('an existing unbound child inherits a parent bound since (closes the attach race)', async () => {
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: 't1' }) // parent, bound
      .mockResolvedValueOnce({ id: 'P:a1', taskId: null }) // existing child
    tx.session.updateMany.mockResolvedValueOnce({ count: 1 })
    // One event was provisionally tagged with another task, with an open crossing.
    tx.hookEvent.findMany.mockResolvedValueOnce([
      { id: 'he_prov', taskId: 't9' },
    ])
    tx.boundaryCrossing.updateMany.mockResolvedValueOnce({ count: 1 })
    tx.hookEvent.updateMany.mockResolvedValueOnce({ count: 2 })
    const r = await sessionRepository.upsertChildForHookEvent({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      agentType: null,
      cwd: null,
    })
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'P:a1', taskId: null, role: 'IMPLEMENTATION' },
      data: { taskId: 't1', bindingSource: 'INHERITED' },
    })
    // Explicit binding wins over provisional tags: every non-t1 event moves.
    expect(tx.hookEvent.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: { in: ['P:a1'] },
        OR: [{ taskId: null }, { taskId: { not: 't1' } }],
      },
      data: { taskId: 't1' },
    })
    expect(tx.boundaryCrossing.updateMany).toHaveBeenCalledWith({
      where: {
        taskId: { in: ['t9'] },
        disposition: null,
        hookEventId: { in: ['he_prov'] },
      },
      data: { taskId: 't1' },
    })
    expect(r).toEqual({ id: 'P:a1', taskId: 't1', steward: false })
  })

  it('leaves a child with its own task, or an unbound parent, alone', async () => {
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: 't1' })
      .mockResolvedValueOnce({ id: 'P:a1', taskId: 't2' })
    expect(
      await sessionRepository.upsertChildForHookEvent({
        ...base,
        parentSessionId: 'P',
        agentId: 'a1',
        agentType: null,
        cwd: null,
      })
    ).toEqual({ id: 'P:a1', taskId: 't2', steward: false })
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: null })
      .mockResolvedValueOnce({ id: 'P:a1', taskId: null })
    await sessionRepository.upsertChildForHookEvent({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      agentType: null,
      cwd: null,
    })
    expect(tx.session.updateMany).not.toHaveBeenCalled()
  })
})

describe('inheritTaskToUnboundChildren', () => {
  it('binds only unbound children and retags all their events to the explicit task', async () => {
    tx.session.findMany.mockResolvedValueOnce([{ id: 'P:a1' }, { id: 'P:a2' }])
    tx.session.updateMany.mockResolvedValueOnce({ count: 2 })
    tx.hookEvent.findMany.mockResolvedValueOnce([{ id: 'he_prov' }])
    tx.boundaryCrossing.updateMany.mockResolvedValueOnce({ count: 1 })
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
      where: {
        sessionId: { in: ['P:a1', 'P:a2'] },
        OR: [{ taskId: null }, { taskId: { not: 't1' } }],
      },
      data: { taskId: 't1' },
    })
    expect(r).toEqual({
      childCount: 2,
      retaggedEventCount: 7,
      crossingsMoved: 1,
    })
  })
})

describe('inheritTaskToUnboundChildren lock order (I5)', () => {
  it('bumps the family root BEFORE reading or touching any child (root -> child order)', async () => {
    const order: string[] = []
    tx.session.updateMany.mockImplementation(
      async (a: { where: { id: unknown } }) => {
        order.push(a.where.id === 'P' ? 'bump-root' : 'update-children')
        return { count: 1 }
      }
    )
    tx.session.findMany.mockImplementationOnce(async () => {
      order.push('read-children')
      return [{ id: 'P:a1' }]
    })
    tx.hookEvent.findMany.mockResolvedValueOnce([])
    tx.hookEvent.updateMany.mockResolvedValueOnce({ count: 0 })
    await sessionRepository.inheritTaskToUnboundChildren('P', 't1')
    expect(order).toEqual(['bump-root', 'read-children', 'update-children'])
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
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: null }) // parent
      .mockResolvedValueOnce({ id: 'P:a1', taskId: null, usageByModel: null })
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

  it('ADDS the delta onto a SUBAGENT_STOP row that already has usage', async () => {
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: null })
      .mockResolvedValueOnce({
        id: 'P:a1',
        taskId: null,
        usageByModel: {
          sonnet: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
        },
      })
    tx.hookEvent.findFirst.mockResolvedValueOnce({
      id: 'he9',
      usageByModel: {
        sonnet: { input: 50, output: 5, cacheRead: 0, cacheCreation: 0 },
      },
    })
    const cumulative = {
      sonnet: { input: 160, output: 16, cacheRead: 0, cacheCreation: 0 },
      haiku: { input: 7, output: 1, cacheRead: 0, cacheCreation: 0 },
    }
    const r = await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage: {
        inputTokens: 167,
        outputTokens: 17,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        byModel: cumulative,
      },
    })
    expect(tx.hookEvent.update).toHaveBeenCalledWith({
      where: { id: 'he9' },
      data: {
        usageByModel: {
          sonnet: { input: 110, output: 11, cacheRead: 0, cacheCreation: 0 },
          haiku: { input: 7, output: 1, cacheRead: 0, cacheCreation: 0 },
        },
      },
    })
    expect(r).toEqual({ settled: true })
  })

  it('is idempotent: the same cumulative twice adds nothing the second time', async () => {
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: null })
      .mockResolvedValueOnce({
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

  it('skips the parent upsert when the child row already exists', async () => {
    tx.session.findUnique.mockResolvedValueOnce({
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
    expect(tx.session.upsert).not.toHaveBeenCalled()
    expect(r).toEqual({ settled: false })
  })

  const expectCumulative = () =>
    expect(tx.session.update).toHaveBeenCalledWith({
      where: { id: 'P:a1' },
      data: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        usageByModel: usage.byModel,
      },
    })

  it('writes the cumulative when an eventless child (eventCount 0) with null usage has no SUBAGENT_STOP row', async () => {
    tx.session.findUnique.mockResolvedValueOnce({
      id: 'P:a1',
      taskId: null,
      usageByModel: null,
      eventCount: 0,
    })
    tx.hookEvent.findFirst.mockResolvedValueOnce(null)
    const r = await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage,
    })
    expectCumulative()
    expect(tx.hookEvent.update).not.toHaveBeenCalled()
    expect(r).toEqual({ settled: false })
  })

  it('writes the cumulative for a child created by settle that has no SUBAGENT_STOP row', async () => {
    tx.session.upsert
      .mockResolvedValueOnce({ id: 'P', taskId: null }) // parent
      .mockResolvedValueOnce({ id: 'P:a1', taskId: null, usageByModel: null, eventCount: 0 })
    tx.hookEvent.findFirst.mockResolvedValueOnce(null)
    await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage,
    })
    expectCumulative()
    expect(tx.hookEvent.update).not.toHaveBeenCalled()
  })

  it('defers (writes nothing) when the child has its own hook events but no SUBAGENT_STOP row yet', async () => {
    tx.session.findUnique.mockResolvedValueOnce({
      id: 'P:a1',
      taskId: null,
      usageByModel: null,
      eventCount: 3,
    })
    tx.hookEvent.findFirst.mockResolvedValueOnce(null)
    const r = await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage,
    })
    expect(tx.session.update).not.toHaveBeenCalled()
    expect(tx.hookEvent.update).not.toHaveBeenCalled()
    expect(r).toEqual({ settled: false })
  })

  it('is idempotent when no SUBAGENT_STOP row exists: the same usage again writes nothing', async () => {
    tx.session.findUnique.mockResolvedValueOnce({
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
    expect(tx.session.update).not.toHaveBeenCalled()
    expect(tx.hookEvent.update).not.toHaveBeenCalled()
    expect(r).toEqual({ settled: false })
  })
})

describe('settleChildUsage — usage drop re-baselines (LUM-932 dedupe upgrade)', () => {
  const inflated = {
    sonnet: { input: 200, output: 20, cacheRead: 0, cacheCreation: 0 },
  }
  const deduped = {
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    byModel: {
      sonnet: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
    },
  }

  it('overwrites the inflated cumulative with the lower one and adds nothing to the SUBAGENT_STOP row', async () => {
    tx.session.findUnique.mockResolvedValueOnce({
      id: 'P:a1',
      taskId: null,
      usageByModel: inflated,
    })
    tx.hookEvent.findFirst.mockResolvedValue({ id: 'he9', usageByModel: null })
    const r = await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage: deduped,
    })
    expect(tx.hookEvent.update).not.toHaveBeenCalled()
    expect(tx.session.update).toHaveBeenCalledWith({
      where: { id: 'P:a1' },
      data: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        usageByModel: deduped.byModel,
      },
    })
    expect(r).toEqual({ settled: false })
  })

  it('then settles later growth against the lower baseline', async () => {
    tx.session.findUnique.mockResolvedValueOnce({
      id: 'P:a1',
      taskId: null,
      usageByModel: deduped.byModel,
    })
    tx.hookEvent.findFirst.mockResolvedValueOnce({
      id: 'he9',
      usageByModel: null,
    })
    await sessionRepository.settleChildUsage({
      ...base,
      parentSessionId: 'P',
      agentId: 'a1',
      usage: {
        ...deduped,
        inputTokens: 130,
        byModel: {
          sonnet: { input: 130, output: 10, cacheRead: 0, cacheCreation: 0 },
        },
      },
    })
    expect(tx.hookEvent.update).toHaveBeenCalledWith({
      where: { id: 'he9' },
      data: {
        usageByModel: {
          sonnet: { input: 30, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
      },
    })
  })
})

describe('upsertWithTaskId (child linkage)', () => {
  const args = {
    id: 'P:a1',
    workspaceId: 'ws',
    workspaceMemberId: 'wm',
    taskId: 't1',
    now,
    parentSessionId: 'P',
    agentId: 'a1',
  }

  it('on a NEW row ensures the parent and creates the child linked', async () => {
    tx.session.upsert.mockResolvedValueOnce({ id: 'P', taskId: null })
    tx.session.findUnique.mockResolvedValueOnce(null)
    tx.session.create.mockResolvedValueOnce({ id: 'P:a1', taskId: 't1' })
    await sessionRepository.upsertWithTaskId(args)
    expect(tx.session.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'P' },
        create: expect.objectContaining({ id: 'P', eventCount: 0 }),
      })
    )
    expect(tx.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'P:a1',
          parentSessionId: 'P',
          agentId: 'a1',
          bindingSource: 'ATTACH',
        }),
      })
    )
  })

  it('on an EXISTING row updates the binding and the child linkage', async () => {
    tx.session.upsert.mockResolvedValueOnce({ id: 'P', taskId: null })
    tx.session.findUnique.mockResolvedValueOnce({ workspaceMemberId: 'wm' })
    tx.session.update.mockResolvedValueOnce({ id: 'P:a1', taskId: 't1' })
    await sessionRepository.upsertWithTaskId(args)
    expect(tx.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'P:a1' },
        data: {
          taskId: 't1',
          bindingSource: 'ATTACH',
          parentSessionId: 'P',
          agentId: 'a1',
        },
      })
    )
  })
})

describe('top-level listings exclude child sessions', () => {
  const topLevel = {
    where: expect.objectContaining({ parentSessionId: null }),
  }

  it('listForTask', async () => {
    ;(prisma.session.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await sessionRepository.listForTask('t1')
    expect(prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining(topLevel)
    )
  })

  it('listForMember', async () => {
    ;(prisma.session.findMany as jest.Mock).mockResolvedValueOnce([])
    await sessionRepository.listForMember('wm')
    expect(prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining(topLevel)
    )
  })

  it('listForTaskMissingRunSummary', async () => {
    ;(prisma.session.findMany as jest.Mock).mockResolvedValueOnce([])
    await sessionRepository.listForTaskMissingRunSummary('t1')
    expect(prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining(topLevel)
    )
  })
})
