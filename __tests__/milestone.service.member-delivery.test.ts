/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { memberDeliveryRows: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { listStatesByTaskIds: jest.fn() },
}))
jest.mock('@/lib/repositories/task-complexity.repository', () => ({
  taskComplexityRepository: { listByTaskIds: jest.fn() },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: { loadSessionTokenRowsForTasks: jest.fn() },
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

const memberDeliveryRows = milestoneRepository.memberDeliveryRows as jest.Mock
const listStates = pullRequestRepository.listStatesByTaskIds as jest.Mock
const listComplexity = taskComplexityRepository.listByTaskIds as jest.Mock
const loadSessionRows =
  retrospectiveRepository.loadSessionTokenRowsForTasks as jest.Mock
const labelsByIds = memberRepository.labelsByIds as jest.Mock

beforeEach(() => {
  memberDeliveryRows.mockReset()
  listStates.mockReset()
  listComplexity.mockReset()
  loadSessionRows.mockReset()
  labelsByIds.mockReset()
})

describe('milestoneService.getMemberDeliveryForMilestone', () => {
  it('fans the member tasks through the batch queries and folds assignee-attributed rows', async () => {
    memberDeliveryRows.mockResolvedValue({
      tasks: [
        {
          id: 't1',
          number: 1,
          title: 'T1',
          status: 'DONE',
          claimSnapshot: 'shipped X',
          claimSnapshotSource: 'AGENT',
          team: { identifier: 'LUM' },
          assignee: { type: 'HUMAN', memberId: 'mA', agent: null },
        },
        {
          id: 't2',
          number: 2,
          title: 'T2',
          status: 'DONE',
          claimSnapshot: null,
          claimSnapshotSource: null,
          team: { identifier: 'LUM' },
          // Shared agent → folds to the task's top token spender (mB).
          assignee: {
            type: 'AGENT',
            memberId: null,
            agent: { memberId: null },
          },
        },
      ],
      signalCounts: [{ taskId: 't1', kind: 'REVERTED', count: 1 }],
    })
    listStates.mockResolvedValue([{ taskId: 't1', state: 'merged' }])
    listComplexity.mockResolvedValue([{ taskId: 't1', changedFileCount: 4 }])
    loadSessionRows.mockResolvedValue([
      {
        taskId: 't2',
        workspaceMemberId: 'mB',
        inputTokens: 0,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ])
    labelsByIds.mockResolvedValue(
      new Map([
        ['mA', 'Alice'],
        ['mB', 'Bob'],
      ])
    )

    const out = await milestoneService.getMemberDeliveryForMilestone('m-1')

    expect(memberDeliveryRows).toHaveBeenCalledWith('m-1')
    expect(listStates).toHaveBeenCalledWith(['t1', 't2'])
    expect(listComplexity).toHaveBeenCalledWith(['t1', 't2'])
    expect(loadSessionRows).toHaveBeenCalledWith(['t1', 't2'])
    // Labels cover assignee members AND the shared-agent fold candidates.
    expect(labelsByIds).toHaveBeenCalledWith(['mA', 'mB'])

    expect(out.rows.map(r => [r.bucket, r.label, r.doneCount])).toEqual([
      ['member', 'Alice', 1],
      ['member', 'Bob', 1],
    ])
    const alice = out.rows[0]!
    expect(alice).toMatchObject({
      memberId: 'mA',
      mergedPrCount: 1,
      fate: { rejectedTaskCount: 1, noRecordDoneCount: 0 },
      friction: { multiPrTaskCount: 0 },
      changedFiles: { total: 4, measuredTasks: 1 },
      claims: [
        {
          taskId: 't1',
          ref: 'LUM-1',
          title: 'T1',
          claim: 'shipped X',
          source: 'AGENT',
        },
      ],
    })
    // Bob's shared-agent task has no complexity row → fail-closed null,
    // and its missing claim stays visible as an explicit no-claim row.
    expect(out.rows[1]!).toMatchObject({
      changedFiles: { total: null, measuredTasks: 0 },
      claims: [
        { taskId: 't2', ref: 'LUM-2', title: 'T2', claim: null, source: null },
      ],
    })
  })
})
