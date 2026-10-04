// __tests__/lib/services/task.service.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(),
    findForUpdate: jest.fn(),
    findWithProject: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    updateState: jest.fn(),
  },
}))

jest.mock('@/lib/integrations/github', () => ({
  getRepoToken: jest.fn(),
}))

jest.mock('@/lib/task/state-machine', () => ({
  ...jest.requireActual('@/lib/task/state-machine'),
  isValidTaskTransition: jest.fn(),
}))

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn().mockResolvedValue([]),
    syncTaskTags: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
  },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskService } from '@/lib/services/task.service'
import { isValidTaskTransition } from '@/lib/task/state-machine'

const mockFindById = taskRepository.findById as jest.Mock
const mockFindForUpdate = taskRepository.findForUpdate as jest.Mock
const mockUpdate = taskRepository.update as jest.Mock
const mockIsValidTransition = isValidTaskTransition as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskService.getTaskDetail', () => {
  it('returns task detail when found and authorized', async () => {
    const mockTask = {
      id: 'task-1',
      title: 'Test',
      status: 'TODO',
      project: { id: 'proj-1', workspaceId: 'ws-1' },
      team: { identifier: 'LUM' },
      pullRequests: [],
      parent: null,
    }
    mockFindById.mockResolvedValue(mockTask)

    const result = await taskService.getTaskDetail('task-1')

    expect(result).toBeDefined()
    expect(result!.id).toBe('task-1')
    expect(result!.teamIdentifier).toBe('LUM')
  })

  it('returns null when task not found', async () => {
    mockFindById.mockResolvedValue(null)

    const result = await taskService.getTaskDetail('nonexistent')

    expect(result).toBeNull()
  })
})

describe('taskService.updateTask', () => {
  it('throws 404 when task not found', async () => {
    mockFindForUpdate.mockResolvedValue(null)

    await expect(
      taskService.updateTask('nonexistent', { title: 'New' })
    ).rejects.toMatchObject({ message: 'Task not found', status: 404 })
  })

  it('throws 409 for invalid status transition', async () => {
    mockFindForUpdate.mockResolvedValue({
      id: 'task-1',
      status: 'DONE',
      project: { workspaceId: 'ws-1' },
      assigneeActorId: null,
    })
    mockIsValidTransition.mockReturnValue(false)

    await expect(
      taskService.updateTask('task-1', { status: 'IN_REVIEW' })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('updates task successfully with valid data', async () => {
    mockFindForUpdate.mockResolvedValue({
      id: 'task-1',
      status: 'TODO',
      project: { workspaceId: 'ws-1' },
      assigneeActorId: null,
    })
    mockIsValidTransition.mockReturnValue(true)
    mockUpdate.mockResolvedValue({
      id: 'task-1',
      title: 'Updated',
      status: 'IN_PROGRESS',
      projectId: 'proj-1',
      project: { id: 'proj-1', name: 'Project' },
      team: { identifier: 'LUM' },
    })

    const result = await taskService.updateTask('task-1', {
      title: 'Updated',
      status: 'IN_PROGRESS',
    })

    expect(result.task).toMatchObject({
      title: 'Updated',
      teamIdentifier: 'LUM',
    })
    expect(result.changedFields).toContain('title')
    expect(result.changedFields).toContain('status')
    expect(result.oldStatus).toBe('TODO')
  })
})
