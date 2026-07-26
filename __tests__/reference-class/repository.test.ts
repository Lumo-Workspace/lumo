/**
 * LUM-497 — reference-class repository. Prisma is mocked; these tests pin the
 * QUERY SHAPE (filters, ordering, distinct, take), which is where a silent
 * wrong-scope bug would live.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
    taskCriteriaSnapshot: { findMany: jest.fn() },
    verificationRun: { findMany: jest.fn() },
    boundaryCrossing: { findMany: jest.fn() },
    taskActivity: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { referenceClassRepository } from '@/lib/repositories/reference-class.repository'

const mockPrisma = prisma as unknown as {
  taskCriteriaSnapshot: { findMany: jest.Mock }
  verificationRun: { findMany: jest.Mock }
  boundaryCrossing: { findMany: jest.Mock }
  taskActivity: { findMany: jest.Mock }
}

beforeEach(() => jest.clearAllMocks())

describe('deliveredByMilestone', () => {
  it('takes the most recent deliveries, one row per task', async () => {
    mockPrisma.taskCriteriaSnapshot.findMany.mockResolvedValue([])
    await referenceClassRepository.deliveredByMilestone('m1', 50)

    const arg = mockPrisma.taskCriteriaSnapshot.findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ task: { milestoneId: 'm1' } })
    expect(arg.orderBy).toEqual({ frozenAt: 'desc' })
    expect(arg.distinct).toEqual(['taskId'])
    expect(arg.take).toBe(50)
  })
})

describe('rejectionRows', () => {
  it('short-circuits without querying on an empty id list', async () => {
    await expect(referenceClassRepository.rejectionRows([])).resolves.toEqual(
      []
    )
    expect(mockPrisma.verificationRun.findMany).not.toHaveBeenCalled()
  })

  it('scopes to the given tasks and only reads FAIL runs', async () => {
    mockPrisma.verificationRun.findMany.mockResolvedValue([])
    await referenceClassRepository.rejectionRows(['a', 'b'])

    const arg = mockPrisma.verificationRun.findMany.mock.calls[0]![0]
    expect(arg.where.taskId).toEqual({ in: ['a', 'b'] })
    expect(arg.where.verdict).toBe('FAIL')
  })
})

describe('crossingRows', () => {
  it('returns the disposition so the pure layer can filter it', async () => {
    mockPrisma.boundaryCrossing.findMany.mockResolvedValue([])
    await referenceClassRepository.crossingRows(['a'])

    const arg = mockPrisma.boundaryCrossing.findMany.mock.calls[0]![0]
    expect(arg.select).toEqual({
      taskId: true,
      category: true,
      disposition: true,
    })
  })
})

describe('criterionChanges', () => {
  it('reads only CRITERION_CHANGED activities for the class', async () => {
    mockPrisma.taskActivity.findMany.mockResolvedValue([])
    await referenceClassRepository.criterionChanges(['a'])

    const arg = mockPrisma.taskActivity.findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({
      taskId: { in: ['a'] },
      type: 'CRITERION_CHANGED',
    })
  })
})
