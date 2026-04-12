jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspace: { findUnique: jest.fn() },
    project: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))

jest.mock('@/lib/summaries/stats', () => ({
  aggregateProjectStats: jest.fn(),
  aggregateWorkspaceStats: jest.fn(),
}))

jest.mock('@/lib/summaries/risk', () => ({
  resolveEffectiveRiskConfig: jest.fn().mockReturnValue({
    overdueRatio: 0.25,
    stalledDays: 7,
    stalledMinCount: 3,
    agentFailRatio: 0.3,
    stalePrDays: 3,
    throughputDrop: 0.5,
  }),
}))

import {
  getProjectStats,
  getWorkspaceStats,
} from '@/lib/services/stats.service'
import { prisma } from '@/lib/db/prisma'
import { aggregateProjectStats } from '@/lib/summaries/stats'
import { resolveEffectiveRiskConfig } from '@/lib/summaries/risk'

const asMock = (fn: unknown): jest.Mock => fn as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('getProjectStats', () => {
  it('resolves effective config and returns aggregated stats', async () => {
    asMock(prisma.project.findUnique).mockResolvedValue({
      id: 'proj-1',
      riskOverdueRatio: null,
      riskStalledDays: null,
      riskStalledMinCount: null,
      riskAgentFailRatio: null,
      riskStalePrDays: null,
      riskThroughputDrop: null,
    })
    asMock(prisma.workspace.findUnique).mockResolvedValue({
      id: 'ws-1',
      riskOverdueRatio: 0.25,
      riskStalledDays: 7,
      riskStalledMinCount: 3,
      riskAgentFailRatio: 0.3,
      riskStalePrDays: 3,
      riskThroughputDrop: 0.5,
    })
    const mockStats = { totalTasks: 10 }
    asMock(aggregateProjectStats).mockResolvedValue(mockStats)

    const result = await getProjectStats('proj-1', 'ws-1')

    expect(resolveEffectiveRiskConfig).toHaveBeenCalled()
    expect(aggregateProjectStats).toHaveBeenCalledWith(
      'proj-1',
      expect.any(Object)
    )
    expect(result).toEqual(mockStats)
  })

  it('throws if project not found', async () => {
    asMock(prisma.project.findUnique).mockResolvedValue(null)
    asMock(prisma.workspace.findUnique).mockResolvedValue({ id: 'ws-1' })

    await expect(getProjectStats('bad', 'ws-1')).rejects.toThrow(
      'Project not found'
    )
  })
})
