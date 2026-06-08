import { usageSignalService } from '@/lib/services/lineage/usage-signal.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { usageSignalAggregates: jest.fn() },
}))

it('computes distribution, variance, and discrimination', async () => {
  ;(lineageEdgeRepository.usageSignalAggregates as jest.Mock).mockResolvedValue({
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
  })
  const h = await usageSignalService.getUsageSignalHealth('ws1')
  expect(h.distribution).toEqual({ used: 6, unused: 0, abstained: 4 })
  expect(h.votedSessions).toBe(2)
  expect(h.perSessionVariance).toBeGreaterThan(0)
  expect(h.usedMergeRate).toBeCloseTo(0.5)
  expect(h.baseMergeRate).toBeCloseTo(0.25)
})

it('returns null merge rates when there are no resolved tasks', async () => {
  ;(lineageEdgeRepository.usageSignalAggregates as jest.Mock).mockResolvedValue({
    distribution: { used: 0, unused: 0, abstained: 0 },
    perSession: [],
    usedTasks: [],
    baseTasks: [],
  })
  const h = await usageSignalService.getUsageSignalHealth('ws1')
  expect(h.usedMergeRate).toBeNull()
  expect(h.baseMergeRate).toBeNull()
  expect(h.perSessionVariance).toBe(0)
})
