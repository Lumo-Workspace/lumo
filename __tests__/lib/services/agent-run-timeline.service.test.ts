/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
    listChildrenForTask: jest.fn(async () => []),
    listTimelineRowsByIds: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { findByTaskIdWithSession: jest.fn() },
}))

jest.mock('@/lib/repositories/attribution.repository', () => ({
  attributionRepository: { listTaskSegments: jest.fn(async () => []) },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { attributionRepository } from '@/lib/repositories/attribution.repository'
import { agentRunTimelineService } from '@/lib/services/agent-run-timeline.service'

const sessions = sessionRepository.listForTask as jest.Mock
const events = hookEventRepository.findByTaskId as jest.Mock
const memories = memoryRepository.findByTaskIdWithSession as jest.Mock

const segments = attributionRepository.listTaskSegments as jest.Mock

const t0 = new Date('2026-06-01T10:00:00Z')
const t1 = new Date('2026-06-01T10:05:00Z')

beforeEach(() => {
  jest.clearAllMocks()
  memories.mockResolvedValue([])
  segments.mockResolvedValue([])
})

it('maps per-run model cost and a STOP turn delta, and aggregates tab totals', async () => {
  sessions.mockResolvedValue([
    {
      id: 'sess_1',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 2,
      loopCount: 1,
      usageByModel: {
        opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
      },
    },
  ])
  events.mockResolvedValue([
    {
      id: 'e1',
      sessionId: 'sess_1',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
    {
      id: 'e2',
      sessionId: 'sess_1',
      type: 'STOP',
      toolName: null,
      payload: {},
      turnSummary: 'did a thing',
      usageByModel: {
        opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
      },
      createdAt: t1,
    },
  ])

  const { runs, totals } = await agentRunTimelineService.getTimeline('task_1')

  expect(runs).toHaveLength(1)
  expect(runs[0]!.cost).toEqual({
    byModel: [
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
    ],
    loopCount: 1,
  })
  const stop = runs[0]!.items.find(
    i => i.kind === 'hook' && i.type === 'STOP'
  ) as { turnCost: unknown }
  expect(stop.turnCost).toEqual({
    byModel: [
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
    ],
  })
  expect(totals).toEqual({
    runCount: 1,
    loopCount: 1,
    byModel: [
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
    ],
  })
})

it('surfaces mid-turn flat-column burn as an in-flight cost row before the first STOP (LUM-345)', async () => {
  sessions.mockResolvedValue([
    {
      id: 'sess_live',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: 0,
      // No STOP yet → usageByModel unsettled; POST_TOOL_BATCH wrote only the
      // flat cumulative columns. This is the long-first-turn live-run case.
      usageByModel: null,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 9000,
      cacheCreationTokens: 100,
    },
  ])
  events.mockResolvedValue([
    {
      id: 'e1',
      sessionId: 'sess_live',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
  ])

  const { runs, totals } = await agentRunTimelineService.getTimeline('task_1')

  const inFlight = {
    model: '__in_flight__',
    input: 1000,
    output: 500,
    cacheRead: 9000,
    cacheCreation: 100,
    total: 10600,
  }
  expect(runs[0]!.cost).toEqual({ byModel: [inFlight], loopCount: 0 })
  // The tab summary card is gated on totals.byModel being non-empty — the
  // live burn must flow into it so the card appears during the run.
  expect(totals.byModel).toEqual([inFlight])
})

it('attributes the in-flight burn per model when the live snapshot exists (LUM-345 follow-up)', async () => {
  sessions.mockResolvedValue([
    {
      id: 'sess_live',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: 0,
      usageByModel: null,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 9000,
      cacheCreationTokens: 100,
      liveUsageByModel: {
        'claude-fable-5': {
          input: 1000,
          output: 500,
          cacheRead: 9000,
          cacheCreation: 100,
        },
      },
    },
  ])
  events.mockResolvedValue([
    {
      id: 'e1',
      sessionId: 'sess_live',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
  ])

  const { runs, totals } = await agentRunTimelineService.getTimeline('task_1')

  const attributed = {
    model: 'claude-fable-5',
    input: 1000,
    output: 500,
    cacheRead: 9000,
    cacheCreation: 100,
    total: 10600,
    inFlight: {
      input: 1000,
      output: 500,
      cacheRead: 9000,
      cacheCreation: 100,
      total: 10600,
    },
  }
  expect(runs[0]!.cost).toEqual({ byModel: [attributed], loopCount: 0 })
  expect(totals.byModel).toEqual([attributed])
})

it('leaves cost null when a session captured no usage', async () => {
  sessions.mockResolvedValue([
    {
      id: 'sess_1',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: null,
      usageByModel: null,
    },
  ])
  events.mockResolvedValue([
    {
      id: 'e1',
      sessionId: 'sess_1',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
  ])
  const { runs, totals } = await agentRunTimelineService.getTimeline('task_1')
  expect(runs[0]!.cost).toBeNull()
  expect(totals).toEqual({
    runCount: 1,
    // No run captured a loop count → aggregate stays null ("loops n/a"),
    // not a misleading 0 (which would read as "ran 0 loops"). LUM-311.
    loopCount: null,
    byModel: [],
  })
})

it('sums only runs with a captured loop count, ignoring null ones', async () => {
  sessions.mockResolvedValue([
    {
      id: 'sess_with',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: 3,
      usageByModel: {
        opus: { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 },
      },
    },
    {
      id: 'sess_without',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: null,
      usageByModel: null,
    },
  ])
  events.mockResolvedValue([
    {
      id: 'e1',
      sessionId: 'sess_with',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
    {
      id: 'e2',
      sessionId: 'sess_without',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
  ])
  const { totals } = await agentRunTimelineService.getTimeline('task_1')
  // Only sess_with contributes; the null run is skipped, not coerced to 0.
  expect(totals.loopCount).toBe(3)
})

it('surfaces runSummary on the run, and null when a session has none (LUM-481)', async () => {
  sessions.mockResolvedValue([
    {
      id: 'sess_with_summary',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: null,
      usageByModel: null,
      runSummary: 'polished',
    },
    {
      id: 'sess_no_summary',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: null,
      usageByModel: null,
      runSummary: null,
    },
  ])
  events.mockResolvedValue([
    {
      id: 'e1',
      sessionId: 'sess_with_summary',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
    {
      id: 'e2',
      sessionId: 'sess_no_summary',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
  ])

  const { runs } = await agentRunTimelineService.getTimeline('task_1')

  const withSummary = runs.find(r => r.sessionId === 'sess_with_summary')
  expect(withSummary!.runSummary).toBe('polished')
  const noSummary = runs.find(r => r.sessionId === 'sess_no_summary')
  expect(noSummary!.runSummary).toBeNull()
})

describe('agentRunTimelineService.getTimeline — agent identity', () => {
  it('passes the session agent through, and defaults the orphan bucket to CLAUDE_CODE', async () => {
    sessions.mockResolvedValue([
      {
        id: 's1',
        agent: 'CODEX',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        lastActivityAt: new Date('2026-01-01T10:30:00Z'),
        eventCount: 1,
        summary: null,
        summaryType: null,
        summaryGeneratedAt: null,
      },
    ])
    events.mockResolvedValue([
      {
        id: 'e1',
        sessionId: 's1',
        type: 'PRE_TOOL_USE',
        toolName: 'Bash',
        payload: {},
        turnSummary: null,
        createdAt: new Date('2026-01-01T10:05:00Z'),
      },
      {
        id: 'e2',
        sessionId: 'no-such-session',
        type: 'PRE_TOOL_USE',
        toolName: 'Read',
        payload: {},
        turnSummary: null,
        createdAt: new Date('2026-01-01T09:00:00Z'),
      },
    ])
    memories.mockResolvedValue([])

    const { runs } = await agentRunTimelineService.getTimeline('task-1')

    const linked = runs.find(r => r.sessionId === 's1')
    expect(linked).toBeDefined()
    expect(linked!.agent).toBe('CODEX')

    const orphan = runs.find(r => r.sessionId === null)
    expect(orphan).toBeDefined()
    expect(orphan!.agent).toBe('CLAUDE_CODE')
    // The orphan run only survives the service's nonEmptyRuns filter because
    // its PRE_TOOL_USE event gives it toolCallCount > 0 — assert that here so
    // the test fails loudly if the filter or event-type mapping ever changes.
    expect(orphan!.toolCallCount).toBeGreaterThan(0)
  })
})

it('run durationMs is turn-active time (prompt→STOP), excluding inter-turn idle', async () => {
  const p1 = new Date('2026-06-01T10:00:00Z')
  const s1 = new Date('2026-06-01T10:00:30Z') // turn 1: 30s
  const p2 = new Date('2026-06-01T15:00:00Z') // ~5h idle gap (user away)
  const s2 = new Date('2026-06-01T15:00:20Z') // turn 2: 20s
  sessions.mockResolvedValue([
    {
      id: 'sess_1',
      startedAt: p1,
      lastActivityAt: s2,
      eventCount: 4,
      loopCount: 2,
      usageByModel: null,
    },
  ])
  const mk = (id: string, type: string, createdAt: Date) => ({
    id,
    sessionId: 'sess_1',
    type,
    toolName: type === 'PRE_TOOL_USE' ? 'Read' : null,
    payload: {},
    turnSummary: null,
    usageByModel: null,
    createdAt,
  })
  events.mockResolvedValue([
    mk('e1', 'USER_PROMPT_SUBMIT', p1),
    mk('e2', 'PRE_TOOL_USE', new Date(p1.getTime() + 5_000)),
    mk('e3', 'STOP', s1),
    mk('e4', 'USER_PROMPT_SUBMIT', p2),
    mk('e5', 'STOP', s2),
  ])

  const { runs } = await agentRunTimelineService.getTimeline('task_1')

  // span would be ~5h; active time is 30s + 20s = 50s.
  expect(runs[0]!.durationMs).toBe(50_000)
})

describe('LUM-932 subagent child sessions fold into the parent run', () => {
  const children = sessionRepository.listChildrenForTask as jest.Mock
  const byIds = sessionRepository.listTimelineRowsByIds as jest.Mock
  const opus = (n: number) => ({
    opus: { input: n, output: 0, cacheRead: 0, cacheCreation: 0 },
  })
  const ev = (id: string, sessionId: string, at: Date) => ({
    id,
    sessionId,
    type: 'PRE_TOOL_USE',
    toolName: 'Read',
    payload: {},
    turnSummary: null,
    usageByModel: null,
    createdAt: at,
  })
  const total = (byModel: { total: number }[] | undefined) =>
    (byModel ?? []).reduce((n, c) => n + c.total, 0)

  it('folds child events and child cost under the bound parent run', async () => {
    sessions.mockResolvedValue([
      {
        id: 'sess_p',
        startedAt: t0,
        lastActivityAt: t1,
        eventCount: 1,
        loopCount: 1,
        usageByModel: opus(100),
      },
    ])
    children.mockResolvedValue([
      {
        id: 'sess_p:a1',
        parentSessionId: 'sess_p',
        startedAt: t0,
        lastActivityAt: t1,
        eventCount: 1,
        loopCount: null,
        usageByModel: opus(40),
      },
    ])
    events.mockResolvedValue([
      ev('e1', 'sess_p', t0),
      ev('e2', 'sess_p:a1', t1),
    ])

    const { runs, totals } = await agentRunTimelineService.getTimeline('task_1')

    expect(runs.map(r => r.sessionId)).toEqual(['sess_p'])
    expect(runs[0]!.toolCallCount).toBe(2)
    expect(total(runs[0]!.cost?.byModel)).toBe(140)
    expect(total(totals.byModel)).toBe(140)
    expect(children).toHaveBeenCalledWith('task_1')
  })

  it('keys a child that attached its own task under its parent run, counting only the child cost', async () => {
    sessions.mockResolvedValue([])
    children.mockResolvedValue([
      {
        id: 'sess_q:a2',
        parentSessionId: 'sess_q',
        startedAt: t1,
        lastActivityAt: t1,
        eventCount: 1,
        loopCount: null,
        usageByModel: opus(30),
      },
    ])
    byIds.mockResolvedValue([
      {
        id: 'sess_q',
        startedAt: t0,
        lastActivityAt: t1,
        eventCount: 5,
        loopCount: 3,
        runSummary: 'parent summary about other work',
        usageByModel: opus(999),
      },
    ])
    events.mockResolvedValue([ev('e3', 'sess_q:a2', t1)])

    const { runs, totals } = await agentRunTimelineService.getTimeline('task_2')

    expect(byIds).toHaveBeenCalledWith(['sess_q'])
    expect(runs.map(r => r.sessionId)).toEqual(['sess_q'])
    expect(runs[0]!.toolCallCount).toBe(1)
    // Only the child's cost belongs to this task — the parent's own burn
    // belongs elsewhere.
    expect(total(runs[0]!.cost?.byModel)).toBe(30)
    expect(total(totals.byModel)).toBe(30)
    expect(totals.loopCount).toBeNull()
  })

  it('costs an inferred unattached run by its task-attributed per-turn usage, not its cumulative columns', async () => {
    children.mockResolvedValue([])
    byIds.mockResolvedValue([])
    sessions.mockResolvedValue([
      {
        id: 'sess_u',
        inferred: true,
        startedAt: t0,
        lastActivityAt: t1,
        eventCount: 4,
        loopCount: 9,
        runSummary: 'summary spanning other tasks',
        // Cumulative across every task the session touched.
        usageByModel: opus(999),
        inputTokens: 999,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ])
    const stop = (id: string, sessionId: string, type: string, n: number) => ({
      ...ev(id, sessionId, t1),
      type,
      toolName: null,
      usageByModel: opus(n),
    })
    events.mockResolvedValue([
      ev('e1', 'sess_u', t0),
      stop('e2', 'sess_u', 'STOP', 12),
      stop('e3', 'sess_u:a1', 'SUBAGENT_STOP', 5),
    ])

    const { runs, totals } = await agentRunTimelineService.getTimeline('task_3')

    expect(runs.map(r => r.sessionId)).toEqual(['sess_u'])
    expect(total(runs[0]!.cost?.byModel)).toBe(17)
    expect(runs[0]!.cost?.loopCount).toBe(1)
    expect(runs[0]!.runSummary).toBeNull()
    expect(total(totals.byModel)).toBe(17)
  })
})

describe('LUM-932 P4 run attribution', () => {
  const toolEvent = (sessionId: string | null) => ({
    id: `e-${sessionId}`,
    sessionId,
    type: 'PRE_TOOL_USE',
    toolName: 'Read',
    payload: {},
    turnSummary: null,
    usageByModel: null,
    createdAt: t0,
  })

  it('an explicitly bound session with no segment rows is exact and empty', async () => {
    sessions.mockResolvedValue([
      { id: 'sess_1', startedAt: t0, lastActivityAt: t1, eventCount: 1, loopCount: 1, usageByModel: null },
    ])
    events.mockResolvedValue([toolEvent('sess_1')])
    const res = await agentRunTimelineService.getTimeline('task_1')
    expect(res.runs[0]!.attribution).toEqual({
      mode: 'EXPLICIT',
      segments: [],
      subagents: [],
      approximate: false,
    })
  })

  it('the unlinked run has no attribution', async () => {
    sessions.mockResolvedValue([])
    events.mockResolvedValue([toolEvent(null)])
    const res = await agentRunTimelineService.getTimeline('task_1')
    expect(res.runs[0]!.sessionId).toBeNull()
    expect(res.runs[0]!.attribution).toBeNull()
  })

  it('an inferred session yields INFERRED mode, approximate, with its segment evidence', async () => {
    const evAt = t0.toISOString()
    segments.mockResolvedValue([
      {
        sessionId: 'sess_inf',
        parentSessionId: null,
        agentType: null,
        source: 'INFERRED',
        confidence: 'HIGH',
        fromTurn: 0,
        toTurn: 2,
        fromAt: t0,
        toAt: null,
        evidence: [{ kind: 'BRANCH', identifier: 'LUM-12', at: evAt }],
      },
    ])
    sessions.mockResolvedValue([
      {
        id: 'sess_inf',
        inferred: true,
        startedAt: t0,
        lastActivityAt: t1,
        eventCount: 1,
        loopCount: 1,
        usageByModel: null,
      },
    ])
    events.mockResolvedValue([toolEvent('sess_inf')])
    const res = await agentRunTimelineService.getTimeline('task_1')
    const run = res.runs.find(r => r.sessionId === 'sess_inf')
    expect(run?.attribution?.mode).toBe('INFERRED')
    expect(run?.attribution?.approximate).toBe(true)
    expect(run?.attribution?.segments[0]!.evidence).toEqual([
      { kind: 'BRANCH', identifier: 'LUM-12', at: evAt },
    ])
  })
})

describe('LUM-932 P4 host runs', () => {
  const children = sessionRepository.listChildrenForTask as jest.Mock
  const byIds = sessionRepository.listTimelineRowsByIds as jest.Mock
  const opus = (n: number) => ({
    opus: { input: n, output: 0, cacheRead: 0, cacheCreation: 0 },
  })
  const total = (byModel: { total: number }[] | undefined) =>
    (byModel ?? []).reduce((n, c) => n + c.total, 0)
  const hostRow = {
    id: 'sess_h',
    startedAt: t0,
    lastActivityAt: t1,
    eventCount: 5,
    loopCount: 3,
    runSummary: 'parent summary about other work',
    usageByModel: opus(999),
  }
  const segRow = (source: string, confidence: string, evidence: unknown[]) => ({
    sessionId: 'sess_h:a1',
    parentSessionId: 'sess_h',
    agentType: 'Explore',
    source,
    confidence,
    fromTurn: 0,
    toTurn: 0,
    fromAt: t0,
    toAt: null,
    evidence,
  })

  it('a parent hosting a subagent that attached this task renders in HOST mode, exact', async () => {
    sessions.mockResolvedValue([])
    children.mockResolvedValue([
      {
        id: 'sess_h:a1',
        parentSessionId: 'sess_h',
        startedAt: t1,
        lastActivityAt: t1,
        eventCount: 1,
        loopCount: null,
        usageByModel: opus(30),
      },
    ])
    byIds.mockResolvedValue([hostRow])
    segments.mockResolvedValue([segRow('SUBAGENT_ATTACH', 'EXPLICIT', [])])
    events.mockResolvedValue([
      {
        id: 'e1',
        sessionId: 'sess_h:a1',
        type: 'PRE_TOOL_USE',
        toolName: 'Read',
        payload: {},
        turnSummary: null,
        usageByModel: null,
        createdAt: t1,
      },
    ])

    const { runs } = await agentRunTimelineService.getTimeline('task_h')

    expect(runs.map(r => r.sessionId)).toEqual(['sess_h'])
    expect(runs[0]!.attribution?.mode).toBe('HOST')
    expect(runs[0]!.attribution?.approximate).toBe(false)
    expect(runs[0]!.attribution?.subagents.map(s => s.source)).toEqual([
      'SUBAGENT_ATTACH',
    ])
    expect(runs[0]!.runSummary).toBeNull()
    expect(total(runs[0]!.cost?.byModel)).toBe(30)
  })

  it('an inferred subagent under an unbound, unhosted parent renders as an approximate HOST run, not unlinked', async () => {
    sessions.mockResolvedValue([])
    children.mockResolvedValue([])
    byIds.mockResolvedValue([hostRow])
    const evAt = t1.toISOString()
    segments.mockResolvedValue([
      segRow('INFERRED', 'HIGH', [
        { kind: 'AGENT_PROMPT', identifier: 'LUM-7', at: evAt },
      ]),
    ])
    events.mockResolvedValue([
      {
        id: 'e1',
        sessionId: 'sess_h:a1',
        type: 'PRE_TOOL_USE',
        toolName: 'Read',
        payload: {},
        turnSummary: null,
        usageByModel: null,
        createdAt: t0,
      },
      {
        id: 'e2',
        sessionId: 'sess_h:a1',
        type: 'SUBAGENT_STOP',
        toolName: null,
        payload: {},
        turnSummary: null,
        usageByModel: opus(7),
        createdAt: t1,
      },
    ])

    const { runs, totals } = await agentRunTimelineService.getTimeline('task_h')

    expect(byIds).toHaveBeenCalledWith(['sess_h'])
    expect(runs.map(r => r.sessionId)).toEqual(['sess_h'])
    const run = runs[0]!
    expect(run.attribution?.mode).toBe('HOST')
    expect(run.attribution?.approximate).toBe(true)
    expect(run.attribution?.subagents[0]!.source).toBe('INFERRED')
    expect(run.toolCallCount).toBe(1)
    expect(run.runSummary).toBeNull()
    // The host's own cumulative burn is not this task's; only the inferred
    // child's task-attributed per-turn usage is.
    expect(total(run.cost?.byModel)).toBe(7)
    expect(run.cost?.loopCount).toBeNull()
    expect(total(totals.byModel)).toBe(7)
  })
})

it('carries the session usageResyncedAt flag onto the run (null when unset)', async () => {
  const resynced = new Date('2026-10-05T00:00:00Z')
  sessions.mockResolvedValue([
    {
      id: 'sess_r',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: 1,
      usageByModel: null,
      usageResyncedAt: resynced,
    },
    {
      id: 'sess_n',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: 1,
      usageByModel: null,
    },
  ])
  events.mockResolvedValue(
    ['sess_r', 'sess_n'].map(sid => ({
      id: `e_${sid}`,
      sessionId: sid,
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    }))
  )
  const { runs } = await agentRunTimelineService.getTimeline('task_1')
  const byId = new Map(runs.map(r => [r.sessionId, r.usageResyncedAt]))
  expect(byId.get('sess_r')).toBe(resynced.toISOString())
  expect(byId.get('sess_n')).toBeNull()
})
