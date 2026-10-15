// __tests__/memory.repository.compaction.test.ts — LUM-328 cold-eviction repo surface
import { memoryRepository } from '@/lib/repositories/memory.repository'

const groupBy = jest.fn()
const findMany = jest.fn()
const updateMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memory: {
      groupBy: (...a: unknown[]) => groupBy(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('memoryRepository.findProjectsOverActiveMemoryThreshold', () => {
  it('groups ACTIVE PROJECT rows by project and keeps only counts above the threshold', async () => {
    groupBy.mockResolvedValue([
      { projectId: 'p1', _count: { _all: 129 } },
      { projectId: 'p2', _count: { _all: 101 } },
    ])

    const result =
      await memoryRepository.findProjectsOverActiveMemoryThreshold(100)

    expect(groupBy).toHaveBeenCalledWith({
      by: ['projectId'],
      // LUM-1157: a project-less PR-review learning is never compacted.
      where: { scope: 'PROJECT', status: 'ACTIVE', projectId: { not: null } },
      _count: { _all: true },
      having: { projectId: { _count: { gt: 100 } } },
    })
    expect(result).toEqual([
      { projectId: 'p1', activeCount: 129 },
      { projectId: 'p2', activeCount: 101 },
    ])
  })
})

describe('memoryRepository.findActiveProjectMemoriesForCompaction', () => {
  it('selects only the fields compaction needs, ACTIVE PROJECT scope only', async () => {
    findMany.mockResolvedValue([])
    await memoryRepository.findActiveProjectMemoriesForCompaction('p1')
    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', scope: 'PROJECT', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, createdByMemberId: true },
    })
  })
})

describe('memoryRepository.archiveMemories', () => {
  it('flips only ACTIVE rows to ARCHIVED (reversible: a manual flip back restores injection)', async () => {
    updateMany.mockResolvedValue({ count: 2 })
    const result = await memoryRepository.archiveMemories(['m1', 'm2'])
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    })
    expect(result).toEqual({ count: 2 })
  })

  it('short-circuits on an empty id list', async () => {
    const result = await memoryRepository.archiveMemories([])
    expect(updateMany).not.toHaveBeenCalled()
    expect(result).toEqual({ count: 0 })
  })
})
