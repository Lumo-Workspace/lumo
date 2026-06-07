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
  const { runs } = await agentRunTimelineService.getTimeline('task_1')
  expect(runs[0]!.cost).toBeNull()
})
