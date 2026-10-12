/**
 * @jest-environment node
 *
 * LUM-1093: repository paging — count + skip/take in a stable order, pinned
 * to the caller's workspace; the service turns it into total + nextCursor.
 */
const mockFindMany = jest.fn()
const mockCount = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      count: (...a: unknown[]) => mockCount(...a),
    },
  },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskQueryService } from '@/lib/services/task-query.service'
import { nextPageCursor, readPageParams } from '@/lib/validation/pagination'

beforeEach(() => {
  jest.clearAllMocks()
  mockFindMany.mockResolvedValue([])
  mockCount.mockResolvedValue(0)
})

describe('taskRepository.findAssignedTasksPage', () => {
  it('pins workspace + assignee, applies filters, pages with count', async () => {
    mockCount.mockResolvedValue(120)
    mockFindMany.mockResolvedValue([{ id: 't51' }])
    const r = await taskRepository.findAssignedTasksPage(
      'w1',
      'act-1',
      { statuses: ['TODO'], milestoneIds: ['m1'], projectName: 'Lumo' },
      { offset: 50, limit: 50 }
    )
    expect(r).toEqual({ rows: [{ id: 't51' }], total: 120 })
    const args = mockFindMany.mock.calls[0]![0]
    expect(args.where).toEqual({
      workspaceId: 'w1',
      assigneeActorId: 'act-1',
      status: { in: ['TODO'] },
      milestoneId: { in: ['m1'] },
      project: { name: { equals: 'Lumo', mode: 'insensitive' } },
    })
    expect(args.skip).toBe(50)
    expect(args.take).toBe(50)
    expect(args.orderBy).toEqual([{ order: 'asc' }, { id: 'asc' }])
    expect(mockCount.mock.calls[0]![0]).toEqual({ where: args.where })
  })
})

describe('taskRepository.findByWorkspaceWithFiltersPage', () => {
  it('counts the same where it pages', async () => {
    mockCount.mockResolvedValue(3)
    await taskRepository.findByWorkspaceWithFiltersPage(
      'w1',
      { statuses: ['DONE'] },
      { offset: 0, limit: 2 }
    )
    const args = mockFindMany.mock.calls[0]![0]
    expect(args.where).toEqual({ workspaceId: 'w1', status: { in: ['DONE'] } })
    expect(args.take).toBe(2)
    expect(args.skip).toBe(0)
    expect(args.include.project).toEqual({ select: { id: true, name: true } })
    expect(mockCount.mock.calls[0]![0]).toEqual({ where: args.where })
  })
})

describe('taskQueryService paging', () => {
  it('findForWorkspacePage adds teamIdentifier, total and nextCursor', async () => {
    mockCount.mockResolvedValue(3)
    mockFindMany.mockResolvedValue([
      { id: 'a', team: { identifier: 'LUM' } },
      { id: 'b', team: { identifier: 'LUM' } },
    ])
    const r = await taskQueryService.findForWorkspacePage(
      'w1',
      {},
      { offset: 0, limit: 2 }
    )
    expect(r.total).toBe(3)
    expect(r.nextCursor).toBe('2')
    expect(r.tasks[0].teamIdentifier).toBe('LUM')
  })

  it('findAssignedPage: last page has no next cursor', async () => {
    mockCount.mockResolvedValue(2)
    mockFindMany.mockResolvedValue([{ id: 'b' }])
    const r = await taskQueryService.findAssignedPage(
      'w1',
      'act',
      {},
      { offset: 1, limit: 50 }
    )
    expect(r).toEqual({ tasks: [{ id: 'b' }], total: 2, nextCursor: null })
  })
})

describe('readPageParams / nextPageCursor', () => {
  it('no params → legacy (null page); limit defaults to 50 with a cursor', () => {
    expect(readPageParams(new URLSearchParams(''))).toEqual({
      ok: true,
      page: null,
    })
    expect(readPageParams(new URLSearchParams('cursor=100'))).toEqual({
      ok: true,
      page: { offset: 100, limit: 50 },
    })
  })

  it('rejects out-of-range limit and malformed cursor', () => {
    expect(readPageParams(new URLSearchParams('limit=501')).ok).toBe(false)
    expect(readPageParams(new URLSearchParams('cursor=1.5')).ok).toBe(false)
  })

  it('nextPageCursor stops at the end', () => {
    expect(nextPageCursor({ offset: 0, limit: 50 }, 50, 120)).toBe('50')
    expect(nextPageCursor({ offset: 100, limit: 50 }, 20, 120)).toBeNull()
  })
})
