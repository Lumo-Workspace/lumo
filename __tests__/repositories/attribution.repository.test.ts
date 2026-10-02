/**
 * @jest-environment node
 *
 * LUM-932 P2 Task 5: attribution repository query shapes (mocked prisma).
 */
jest.mock('@/lib/db/prisma', () => {
  const tx = {
    taskAttributionSegment: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  }
  return {
    prisma: {
      session: { findUnique: jest.fn(), findMany: jest.fn() },
      hookEvent: { findMany: jest.fn() },
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
  hookEvent: Record<'findMany', jest.Mock>
  task: Record<'findMany', jest.Mock>
  pullRequest: Record<'findMany', jest.Mock>
  $transaction: jest.Mock
  __tx: {
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
    }
    const { workspaceId: _ws, ...sessionFields } = root
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
      sessions: [
        {
          id: 'r',
          parentSessionId: null,
          agentId: null,
          taskId: null,
          bindingSource: null,
          startedAt: new Date(0),
        },
        {
          id: 'r:a1',
          parentSessionId: 'r',
          agentId: 'a1',
          taskId: null,
          bindingSource: null,
          startedAt: new Date(0),
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

describe('replaceFamilySegments', () => {
  it('deletes the family segments then inserts the new rows in one transaction', async () => {
    const order: string[] = []
    p.__tx.taskAttributionSegment.deleteMany.mockImplementation(async () => {
      order.push('delete')
    })
    p.__tx.taskAttributionSegment.createMany.mockImplementation(async () => {
      order.push('create')
    })
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
    await attributionRepository.replaceFamilySegments(['r', 'r:a1'], [row])
    expect(p.$transaction).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['delete', 'create'])
    expect(p.__tx.taskAttributionSegment.deleteMany).toHaveBeenCalledWith({
      where: { sessionId: { in: ['r', 'r:a1'] } },
    })
    expect(p.__tx.taskAttributionSegment.createMany).toHaveBeenCalledWith({
      data: [row],
    })
  })

  it('still clears stale segments when there are no rows', async () => {
    await attributionRepository.replaceFamilySegments(['r'], [])
    expect(p.__tx.taskAttributionSegment.deleteMany).toHaveBeenCalled()
    expect(p.__tx.taskAttributionSegment.createMany).not.toHaveBeenCalled()
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
