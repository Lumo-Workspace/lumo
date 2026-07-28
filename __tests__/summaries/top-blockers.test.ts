import { collectTopBlockers } from '@/lib/summaries/top-blockers'

const NOW = new Date('2026-04-11T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

describe('collectTopBlockers', () => {
  it('returns empty groups when nothing triggers', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [],
      prs: [],
      now: NOW,
    })
    expect(result).toEqual({
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
      staleOpenPrs: [],
      highStakesTaskIds: [],
    })
  })

  it('collects overdue tasks (dueDate < now && status != DONE)', () => {
    const result = collectTopBlockers({
      tasks: [
        {
          id: 't1',
          identifier: 'LUM-1',
          title: 'Fix login bug',
          status: 'IN_PROGRESS',
          priority: 'MEDIUM' as const,
          dueDate: daysAgo(2),
          updatedAt: daysAgo(1),
        },
        {
          id: 't2',
          identifier: 'LUM-2',
          title: 'Update docs',
          status: 'DONE',
          priority: 'MEDIUM' as const,
          dueDate: daysAgo(5),
          updatedAt: daysAgo(1),
        },
        {
          id: 't3',
          identifier: 'LUM-3',
          title: 'Add tests',
          status: 'TODO',
          priority: 'MEDIUM' as const,
          dueDate: null,
          updatedAt: daysAgo(1),
        },
      ],
      agents: [],
      prs: [],
      now: NOW,
    })
    expect(result.overdueTaskIds).toEqual([
      { id: 't1', identifier: 'LUM-1', title: 'Fix login bug' },
    ])
  })

  it('collects stalled tasks (not DONE/CANCELLED and updatedAt older than stalledDays)', () => {
    const result = collectTopBlockers({
      tasks: [
        {
          id: 'a',
          identifier: 'LUM-4',
          title: 'Stalled task',
          status: 'IN_PROGRESS',
          priority: 'MEDIUM' as const,
          dueDate: null,
          updatedAt: daysAgo(10),
        },
        {
          id: 'b',
          identifier: 'LUM-5',
          title: 'Recent task',
          status: 'TODO',
          priority: 'MEDIUM' as const,
          dueDate: null,
          updatedAt: daysAgo(3),
        },
        {
          id: 'c',
          identifier: 'LUM-6',
          title: 'Done task',
          status: 'DONE',
          priority: 'MEDIUM' as const,
          dueDate: null,
          updatedAt: daysAgo(20),
        },
      ],
      agents: [],
      prs: [],
      now: NOW, // stalledDays = 7
    })
    expect(result.stalledTaskIds).toEqual([
      {
        id: 'a',
        identifier: 'LUM-4',
        title: 'Stalled task',
        priority: 'MEDIUM',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ])
  })

  it('collects failing agent task ids', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [
        {
          taskId: 'x',
          identifier: 'LUM-7',
          title: 'Agent task X',
          agentStatus: 'FAILED',
        },
        {
          taskId: 'y',
          identifier: 'LUM-8',
          title: 'Agent task Y',
          agentStatus: 'COMPLETED',
        },
        {
          taskId: 'z',
          identifier: 'LUM-9',
          title: 'Agent task Z',
          agentStatus: 'FAILED',
        },
      ],
      prs: [],
      now: NOW,
    })
    expect(result.failingAgentTaskIds).toEqual([
      { id: 'x', identifier: 'LUM-7', title: 'Agent task X' },
      { id: 'z', identifier: 'LUM-9', title: 'Agent task Z' },
    ])
  })

  it('collects stale open PR numbers by age', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [],
      prs: [
        {
          number: 1,
          state: 'open',
          createdAt: daysAgo(5),
          url: 'https://github.com/o/r/pull/1',
        },
        {
          number: 2,
          state: 'open',
          createdAt: daysAgo(1),
          url: 'https://github.com/o/r/pull/2',
        },
        {
          number: 3,
          state: 'merged',
          createdAt: daysAgo(30),
          url: 'https://github.com/o/r/pull/3',
        },
      ],
      now: NOW, // stalePrDays = 3
    })
    expect(result.staleOpenPrNumbers).toEqual([1])
  })

  it('caps each group at 10 items', () => {
    const tasks = Array.from({ length: 15 }, (_, i) => ({
      id: `t${i}`,
      identifier: `LUM-${i}`,
      title: `Task ${i}`,
      status: 'IN_PROGRESS',
      priority: 'MEDIUM' as const,
      dueDate: daysAgo(2),
      updatedAt: daysAgo(1),
    }))
    const result = collectTopBlockers({
      tasks,
      agents: [],
      prs: [],
      now: NOW,
    })
    expect(result.overdueTaskIds).toHaveLength(10)
  })
})
