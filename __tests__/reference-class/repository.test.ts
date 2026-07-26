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
    verificationRunWithdrawal: { findMany: jest.fn() },
    boundaryCrossing: { findMany: jest.fn() },
    taskActivity: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { referenceClassRepository } from '@/lib/repositories/reference-class.repository'

const mockPrisma = prisma as unknown as {
  task: { findUnique: jest.Mock }
  taskCriteriaSnapshot: { findMany: jest.Mock }
  verificationRun: { findMany: jest.Mock }
  verificationRunWithdrawal: { findMany: jest.Mock }
  boundaryCrossing: { findMany: jest.Mock }
  taskActivity: { findMany: jest.Mock }
}

beforeEach(() => jest.clearAllMocks())

describe('taskScope', () => {
  it('maps nested relation names onto the flat TaskScope shape', async () => {
    // Realistic row with a milestone present, so the milestone?.name mapping
    // is genuinely exercised (not just a mocked-through null).
    mockPrisma.task.findUnique.mockResolvedValue({
      milestoneId: 'ms1',
      projectId: 'p1',
      teamId: 't1',
      milestone: { name: 'Sprint 12' },
      project: { name: 'Lumo Core' },
      team: { name: 'Platform' },
    })

    const result = await referenceClassRepository.taskScope('task1')

    const arg = mockPrisma.task.findUnique.mock.calls[0]![0]
    expect(arg.where).toEqual({ id: 'task1' })
    expect(arg.select).toEqual({
      milestoneId: true,
      projectId: true,
      teamId: true,
      milestone: { select: { name: true } },
      project: { select: { name: true } },
      team: { select: { name: true } },
    })
    expect(result).toEqual({
      milestoneId: 'ms1',
      milestoneName: 'Sprint 12',
      projectId: 'p1',
      projectName: 'Lumo Core',
      teamId: 't1',
      teamName: 'Platform',
    })
  })

  it('maps a task with no milestone to milestoneName: null', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      milestoneId: null,
      projectId: 'p1',
      teamId: 't1',
      milestone: null,
      project: { name: 'Lumo Core' },
      team: { name: 'Platform' },
    })

    const result = await referenceClassRepository.taskScope('task2')

    expect(result).toEqual({
      milestoneId: null,
      milestoneName: null,
      projectId: 'p1',
      projectName: 'Lumo Core',
      teamId: 't1',
      teamName: 'Platform',
    })
  })

  it('returns null for a missing task', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null)

    await expect(referenceClassRepository.taskScope('missing')).resolves.toBe(
      null
    )
  })
})

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

describe('deliveredByProject', () => {
  it('scopes to projectId and carries the same shape as the milestone variant', async () => {
    mockPrisma.taskCriteriaSnapshot.findMany.mockResolvedValue([])
    await referenceClassRepository.deliveredByProject('p1', 50)

    const arg = mockPrisma.taskCriteriaSnapshot.findMany.mock.calls[0]![0]
    // Pins the field name specifically — the three delivered* variants share a
    // private helper, so a copy/paste bug pointing this at the wrong relation
    // field (e.g. milestoneId or teamId) would slip past unless this asserts
    // on `projectId` by name.
    expect(arg.where).toEqual({ task: { projectId: 'p1' } })
    expect(arg.orderBy).toEqual({ frozenAt: 'desc' })
    expect(arg.distinct).toEqual(['taskId'])
    expect(arg.take).toBe(50)
  })
})

describe('deliveredByTeam', () => {
  it('scopes to teamId and carries the same shape as the milestone variant', async () => {
    mockPrisma.taskCriteriaSnapshot.findMany.mockResolvedValue([])
    await referenceClassRepository.deliveredByTeam('t1', 50)

    const arg = mockPrisma.taskCriteriaSnapshot.findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ task: { teamId: 't1' } })
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

  it('carries verdictActionId so the pure layer can drop withdrawn send-backs', async () => {
    // Whether a withdrawn verdict still counts is policy (LUM-586), decided in
    // lib/reference-class — so the query must hand the action id over rather
    // than filtering here. Without this field the exclusion is impossible.
    mockPrisma.verificationRun.findMany.mockResolvedValue([])
    await referenceClassRepository.rejectionRows(['a'])

    const arg = mockPrisma.verificationRun.findMany.mock.calls[0]![0]
    expect(arg.select).toEqual({
      taskId: true,
      rejectionReasonEnum: true,
      verdictActionId: true,
    })
  })
})

describe('withdrawnVerdictActions', () => {
  it('reads the withdrawal tombstones for the class, keyed by task', async () => {
    mockPrisma.verificationRunWithdrawal.findMany.mockResolvedValue([])
    await referenceClassRepository.withdrawnVerdictActions(['a', 'b'])

    const arg = mockPrisma.verificationRunWithdrawal.findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ taskId: { in: ['a', 'b'] } })
    // taskId travels with the action id: withdrawals are unique per
    // (taskId, verdictActionId), so the pure filter needs both to stay scoped.
    expect(arg.select).toEqual({ taskId: true, verdictActionId: true })
  })

  it('short-circuits without querying on an empty id list', async () => {
    await expect(
      referenceClassRepository.withdrawnVerdictActions([])
    ).resolves.toEqual([])
    expect(mockPrisma.verificationRunWithdrawal.findMany).not.toHaveBeenCalled()
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

  it('scopes to the given tasks WITHOUT filtering on disposition', async () => {
    // Which dispositions count is a policy decision that belongs in the pure
    // layer (crossingObservations), not here. This must fail if a disposition
    // filter is ever added to the query.
    mockPrisma.boundaryCrossing.findMany.mockResolvedValue([])
    await referenceClassRepository.crossingRows(['a', 'b'])

    const arg = mockPrisma.boundaryCrossing.findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ taskId: { in: ['a', 'b'] } })
  })

  it('short-circuits without querying on an empty id list', async () => {
    await expect(referenceClassRepository.crossingRows([])).resolves.toEqual([])
    expect(mockPrisma.boundaryCrossing.findMany).not.toHaveBeenCalled()
  })
})

describe('latestSnapshots', () => {
  it('selects criteria alongside taskId/frozenAt, one row per task', async () => {
    mockPrisma.taskCriteriaSnapshot.findMany.mockResolvedValue([])
    await referenceClassRepository.latestSnapshots(['a', 'b'])

    const arg = mockPrisma.taskCriteriaSnapshot.findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ taskId: { in: ['a', 'b'] } })
    expect(arg.select).toEqual({
      taskId: true,
      criteria: true,
      frozenAt: true,
    })
    expect(arg.orderBy).toEqual({ frozenAt: 'desc' })
    // Task 6 replays exactly one frozen snapshot per task — distinct is what
    // guarantees that collapse.
    expect(arg.distinct).toEqual(['taskId'])
  })

  it('short-circuits without querying on an empty id list', async () => {
    await expect(referenceClassRepository.latestSnapshots([])).resolves.toEqual(
      []
    )
    expect(mockPrisma.taskCriteriaSnapshot.findMany).not.toHaveBeenCalled()
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

  it('short-circuits without querying on an empty id list', async () => {
    await expect(
      referenceClassRepository.criterionChanges([])
    ).resolves.toEqual([])
    expect(mockPrisma.taskActivity.findMany).not.toHaveBeenCalled()
  })
})
