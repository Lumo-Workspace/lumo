/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { taskRefs: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { listStatesByTaskIds: jest.fn() },
}))
jest.mock('@/lib/repositories/task-complexity.repository', () => ({
  taskComplexityRepository: { listByTaskIds: jest.fn() },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: { loadMemberActualRowsForTasks: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { labelsByIds: jest.fn() },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskComplexityRepository } from '@/lib/repositories/task-complexity.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

const taskRefs = milestoneRepository.taskRefs as jest.Mock
const listStates = pullRequestRepository.listStatesByTaskIds as jest.Mock
const listComplexity = taskComplexityRepository.listByTaskIds as jest.Mock
const loadMemberRows =
  retrospectiveRepository.loadMemberActualRowsForTasks as jest.Mock
const labelsByIds = memberRepository.labelsByIds as jest.Mock

beforeEach(() => {
  taskRefs.mockReset()
  listStates.mockReset()
  listComplexity.mockReset()
  loadMemberRows.mockReset()
  labelsByIds.mockReset()
})

describe('milestoneService.getDeliveryStatsForMilestone', () => {
  it('fans the member task set through the batch queries and folds honest buckets', async () => {
    taskRefs.mockResolvedValue([
      { id: 't1', ref: 'LUM-1', title: 'First' },
      { id: 't2', ref: 'LUM-2', title: 'Second' },
    ])
    listStates.mockResolvedValue([
      { taskId: 't1', state: 'merged' },
      { taskId: 't1', state: 'merged' },
    ])
    listComplexity.mockResolvedValue([{ taskId: 't1', changedFileCount: 7 }])
    loadMemberRows.mockResolvedValue({
      sessions: [
        {
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      ],
      turnEvents: [],
    })
    labelsByIds.mockResolvedValue(new Map([['mA', 'Alice']]))

    const stats = await milestoneService.getDeliveryStatsForMilestone('m-1')

    expect(taskRefs).toHaveBeenCalledWith('m-1')
    expect(listStates).toHaveBeenCalledWith(['t1', 't2'])
    expect(listComplexity).toHaveBeenCalledWith(['t1', 't2'])
    expect(loadMemberRows).toHaveBeenCalledWith(['t1', 't2'])
    // Labels resolved only for the distinct non-null attribution keys.
    expect(labelsByIds).toHaveBeenCalledWith(['mA'])

    expect(stats.pr).toEqual({
      mergedPrCount: 2,
      multiPrTaskCount: 1,
      linkedTaskCount: 1,
      unlinkedTaskCount: 1,
      totalTasks: 2,
    })
    expect(stats.changedFiles).toEqual({
      total: 7,
      measuredTasks: 1,
      totalTasks: 2,
    })
    expect(stats.perMember.tokenCost).toBe(15)
    expect(stats.perMember.rows).toEqual([
      {
        memberId: 'mA',
        label: 'Alice',
        tokenCost: 15,
        activeTimeSec: 0,
        // The mocked PR rows carry no volume columns → unsynced, fail-closed.
        changeVolume: null,
        // No usageByModel map in the mocked session rows → no model split,
        // the spend reads as the explicit unattributed remainder.
        models: [],
        modelUnattributedTokens: 15,
      },
    ])
    expect(stats.changeVolume).toEqual({
      additions: null,
      deletions: null,
      changedFiles: null,
      measuredPrs: 0,
      totalMergedPrs: 2,
    })

    // LUM-727 BY TASK rows: labelled from the same task set, and only for
    // tasks that carry a signal — t2 has neither spend nor a PR, so it is
    // absent rather than rendered as a fabricated zero.
    expect(stats.perTask.rows).toEqual([
      {
        taskId: 't1',
        ref: 'LUM-1',
        title: 'First',
        tokenCost: 15,
        models: [],
        modelUnattributedTokens: 15,
        activeTimeSec: 0,
        prCount: 2,
        multiPr: true,
        changeVolume: null,
      },
    ])
    expect(stats.perTask.unattributedActiveTimeSec).toBe(0)
  })
})
