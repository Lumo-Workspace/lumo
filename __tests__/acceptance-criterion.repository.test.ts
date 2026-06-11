import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockCreateMany = jest.fn()
const mockCreate = jest.fn()
const mockFindMany = jest.fn()
const mockFindUnique = jest.fn()
const mockCount = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    acceptanceCriterion: {
      createMany: (...args: any[]) => mockCreateMany(...args),
      create: (...args: any[]) => mockCreate(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      count: (...args: any[]) => mockCount(...args),
      update: (...args: any[]) => mockUpdate(...args),
      delete: (...args: any[]) => mockDelete(...args),
    },
  },
}))

// ── Shared fixture helpers ───────────────────────────────────────────────────

const makeRow = (id: string, deletedAt: Date | null = null) => ({
  id,
  taskId: 't-1',
  statement: `criterion ${id}`,
  verifierType: 'MACHINE' as const,
  checkpointer: null,
  evidenceRequired: false,
  source: 'AGENT_DRAFT' as const,
  addedAtRound: 0,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt,
})

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('acceptanceCriterionRepository', () => {
  describe('createMany', () => {
    it('returns { count: 0 } and does not touch prisma for an empty batch', async () => {
      const result = await acceptanceCriterionRepository.createMany([])

      expect(result).toEqual({ count: 0 })
      expect(mockCreateMany).not.toHaveBeenCalled()
    })

    it('maps inputs, defaulting checkpointer to null and omitting evidenceRequired/addedAtRound so column defaults apply', async () => {
      mockCreateMany.mockResolvedValue({ count: 2 })

      const result = await acceptanceCriterionRepository.createMany([
        {
          taskId: 't-1',
          statement: 'all jest suites pass',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest',
          source: 'AGENT_DRAFT',
        },
        {
          taskId: 't-1',
          statement: 'UI copy reviewed by a human',
          verifierType: 'HUMAN',
          evidenceRequired: true,
          source: 'REVIEW_ADDED',
          addedAtRound: 2,
        },
      ])

      expect(result).toEqual({ count: 2 })
      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            taskId: 't-1',
            statement: 'all jest suites pass',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest',
            source: 'AGENT_DRAFT',
          },
          {
            taskId: 't-1',
            statement: 'UI copy reviewed by a human',
            verifierType: 'HUMAN',
            checkpointer: null,
            evidenceRequired: true,
            source: 'REVIEW_ADDED',
            addedAtRound: 2,
          },
        ],
      })
    })
  })

  describe('create', () => {
    it('inserts one criterion (the REVIEW_ADDED append path) with column defaults preserved', async () => {
      mockCreate.mockResolvedValue({ id: 'c-1' })

      await acceptanceCriterionRepository.create({
        taskId: 't-1',
        statement: 'migration is additive',
        verifierType: 'HUMAN',
        source: 'REVIEW_ADDED',
        addedAtRound: 1,
      })

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          taskId: 't-1',
          statement: 'migration is additive',
          verifierType: 'HUMAN',
          checkpointer: null,
          source: 'REVIEW_ADDED',
          addedAtRound: 1,
        },
        select: expect.objectContaining({ id: true, source: true }),
      })
    })
  })

  describe('listByTask', () => {
    it('selects only contract fields, oldest first', async () => {
      mockFindMany.mockResolvedValue([])

      await acceptanceCriterionRepository.listByTask('t-1')

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { taskId: 't-1' },
        orderBy: { createdAt: 'asc' },
        select: expect.objectContaining({
          statement: true,
          verifierType: true,
          checkpointer: true,
          evidenceRequired: true,
          source: true,
          addedAtRound: true,
        }),
      })
    })
  })

  describe('findById', () => {
    it('looks up by id with the contract select', async () => {
      mockFindUnique.mockResolvedValue(null)

      const result = await acceptanceCriterionRepository.findById('c-9')

      expect(result).toBeNull()
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: 'c-9' },
        select: expect.objectContaining({ statement: true }),
      })
    })
  })

  describe('countByTask', () => {
    it('counts a task’s criteria (soft-cap input)', async () => {
      mockCount.mockResolvedValue(8)

      await expect(
        acceptanceCriterionRepository.countByTask('t-1')
      ).resolves.toBe(8)
      expect(mockCount).toHaveBeenCalledWith({ where: { taskId: 't-1' } })
    })
  })

  describe('update', () => {
    it('patches only the provided fields', async () => {
      mockUpdate.mockResolvedValue({ id: 'c-1' })

      await acceptanceCriterionRepository.update('c-1', {
        statement: 'revised',
        source: 'HUMAN_EDIT',
      })

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { statement: 'revised', source: 'HUMAN_EDIT' },
        select: expect.objectContaining({ id: true }),
      })
    })
  })

  describe('delete', () => {
    it('deletes by id', async () => {
      mockDelete.mockResolvedValue({ id: 'c-1' })

      await acceptanceCriterionRepository.delete('c-1')

      expect(mockDelete).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        select: { id: true },
      })
    })
  })
})

// ── Soft-delete / tombstone tests ────────────────────────────────────────────

describe('acceptanceCriterionRepository tombstones (LUM-437)', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('listByTask', () => {
    it('excludes soft-deleted rows', async () => {
      const active1 = makeRow('c-1')
      const active2 = makeRow('c-2')
      // c-3 is tombstoned — listByTask must not return it
      mockFindMany.mockResolvedValue([active1, active2])

      const result = await acceptanceCriterionRepository.listByTask('t-1')

      expect(result).toHaveLength(2)
      expect(result.map(r => r.id)).toEqual(['c-1', 'c-2'])
      // The where clause must include deletedAt: null so only active rows come back
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 't-1', deletedAt: null },
        })
      )
    })
  })

  describe('listByTaskIncludingDeleted', () => {
    it('returns active + tombstoned rows, tombstone has non-null deletedAt', async () => {
      const deletedAt = new Date('2024-06-01')
      const active1 = makeRow('c-1')
      const active2 = makeRow('c-2')
      const tombstoned = makeRow('c-3', deletedAt)
      mockFindMany.mockResolvedValue([active1, active2, tombstoned])

      const result =
        await acceptanceCriterionRepository.listByTaskIncludingDeleted('t-1')

      expect(result).toHaveLength(3)
      const deleted = result.find(r => r.id === 'c-3')
      expect(deleted?.deletedAt).toEqual(deletedAt)
      // where must NOT include deletedAt filter
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 't-1' },
        })
      )
    })
  })

  describe('softDelete', () => {
    it('stamps deletedAt on the row without removing it', async () => {
      mockUpdate.mockResolvedValue({ id: 'c-1' })

      await acceptanceCriterionRepository.softDelete('c-1')

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
          select: { id: true },
        })
      )
    })
  })

  describe('countByTask', () => {
    it('counts only active (non-deleted) rows', async () => {
      mockCount.mockResolvedValue(2)

      await acceptanceCriterionRepository.countByTask('t-1')

      expect(mockCount).toHaveBeenCalledWith({
        where: { taskId: 't-1', deletedAt: null },
      })
    })
  })
})
