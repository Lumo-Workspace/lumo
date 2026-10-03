/**
 * @jest-environment node
 *
 * LUM-307 — per-person token stats on a task. Covers the pure aggregator
 * `aggregateRunsByMember` (no I/O) and the `getTimeline` wiring that groups
 * runs by workspace member and enriches Clerk display names.
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
jest.mock('@/lib/repositories/attribution.repository', () => ({
  attributionRepository: { listTaskSegments: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { findByTaskIdWithSession: jest.fn() },
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  enrichClerkUsers: jest.fn(async () => new Map()),
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { enrichClerkUsers } from '@/lib/utils/clerk-helpers'
import {
  agentRunTimelineService,
  aggregateRunsByMember,
} from '@/lib/services/agent-run-timeline.service'
import type { ModelCost } from '@/lib/services/model-cost'

const sessions = sessionRepository.listForTask as jest.Mock
const events = hookEventRepository.findByTaskId as jest.Mock
const memories = memoryRepository.findByTaskIdWithSession as jest.Mock
const enrich = enrichClerkUsers as jest.Mock

const opus = (n: number): ModelCost => ({
  model: 'opus',
  input: n,
  output: n,
  cacheRead: n,
  cacheCreation: n,
  total: n * 4,
})

beforeEach(() => {
  jest.clearAllMocks()
  memories.mockResolvedValue([])
  enrich.mockResolvedValue(new Map())
})

describe('aggregateRunsByMember', () => {
  it('sums runs belonging to the same member', () => {
    const out = aggregateRunsByMember([
      {
        workspaceMemberId: 'm1',
        clerkId: 'c1',
        loopCount: 2,
        byModel: [opus(100)],
      },
      {
        workspaceMemberId: 'm1',
        clerkId: 'c1',
        loopCount: 1,
        byModel: [opus(50)],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      workspaceMemberId: 'm1',
      clerkId: 'c1',
      runCount: 2,
      loopCount: 3,
    })
    expect(out[0]!.byModel).toEqual([
      {
        model: 'opus',
        input: 150,
        output: 150,
        cacheRead: 150,
        cacheCreation: 150,
        total: 600,
      },
    ])
  })

  it('orders members by total spend descending', () => {
    const out = aggregateRunsByMember([
      {
        workspaceMemberId: 'small',
        clerkId: 'cs',
        loopCount: 1,
        byModel: [opus(10)],
      },
      {
        workspaceMemberId: 'big',
        clerkId: 'cb',
        loopCount: 1,
        byModel: [opus(1000)],
      },
    ])
    expect(out.map(m => m.workspaceMemberId)).toEqual(['big', 'small'])
  })

  it('skips runs with no member (orphan / unlinked sessions)', () => {
    const out = aggregateRunsByMember([
      {
        workspaceMemberId: null,
        clerkId: null,
        loopCount: 1,
        byModel: [opus(100)],
      },
    ])
    expect(out).toEqual([])
  })

  it('omits a member whose runs captured no token cost', () => {
    const out = aggregateRunsByMember([
      {
        workspaceMemberId: 'm1',
        clerkId: 'c1',
        loopCount: 0,
        byModel: null,
      },
    ])
    expect(out).toEqual([])
  })

  it('backfills clerkId from the first run that carries one', () => {
    const out = aggregateRunsByMember([
      {
        workspaceMemberId: 'm1',
        clerkId: null,
        loopCount: 0,
        byModel: [opus(10)],
      },
      {
        workspaceMemberId: 'm1',
        clerkId: 'c1',
        loopCount: 0,
        byModel: [opus(10)],
      },
    ])
    expect(out[0]!.clerkId).toBe('c1')
  })
})

describe('getTimeline — perMember', () => {
  const t0 = new Date('2026-06-01T10:00:00Z')
  const t1 = new Date('2026-06-01T10:05:00Z')

  it('groups per-member cost and enriches Clerk name + avatar', async () => {
    sessions.mockResolvedValue([
      {
        id: 'sess_1',
        agent: 'CLAUDE_CODE',
        workspaceMemberId: 'm1',
        member: { clerkId: 'clerk_1' },
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
        turnSummary: 'done',
        usageByModel: {
          opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
        },
        createdAt: t1,
      },
    ])
    enrich.mockResolvedValue(
      new Map([
        [
          'clerk_1',
          {
            clerkId: 'clerk_1',
            name: 'Ada Lovelace',
            imageUrl: 'http://img/ada.png',
          },
        ],
      ])
    )

    const { perMember, runs } =
      await agentRunTimelineService.getTimeline('task_1')

    expect(enrich).toHaveBeenCalledWith(['clerk_1'])
    expect(perMember).toHaveLength(1)
    expect(perMember[0]).toMatchObject({
      workspaceMemberId: 'm1',
      clerkId: 'clerk_1',
      name: 'Ada Lovelace',
      imageUrl: 'http://img/ada.png',
      runCount: 1,
      loopCount: 1,
    })
    expect(perMember[0]!.byModel[0]!.total).toBe(170)
    // The owning member is also stamped on the run for the run-header avatar.
    expect(runs[0]!.member).toEqual({
      workspaceMemberId: 'm1',
      name: 'Ada Lovelace',
      imageUrl: 'http://img/ada.png',
    })
  })

  it('returns an empty perMember list when no session has captured cost', async () => {
    sessions.mockResolvedValue([
      {
        id: 'sess_1',
        agent: 'CLAUDE_CODE',
        workspaceMemberId: 'm1',
        member: { clerkId: 'clerk_1' },
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

    const { perMember, runs } =
      await agentRunTimelineService.getTimeline('task_1')
    expect(perMember).toEqual([])
    // The run captured no cost, but its owner is still resolved so the run
    // header can show who ran it (LUM-308).
    expect(enrich).toHaveBeenCalledWith(['clerk_1'])
    expect(runs[0]!.member).toEqual({
      workspaceMemberId: 'm1',
      name: 'Unknown',
      imageUrl: '',
    })
  })
})
