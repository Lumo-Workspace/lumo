import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockCreate = jest.fn()
const mockCreateMany = jest.fn()
const mockFindMany = jest.fn()
const mockAggregate = jest.fn()
// verificationRunWithdrawal.findMany is called by latestRunsByCriterion +
// latestHumanVerdictAction to fetch withdrawn action ids (LUM-586).
const mockWithdrawalFindMany = jest.fn().mockResolvedValue([])

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    verificationRun: {
      create: (...args: any[]) => mockCreate(...args),
      createMany: (...args: any[]) => mockCreateMany(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      aggregate: (...args: any[]) => mockAggregate(...args),
    },
    verificationRunWithdrawal: {
      findMany: (...args: any[]) => mockWithdrawalFindMany(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('verificationRunRepository', () => {
  describe('create', () => {
    it('maps optional fields to explicit nulls (append-only event row)', async () => {
      mockCreate.mockResolvedValue({ id: 'r-1' })

      await verificationRunRepository.create({
        taskId: 't-1',
        criterionId: 'c-1',
        round: 1,
        verifierType: 'MACHINE',
        verdict: 'FAIL',
        rejectionReason: '2 jest suites failing',
        rejectionReasonEnum: 'CRITERION_UNMET',
      })

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          taskId: 't-1',
          criterionId: 'c-1',
          round: 1,
          verifierType: 'MACHINE',
          verdict: 'FAIL',
          evidencePointer: null,
          rejectionReason: '2 jest suites failing',
          rejectionReasonEnum: 'CRITERION_UNMET',
          verdictActionId: null,
        },
        select: expect.objectContaining({ id: true, verdict: true }),
      })
    })
  })

  describe('createMany', () => {
    it('returns { count: 0 } and does not touch prisma for an empty batch', async () => {
      const result = await verificationRunRepository.createMany([])

      expect(result).toEqual({ count: 0 })
      expect(mockCreateMany).not.toHaveBeenCalled()
    })

    it('batch-appends one verdict per criterion', async () => {
      mockCreateMany.mockResolvedValue({ count: 2 })

      const result = await verificationRunRepository.createMany([
        {
          taskId: 't-1',
          criterionId: 'c-1',
          round: 1,
          verifierType: 'MACHINE',
          verdict: 'PASS',
          evidencePointer: 'jest run #42',
        },
        {
          taskId: 't-1',
          criterionId: 'c-2',
          round: 1,
          verifierType: 'MACHINE',
          verdict: 'FAIL',
        },
      ])

      expect(result).toEqual({ count: 2 })
      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            criterionId: 'c-1',
            verdict: 'PASS',
            evidencePointer: 'jest run #42',
          }),
          expect.objectContaining({
            criterionId: 'c-2',
            verdict: 'FAIL',
            evidencePointer: null,
          }),
        ],
      })
    })
  })

  describe('listByTask', () => {
    it('orders by round then arrival', async () => {
      mockFindMany.mockResolvedValue([])

      await verificationRunRepository.listByTask('t-1')

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { taskId: 't-1' },
        orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
        select: expect.objectContaining({ verdict: true, round: true }),
      })
    })
  })

  describe('listByTaskAndRound', () => {
    it('filters on the round', async () => {
      mockFindMany.mockResolvedValue([])

      await verificationRunRepository.listByTaskAndRound('t-1', 2)

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { taskId: 't-1', round: 2 },
        orderBy: { createdAt: 'asc' },
        select: expect.objectContaining({ verdict: true }),
      })
    })
  })

  describe('maxRoundByTask', () => {
    it('returns the max round (the derived "current round")', async () => {
      mockAggregate.mockResolvedValue({ _max: { round: 3 } })

      await expect(
        verificationRunRepository.maxRoundByTask('t-1')
      ).resolves.toBe(3)
      expect(mockAggregate).toHaveBeenCalledWith({
        where: { taskId: 't-1' },
        _max: { round: true },
      })
    })

    it('returns null when no verification has run yet', async () => {
      mockAggregate.mockResolvedValue({ _max: { round: null } })

      await expect(
        verificationRunRepository.maxRoundByTask('t-1')
      ).resolves.toBeNull()
    })
  })

  describe('taskIdsWithSendBack', () => {
    it('qualifies only HUMAN and AGENT FAIL verdicts', async () => {
      mockFindMany.mockResolvedValue([
        { taskId: 't-human' },
        { taskId: 't-agent' },
      ])

      const ids = await verificationRunRepository.taskIdsWithSendBack([
        't-human',
        't-agent',
        't-machine',
        't-pass',
      ])

      expect(ids).toEqual(new Set(['t-human', 't-agent']))
      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          verdict: 'FAIL',
          verifierType: { in: ['HUMAN', 'AGENT'] },
          taskId: { in: ['t-human', 't-agent', 't-machine', 't-pass'] },
        },
        select: { taskId: true },
        distinct: ['taskId'],
      })
    })

    it('returns an empty set for empty input without querying', async () => {
      const ids = await verificationRunRepository.taskIdsWithSendBack([])
      expect(ids).toEqual(new Set())
      expect(mockFindMany).not.toHaveBeenCalled()
    })

    it('omits the taskId filter when called with no argument', async () => {
      mockFindMany.mockResolvedValue([{ taskId: 't-1' }])

      await verificationRunRepository.taskIdsWithSendBack()

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { verdict: 'FAIL', verifierType: { in: ['HUMAN', 'AGENT'] } },
        select: { taskId: true },
        distinct: ['taskId'],
      })
    })
  })

  describe('latestRunsByCriterion', () => {
    it('keeps the highest-round / latest run per criterion', async () => {
      mockFindMany.mockResolvedValue([
        { criterionId: 'c-1', round: 1, verdict: 'FAIL', id: 'r-1' },
        { criterionId: 'c-2', round: 1, verdict: 'PASS', id: 'r-2' },
        // round-2 re-verification of c-1 supersedes its round-1 FAIL
        { criterionId: 'c-1', round: 2, verdict: 'PASS', id: 'r-3' },
      ])

      const result =
        await verificationRunRepository.latestRunsByCriterion('t-1')

      expect(result.get('c-1')).toEqual(
        expect.objectContaining({ id: 'r-3', verdict: 'PASS', round: 2 })
      )
      expect(result.get('c-2')).toEqual(
        expect.objectContaining({ id: 'r-2', verdict: 'PASS', round: 1 })
      )
      // ascending query order is what makes last-write-wins correct
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
        })
      )
    })
  })
})
