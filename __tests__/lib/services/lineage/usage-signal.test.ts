import { usageSignalService } from '@/lib/services/lineage/usage-signal.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { usageSignalAggregates: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: { taskIdsWithSendBack: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    countSpinoffsForWorkspace: jest.fn(),
    taskIdsWithMarkers: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { taskIdsWithCategory: jest.fn() },
}))

import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

beforeEach(() => {
  ;(
    verificationRunRepository.taskIdsWithSendBack as jest.Mock
  ).mockResolvedValue(new Set())
  ;(
    activityRepository.countSpinoffsForWorkspace as jest.Mock
  ).mockResolvedValue(0)
  ;(activityRepository.taskIdsWithMarkers as jest.Mock).mockResolvedValue(
    new Set()
  )
  ;(
    boundaryCrossingRepository.taskIdsWithCategory as jest.Mock
  ).mockResolvedValue(new Set())
})

it('computes distribution, variance, and discrimination', async () => {
  ;(lineageEdgeRepository.usageSignalAggregates as jest.Mock).mockResolvedValue(
    {
      distribution: { used: 6, unused: 0, abstained: 4 },
      perSession: [
        { sessionId: 's1', injected: 3, used: 3 },
        { sessionId: 's2', injected: 7, used: 3 },
      ],
      usedTasks: [
        { taskId: 't1', resolved: true, merged: true },
        { taskId: 't2', resolved: true, merged: false },
      ],
      baseTasks: [
        { taskId: 't1', resolved: true, merged: true },
        { taskId: 't2', resolved: true, merged: false },
        { taskId: 't3', resolved: true, merged: false },
        { taskId: 't4', resolved: true, merged: false },
      ],
    }
  )
  const h = await usageSignalService.getUsageSignalHealth('ws1')
  expect(h.distribution).toEqual({ used: 6, unused: 0, abstained: 4 })
  expect(h.votedSessions).toBe(2)
  expect(h.perSessionVariance).toBeGreaterThan(0)
  expect(h.usedMergeRate).toBeCloseTo(0.5)
  expect(h.baseMergeRate).toBeCloseTo(0.25)
})

it('returns null merge rates when there are no resolved tasks', async () => {
  ;(lineageEdgeRepository.usageSignalAggregates as jest.Mock).mockResolvedValue(
    {
      distribution: { used: 0, unused: 0, abstained: 0 },
      perSession: [],
      usedTasks: [],
      baseTasks: [],
    }
  )
  const h = await usageSignalService.getUsageSignalHealth('ws1')
  expect(h.usedMergeRate).toBeNull()
  expect(h.baseMergeRate).toBeNull()
  expect(h.perSessionVariance).toBe(0)
})

describe('getUsageSignalHealth iteration-taint', () => {
  it('recounts a merged task with a send-back as non-merged in both used and base folds', async () => {
    ;(
      lineageEdgeRepository.usageSignalAggregates as jest.Mock
    ).mockResolvedValue({
      distribution: { used: 4, unused: 0, abstained: 0 },
      perSession: [],
      usedTasks: [
        { taskId: 't1', resolved: true, merged: true },
        { taskId: 't2', resolved: true, merged: true },
      ],
      baseTasks: [
        { taskId: 't1', resolved: true, merged: true },
        { taskId: 't2', resolved: true, merged: true },
        { taskId: 't3', resolved: true, merged: true },
        { taskId: 't4', resolved: true, merged: true },
      ],
    })
    ;(
      verificationRunRepository.taskIdsWithSendBack as jest.Mock
    ).mockResolvedValue(new Set(['t2', 't4']))

    const h = await usageSignalService.getUsageSignalHealth('ws1')

    // base: 4 resolved, t2 & t4 tainted → 2 merged → 0.5; 2 in the negative class
    expect(h.baseMergeRate).toBeCloseTo(0.5)
    expect(h.baseResolvedTasks).toBe(4)
    expect(h.baseFailedTasks).toBe(2)
    // used: 2 resolved, t2 tainted → 1 merged → 0.5; taint applied to the used fold too
    expect(h.usedMergeRate).toBeCloseTo(0.5)
    expect(h.usedResolvedTasks).toBe(2)
    expect(h.usedFailedTasks).toBe(1)
  })
})

it('includes the raw spinoff count', async () => {
  ;(lineageEdgeRepository.usageSignalAggregates as jest.Mock).mockResolvedValue(
    {
      distribution: { used: 0, unused: 0, abstained: 0 },
      perSession: [],
      usedTasks: [],
      baseTasks: [],
    }
  )
  ;(
    activityRepository.countSpinoffsForWorkspace as jest.Mock
  ).mockResolvedValue(3)
  const h = await usageSignalService.getUsageSignalHealth('ws1')
  expect(h.spinoffsDuringInFlight).toBe(3)
})

it('folds judge-confirmed laundering markers + CONTRACT_WEAKENING into the negative class', async () => {
  ;(lineageEdgeRepository.usageSignalAggregates as jest.Mock).mockResolvedValue(
    {
      distribution: { used: 2, unused: 0, abstained: 0 },
      perSession: [],
      usedTasks: [
        { taskId: 't1', resolved: true, merged: true },
        { taskId: 't2', resolved: true, merged: true },
      ],
      baseTasks: [
        { taskId: 't1', resolved: true, merged: true },
        { taskId: 't2', resolved: true, merged: true },
      ],
    }
  )
  // No HUMAN/AGENT send-backs, but both tasks carry a judge-confirmed laundering
  // crossing (spinoff / silent-fix / contract-weakening) → folded into the negative class.
  ;(
    boundaryCrossingRepository.taskIdsWithCategory as jest.Mock
  ).mockResolvedValue(new Set(['t1', 't2']))

  const h = await usageSignalService.getUsageSignalHealth('ws1')
  // Both resolved tasks are tainted as failed → merge rate 0, failed 2.
  expect(h.baseMergeRate).toBe(0)
  expect(h.baseFailedTasks).toBe(2)
})
