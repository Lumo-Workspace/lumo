/**
 * @jest-environment node
 *
 * LUM-932 P2 Task 5: attribution repository query shapes (mocked prisma).
 */
jest.mock('@/lib/db/prisma', () => {
  const tx = {
    session: { updateMany: jest.fn(), findMany: jest.fn() },
    hookEvent: { findMany: jest.fn(), updateMany: jest.fn() },
    boundaryCrossing: { updateMany: jest.fn() },
    taskAttributionSegment: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  }
  return {
    prisma: {
      session: { findUnique: jest.fn(), findMany: jest.fn() },
      hookEvent: {
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      taskAttributionSegment: { findMany: jest.fn() },
      task: { findMany: jest.fn() },
      pullRequest: { findMany: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  ATTRIBUTION_COMPUTE_VERSION,
  attributionRepository,
} from '@/lib/repositories/attribution.repository'

const p = prisma as unknown as {
  session: Record<'findUnique' | 'findMany', jest.Mock>
  hookEvent: Record<'findMany' | 'count' | 'groupBy', jest.Mock>
  taskAttributionSegment: Record<'findMany', jest.Mock>
  task: Record<'findMany', jest.Mock>
  pullRequest: Record<'findMany', jest.Mock>
  $transaction: jest.Mock
  __tx: {
    session: Record<'updateMany' | 'findMany', jest.Mock>
    hookEvent: Record<'findMany' | 'updateMany', jest.Mock>
    boundaryCrossing: Record<'updateMany', jest.Mock>
    taskAttributionSegment: Record<'deleteMany' | 'createMany', jest.Mock>
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('exports compute version 1', () => {
  expect(ATTRIBUTION_COMPUTE_VERSION).toBe(1)
})

describe('loadFamily', () => {
  it('returns null when the root session is missing', async () => {
    p.session.findUnique.mockResolvedValue(null)
    await expect(attributionRepository.loadFamily('r')).resolves.toBeNull()
    expect(p.hookEvent.findMany).not.toHaveBeenCalled()
  })

  it('loads root + children and their events in createdAt order', async () => {
    const root = {
      id: 'r',
      workspaceId: 'ws',
      parentSessionId: null,
      agentId: null,
      taskId: null,
      bindingSource: null,
      startedAt: new Date(0),
      role: 'IMPLEMENTATION',
      milestoneId: null,
      attributionVersion: 3,
    }
    const { workspaceId: _ws, attributionVersion: _v, ...sessionFields } = root
    const child = {
      ...sessionFields,
      id: 'r:a1',
      parentSessionId: 'r',
      agentId: 'a1',
    }
    p.session.findUnique.mockResolvedValue(root)
    p.session.findMany.mockResolvedValue([child])
    p.hookEvent.findMany.mockResolvedValue([])

    const fam = await attributionRepository.loadFamily('r')
    expect(fam).toEqual({
      workspaceId: 'ws',
      attributionVersion: 3,
      sessions: [
        {
          id: 'r',
          parentSessionId: null,
          agentId: null,
          taskId: null,
          bindingSource: null,
          startedAt: new Date(0),
          role: 'IMPLEMENTATION',
          milestoneId: null,
        },
        {
          id: 'r:a1',
          parentSessionId: 'r',
          agentId: 'a1',
          taskId: null,
          bindingSource: null,
          startedAt: new Date(0),
          role: 'IMPLEMENTATION',
          milestoneId: null,
        },
      ],
      events: [],
    })
    expect(p.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentSessionId: 'r', workspaceId: 'ws' },
      })
    )
    const evArgs = p.hookEvent.findMany.mock.calls[0]![0]
    expect(evArgs.where).toEqual({
      workspaceId: 'ws',
      sessionId: { in: ['r', 'r:a1'] },
    })
    expect(evArgs.orderBy).toEqual({ createdAt: 'asc' })
    expect(evArgs.select).toEqual({
      id: true,
      sessionId: true,
      taskId: true,
      type: true,
      createdAt: true,
      attributionSignals: true,
      payloadPrunedAt: true,
    })
  })

  it('fetches payloads only for never-computed, unpruned events and merges by id', async () => {
    const root = {
      id: 'r',
      workspaceId: 'ws',
      parentSessionId: null,
      agentId: null,
      taskId: null,
      bindingSource: null,
      startedAt: new Date(0),
    }
    p.session.findUnique.mockResolvedValue(root)
    p.session.findMany.mockResolvedValue([])
    const base = {
      sessionId: 'r',
      type: 'PRE_TOOL_USE',
      createdAt: new Date(1),
      payloadPrunedAt: null,
    }
    p.hookEvent.findMany
      .mockResolvedValueOnce([
        { ...base, id: 'e1', attributionSignals: [] },
        { ...base, id: 'e2', attributionSignals: null },
      ])
      .mockResolvedValueOnce([{ id: 'e2', payload: { a: 1 } }])
    const fam = await attributionRepository.loadFamily('r')
    expect(p.hookEvent.findMany).toHaveBeenCalledTimes(2)
    const payloadArgs = p.hookEvent.findMany.mock.calls[1]![0]
    expect(payloadArgs.where).toEqual({
      workspaceId: 'ws',
      sessionId: { in: ['r'] },
      attributionSignals: { equals: Prisma.DbNull },
      payloadPrunedAt: null,
    })
    expect(payloadArgs.select).toEqual({ id: true, payload: true })
    expect(fam!.events.map(e => [e.id, e.payload])).toEqual([
      ['e1', null],
      ['e2', { a: 1 }],
    ])
  })
})

describe('resolveIdentifiers', () => {
  it('returns an empty map without querying for no identifiers', async () => {
    const out = await attributionRepository.resolveIdentifiers('ws', [])
    expect(out.size).toBe(0)
    expect(p.task.findMany).not.toHaveBeenCalled()
  })

  it('batches one query across teams, excluding soft-deleted tasks', async () => {
    p.task.findMany.mockResolvedValue([
      { id: 't12', number: 12, team: { identifier: 'LUM' } },
      { id: 's3', number: 3, team: { identifier: 'SPEC' } },
    ])
    const out = await attributionRepository.resolveIdentifiers('ws', [
      'LUM-12',
      'SPEC-3',
      'LUM-99',
      'LUM-12',
      'bogus',
    ])
    expect(p.task.findMany).toHaveBeenCalledTimes(1)
    const args = p.task.findMany.mock.calls[0]![0]
    expect(args.where).toEqual({
      deletedAt: null,
      OR: [
        {
          team: { identifier: 'LUM', workspaceId: 'ws' },
          number: { in: [12, 99] },
        },
        {
          team: { identifier: 'SPEC', workspaceId: 'ws' },
          number: { in: [3] },
        },
      ],
    })
    expect(args.select).toEqual({
      id: true,
      number: true,
      team: { select: { identifier: true } },
    })
    expect([...out]).toEqual([
      ['LUM-12', 't12'],
      ['SPEC-3', 's3'],
    ])
  })
})

describe('taskIdsForBranches', () => {
  it('maps each branch to the most recently updated linked PR task', async () => {
    p.pullRequest.findMany.mockResolvedValue([
      { headBranch: 'feat/a', taskId: 'newer' },
      { headBranch: 'feat/b', taskId: 'b1' },
      { headBranch: 'feat/a', taskId: 'older' },
    ])
    const out = await attributionRepository.taskIdsForBranches('ws', [
      'feat/a',
      'feat/b',
      'feat/a',
    ])
    const args = p.pullRequest.findMany.mock.calls[0]![0]
    expect(args.where).toEqual({
      workspaceId: 'ws',
      headBranch: { in: ['feat/a', 'feat/b'] },
      taskId: { not: null },
      task: { deletedAt: null },
    })
    expect(args.orderBy).toEqual({ updatedAt: 'desc' })
    expect([...out]).toEqual([
      ['feat/a', 'newer'],
      ['feat/b', 'b1'],
    ])
  })

  it('skips the query for no branches', async () => {
    const out = await attributionRepository.taskIdsForBranches('ws', [])
    expect(out.size).toBe(0)
    expect(p.pullRequest.findMany).not.toHaveBeenCalled()
  })
})

describe('commitFamilyAttribution', () => {
  const row = {
    workspaceId: 'ws',
    sessionId: 'r',
    taskId: 't',
    fromTurn: 0,
    toTurn: 1,
    fromAt: new Date(0),
    toAt: null,
    source: 'INFERRED' as const,
    confidence: 'HIGH' as const,
    evidence: [],
    computeVersion: 1,
  }
  const base = {
    rootSessionId: 'r',
    expectedVersion: 2,
    familyIds: ['r', 'r:a1'],
  }

  beforeEach(() => {
    p.__tx.session.updateMany.mockResolvedValue({ count: 1 })
    const member = (id: string, parentSessionId: string | null) => ({
      id,
      parentSessionId,
      taskId: null,
      role: 'IMPLEMENTATION',
      milestoneId: null,
    })
    p.__tx.session.findMany.mockResolvedValue([
      member('r', null),
      member('r:a1', 'r'),
    ])
    p.__tx.hookEvent.updateMany.mockResolvedValue({ count: 0 })
    p.__tx.boundaryCrossing.updateMany.mockResolvedValue({ count: 0 })
  })

  it('deletes and inserts segments, after the root compare-and-bump FIRST, with explicit tx limits', async () => {
    const order: string[] = []
    p.__tx.session.updateMany.mockImplementation(async () => {
      order.push('version')
      return { count: 1 }
    })
    p.__tx.taskAttributionSegment.deleteMany.mockImplementation(async () => {
      order.push('delete')
    })
    p.__tx.taskAttributionSegment.createMany.mockImplementation(async () => {
      order.push('create')
    })
    await expect(
      attributionRepository.commitFamilyAttribution({
        ...base,
        segments: [row],
        eventTaskChanges: [],
      })
    ).resolves.toMatchObject({
      conflict: false,
      eventsUpdated: 0,
      crossingsMoved: 0,
    })
    // Root-first lock order: the version bump is the first statement.
    expect(order).toEqual(['version', 'delete', 'create'])
    expect(p.__tx.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'r', attributionVersion: 2 },
      data: { attributionVersion: { increment: 1 } },
    })
    expect(p.__tx.taskAttributionSegment.deleteMany).toHaveBeenCalledWith({
      where: { sessionId: { in: ['r', 'r:a1'] } },
    })
    expect(p.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 15_000,
      maxWait: 5_000,
    })
  })

  it('still clears stale segments when there are no rows; null leaves them', async () => {
    await attributionRepository.commitFamilyAttribution({
      ...base,
      segments: [],
      eventTaskChanges: [],
    })
    expect(p.__tx.taskAttributionSegment.deleteMany).toHaveBeenCalled()
    expect(p.__tx.taskAttributionSegment.createMany).not.toHaveBeenCalled()
    jest.clearAllMocks()
    p.__tx.session.updateMany.mockResolvedValue({ count: 1 })
    await attributionRepository.commitFamilyAttribution({
      ...base,
      segments: null,
      eventTaskChanges: [],
    })
    expect(p.__tx.taskAttributionSegment.deleteMany).not.toHaveBeenCalled()
  })

  it('a version mismatch on the final compare-and-bump rolls back and reports the conflict', async () => {
    p.__tx.session.updateMany.mockResolvedValue({ count: 0 })
    p.__tx.hookEvent.findMany.mockResolvedValue([{ id: 'e1', taskId: null }])
    let rolledBack = false
    p.$transaction.mockImplementationOnce(
      async (fn: (t: typeof p.__tx) => unknown) => {
        try {
          return await fn(p.__tx)
        } catch (e) {
          rolledBack = true
          throw e
        }
      }
    )
    await expect(
      attributionRepository.commitFamilyAttribution({
        ...base,
        segments: [row],
        eventTaskChanges: [{ eventId: 'e1', taskId: 't' }],
      })
    ).resolves.toEqual(
      expect.objectContaining({
        conflict: true,
        eventsUpdated: 0,
        crossingsMoved: 0,
      })
    )
    expect(rolledBack).toBe(true)
  })

  it('a deadlock / write conflict (P2034) is reported as a version conflict', async () => {
    p.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('deadlock detected', {
        code: 'P2034',
        clientVersion: 'test',
      })
    )
    await expect(
      attributionRepository.commitFamilyAttribution({
        ...base,
        segments: [row],
        eventTaskChanges: [],
      })
    ).resolves.toEqual(expect.objectContaining({ conflict: true }))
  })

  it('updates events per target and narrows crossing moves by the old task ids', async () => {
    p.__tx.hookEvent.findMany.mockResolvedValue([
      { id: 'e1', taskId: 't_old' },
      { id: 'e2', taskId: null },
      { id: 'e3', taskId: 't_new' },
      { id: 'e4', taskId: 't_old' },
    ])
    p.__tx.hookEvent.updateMany.mockResolvedValue({ count: 1 })
    p.__tx.boundaryCrossing.updateMany.mockResolvedValue({ count: 1 })
    const out = await attributionRepository.commitFamilyAttribution({
      ...base,
      segments: null,
      eventTaskChanges: [
        { eventId: 'e1', taskId: 't_new' },
        { eventId: 'e2', taskId: 't_new' },
        { eventId: 'e3', taskId: 't_new' },
        { eventId: 'e4', taskId: null },
      ],
    })
    // Eligibility is re-read in-transaction: only still-eligible family
    // sessions' events are read.
    expect(p.__tx.session.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['r', 'r:a1'] } },
      select: {
        id: true,
        parentSessionId: true,
        taskId: true,
        role: true,
        milestoneId: true,
      },
    })
    expect(p.__tx.hookEvent.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['e1', 'e2', 'e3', 'e4'] },
        sessionId: { in: ['r', 'r:a1'] },
      },
      select: { id: true, taskId: true },
    })
    // e3 already carries its target: not rewritten.
    expect(p.__tx.hookEvent.updateMany.mock.calls.map(c => c[0])).toEqual([
      { where: { id: { in: ['e1', 'e2'] } }, data: { taskId: 't_new' } },
      { where: { id: { in: ['e4'] } }, data: { taskId: null } },
    ])
    // e2 had no task: it cannot own a task-scoped crossing.
    expect(
      p.__tx.boundaryCrossing.updateMany.mock.calls.map(c => c[0])
    ).toEqual([
      {
        where: {
          taskId: { in: ['t_old'] },
          disposition: null,
          hookEventId: { in: ['e1'] },
        },
        data: { taskId: 't_new' },
      },
      {
        where: {
          taskId: { in: ['t_old'] },
          disposition: null,
          hookEventId: { in: ['e4'] },
        },
        data: { taskId: null },
      },
    ])
    expect(out).toEqual({
      conflict: false,
      eventsUpdated: 2,
      crossingsMoved: 2,
      crossingsMovedToNull: 1,
      changedEvents: [
        { eventId: 'e1', fromTaskId: 't_old', toTaskId: 't_new' },
        { eventId: 'e2', fromTaskId: null, toTaskId: 't_new' },
        { eventId: 'e4', fromTaskId: 't_old', toTaskId: null },
      ],
    })
  })
})

