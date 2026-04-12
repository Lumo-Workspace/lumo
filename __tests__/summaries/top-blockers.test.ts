import { collectTopBlockers, DEFAULT_RISK_CONFIG } from '@/lib/summaries/risk'

const NOW = new Date('2026-04-11T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

describe('collectTopBlockers', () => {
  it('returns empty groups when nothing triggers', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })
    expect(result).toEqual({
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
    })
  })

  it('collects overdue tasks (dueDate < now && status != DONE)', () => {
    const result = collectTopBlockers({
      tasks: [
        {
          id: 't1',
          status: 'IN_PROGRESS',
          dueDate: daysAgo(2),
          updatedAt: daysAgo(1),
        },
        {
          id: 't2',
          status: 'DONE',
          dueDate: daysAgo(5),
          updatedAt: daysAgo(1),
        },
        {
          id: 't3',
          status: 'TODO',
          dueDate: null,
          updatedAt: daysAgo(1),
        },
      ],
      agents: [],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })
    expect(result.overdueTaskIds).toEqual(['t1'])
  })

  it('collects stalled tasks (not DONE/CANCELLED and updatedAt older than stalledDays)', () => {
    const result = collectTopBlockers({
      tasks: [
        {
          id: 'a',
          status: 'IN_PROGRESS',
          dueDate: null,
          updatedAt: daysAgo(10),
        },
        { id: 'b', status: 'TODO', dueDate: null, updatedAt: daysAgo(3) },
        { id: 'c', status: 'DONE', dueDate: null, updatedAt: daysAgo(20) },
      ],
      agents: [],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG, // stalledDays = 7
    })
    expect(result.stalledTaskIds).toEqual(['a'])
  })

  it('collects failing agent task ids', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [
        { taskId: 'x', agentStatus: 'FAILED' },
        { taskId: 'y', agentStatus: 'COMPLETED' },
        { taskId: 'z', agentStatus: 'FAILED' },
      ],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })
    expect(result.failingAgentTaskIds).toEqual(['x', 'z'])
  })

  it('collects stale open PR numbers by age', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [],
      prs: [
        { number: 1, state: 'open', createdAt: daysAgo(5) },
        { number: 2, state: 'open', createdAt: daysAgo(1) },
        { number: 3, state: 'merged', createdAt: daysAgo(30) },
      ],
      now: NOW,
      config: DEFAULT_RISK_CONFIG, // stalePrDays = 3
    })
    expect(result.staleOpenPrNumbers).toEqual([1])
  })

  it('caps each group at 10 items', () => {
    const tasks = Array.from({ length: 15 }, (_, i) => ({
      id: `t${i}`,
      status: 'IN_PROGRESS',
      dueDate: daysAgo(2),
      updatedAt: daysAgo(1),
    }))
    const result = collectTopBlockers({
      tasks,
      agents: [],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })
    expect(result.overdueTaskIds).toHaveLength(10)
  })
})
