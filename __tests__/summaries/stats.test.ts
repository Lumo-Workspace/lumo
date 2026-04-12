/**
 * @jest-environment node
 */
import { aggregateProjectStats } from '@/lib/summaries/stats'
import { DEFAULT_RISK_CONFIG } from '@/lib/summaries/risk'

// We exercise the signature only, without a real DB — mock prisma.
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    pullRequest: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    actor: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))

describe('aggregateProjectStats signature', () => {
  it('accepts a RiskConfig argument and returns risk+topBlockers in result', async () => {
    const result = await aggregateProjectStats('proj_1', DEFAULT_RISK_CONFIG)
    expect(result.risk).toBeDefined()
    expect(result.risk.level).toBe('healthy')
    expect(result.topBlockers).toBeDefined()
    expect(result.topBlockers.overdueTaskIds).toEqual([])
  })
})
