import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockCreateMany = jest.fn()
const mockGroupBy = jest.fn()
const mockFindMany = jest.fn()
const mockUpdateMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    lineageEdge: {
      createMany: (...args: any[]) => mockCreateMany(...args),
      groupBy: (...args: any[]) => mockGroupBy(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
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
        skipDuplicates: true,
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
        skipDuplicates: true,
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

    it('passes skipDuplicates: true so re-injection is idempotent at the DB layer', async () => {
      mockCreateMany.mockResolvedValue({ count: 1 })

      await lineageEdgeRepository.createMany([
        {
          workspaceId: 'ws-1',
          taskId: 't-1',
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
          sessionId: 's-1',
        },
      ])

      expect(mockCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true })
      )
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

  describe('stampOutcomeByTask', () => {
    it('stamps MERGED over UNKNOWN/REJECTED edges (advancing the ladder)', async () => {
      mockUpdateMany.mockResolvedValue({ count: 3 })

      const result = await lineageEdgeRepository.stampOutcomeByTask(
        't-1',
        'MERGED'
      )

      expect(result).toEqual({ count: 3 })
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { taskId: 't-1', outcome: { in: ['UNKNOWN', 'REJECTED'] } },
        data: { outcome: 'MERGED' },
      })
    })

    it('stamps REJECTED only over UNKNOWN edges (never downgrades a verdict)', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 })

      await lineageEdgeRepository.stampOutcomeByTask('t-1', 'REJECTED')

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { taskId: 't-1', outcome: { in: ['UNKNOWN'] } },
        data: { outcome: 'REJECTED' },
      })
    })

    it('stamps REWORKED only over already-MERGED edges (lateral move)', async () => {
      mockUpdateMany.mockResolvedValue({ count: 2 })

      await lineageEdgeRepository.stampOutcomeByTask('t-1', 'REWORKED')

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { taskId: 't-1', outcome: { in: ['MERGED'] } },
        data: { outcome: 'REWORKED' },
      })
    })

    it('keeps REWORKED sticky — re-completion does not restamp it to MERGED', async () => {
      // Re-completing a reopened task calls stampOutcomeByTask(_, 'MERGED').
      // REWORKED must be absent from MERGED's source set, so an already-REWORKED
      // edge is left untouched (the verdict records that the work had to be
      // redone, which a later success does not erase).
      mockUpdateMany.mockResolvedValue({ count: 0 })

      await lineageEdgeRepository.stampOutcomeByTask('t-1', 'MERGED')

      const where = mockUpdateMany.mock.calls[0][0].where
      expect(where.outcome.in).not.toContain('REWORKED')
    })

    it('uses the transaction client when one is passed', async () => {
      const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
      const tx = { lineageEdge: { updateMany: txUpdateMany } } as any

      await lineageEdgeRepository.stampOutcomeByTask('t-1', 'MERGED', tx)

      expect(txUpdateMany).toHaveBeenCalledTimes(1)
      expect(mockUpdateMany).not.toHaveBeenCalled()
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

  describe('countResolvedTasks', () => {
    it('counts distinct taskIds with at least one non-UNKNOWN edge', async () => {
      mockGroupBy.mockResolvedValue([
        { taskId: 't1' },
        { taskId: 't2' },
        { taskId: 't3' },
      ])
      const n = await lineageEdgeRepository.countResolvedTasks()
      expect(n).toBe(3)
      expect(mockGroupBy).toHaveBeenCalledWith({
        by: ['taskId'],
        where: { outcome: { not: 'UNKNOWN' } },
      })
    })

    it('returns 0 when there are no resolved edges', async () => {
      mockGroupBy.mockResolvedValue([])
      expect(await lineageEdgeRepository.countResolvedTasks()).toBe(0)
    })
  })

  describe('mergeRateByFragments', () => {
    it('returns [] and does not query for an empty fragment list', async () => {
      const result = await lineageEdgeRepository.mergeRateByFragments([])
      expect(result).toEqual([])
      expect(mockGroupBy).not.toHaveBeenCalled()
    })

    it('groups by fragment + task + outcome scoped to the requested fragments', async () => {
      mockGroupBy.mockResolvedValue([])
      await lineageEdgeRepository.mergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
      ])
      expect(mockGroupBy).toHaveBeenCalledWith({
        by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
        where: { OR: [{ fragmentType: 'MEMORY', fragmentId: 'mem-1' }] },
        _count: { _all: true },
      })
    })

    it('dedupes by task: many edges for one task count as one resolved/merged task', async () => {
      mockGroupBy.mockResolvedValue([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'A', outcome: 'MERGED', _count: { _all: 2 } },
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'A', outcome: 'UNKNOWN', _count: { _all: 1 } },
      ])
      const result = await lineageEdgeRepository.mergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
      ])
      expect(result).toEqual([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 1, mergedTasks: 1 },
      ])
    })

    it('excludes UNKNOWN-only tasks from the denominator', async () => {
      mockGroupBy.mockResolvedValue([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'A', outcome: 'MERGED', _count: { _all: 1 } },
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'B', outcome: 'REJECTED', _count: { _all: 1 } },
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'C', outcome: 'UNKNOWN', _count: { _all: 3 } },
      ])
      const result = await lineageEdgeRepository.mergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
      ])
      expect(result).toEqual([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 2, mergedTasks: 1 },
      ])
    })

    it('omits fragments with no edges and preserves requested order', async () => {
      mockGroupBy.mockResolvedValue([
        { fragmentType: 'PR', fragmentId: 'pr-7', taskId: 'A', outcome: 'MERGED', _count: { _all: 1 } },
      ])
      const result = await lineageEdgeRepository.mergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
        { fragmentType: 'PR', fragmentId: 'pr-7' },
      ])
      expect(result).toEqual([
        { fragmentType: 'PR', fragmentId: 'pr-7', resolvedTasks: 1, mergedTasks: 1 },
      ])
    })
  })

  describe('findSessionFragmentEdges', () => {
    it('returns this session edges with current used/usedAt flags', async () => {
      mockFindMany.mockResolvedValue([
        { fragmentType: 'MEMORY', fragmentId: 'm1', used: null, usedAt: null },
        { fragmentType: 'WEB_LINK', fragmentId: 'w1', used: true, usedAt: new Date() },
      ])
      const rows = await lineageEdgeRepository.findSessionFragmentEdges('sess-1')
      expect(rows).toHaveLength(2)
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { sessionId: 'sess-1' },
        select: {
          fragmentType: true,
          fragmentId: true,
          used: true,
          usedAt: true,
        },
      })
    })
  })

  describe('applyUsageVote', () => {
    it('stamps used=true for voted refs and used=false for the rest, with usedAt', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 })
      const res = await lineageEdgeRepository.applyUsageVote('sess-1', [
        { fragmentType: 'MEMORY', fragmentId: 'm1' },
      ])
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          sessionId: 'sess-1',
          OR: [{ fragmentType: 'MEMORY', fragmentId: 'm1' }],
        },
        data: { used: true, usedAt: expect.any(Date) },
      })
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          sessionId: 'sess-1',
          NOT: { OR: [{ fragmentType: 'MEMORY', fragmentId: 'm1' }] },
        },
        data: { used: false, usedAt: expect.any(Date) },
      })
      expect(res).toEqual({ used: 1, unused: 1 })
    })

    it('marks all session edges used=false when no refs voted', async () => {
      mockUpdateMany.mockResolvedValue({ count: 3 })
      const res = await lineageEdgeRepository.applyUsageVote('sess-1', [])
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { sessionId: 'sess-1' },
        data: { used: false, usedAt: expect.any(Date) },
      })
      expect(res).toEqual({ used: 0, unused: 3 })
    })
  })

  describe('usageMergeRateByFragments', () => {
    it('counts only used=true (fragment,task) pairs, task-deduped', async () => {
      mockGroupBy.mockResolvedValue([
        { fragmentType: 'MEMORY', fragmentId: 'm1', taskId: 'tA', outcome: 'MERGED', _count: { _all: 1 } },
        { fragmentType: 'MEMORY', fragmentId: 'm1', taskId: 'tB', outcome: 'REJECTED', _count: { _all: 1 } },
        { fragmentType: 'MEMORY', fragmentId: 'm1', taskId: 'tC', outcome: 'UNKNOWN', _count: { _all: 1 } },
      ])
      const [rate] = await lineageEdgeRepository.usageMergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'm1' },
      ])
      expect(rate).toEqual({
        fragmentType: 'MEMORY',
        fragmentId: 'm1',
        usedResolvedTasks: 2,
        usedMergedTasks: 1,
      })
      expect(mockGroupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
          where: expect.objectContaining({ used: true }),
        })
      )
    })

    it('returns [] for empty input', async () => {
      expect(await lineageEdgeRepository.usageMergeRateByFragments([])).toEqual([])
      expect(mockGroupBy).not.toHaveBeenCalled()
    })
  })
})
