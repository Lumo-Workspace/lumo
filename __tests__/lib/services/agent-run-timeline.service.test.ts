/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { findByTaskIdWithSession: jest.fn() },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { agentRunTimelineService } from '@/lib/services/agent-run-timeline.service'

const sessions = sessionRepository.listForTask as jest.Mock
const events = hookEventRepository.findByTaskId as jest.Mock
const memories = memoryRepository.findByTaskIdWithSession as jest.Mock

const t0 = new Date('2026-06-01T10:00:00Z')
const t1 = new Date('2026-06-01T10:05:00Z')

beforeEach(() => {
  jest.clearAllMocks()
  memories.mockResolvedValue([])
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
    turnCount: 1,
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
    turnCount: 0,
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
