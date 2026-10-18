/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskForecastSnapshot: { findUnique: jest.fn(), create: jest.fn() },
    task: { findUnique: jest.fn(), count: jest.fn() },
    notification: { count: jest.fn() },
    hookEvent: { findMany: jest.fn() },
    session: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { inferredUsageEventsForTasks } from '@/lib/repositories/task-attribution-where'

const snapFind = prisma.taskForecastSnapshot.findUnique as jest.Mock
const snapCreate = prisma.taskForecastSnapshot.create as jest.Mock
const taskFind = prisma.task.findUnique as jest.Mock
const taskCount = prisma.task.count as jest.Mock
const notifCount = prisma.notification.count as jest.Mock
const hookFind = prisma.hookEvent.findMany as jest.Mock
const sessionFind = prisma.session.findMany as jest.Mock

beforeEach(() => {
  ;[
    snapFind,
    snapCreate,
    taskFind,
    taskCount,
    notifCount,
    hookFind,
    sessionFind,
  ].forEach(m => m.mockReset())
  // Default: no turn events → active time 0. Duration-specific tests override.
  hookFind.mockResolvedValue([])
  // Default: no inferred top-level sessions (LUM-1237 counts runs by id).
  sessionFind.mockResolvedValue([])
})

it('loadActuals sums session usage and counts sessions', async () => {
  const t0 = new Date('2024-01-01T00:00:00Z')
  taskFind.mockResolvedValue({
    projectId: 'p1',
    sessions: [
      {
        id: 's1',
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheCreationTokens: 0,
        startedAt: t0,
        lastActivityAt: t0,
      },
      {
        id: 's2',
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        startedAt: t0,
        lastActivityAt: t0,
      },
    ],
  })
  const a = await retrospectiveRepository.loadActuals('t1')
  expect(a).toEqual({
    projectId: 'p1',
    tokenCost: 38,
    iterations: 2,
    interactionRounds: 0,
    totalDurationSec: 0,
  })
})