describe('listExplicitRootSessionsForMember', () => {
  it('defaults to at most 50 sessions, most recently active first', async () => {
    p.session.findMany.mockResolvedValue([{ id: 's1' }])
    const since = new Date(0)
    await expect(
      attributionRepository.listExplicitRootSessionsForMember('m', since)
    ).resolves.toEqual(['s1'])
    expect(p.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        orderBy: { lastActivityAt: 'desc' },
      })
    )
  })
})

describe('loadBoundFamilyShape', () => {
  const root = {
    id: 'r',
    workspaceId: 'ws',
    parentSessionId: null,
    agentId: null,
    taskId: 'task_1',
    bindingSource: 'ATTACH',
    startedAt: new Date(0),
  }

  it('returns null without loading events when the root is missing or unbound', async () => {
    p.session.findUnique.mockResolvedValueOnce(null)
    await expect(
      attributionRepository.loadBoundFamilyShape('r')
    ).resolves.toBeNull()
    p.session.findUnique.mockResolvedValueOnce({ ...root, taskId: null })
    await expect(
      attributionRepository.loadBoundFamilyShape('r')
    ).resolves.toBeNull()
    expect(p.session.findMany).not.toHaveBeenCalled()
    expect(p.hookEvent.findMany).not.toHaveBeenCalled()
    expect(p.hookEvent.count).not.toHaveBeenCalled()
  })

  it('counts root prompts and takes each session first event time, never loading events', async () => {
    const { workspaceId: _ws, ...rootSession } = root
    const child = {
      ...rootSession,
      id: 'r:a1',
      parentSessionId: 'r',
      agentId: 'a1',
      taskId: null,
      bindingSource: null,
    }
    p.session.findUnique.mockResolvedValue(root)
    p.session.findMany.mockResolvedValue([child])
    p.hookEvent.count.mockResolvedValue(3)
    p.hookEvent.groupBy.mockResolvedValue([
      { sessionId: 'r', _min: { createdAt: new Date(5) } },
      { sessionId: 'r:a1', _min: { createdAt: new Date(9) } },
    ])

    const shape = await attributionRepository.loadBoundFamilyShape('r')
    expect(shape).toEqual({
      workspaceId: 'ws',
      sessions: [rootSession, child],
      rootPromptCount: 3,
      firstEventAt: new Map([
        ['r', new Date(5)],
        ['r:a1', new Date(9)],
      ]),
    })
    expect(p.hookEvent.findMany).not.toHaveBeenCalled()
    expect(p.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentSessionId: 'r', workspaceId: 'ws' },
      })
    )
    expect(p.hookEvent.count).toHaveBeenCalledWith({
      where: { workspaceId: 'ws', sessionId: 'r', type: 'USER_PROMPT_SUBMIT' },
    })
    expect(p.hookEvent.groupBy).toHaveBeenCalledWith({
      by: ['sessionId'],
      where: { workspaceId: 'ws', sessionId: { in: ['r', 'r:a1'] } },
      _min: { createdAt: true },
    })
  })
})

