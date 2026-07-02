/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { costTrendRows: jest.fn() },
}))
jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: { findByIds: jest.fn() },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: { loadActualsForTasks: jest.fn() },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

const costTrendRows = milestoneRepository.costTrendRows as jest.Mock
const findByIds = sprintRepository.findByIds as jest.Mock
const loadActualsForTasks =
  retrospectiveRepository.loadActualsForTasks as jest.Mock

beforeEach(() => {
  costTrendRows.mockReset()
  findByIds.mockReset()
  loadActualsForTasks.mockReset()
})

describe('milestoneService.getCostTrendForMilestone', () => {
  it('rolls up actuals over the member task set and replays the burnup', async () => {
    costTrendRows.mockResolvedValue({
      tasks: [
        {
          id: 't1',
          status: 'DONE',
          createdAt: new Date('2026-01-04T00:00:00Z'),
          sprintId: 's1',
        },
        {
          id: 't2',
          status: 'TODO',
          createdAt: new Date('2026-01-05T00:00:00Z'),
          sprintId: 's1',
        },
        {
          id: 't3',
          status: 'TODO',
          createdAt: new Date('2026-01-05T00:00:00Z'),
          sprintId: null,
        },
      ],
      activities: [],
    })
    findByIds.mockResolvedValue([
      {
        id: 's1',
        number: 1,
        name: 'Sprint 1',
        status: 'CLOSED',
        startDate: new Date('2026-01-05T00:00:00Z'),
        endDate: new Date('2026-01-09T00:00:00Z'),
      },
    ])
    loadActualsForTasks.mockResolvedValue({
      tokenCost: 500,
      activeTimeSec: 120,
      measuredTasks: 2,
      models: [
        {
          model: 'claude-opus-4-5',
          input: 100,
          output: 200,
          cacheRead: 50,
          cacheCreation: 50,
          total: 400,
        },
      ],
      modelUnattributedTokens: 100,
    })

    const result = await milestoneService.getCostTrendForMilestone(
      'm-1',
      'team-1'
    )

    // Cost rollup passes the actuals through and adds the coverage denominator.
    expect(result.costRollup).toEqual({
      tokenCost: 500,
      activeTimeSec: 120,
      measuredTasks: 2,
      totalTasks: 3,
      models: [
        {
          model: 'claude-opus-4-5',
          input: 100,
          output: 200,
          cacheRead: 50,
          cacheCreation: 50,
          total: 400,
        },
      ],
      modelUnattributedTokens: 100,
    })
    // Every member task feeds the batched actuals — including unsprinted ones.
    expect(loadActualsForTasks).toHaveBeenCalledWith(['t1', 't2', 't3'])
    // Sprint windows resolve deduped sprint ids against the caller's team.
    expect(findByIds).toHaveBeenCalledWith(['s1'], 'team-1')
    // The burnup replay rides the same fetch.
    expect(result.burnup.scopeTotal).toBe(3)
    expect(result.burnup.sprintWindows).toEqual([
      {
        sprintId: 's1',
        number: 1,
        name: 'Sprint 1',
        start: '2026-01-05',
        end: '2026-01-09',
      },
    ])
    expect(result.burnup.start).toBe('2026-01-04')
  })

  it('propagates the fail-closed null token cost for an unmeasured milestone', async () => {
    costTrendRows.mockResolvedValue({ tasks: [], activities: [] })
    findByIds.mockResolvedValue([])
    loadActualsForTasks.mockResolvedValue({
      tokenCost: null,
      activeTimeSec: 0,
      measuredTasks: 0,
      models: [],
      modelUnattributedTokens: 0,
    })

    const result = await milestoneService.getCostTrendForMilestone(
      'm-1',
      'team-1'
    )
    expect(result.costRollup).toEqual({
      tokenCost: null,
      activeTimeSec: 0,
      measuredTasks: 0,
      totalTasks: 0,
      models: [],
      modelUnattributedTokens: 0,
    })
    expect(result.burnup.series).toEqual([])
  })
})
