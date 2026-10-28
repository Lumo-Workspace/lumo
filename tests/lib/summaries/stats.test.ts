// Mock @prisma/adapter-pg to prevent pg from loading (pg uses TextEncoder
// at module-evaluation time which is unavailable in jsdom environment)
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

// Mock clerk-helpers to avoid Clerk SDK import
jest.mock('@/lib/auth/user-profiles', () => ({
  enrichUsers: jest.fn().mockResolvedValue(new Map()),
}))

// Mock prisma
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    actor: {
      findMany: jest.fn(),
    },
    pullRequest: {
      count: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    project: {
      findMany: jest.fn(),
    },
  },
}))

import { aggregateProjectStats } from '@/lib/summaries/stats'
import { prisma } from '@/lib/db/prisma'

const asMock = (fn: unknown): jest.Mock<any> => fn as jest.Mock<any>

const PROJECT_ID = 'proj-1'

function setupDefaultMocks() {
  // status groupBy
  asMock(prisma.task.groupBy).mockImplementation(({ by }: { by: string[] }) => {
    // Must check assigneeActorId before status since that query includes both
    if (by.includes('assigneeActorId')) {
      return Promise.resolve([
        { assigneeActorId: 'actor-1', status: 'DONE', _count: { _all: 3 } },
        {
          assigneeActorId: 'actor-1',
          status: 'IN_PROGRESS',
          _count: { _all: 2 },
        },
        { assigneeActorId: 'actor-2', status: 'DONE', _count: { _all: 1 } },
      ])
    }
    if (by.includes('agentStatus')) {
      return Promise.resolve([
        { agentStatus: 'COMPLETED', _count: { _all: 2 } },
        { agentStatus: 'FAILED', _count: { _all: 1 } },
        { agentStatus: 'WORKING', _count: { _all: 1 } },
      ])
    }
    if (by.includes('status')) {
      return Promise.resolve([
        { status: 'TODO', _count: { _all: 5 } },
        { status: 'IN_PROGRESS', _count: { _all: 3 } },
        { status: 'DONE', _count: { _all: 10 } },
      ])
    }
    if (by.includes('priority')) {
      return Promise.resolve([
        { priority: 'HIGH', _count: { _all: 4 } },
        { priority: 'MEDIUM', _count: { _all: 9 } },
        { priority: 'LOW', _count: { _all: 5 } },
      ])
    }
    return Promise.resolve([])
  })

  // overdue tasks (include team + number to match stats.ts's Prisma include
  // shape — it builds `${task.team.identifier}-${task.number}` for topBlockers)
  asMock(prisma.task.findMany).mockImplementation(({ where }: any) => {
    if (where?.dueDate) {
      return Promise.resolve([
        {
          id: 'task-overdue-1',
          number: 101,
          title: 'Overdue task 1',
          team: { identifier: 'LUM' },
        },
        {
          id: 'task-overdue-2',
          number: 102,
          title: 'Overdue task 2',
          team: { identifier: 'LUM' },
        },
      ])
    }
    // completion trend
    // LUM-1282: the recent-completions query filters on completedAt (OR
    // updatedAt for rows the backfill has not reached).
    if (where?.status === 'DONE' && where?.OR) {
      return Promise.resolve([
        { updatedAt: new Date('2026-04-01T10:00:00Z') },
        { updatedAt: new Date('2026-04-01T14:00:00Z') },
        { updatedAt: new Date('2026-04-03T10:00:00Z') },
      ])
    }
    // avg completion time
    if (where?.status === 'DONE') {
      return Promise.resolve([
        {
          createdAt: new Date('2026-03-01T00:00:00Z'),
          updatedAt: new Date('2026-03-03T00:00:00Z'),
        },
        {
          createdAt: new Date('2026-03-05T00:00:00Z'),
          updatedAt: new Date('2026-03-07T00:00:00Z'),
        },
      ])
    }
    return Promise.resolve([])
  })

  // PR counts
  asMock(prisma.pullRequest.count).mockImplementation(({ where }: any) => {
    if (where?.state === 'merged') return Promise.resolve(5)
    if (where?.state === 'open') return Promise.resolve(2)
    return Promise.resolve(7)
  })

  // actor lookup for member workload
  asMock(prisma.actor.findMany).mockResolvedValue([
    {
      id: 'actor-1',
      type: 'HUMAN',
      member: { clerkId: 'clerk-user-1' },
      agent: null,
    },
    {
      id: 'actor-2',
      type: 'AGENT',
      member: null,
      agent: { name: 'Coding Agent' },
    },
  ])
}

describe('aggregateProjectStats', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupDefaultMocks()
  })

  it('returns correct status distribution', async () => {
    const stats = await aggregateProjectStats(PROJECT_ID)
    expect(stats.statusDistribution).toEqual({
      TODO: 5,
      IN_PROGRESS: 3,
      DONE: 10,
    })
  })

  it('returns correct priority distribution', async () => {
    const stats = await aggregateProjectStats(PROJECT_ID)
    expect(stats.priorityDistribution).toEqual({
      HIGH: 4,
      MEDIUM: 9,
      LOW: 5,
    })
  })

  it('returns correct totalTasks', async () => {
    const stats = await aggregateProjectStats(PROJECT_ID)
    // sum of all status counts: 5 + 3 + 10
    expect(stats.totalTasks).toBe(18)
  })

  it('returns overdue task ids', async () => {
    const stats = await aggregateProjectStats(PROJECT_ID)
    expect(stats.overdueTasks.count).toBe(2)
    expect(stats.overdueTasks.taskIds).toContain('task-overdue-1')
  })

  it('returns member workload with actor names', async () => {
    const stats = await aggregateProjectStats(PROJECT_ID)
    expect(stats.memberWorkload).toHaveLength(2)
    const actor1 = stats.memberWorkload.find(m => m.actorId === 'actor-1')
    expect(actor1).toBeDefined()
    expect(actor1?.name).toBe('clerk-user-1')
    expect(actor1?.completed).toBe(3)
    expect(actor1?.assigned).toBe(5)

    const actor2 = stats.memberWorkload.find(m => m.actorId === 'actor-2')
    expect(actor2?.name).toBe('Coding Agent')
  })

  it('returns completionTrend grouped by date', async () => {
    const stats = await aggregateProjectStats(PROJECT_ID)
    expect(stats.completionTrend.length).toBeGreaterThan(0)
    const april1 = stats.completionTrend.find(t => t.date === '2026-04-01')
    expect(april1?.completed).toBe(2)
  })

  it('returns agent stats', async () => {
    const stats = await aggregateProjectStats(PROJECT_ID)
    expect(stats.agentStats.completed).toBe(2)
    expect(stats.agentStats.failed).toBe(1)
    expect(stats.agentStats.working).toBe(1)
    expect(stats.agentStats.total).toBe(4)
  })

  it('returns pr stats', async () => {
    const stats = await aggregateProjectStats(PROJECT_ID)
    expect(stats.prStats.total).toBe(7)
    expect(stats.prStats.merged).toBe(5)
    expect(stats.prStats.open).toBe(2)
  })
})
