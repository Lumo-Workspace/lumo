import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockCreateMany = jest.fn()
const mockGroupBy = jest.fn()
const mockFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    lineageEdge: {
      createMany: (...args: any[]) => mockCreateMany(...args),
      groupBy: (...args: any[]) => mockGroupBy(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('lineageEdgeRepository', () => {
  describe('createMany', () => {
    it('returns { count: 0 } and does not touch prisma for an empty batch', async () => {
      const result = await lineageEdgeRepository.createMany([])

      expect(result).toEqual({ count: 0 })
      expect(mockCreateMany).not.toHaveBeenCalled()
    })

    it('maps inputs, defaulting sessionId/runId to null and omitting outcome', async () => {
      mockCreateMany.mockResolvedValue({ count: 2 })

      const result = await lineageEdgeRepository.createMany([
        {
          workspaceId: 'ws-1',
          taskId: 't-1',
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
        },
        {
          workspaceId: 'ws-1',
          taskId: 't-1',
          fragmentType: 'PR_REVIEW_TODO',
          fragmentId: 'todo-9',
          sessionId: 'sess-1',
          runId: 'run-1',
        },
      ])

      expect(result).toEqual({ count: 2 })
      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            workspaceId: 'ws-1',
            taskId: 't-1',
            fragmentType: 'MEMORY',
            fragmentId: 'mem-1',
            sessionId: null,
            runId: null,
          },
          {
            workspaceId: 'ws-1',
            taskId: 't-1',
            fragmentType: 'PR_REVIEW_TODO',
            fragmentId: 'todo-9',
            sessionId: 'sess-1',
            runId: 'run-1',
          },
        ],
      })
    })

    it('passes outcome through when explicitly provided', async () => {
      mockCreateMany.mockResolvedValue({ count: 1 })

      await lineageEdgeRepository.createMany([
        {
          workspaceId: 'ws-1',
          taskId: 't-1',
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
          outcome: 'MERGED',
        },
      ])

      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            workspaceId: 'ws-1',
            taskId: 't-1',
            fragmentType: 'MEMORY',
            fragmentId: 'mem-1',
            sessionId: null,
            runId: null,
            outcome: 'MERGED',
          },
        ],
      })
    })

    it('uses the transaction client when one is passed', async () => {
      const txCreateMany = jest.fn().mockResolvedValue({ count: 1 })
      const tx = { lineageEdge: { createMany: txCreateMany } } as any

      await lineageEdgeRepository.createMany(
        [
          {
            workspaceId: 'ws-1',
            taskId: 't-1',
            fragmentType: 'SLACK_CONTEXT',
            fragmentId: 'slack-1',
          },
        ],
        tx
      )

      expect(txCreateMany).toHaveBeenCalledTimes(1)
      expect(mockCreateMany).not.toHaveBeenCalled()
    })
  })

  describe('aggregateByFragments', () => {
    it('returns [] and does not query for an empty fragment list', async () => {
      const result = await lineageEdgeRepository.aggregateByFragments([])

      expect(result).toEqual([])
      expect(mockGroupBy).not.toHaveBeenCalled()
    })

    it('groups by fragment + outcome scoped to the requested fragments', async () => {
      mockGroupBy.mockResolvedValue([])

      await lineageEdgeRepository.aggregateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
        { fragmentType: 'PR', fragmentId: 'pr-7' },
      ])

      expect(mockGroupBy).toHaveBeenCalledWith({
        by: ['fragmentType', 'fragmentId', 'outcome'],
        where: {
          OR: [
            { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
            { fragmentType: 'PR', fragmentId: 'pr-7' },
          ],
        },
        _count: { _all: true },
      })
    })

    it('folds groupBy rows into per-fragment outcome stats', async () => {
      mockGroupBy.mockResolvedValue([
        {
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
          outcome: 'MERGED',
          _count: { _all: 3 },
        },
        {
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
          outcome: 'REJECTED',
          _count: { _all: 1 },
        },
        {
          fragmentType: 'PR',
          fragmentId: 'pr-7',
          outcome: 'UNKNOWN',
          _count: { _all: 2 },
        },
      ])

      const result = await lineageEdgeRepository.aggregateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
        { fragmentType: 'PR', fragmentId: 'pr-7' },
      ])

      expect(result).toEqual([
        {
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
          total: 4,
          merged: 3,
          byOutcome: { MERGED: 3, REJECTED: 1, REWORKED: 0, UNKNOWN: 0 },
        },
        {
          fragmentType: 'PR',
          fragmentId: 'pr-7',
          total: 2,
          merged: 0,
          byOutcome: { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 2 },
        },
      ])
    })

    it('returns results in the requested fragment order and omits fragments with no edges', async () => {
      mockGroupBy.mockResolvedValue([
        {
          fragmentType: 'PR',
          fragmentId: 'pr-7',
          outcome: 'MERGED',
          _count: { _all: 1 },
        },
      ])

      const result = await lineageEdgeRepository.aggregateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' }, // no edges → omitted
        { fragmentType: 'PR', fragmentId: 'pr-7' },
      ])

      expect(result).toHaveLength(1)
      expect(result[0]?.fragmentId).toBe('pr-7')
    })
  })

  describe('listByTask', () => {
    it('lists edges for a task ordered by includedAt asc', async () => {
      mockFindMany.mockResolvedValue([{ id: 'edge-1' }])

      const result = await lineageEdgeRepository.listByTask('t-1')

      expect(result).toEqual([{ id: 'edge-1' }])
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { taskId: 't-1' },
        orderBy: { includedAt: 'asc' },
      })
    })
  })

  describe('listByTaskWithCost', () => {
    it('queries edges for the task, oldest first, with run+session cost included', async () => {
      mockFindMany.mockResolvedValue([])

      const result = await lineageEdgeRepository.listByTaskWithCost('tsk_1')

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { taskId: 'tsk_1' },
        orderBy: { includedAt: 'asc' },
        include: {
          run: {
            select: {
              id: true,
              inputTokens: true,
              outputTokens: true,
              cacheReadTokens: true,
              cacheCreationTokens: true,
              loopCount: true,
            },
          },
          session: {
            select: {
              id: true,
              inputTokens: true,
              outputTokens: true,
              cacheReadTokens: true,
              cacheCreationTokens: true,
              loopCount: true,
            },
          },
        },
      })
      expect(result).toEqual([])
    })
  })
})
