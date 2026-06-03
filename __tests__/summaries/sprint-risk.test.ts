/**
 * @jest-environment node
 */
import { aggregateSprintRisk } from '@/lib/summaries/stats'
import { DEFAULT_RISK_CONFIG } from '@/lib/summaries/risk'

// Routed prisma mock: the same task.findMany / task.groupBy method is called
// several times inside aggregateSprintRisk, so we branch on the `where` shape
// to return the right fixture per call.
const mocks = {
  statusGroups: [] as unknown[],
  agentGroups: [] as unknown[],
  overdue: [] as unknown[],
  stalled: [] as unknown[],
  failingAgents: [] as unknown[],
  completedRecently: [] as unknown[],
  openPrs: [] as unknown[],
}

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      groupBy: jest.fn((args: { by: string[] }) =>
        Promise.resolve(
          args.by.includes('agentStatus') ? mocks.agentGroups : mocks.statusGroups
        )
      ),
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        const where = args.where ?? {}
        if ('dueDate' in where) return Promise.resolve(mocks.overdue)
        if (where.agentStatus === 'FAILED')
          return Promise.resolve(mocks.failingAgents)
        if (where.status === 'DONE') return Promise.resolve(mocks.completedRecently)
        // stalled candidates: status notIn DONE + updatedAt cutoff
        return Promise.resolve(mocks.stalled)
      }),
    },
    pullRequest: {
      findMany: jest.fn(() => Promise.resolve(mocks.openPrs)),
    },
  },
}))

function resetMocks() {
  mocks.statusGroups = []
  mocks.agentGroups = []
  mocks.overdue = []
  mocks.stalled = []
  mocks.failingAgents = []
  mocks.completedRecently = []
  mocks.openPrs = []
}

const team = { identifier: 'ENG' }

describe('aggregateSprintRisk', () => {
  beforeEach(resetMocks)

  it('returns healthy with empty blockers when the sprint has no tasks', async () => {
    const { risk, topBlockers } = await aggregateSprintRisk(
      'sprint_1',
      DEFAULT_RISK_CONFIG
    )
    expect(risk.level).toBe('healthy')
    expect(risk.score).toBe(0)
    expect(risk.reasons).toEqual([])
    expect(topBlockers.overdueTaskIds).toEqual([])
    expect(topBlockers.stalledTaskIds).toEqual([])
    expect(topBlockers.failingAgentTaskIds).toEqual([])
    expect(topBlockers.staleOpenPrNumbers).toEqual([])
  })

  it('flags at-risk when overdue ratio is high and tasks are stalled', async () => {
    const now = new Date()
    const longAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    mocks.statusGroups = [{ status: 'TODO', _count: { _all: 4 } }]
    mocks.overdue = [
      { id: 't1', number: 1, title: 'Fix login', team },
      { id: 't2', number: 2, title: 'Wire API', team },
      { id: 't3', number: 3, title: 'Add tests', team },
      { id: 't4', number: 4, title: 'Polish UI', team },
    ]
    mocks.stalled = [
      {
        id: 't1',
        number: 1,
        title: 'Fix login',
        status: 'TODO',
        dueDate: longAgo,
        updatedAt: longAgo,
        team,
      },
      {
        id: 't2',
        number: 2,
        title: 'Wire API',
        status: 'IN_PROGRESS',
        dueDate: longAgo,
        updatedAt: longAgo,
        team,
      },
      {
        id: 't3',
        number: 3,
        title: 'Add tests',
        status: 'TODO',
        dueDate: longAgo,
        updatedAt: longAgo,
        team,
      },
    ]

    const { risk, topBlockers } = await aggregateSprintRisk(
      'sprint_1',
      DEFAULT_RISK_CONFIG
    )

    // overdue_ratio_high (4/4, weight 3) + stalled_tasks (3, weight 2) = 5 → at-risk
    expect(risk.level).toBe('at-risk')
    expect(risk.reasons.map(r => r.code)).toEqual(
      expect.arrayContaining(['overdue_ratio_high', 'stalled_tasks'])
    )
    expect(topBlockers.overdueTaskIds).toHaveLength(4)
    expect(topBlockers.overdueTaskIds[0]).toEqual({
      id: 't1',
      identifier: 'ENG-1',
      title: 'Fix login',
    })
    expect(topBlockers.stalledTaskIds).toHaveLength(3)
  })

  it('surfaces failing agents and stale PRs as blockers', async () => {
    const now = new Date()
    const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
    mocks.statusGroups = [{ status: 'IN_PROGRESS', _count: { _all: 2 } }]
    mocks.failingAgents = [
      { id: 't9', number: 9, title: 'Agent task', agentStatus: 'FAILED', team },
    ]
    mocks.openPrs = [
      { number: 12, state: 'open', createdAt: old },
      { number: 15, state: 'open', createdAt: old },
    ]

    const { topBlockers } = await aggregateSprintRisk(
      'sprint_1',
      DEFAULT_RISK_CONFIG
    )
    expect(topBlockers.failingAgentTaskIds).toEqual([
      { id: 't9', identifier: 'ENG-9', title: 'Agent task' },
    ])
    expect(topBlockers.staleOpenPrNumbers).toEqual([12, 15])
  })
})
