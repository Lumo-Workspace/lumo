/**
 * @jest-environment node
 */
import { aggregateProjectStats } from '@/lib/summaries/stats'

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
  it('takes only a project id and returns topBlockers in result', async () => {
    const result = await aggregateProjectStats('proj_1')
    expect(result.topBlockers).toBeDefined()
    expect(result.topBlockers.overdueTaskIds).toEqual([])
    expect(result).not.toHaveProperty('risk')
  })
})