it('interactionRounds counts prompt submissions', async () => {
  const t0 = new Date('2024-01-01T00:00:00Z')
  const at = (ms: number) => new Date(t0.getTime() + ms)
  taskFind.mockResolvedValue({ projectId: 'p1', sessions: [] })
  // 3 USER_PROMPT_SUBMIT events (plus STOPs) → interactionRounds === 3.
  hookFind.mockResolvedValue([
    { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
    { sessionId: 's1', type: 'STOP', createdAt: at(1000) },
    { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(2000) },
    { sessionId: 's1', type: 'STOP', createdAt: at(3000) },
    { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(4000) },
    { sessionId: 's1', type: 'STOP', createdAt: at(5000) },
  ])

  const a = await retrospectiveRepository.loadActuals('t1')
  expect(a?.interactionRounds).toBe(3)
  // The notification table must NOT drive this metric at all — the count comes
  // purely from the USER_PROMPT_SUBMIT turn events.
  expect(notifCount).not.toHaveBeenCalled()
})

it('loadActuals returns tokenCost null when no session carries usage', async () => {
  const t0 = new Date('2024-01-01T00:00:00Z')
  taskFind.mockResolvedValue({
    projectId: 'p1',
    sessions: [
      {
        id: 's1',
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        startedAt: t0,
        lastActivityAt: t0,
      },
    ],
  })
  const a = await retrospectiveRepository.loadActuals('t1')
  expect(a).toEqual({
    projectId: 'p1',
    tokenCost: null,
    iterations: 1,
    interactionRounds: 0,
    totalDurationSec: 0,
  })
})

it('loadActuals returns null when the task is missing', async () => {
  taskFind.mockResolvedValue(null)
  expect(await retrospectiveRepository.loadActuals('nope')).toBeNull()
})

it('createSnapshotIfAbsent swallows unique-violation (keep-first)', async () => {
  snapCreate.mockRejectedValue(
    Object.assign(new Error('unique'), { code: 'P2002' })
  )
  await expect(
    retrospectiveRepository.createSnapshotIfAbsent('t1', {
      iterations: null,
      interactionRounds: null,
      tokenCost: null,
      cohortSize: 0,
      tokenCostBasis: 0,
    })
  ).resolves.toBeUndefined()
})

it('createSnapshotIfAbsent rethrows non-P2002 errors', async () => {
  snapCreate.mockRejectedValue(
    Object.assign(new Error('boom'), { code: 'P2003' })
  )
  await expect(
    retrospectiveRepository.createSnapshotIfAbsent('t1', {
      iterations: null,
      interactionRounds: null,
      tokenCost: null,
      cohortSize: 0,
      tokenCostBasis: 0,
    })
  ).rejects.toThrow('boom')
})

it('createSnapshotIfAbsent sets capturedAt explicitly', async () => {
  snapCreate.mockResolvedValue({})
  await retrospectiveRepository.createSnapshotIfAbsent('t1', {
    iterations: null,
    interactionRounds: null,
    tokenCost: null,
    cohortSize: 0,
    tokenCostBasis: 0,
  })
  const data = snapCreate.mock.calls[0]?.[0]?.data
  expect(data.capturedAt).toBeInstanceOf(Date)
})

it('countReferenceLibrary counts DONE tasks with sessions', async () => {
  taskCount.mockResolvedValue(27)
  expect(await retrospectiveRepository.countReferenceLibrary('p1')).toBe(27)
  // LUM-932 P3: explicit sessions OR unattached top-level work inferred onto it.
  expect(taskCount).toHaveBeenCalledWith({
    where: {
      projectId: 'p1',
      status: 'DONE',
      OR: [
        { sessions: { some: {} } },
        {
          attributionSegments: {
            some: {
              source: 'INFERRED',
              session: {
                parentSessionId: null,
                taskId: null,
                NOT: { role: 'STEWARD', milestoneId: { not: null } },
              },
            },
          },
        },
      ],
    },
  })
})

describe('loadActuals — totalDurationSec (turn-active time)', () => {
  const base = new Date('2024-01-01T00:00:00Z')
  const at = (msOffset: number) => new Date(base.getTime() + msOffset)

  beforeEach(() => {
    taskFind.mockResolvedValue({ projectId: 'p1', sessions: [] })
  })

  it('sums per-session turn-active time (prompt→STOP), excluding idle between turns', async () => {
    // One session, two turns with a ~5h idle gap in between (the merged-bug
    // case): turn1 30s + turn2 20s = 50s; the idle is excluded.
    hookFind.mockResolvedValue([
      { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
      { sessionId: 's1', type: 'STOP', createdAt: at(30_000) },
      {
        sessionId: 's1',
        type: 'USER_PROMPT_SUBMIT',
        createdAt: at(5 * 60 * 60 * 1000),
      },
      {
        sessionId: 's1',
        type: 'STOP',
        createdAt: at(5 * 60 * 60 * 1000 + 20_000),
      },
    ])

    const actuals = await retrospectiveRepository.loadActuals('t1')
    expect(actuals?.totalDurationSec).toBe(50)
  })

  it('queries the full active-time event stream (including human-wait markers)', async () => {
    await retrospectiveRepository.loadActuals('t1')
    // The type filter must include human-wait markers (PERMISSION_REQUEST,
    // NOTIFICATION, ELICITATION) so the active-time algorithm can exclude
    // mid-turn human-wait intervals — not just the turn-boundary types.
    const call = hookFind.mock.calls[0]?.[0]
    const types: string[] = call?.where?.type?.in ?? []
    expect(types).toEqual(
      expect.arrayContaining([
        'USER_PROMPT_SUBMIT',
        'STOP',
        'STOP_FAILURE',
        'PERMISSION_REQUEST',
        'NOTIFICATION',
        'ELICITATION',
      ])
    )
  })

  it('is 0 when there are no turn events', async () => {
    hookFind.mockResolvedValue([])
    const actuals = await retrospectiveRepository.loadActuals('t1')
    expect(actuals?.totalDurationSec).toBe(0)
  })
})

// LUM-562: per-session spend for the cost trajectory — same Session.* columns
// loadActuals totals, so Σ here reconciles with loadActuals.tokenCost.
describe('loadPerSessionCost — per-session cost trajectory (LUM-562)', () => {
  it('sums each session usage-bearing session, oldest-first, reconciling with the loadActuals total', async () => {
    const sessions = [
      {
        id: 's-1',
        startedAt: new Date('2026-06-02T09:00:00Z'),
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheCreationTokens: 1,
        loopCount: 3,
      },
      {
        id: 's-2',
        startedAt: new Date('2026-06-03T09:00:00Z'),
        inputTokens: 7,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        loopCount: 1,
      },
    ]
    sessionFind.mockResolvedValue(sessions)

    const perSession = await retrospectiveRepository.loadPerSessionCost('t1')

    // Only usage-bearing sessions, ordered by startedAt; columns summed.
    expect(perSession).toEqual([
      {
        sessionId: 's-1',
        tokenCost: 18,
        loopCount: 3,
        startedAt: sessions[0]!.startedAt,
      },
      {
        sessionId: 's-2',
        tokenCost: 7,
        loopCount: 1,
        startedAt: sessions[1]!.startedAt,
      },
    ])
    // Same source as loadActuals: the trajectory sums to the same task total.
    taskFind.mockResolvedValue({ projectId: 'p', sessions })
    hookFind.mockResolvedValue([])
    const actuals = await retrospectiveRepository.loadActuals('t1')
    const trajectoryTotal = perSession.reduce((a, p) => a + p.tokenCost, 0)
    expect(trajectoryTotal).toBe(actuals?.tokenCost)
  })

  it('queries only usage-bearing sessions of the task, ordered by startedAt', async () => {
    sessionFind.mockResolvedValue([])
    const out = await retrospectiveRepository.loadPerSessionCost('t1')
    expect(out).toEqual([])
    expect(sessionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 't1', outputTokens: { not: null } },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      })
    )
  })

  it('coerces null token columns to 0 in the per-session sum', async () => {
    sessionFind.mockResolvedValue([
      {
        id: 's-1',
        startedAt: new Date('2026-06-02T09:00:00Z'),
        inputTokens: 4,
        outputTokens: 3,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        loopCount: null,
      },
    ])
    const out = await retrospectiveRepository.loadPerSessionCost('t1')
    expect(out).toEqual([
      {
        sessionId: 's-1',
        tokenCost: 7,
        loopCount: 0,
        startedAt: new Date('2026-06-02T09:00:00Z'),
      },
    ])
  })
})

