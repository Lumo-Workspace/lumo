/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    task: {
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { projectRepository } from '@/lib/repositories/project.repository'

const mockFindMany = prisma.project.findMany as jest.Mock
const mockFindUnique = prisma.project.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('projectRepository.findWorkspaceId', () => {
  it('selects only workspaceId for the requested project', async () => {
    mockFindUnique.mockResolvedValue({ workspaceId: 'ws-1' })

    const result = await projectRepository.findWorkspaceId('proj-1')

    expect(result).toEqual({ workspaceId: 'ws-1' })
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      select: { workspaceId: true },
    })
  })

  it('returns null when project does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await projectRepository.findWorkspaceId('missing')).toBeNull()
  })
})

// ── findByWorkspace ────────────────────────────────────────────────────────

describe('findByWorkspace', () => {
  it('returns projects with owner reference and repositories', async () => {
    const mockProjects = [
      {
        id: 'p1',
        name: 'Public Project',
        isIdea: false,
        _count: { tasks: 5 },
        owner: { id: 'm1', clerkId: 'user_alice' },
        repositories: [],
      },
      {
        id: 'p2',
        name: 'My Idea',
        isIdea: true,
        createdByMemberId: 'member-1',
        _count: { tasks: 2 },
        owner: null,
        repositories: [],
      },
    ]
    mockFindMany.mockResolvedValue(mockProjects)

    const result = await projectRepository.findByWorkspace('ws-1', 'member-1')

    expect(result).toEqual(mockProjects)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'ws-1',
          OR: [
            { isIdea: false },
            { isIdea: true, createdByMemberId: 'member-1' },
          ],
        },
        include: expect.objectContaining({
          _count: { select: { tasks: { where: { deletedAt: null } } } },
          owner: {
            select: {
              id: true,
              clerkId: true,
              actor: { select: { id: true } },
            },
          },
        }),
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      })
    )
    // No inline tasks include — counts come from countTasksByStatus
    const call = mockFindMany.mock.calls[0][0] as {
      include: Record<string, unknown>
    }
    expect(call.include.tasks).toBeUndefined()
  })
})

// ── findById ───────────────────────────────────────────────────────────────

describe('findById', () => {
  it('returns project with task and view counts', async () => {
    const mockProject = {
      id: 'p1',
      name: 'Test Project',
      _count: { tasks: 3, views: 2 },
    }
    mockFindUnique.mockResolvedValue(mockProject)

    const result = await projectRepository.findById('p1', 'ws1')

    expect(result).toEqual(mockProject)
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'p1', workspaceId: 'ws1' },
      include: {
        _count: {
          select: { tasks: { where: { deletedAt: null } }, views: true },
        },
      },
    })
  })

  it('returns null when project not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await projectRepository.findById('nonexistent', 'ws1')

    expect(result).toBeNull()
  })
})

// ── countTasksByStatus ─────────────────────────────────────────────────────

describe('countTasksByStatus', () => {
  it('returns map of project id → status count buckets, filling zeros', async () => {
    // mock prisma.task.groupBy
    ;(prisma as unknown as { task: { groupBy: jest.Mock } }).task = {
      groupBy: jest.fn().mockResolvedValue([
        { projectId: 'p1', status: 'TODO', _count: { _all: 3 } },
        { projectId: 'p1', status: 'IN_PROGRESS', _count: { _all: 1 } },
        { projectId: 'p2', status: 'DONE', _count: { _all: 7 } },
      ]),
    }

    const result = await projectRepository.countTasksByStatus(
      'ws-1',
      'member-1'
    )

    expect(result.get('p1')).toEqual({
      BACKLOG: 0,
      TODO: 3,
      IN_PROGRESS: 1,
      IN_REVIEW: 0,
      DONE: 0,
      CANCELED: 0,
    })
    expect(result.get('p2')).toEqual({
      BACKLOG: 0,
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 7,
      CANCELED: 0,
    })
  })

  it('passes the workspace + idea-visibility filter to groupBy', async () => {
    const groupBy = jest.fn().mockResolvedValue([])
    ;(prisma as unknown as { task: { groupBy: jest.Mock } }).task = { groupBy }

    await projectRepository.countTasksByStatus('ws-1', 'member-1')

    expect(groupBy).toHaveBeenCalledWith({
      by: ['projectId', 'status'],
      where: {
        workspaceId: 'ws-1',
        // LUM-1285: trashed tasks don't count (derived completion).
        deletedAt: null,
        project: {
          workspaceId: 'ws-1',
          OR: [
            { isIdea: false },
            { isIdea: true, createdByMemberId: 'member-1' },
          ],
        },
      },
      _count: { _all: true },
    })
  })
})

// ── reorder ────────────────────────────────────────────────────────────────

describe('reorder', () => {
  it('updates order sequentially in a transaction', async () => {
    const mockUpdate = jest.fn()
    const txProject = { update: mockUpdate }
    const mockTx = jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ project: txProject })
    )
    ;(prisma as unknown as { $transaction: jest.Mock }).$transaction = mockTx

    await projectRepository.reorder('ws-1', ['p2', 'p1', 'p3'])

    expect(mockUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'p2', workspaceId: 'ws-1' },
      data: { order: 1 },
    })
    expect(mockUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'p1', workspaceId: 'ws-1' },
      data: { order: 2 },
    })
    expect(mockUpdate).toHaveBeenNthCalledWith(3, {
      where: { id: 'p3', workspaceId: 'ws-1' },
      data: { order: 3 },
    })
  })
})

// ── maxOrderInWorkspace ────────────────────────────────────────────────────

describe('maxOrderInWorkspace', () => {
  it('returns the current max order for the workspace or 0 when empty', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _max: { order: 7 } })
    ;(prisma as unknown as { project: { aggregate: jest.Mock } }).project = {
      ...(prisma.project as unknown as object),
      aggregate,
    } as never

    const result = await projectRepository.maxOrderInWorkspace('ws-1')

    expect(result).toBe(7)
    expect(aggregate).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      _max: { order: true },
    })
  })

  it('returns 0 when the workspace has no projects', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _max: { order: null } })
    ;(prisma as unknown as { project: { aggregate: jest.Mock } }).project = {
      ...(prisma.project as unknown as object),
      aggregate,
    } as never

    const result = await projectRepository.maxOrderInWorkspace('ws-1')

    expect(result).toBe(0)
  })
})