describe('listFamilySegments', () => {
  it('selects the comparable fields of the family segments', async () => {
    p.taskAttributionSegment.findMany.mockResolvedValue([{ sessionId: 'r' }])
    await expect(
      attributionRepository.listFamilySegments(['r', 'r:a1'])
    ).resolves.toEqual([{ sessionId: 'r' }])
    expect(p.taskAttributionSegment.findMany).toHaveBeenCalledWith({
      where: { sessionId: { in: ['r', 'r:a1'] } },
      select: {
        sessionId: true,
        taskId: true,
        fromTurn: true,
        toTurn: true,
        fromAt: true,
        toAt: true,
        source: true,
        confidence: true,
        computeVersion: true,
        evidence: true,
      },
    })
  })
})

describe('findOpenSegmentTask', () => {
  it('ignores segments whose task is in the trash and prefers the first session in order', async () => {
    p.taskAttributionSegment.findMany.mockResolvedValue([
      { sessionId: 'r', taskId: 't_parent' },
      { sessionId: 'r:a1', taskId: 't_child' },
    ])
    await expect(
      attributionRepository.findOpenSegmentTask('ws', ['r:a1', 'r'])
    ).resolves.toBe('t_child')
    expect(p.taskAttributionSegment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'ws',
          sessionId: { in: ['r:a1', 'r'] },
          toAt: null,
          source: 'INFERRED',
          task: { deletedAt: null },
        },
      })
    )
  })
})

describe('listTaskSegments', () => {
  it('selects the task segments and flattens the session family position', async () => {
    const fromAt = new Date(0)
    p.taskAttributionSegment.findMany.mockResolvedValue([
      {
        sessionId: 'r',
        source: 'INFERRED',
        confidence: 'HIGH',
        fromTurn: 0,
        toTurn: 1,
        fromAt,
        toAt: null,
        evidence: [],
        session: { parentSessionId: null, agentType: null },
      },
      {
        sessionId: 'r:a1',
        source: 'SUBAGENT_ATTACH',
        confidence: 'EXPLICIT',
        fromTurn: 0,
        toTurn: 0,
        fromAt,
        toAt: null,
        evidence: [],
        session: { parentSessionId: 'r', agentType: 'general-purpose' },
      },
    ])
    const rows = await attributionRepository.listTaskSegments('T')
    expect(p.taskAttributionSegment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 'T' },
        orderBy: { fromAt: 'asc' },
      })
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).not.toHaveProperty('session')
    expect(rows[0]).toMatchObject({ sessionId: 'r', parentSessionId: null, agentType: null })
    expect(rows[1]).toMatchObject({
      sessionId: 'r:a1',
      parentSessionId: 'r',
      agentType: 'general-purpose',
    })
  })
})
