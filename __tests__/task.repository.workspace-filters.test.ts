import {
  taskRepository,
  WORKSPACE_TASK_QUERY_LIMIT,
} from '@/lib/repositories/task.repository'

const mockTaskFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: (...args: any[]) => mockTaskFindMany(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.findByWorkspaceWithFilters', () => {
  it('scopes to the workspace (Task.workspaceId) and caps results when no filters', async () => {
    mockTaskFindMany.mockResolvedValueOnce([])

    await taskRepository.findByWorkspaceWithFilters('w1')

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1' },
        orderBy: { order: 'asc' },
        take: WORKSPACE_TASK_QUERY_LIMIT,
      })
    )
  })

  it('applies every filter dimension', async () => {
    mockTaskFindMany.mockResolvedValueOnce([])

    await taskRepository.findByWorkspaceWithFilters('w1', {
      projectIds: ['p1'],
      milestoneIds: ['m1'],
      statuses: ['TODO', 'DONE'],
      priorities: ['HIGH'],
      assigneeActorIds: ['a1'],
      tagIds: ['t1', 't2'],
    })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'w1',
          projectId: { in: ['p1'] },
          milestoneId: { in: ['m1'] },
          status: { in: ['TODO', 'DONE'] },
          priority: { in: ['HIGH'] },
          assigneeActorId: { in: ['a1'] },
          taskTags: { some: { tagId: { in: ['t1', 't2'] } } },
        },
      })
    )
  })

  it('ignores empty-array filters', async () => {
    mockTaskFindMany.mockResolvedValueOnce([])

    await taskRepository.findByWorkspaceWithFilters('w1', {
      projectIds: [],
      statuses: [],
    })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1' } })
    )
  })
})
