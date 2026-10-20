import { sprintSummaryRepository } from '@/lib/repositories/sprint-summary.repository'

const mockSprintFindUnique = jest.fn()
const mockListTasks = jest.fn()
const mockSpillover = jest.fn()
const mockLoadInputs = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    sprint: { findUnique: (...a: any[]) => mockSprintFindUnique(...a) },
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    listBySprintForStats: (...a: any[]) => mockListTasks(...a),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    listSpilloverFromSprint: (...a: any[]) => mockSpillover(...a),
  },
}))
jest.mock('@/lib/repositories/sprint-process-stages.repository', () => ({
  sprintProcessStagesRepository: {
    loadInputs: (...a: any[]) => mockLoadInputs(...a),
  },
}))

const d = (s: string) => new Date(s)

beforeEach(() => {
  jest.clearAllMocks()
  mockListTasks.mockResolvedValue([
    {
      id: 't1',
      status: 'DONE',
      priority: 'HIGH',
      assigneeActorId: 'a1',
      title: 'A',
    },
    {
      id: 't2',
      status: 'IN_PROGRESS',
      priority: 'LOW',
      assigneeActorId: null,
      title: 'B',
    },
    {
      id: 't3',
      status: 'BACKLOG',
      priority: 'LOW',
      assigneeActorId: null,
      title: 'C',
    },
  ])
  mockSpillover.mockResolvedValue([{ taskId: 'x', payload: {} }])
  mockSprintFindUnique.mockResolvedValue({
    startDate: d('2026-10-01T00:00:00Z'),
    endDate: d('2026-10-14T00:00:00Z'),
    startedAt: d('2026-10-01T00:00:00Z'),
    closedAt: d('2026-10-11T00:00:00Z'),
    team: { workspaceId: 'ws1' },
  })
  mockLoadInputs.mockResolvedValue({
    statusEvents: [
      {
        taskId: 't2',
        payload: { from: 'TODO', to: 'IN_PROGRESS' },
        createdAt: d('2026-10-09T00:00:00Z'),
      },
    ],
    crossings: [],
    pullRequests: [],
    testCases: [],
    turnEvents: [],
    crossingGateEnabled: true,
  })
})

describe('sprintSummaryRepository.computeStatsData', () => {
  it('keeps the existing keys unchanged and adds processStages + verifiedCount', async () => {
    const securityBlocking = jest.fn().mockResolvedValue(0)
    const { stats, tasks } = await sprintSummaryRepository.computeStatsData(
      's1',
      { securityBlocking }
    )
    expect(tasks.map(t => t.id)).toEqual(['t1', 't2'])
    expect(stats).toMatchObject({
      totalTasks: 3,
      done: 1,
      spillover: 1,
      byPriority: { HIGH: 1, LOW: 1 },
      byAssignee: { a1: 1, unassigned: 1 },
    })
    // Batched over the non-BACKLOG task set, scoped to the sprint's workspace.
    expect(mockLoadInputs).toHaveBeenCalledWith('ws1', ['t1', 't2'])
    // The security plane is only asked about DONE tasks.
    expect(securityBlocking).toHaveBeenCalledTimes(1)
    expect(securityBlocking).toHaveBeenCalledWith('t1')
    // t1 has no test cases → not verified (fail-closed).
    expect(stats.verifiedCount).toBe(0)
    // t2: IN_PROGRESS from 10-09 to close (10-11) = 48h of "other".
    expect(stats.processStages).toEqual({
      tasks: 1,
      stages: {
        ruling: { medianMs: null, n: 0 },
        agent: { medianMs: null, n: 0 },
        review: { medianMs: null, n: 0 },
        verification: { medianMs: null, n: 0 },
        other: { medianMs: 48 * 3_600_000, n: 1 },
      },
    })
  })

  it('omits the new keys when the sprint row is gone', async () => {
    mockSprintFindUnique.mockResolvedValue(null)
    const { stats } = await sprintSummaryRepository.computeStatsData('s1')
    expect(Object.keys(stats).sort()).toEqual([
      'byAssignee',
      'byPriority',
      'done',
      'spillover',
      'totalTasks',
    ])
  })
})
