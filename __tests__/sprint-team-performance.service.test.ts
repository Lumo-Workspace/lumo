// Mocks must be declared before any imports that reference the mocked modules.

const mockTaskRows = jest.fn()
const mockLoadMemberActuals = jest.fn()
const mockLabelsByIds = jest.fn()

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    taskRowsForPerformance: (...a: unknown[]) => mockTaskRows(...a),
  },
}))

jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadMemberActualRowsForTasks: (...a: unknown[]) =>
      mockLoadMemberActuals(...a),
  },
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    labelsByIds: (...a: unknown[]) => mockLabelsByIds(...a),
  },
}))

import { sprintTeamPerformanceService } from '@/lib/services/sprint-team-performance.service'

beforeEach(() => jest.clearAllMocks())

describe('sprintTeamPerformanceService.getForSprint', () => {
  test('wires task rows + actual rows + labels into the fold', async () => {
    mockTaskRows.mockResolvedValue([
      {
        id: 't1',
        identifier: 'LUM-1',
        title: 'First',
        status: 'DONE',
        priority: 'HIGH',
        updatedAt: new Date('2026-07-15T00:00:00Z'),
      },
    ])
    mockLoadMemberActuals.mockResolvedValue({
      sessions: [
        {
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          usageByModel: null,
        },
      ],
      turnEvents: [],
    })
    mockLabelsByIds.mockResolvedValue(new Map([['mA', 'Alice']]))

    const out = await sprintTeamPerformanceService.getForSprint('sprint-1')

    expect(mockTaskRows).toHaveBeenCalledWith('sprint-1')
    expect(mockLoadMemberActuals).toHaveBeenCalledWith(['t1'])
    // Only the distinct non-null member ids are resolved to labels.
    expect(mockLabelsByIds).toHaveBeenCalledWith(['mA'])
    expect(out.measuredTasks).toBe(1)
    expect(out.totalTokenCost).toBe(150)
    const alice = out.rows.find(r => r.memberId === 'mA')!
    expect(alice.label).toBe('Alice')
    expect(alice.tasksDone).toBe(1)
    expect(alice.perTask[0]!.identifier).toBe('LUM-1')
  })

  test('empty sprint → no labels resolved, null token total', async () => {
    mockTaskRows.mockResolvedValue([])
    mockLoadMemberActuals.mockResolvedValue({ sessions: [], turnEvents: [] })
    mockLabelsByIds.mockResolvedValue(new Map())

    const out = await sprintTeamPerformanceService.getForSprint('empty')

    expect(mockLoadMemberActuals).toHaveBeenCalledWith([])
    expect(mockLabelsByIds).toHaveBeenCalledWith([])
    expect(out.rows).toEqual([])
    expect(out.totalTokenCost).toBeNull()
  })
})
