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

// ── findByWorkspace ────────────────────────────────────────────────────────

describe('findByWorkspace', () => {
  it('returns projects with defaultReviewer flattened-ready and repositories', async () => {
    const mockProjects = [
      {
        id: 'p1',
        name: 'Public Project',
        isIdea: false,
        _count: { tasks: 5 },
        defaultReviewer: { id: 'm1', user: { name: 'Alice' } },
        repositories: [],
      },
      {
        id: 'p2',
        name: 'My Idea',
        isIdea: true,
        createdByMemberId: 'member-1',
        _count: { tasks: 2 },
        defaultReviewer: null,
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
          _count: { select: { tasks: true } },
          defaultReviewer: {
            include: { user: { select: { name: true } } },
          },
        }),
        orderBy: { updatedAt: 'desc' },
      })
    )
    // No inline tasks include — counts come from countTasksByStatus
    const call = mockFindMany.mock.calls[0][0] as { include: Record<string, unknown> }
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

    const result = await projectRepository.findById('p1')

    expect(result).toEqual(mockProject)
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      include: { _count: { select: { tasks: true, views: true } } },
    })
  })

  it('returns null when project not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await projectRepository.findById('nonexistent')

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
      TODO: 3,
      IN_PROGRESS: 1,
      IN_REVIEW: 0,
      DONE: 0,
    })
    expect(result.get('p2')).toEqual({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 7,
    })
  })

  it('passes the workspace + idea-visibility filter to groupBy', async () => {
    const groupBy = jest.fn().mockResolvedValue([])
    ;(prisma as unknown as { task: { groupBy: jest.Mock } }).task = { groupBy }

    await projectRepository.countTasksByStatus('ws-1', 'member-1')

    expect(groupBy).toHaveBeenCalledWith({
      by: ['projectId', 'status'],
      where: {
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