describe('loadMemberActualRowsForTasks', () => {
  it('fetches the SAME token columns and event stream as loadActualsForTasks, plus the attribution keys', async () => {
    const sessions = [
      {
        id: 's-1',
        taskId: 't1',
        workspaceMemberId: 'mA',
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ]
    const createdAt = new Date('2026-06-02T09:00:00Z')
    const events = [
      // NULL event task → falls back to the session's explicit task.
      {
        sessionId: 's-1',
        taskId: null,
        type: 'USER_PROMPT_SUBMIT',
        createdAt,
        session: { taskId: 't1' },
      },
      // The event's own task wins (LUM-932 per-event attribution).
      {
        sessionId: 's-1',
        taskId: 't2',
        type: 'STOP',
        createdAt,
        session: { taskId: 't1' },
      },
    ]
    sessionFind.mockResolvedValue(sessions)
    hookFind.mockResolvedValue(events)

    const out = await retrospectiveRepository.loadMemberActualRowsForTasks([
      't1',
      't2',
    ])
    expect(out).toEqual({
      sessions,
      turnEvents: [
        {
          sessionId: 's-1',
          taskId: 't1',
          type: 'USER_PROMPT_SUBMIT',
          createdAt,
        },
        { sessionId: 's-1', taskId: 't2', type: 'STOP', createdAt },
      ],
    })
    // Same task-linked session set as loadActualsForTasks, now with the
    // per-member attribution keys (id + workspaceMemberId) and the LUM-636
    // per-model map selected.
    expect(sessionFind).toHaveBeenCalledWith({
      where: { taskId: { in: ['t1', 't2'] } },
      select: {
        id: true,
        taskId: true,
        workspaceMemberId: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        usageByModel: true,
      },
    })
    // Same union event stream + type filter — the Σ-identity's same-source leg.
    expect(hookFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { taskId: { in: ['t1', 't2'] } },
            { taskId: null, session: { taskId: { in: ['t1', 't2'] } } },
          ],
        }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          sessionId: true,
          taskId: true,
          type: true,
          createdAt: true,
          session: { select: { taskId: true } },
        },
      })
    )
  })

  it('short-circuits an empty task set without querying', async () => {
    const out = await retrospectiveRepository.loadMemberActualRowsForTasks([])
    expect(out).toEqual({ sessions: [], turnEvents: [] })
    expect(sessionFind).not.toHaveBeenCalled()
    expect(hookFind).not.toHaveBeenCalled()
  })
})

describe('loadSessionTokenRowsForTasks', () => {
  it('fetches the same token columns and attribution key, without the event stream', async () => {
    const sessions = [
      {
        taskId: 't1',
        workspaceMemberId: 'mA',
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ]
    sessionFind.mockResolvedValue(sessions)

    const out = await retrospectiveRepository.loadSessionTokenRowsForTasks([
      't1',
      't2',
    ])
    expect(out).toEqual(sessions)
    expect(sessionFind).toHaveBeenCalledWith({
      where: { taskId: { in: ['t1', 't2'] } },
      select: {
        taskId: true,
        workspaceMemberId: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
      },
    })
    // Lean by design: the delivery rollup needs no active time, so the
    // active-time hook-event stream is never fetched on this path — the only
    // hook-event read is the LUM-932 P3 inferred-usage query (one, batched).
    expect(hookFind).toHaveBeenCalledTimes(1)
    expect(hookFind.mock.calls[0][0].where).toEqual(
      inferredUsageEventsForTasks(['t1', 't2'])
    )
  })

  it('short-circuits an empty task set without querying', async () => {
    const out = await retrospectiveRepository.loadSessionTokenRowsForTasks([])
    expect(out).toEqual([])
    expect(sessionFind).not.toHaveBeenCalled()
  })
})
