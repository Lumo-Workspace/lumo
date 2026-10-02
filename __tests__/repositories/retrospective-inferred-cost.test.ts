/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn(), findMany: jest.fn() },
    hookEvent: { findMany: jest.fn(), groupBy: jest.fn() },
    session: { findMany: jest.fn(), groupBy: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { forecastRepository } from '@/lib/repositories/forecast.repository'
import {
  foldInferredBySession,
  inferredUsageForTasks,
} from '@/lib/repositories/inferred-usage.repository'
import {
  addUsageMaps,
  usageMapKindTotals,
  usageMapTotal,
} from '@/lib/services/model-cost'
import { loadTaskContextSamples } from '@/lib/summaries/stats'
import { inferredUsageEventsForTasks } from '@/lib/repositories/task-attribution-where'

const taskFind = prisma.task.findUnique as jest.Mock
const taskFindMany = prisma.task.findMany as jest.Mock
const hookFind = prisma.hookEvent.findMany as jest.Mock
const hookGroupBy = prisma.hookEvent.groupBy as unknown as jest.Mock
const sessionFind = prisma.session.findMany as jest.Mock
const sessionGroupBy = prisma.session.groupBy as unknown as jest.Mock

type InferredEvent = {
  taskId: string
  sessionId: string
  workspaceMemberId: string
  type: 'STOP' | 'STOP_FAILURE' | 'SUBAGENT_STOP'
  usageByModel: Record<string, unknown>
  session: {
    parentSessionId: string | null
    startedAt: Date
    parent: { startedAt: Date } | null
  }
}

const u = (input: number, output = 0, cacheRead = 0, cacheCreation = 0) => ({
  input,
  output,
  cacheRead,
  cacheCreation,
})

/** Is this the inferred-usage query (vs. the active-time turn stream)? */
function isInferredQuery(args: { where?: Record<string, unknown> }): boolean {
  const session = args.where?.session as { taskId?: unknown } | undefined
  return !!session && session.taskId === null && 'usageByModel' in args.where!
}

let inferredEvents: InferredEvent[] = []
let sessionRows: Array<Record<string, unknown>> = []
/** Session start times the inferred rows' `session` relation reports. */
let rootStarts: Array<{ id: string; startedAt: Date }> = []

beforeEach(() => {
  jest.clearAllMocks()
  inferredEvents = []
  sessionRows = []
  rootStarts = []
  hookFind.mockImplementation(
    async (args: { where: Record<string, unknown> }) =>
      isInferredQuery(args)
        ? inferredEvents.filter(e =>
            ((args.where.taskId as { in: string[] }).in as string[]).includes(
              e.taskId
            )
          )
        : []
  )
  sessionFind.mockImplementation(async () => sessionRows)
})

const T0 = new Date('2026-09-01T00:00:00Z')
const T1 = new Date('2026-09-02T00:00:00Z')
const T2 = new Date('2026-09-03T00:00:00Z')

const explicitA = {
  id: 'A',
  parentSessionId: null,
  taskId: 't1',
  workspaceMemberId: 'm1',
  startedAt: T0,
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 5,
  cacheCreationTokens: 1,
  loopCount: 2,
  usageByModel: { opus: u(10, 20, 5, 1) },
}
const explicitB = {
  id: 'B',
  parentSessionId: null,
  taskId: 't1',
  workspaceMemberId: 'm2',
  startedAt: T2,
  inputTokens: 3,
  outputTokens: 4,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  loopCount: 1,
  usageByModel: { sonnet: u(3, 4) },
}
/** Explicit subagent child of A (inherited binding). */
const explicitChild = {
  id: 'A:sub1',
  parentSessionId: 'A',
  taskId: 't1',
  workspaceMemberId: 'm1',
  startedAt: T1,
  inputTokens: 100,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  loopCount: null,
  usageByModel: { haiku: u(100) },
}

const startOf = (id: string): Date =>
  rootStarts.find(r => r.id === id)?.startedAt ?? new Date(0)

/** Built lazily so `rootStarts` set later in a test is honored. */
const ev = (
  sessionId: string,
  type: InferredEvent['type'],
  usage: Record<string, unknown>,
  opts: { parent?: string; task?: string; member?: string } = {}
): InferredEvent => ({
  taskId: opts.task ?? 't1',
  sessionId,
  workspaceMemberId: opts.member ?? 'm3',
  type,
  usageByModel: usage,
  get session() {
    return {
      parentSessionId: opts.parent ?? null,
      startedAt: startOf(sessionId),
      parent: opts.parent ? { startedAt: startOf(opts.parent) } : null,
    }
  },
})

describe('inferredUsageForTasks', () => {
  it('queries the inferred-usage rule once, batched, and resolves the family root', async () => {
    inferredEvents = [
      ev('U', 'STOP', { opus: u(1) }),
      ev('U:sub', 'SUBAGENT_STOP', { opus: u(2) }, { parent: 'U' }),
    ]
    const rows = await inferredUsageForTasks(['t1', 't2'])
    expect(hookFind).toHaveBeenCalledTimes(1)
    expect(hookFind.mock.calls[0][0].where).toEqual(
      inferredUsageEventsForTasks(['t1', 't2'])
    )
    expect(rows.map(r => [r.sessionId, r.rootSessionId])).toEqual([
      ['U', 'U'],
      ['U:sub', 'U'],
    ])
    // The trajectory's root start time rides on the same query.
    expect(hookFind.mock.calls[0][0].select.session).toEqual({
      select: {
        parentSessionId: true,
        startedAt: true,
        parent: { select: { startedAt: true } },
      },
    })
    expect(await inferredUsageForTasks([])).toEqual([])
    expect(hookFind).toHaveBeenCalledTimes(1)
  })

  it('folds rows per (task, session) into flat per-kind totals', () => {
    const folded = foldInferredBySession([
      {
        taskId: 't1',
        sessionId: 'U',
        rootSessionId: 'U',
        rootStartedAt: T1,
        workspaceMemberId: 'm3',
        type: 'STOP',
        usageByModel: { opus: u(1, 2, 3, 4) },
      },
      {
        taskId: 't1',
        sessionId: 'U',
        rootSessionId: 'U',
        rootStartedAt: T1,
        workspaceMemberId: 'm3',
        type: 'STOP',
        usageByModel: { opus: u(1), sonnet: u(0, 5) },
      },
    ])
    expect(folded).toEqual([
      expect.objectContaining({
        id: 'U',
        taskId: 't1',
        inputTokens: 2,
        outputTokens: 7,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
        usageByModel: { opus: u(2, 2, 3, 4), sonnet: u(0, 5) },
      }),
    ])
  })
})

describe('retrospective loaders — hybrid cost (LUM-932 P3)', () => {
  it('pure explicit: every loader is unchanged (regression baseline)', async () => {
    sessionRows = [explicitA, explicitB]
    taskFind.mockResolvedValue({ projectId: 'p1', sessions: sessionRows })

    expect(await retrospectiveRepository.loadActuals('t1')).toEqual({
      projectId: 'p1',
      tokenCost: 36 + 7,
      iterations: 2,
      interactionRounds: 0,
      totalDurationSec: 0,
    })
    expect(await retrospectiveRepository.loadPerSessionCost('t1')).toEqual([
      { sessionId: 'A', tokenCost: 36, loopCount: 2, startedAt: T0 },
      { sessionId: 'B', tokenCost: 7, loopCount: 1, startedAt: T2 },
    ])
    const set = await retrospectiveRepository.loadActualsForTasks(['t1'])
    expect(set).toEqual({
      tokenCost: 43,
      activeTimeSec: 0,
      measuredTasks: 1,
      models: [
        { model: 'opus', ...u(10, 20, 5, 1), total: 36 },
        { model: 'sonnet', ...u(3, 4), total: 7 },
      ],
      modelUnattributedTokens: 0,
    })
    const member = await retrospectiveRepository.loadMemberActualRowsForTasks([
      't1',
    ])
    expect(member.sessions).toEqual(sessionRows)
    expect(
      await retrospectiveRepository.loadSessionTokenRowsForTasks(['t1'])
    ).toEqual(sessionRows)
  })

  it('pure inferred: tokenCost comes from per-turn usage rows', async () => {
    taskFind.mockResolvedValue({ projectId: 'p1', sessions: [] })
    rootStarts = [{ id: 'U', startedAt: T1 }]
    inferredEvents = [
      ev('U', 'STOP', { opus: u(5, 5) }),
      ev('U', 'STOP', { opus: u(1, 1, 8) }),
    ]

    const a = await retrospectiveRepository.loadActuals('t1')
    expect(a?.tokenCost).toBe(20)
    expect(a?.iterations).toBe(0)

    expect(await retrospectiveRepository.loadPerSessionCost('t1')).toEqual([
      { sessionId: 'U', tokenCost: 20, loopCount: 2, startedAt: T1 },
    ])

    const set = await retrospectiveRepository.loadActualsForTasks(['t1'])
    expect(set.tokenCost).toBe(20)
    expect(set.measuredTasks).toBe(1)
    expect(set.models).toEqual([{ model: 'opus', ...u(6, 6, 8), total: 20 }])
    expect(set.modelUnattributedTokens).toBe(0)

    const member = await retrospectiveRepository.loadMemberActualRowsForTasks([
      't1',
    ])
    expect(member.sessions).toEqual([
      {
        id: 'U',
        taskId: 't1',
        workspaceMemberId: 'm3',
        inputTokens: 6,
        outputTokens: 6,
        cacheReadTokens: 8,
        cacheCreationTokens: 0,
        usageByModel: { opus: u(6, 6, 8) },
      },
    ])
    expect(
      await retrospectiveRepository.loadSessionTokenRowsForTasks(['t1'])
    ).toEqual([
      {
        taskId: 't1',
        workspaceMemberId: 'm3',
        inputTokens: 6,
        outputTokens: 6,
        cacheReadTokens: 8,
        cacheCreationTokens: 0,
      },
    ])
  })

  it('no usage on either side stays null (not measured ≠ spent zero)', async () => {
    taskFind.mockResolvedValue({
      projectId: 'p1',
      sessions: [
        {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheCreationTokens: null,
        },
      ],
    })
    expect((await retrospectiveRepository.loadActuals('t1'))?.tokenCost).toBe(
      null
    )
    expect(
      (await retrospectiveRepository.loadActualsForTasks(['t1'])).tokenCost
    ).toBe(null)
  })

  it('mixed explicit + inferred: totals add, per-model and per-member split', async () => {
    sessionRows = [explicitA]
    taskFind.mockResolvedValue({ projectId: 'p1', sessions: sessionRows })
    rootStarts = [{ id: 'U', startedAt: T1 }]
    inferredEvents = [ev('U', 'STOP', { opus: u(4), sonnet: u(0, 6) })]

    expect((await retrospectiveRepository.loadActuals('t1'))?.tokenCost).toBe(
      46
    )
    const set = await retrospectiveRepository.loadActualsForTasks(['t1'])
    expect(set.tokenCost).toBe(46)
    expect(set.models).toEqual([
      { model: 'opus', ...u(14, 20, 5, 1), total: 40 },
      { model: 'sonnet', ...u(0, 6), total: 6 },
    ])
    const member = await retrospectiveRepository.loadMemberActualRowsForTasks([
      't1',
    ])
    expect(member.sessions.map(s => [s.id, s.workspaceMemberId])).toEqual([
      ['A', 'm1'],
      ['U', 'm3'],
    ])
  })

  it('explicit child + inferred child are each counted once, folded to their root', async () => {
    sessionRows = [explicitA, explicitChild]
    taskFind.mockResolvedValue({ projectId: 'p1', sessions: sessionRows })
    rootStarts = [{ id: 'U', startedAt: T1 }]
    inferredEvents = [
      ev('U', 'STOP', { opus: u(7) }),
      ev('U:sub', 'SUBAGENT_STOP', { haiku: u(9) }, { parent: 'U' }),
    ]

    const actuals = await retrospectiveRepository.loadActuals('t1')
    // A (36) + explicit child (100) + inferred parent (7) + inferred child (9)
    expect(actuals?.tokenCost).toBe(152)

    const points = await retrospectiveRepository.loadPerSessionCost('t1')
    expect(points).toEqual([
      { sessionId: 'A', tokenCost: 136, loopCount: 2, startedAt: T0 },
      { sessionId: 'U', tokenCost: 16, loopCount: 1, startedAt: T1 },
    ])
    expect(points.reduce((s, p) => s + p.tokenCost, 0)).toBe(actuals?.tokenCost)
    expect(
      (await retrospectiveRepository.loadActualsForTasks(['t1'])).tokenCost
    ).toBe(152)
  })

  it('Σ trajectory == loadActuals.tokenCost across a mixed task (identity)', async () => {
    sessionRows = [explicitA, explicitChild, explicitB]
    taskFind.mockResolvedValue({ projectId: 'p1', sessions: sessionRows })
    rootStarts = [
      { id: 'U', startedAt: T1 },
      { id: 'V', startedAt: T0 },
    ]
    inferredEvents = [
      ev('U', 'STOP', { opus: u(1, 2, 3, 4) }),
      ev('V', 'STOP_FAILURE', { opus: u(11) }),
      ev('V:x', 'SUBAGENT_STOP', { opus: u(13) }, { parent: 'V' }),
    ]
    const actuals = await retrospectiveRepository.loadActuals('t1')
    const points = await retrospectiveRepository.loadPerSessionCost('t1')
    expect(points.reduce((s, p) => s + p.tokenCost, 0)).toBe(actuals?.tokenCost)
    // one point per top-level session, oldest-first (ties by id)
    expect(points.map(p => p.sessionId)).toEqual(['A', 'V', 'U', 'B'])
  })

  it('loadPerSessionCost costs one extra query: no separate session start lookup', async () => {
    sessionRows = [explicitA]
    rootStarts = [
      { id: 'U', startedAt: T1 },
      { id: 'P', startedAt: T2 },
    ]
    inferredEvents = [
      ev('U', 'STOP', { opus: u(3) }),
      ev('P:sub', 'SUBAGENT_STOP', { opus: u(4) }, { parent: 'P' }),
    ]
    const points = await retrospectiveRepository.loadPerSessionCost('t1')
    expect(sessionFind).toHaveBeenCalledTimes(1)
    expect(hookFind).toHaveBeenCalledTimes(1)
    expect(points).toEqual([
      { sessionId: 'A', tokenCost: 36, loopCount: 2, startedAt: T0 },
      { sessionId: 'U', tokenCost: 3, loopCount: 1, startedAt: T1 },
      // an inferred child folds to its root, dated by the root's start
      { sessionId: 'P', tokenCost: 4, loopCount: 0, startedAt: T2 },
    ])
  })

  it('folds an explicit child into its parent only when the parent is in this task', async () => {
    // Child of a session bound elsewhere (not in t1's explicit set).
    const orphanChild = {
      ...explicitChild,
      id: 'Z:sub',
      parentSessionId: 'Z',
      startedAt: T1,
    }
    sessionRows = [explicitA, explicitChild, orphanChild]
    taskFind.mockResolvedValue({ projectId: 'p1', sessions: sessionRows })
    const points = await retrospectiveRepository.loadPerSessionCost('t1')
    expect(points).toEqual([
      { sessionId: 'A', tokenCost: 136, loopCount: 2, startedAt: T0 },
      { sessionId: 'Z:sub', tokenCost: 100, loopCount: 0, startedAt: T1 },
    ])
    const actuals = await retrospectiveRepository.loadActuals('t1')
    expect(points.reduce((sum, p) => sum + p.tokenCost, 0)).toBe(
      actuals?.tokenCost
    )
  })

  it('issues one inferred query per loader call, batched over task ids', async () => {
    await retrospectiveRepository.loadActualsForTasks(['t1', 't2', 't3'])
    const inferredCalls = hookFind.mock.calls.filter(c => isInferredQuery(c[0]))
    expect(inferredCalls).toHaveLength(1)
    expect(inferredCalls[0][0].where.taskId).toEqual({
      in: ['t1', 't2', 't3'],
    })
  })
})

describe('forecast + stats loaders — hybrid cost', () => {
  const candidate = (id: string, sessions: unknown[]) => ({
    id,
    title: id,
    number: 1,
    team: { identifier: 'LUM' },
    taskTags: [],
    sessions,
    pullRequests: [],
  })

  it('loadForecastInputs adds inferred cost to candidates (explicit-only unchanged)', async () => {
    taskFind.mockResolvedValue({
      id: 'target',
      title: 'x',
      projectId: 'p1',
      taskTags: [],
    })
    const s = {
      startedAt: T0,
      lastActivityAt: T1,
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    }
    const nullS = {
      ...s,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
    }
    taskFindMany.mockResolvedValue([
      candidate('c1', [s]),
      candidate('c2', [nullS]),
      candidate('c3', [s]),
    ])
    hookGroupBy.mockResolvedValue([])
    inferredEvents = [
      ev('U', 'STOP', { opus: u(10) }, { task: 'c2' }),
      ev('W', 'STOP', { opus: u(5) }, { task: 'c3' }),
    ]
    const res = await forecastRepository.loadForecastInputs('target')
    expect(res?.candidates.map(c => [c.id, c.tokenCost])).toEqual([
      ['c1', 3],
      ['c2', 10],
      ['c3', 8],
    ])
    expect(hookFind.mock.calls.filter(c => isInferredQuery(c[0]))).toHaveLength(
      1
    )
  })

  it('loadTaskContextSamples adds inferred tokens and covers inferred-only tasks', async () => {
    sessionGroupBy.mockResolvedValue([
      {
        taskId: 't1',
        _count: { _all: 2 },
        _sum: {
          loopCount: 4,
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: null,
          cacheCreationTokens: null,
        },
      },
      {
        taskId: 't2',
        _count: { _all: 1 },
        _sum: {
          loopCount: 3,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
    ])
    inferredEvents = [
      ev('U', 'STOP', { opus: u(100) }, { task: 't1' }),
      ev('W', 'STOP', { opus: u(7) }, { task: 't3' }),
    ]
    const samples = await loadTaskContextSamples(['t1', 't2', 't3'])
    expect(samples.get('t1')).toEqual({
      taskId: 't1',
      sessionCount: 2,
      loopCount: 4,
      totalTokens: 115,
    })
    // explicit-only task unchanged
    expect(samples.get('t2')).toEqual({
      taskId: 't2',
      sessionCount: 1,
      loopCount: 3,
      totalTokens: 2,
    })
    expect(samples.get('t3')).toEqual({
      taskId: 't3',
      sessionCount: 0,
      loopCount: null,
      totalTokens: 7,
    })
  })
})

describe('shared usage-map helpers', () => {
  it('addUsageMaps sums per model without mutating inputs; totals per kind', () => {
    const a = { opus: u(1, 2, 3, 4) }
    const sum = addUsageMaps(a, { opus: u(1), haiku: u(0, 0, 0, 9) })
    expect(sum).toEqual({ opus: u(2, 2, 3, 4), haiku: u(0, 0, 0, 9) })
    expect(a).toEqual({ opus: u(1, 2, 3, 4) })
    expect(addUsageMaps(null, { opus: u(5) })).toEqual({ opus: u(5) })
    expect(usageMapKindTotals(sum)).toEqual(u(2, 2, 3, 13))
    expect(usageMapTotal(sum)).toBe(20)
  })
})
