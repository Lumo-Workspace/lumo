/**
 * @jest-environment node
 */

// LUM-883: the real confirmed-list check runs against this installation row.
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: {
    findByWorkspace: jest
      .fn()
      .mockResolvedValue({ installationId: 1, repositories: ['org/repo'] }),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn() },
}))

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findByRepoAndNumber: jest.fn(),
    updateTaskId: jest.fn(),
    updateState: jest.fn(),
    findActivePr: jest.fn(),
    searchByWorkspace: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByRepo: jest.fn(),
    upsertPullRequest: jest.fn(),
  },
}))

jest.mock('@/lib/crypto', () => ({
  decrypt: jest.fn().mockReturnValue('fake-token'),
}))

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn().mockResolvedValue([]),
    syncTaskTags: jest.fn(),
  },
}))

jest.mock('@/lib/integrations/github', () => ({
  getRepoToken: jest.fn(),
}))

jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: jest.fn(),
}))

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskService } from '@/lib/services/task.service'

const mockFindWithProject = taskRepository.findWithProject as jest.Mock
const mockFindById = pullRequestRepository.findById as jest.Mock
const mockFindByRepoAndNumber =
  pullRequestRepository.findByRepoAndNumber as jest.Mock
const mockUpdateTaskId = pullRequestRepository.updateTaskId as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskService.linkPullRequest', () => {
  const taskWithProject = { id: 'task-1', project: { workspaceId: 'ws-1' } }

  beforeEach(() => {
    mockFindWithProject.mockResolvedValue(taskWithProject)
  })

  it('throws 404 when task not found', async () => {
    mockFindWithProject.mockResolvedValue(null)
    await expect(
      taskService.linkPullRequest('nonexistent', {
        url: 'https://github.com/org/repo/pull/1',
      })
    ).rejects.toMatchObject({ message: 'Task not found', status: 404 })
  })

  it('links PR by prId when PR has no existing task', async () => {
    mockFindById.mockResolvedValue({
      id: 'pr-1',
      workspaceId: 'ws-1',
      repo: 'org/repo',
      taskId: null,
      task: null,
    })
    mockUpdateTaskId.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })

    const result = await taskService.linkPullRequest('task-1', { prId: 'pr-1' })

    expect(mockUpdateTaskId).toHaveBeenCalledWith('pr-1', 'task-1')
    expect(result).toEqual({ id: 'pr-1', taskId: 'task-1' })
  })

  it('links PR by URL when PR exists locally', async () => {
    mockFindByRepoAndNumber.mockResolvedValue({
      id: 'pr-1',
      workspaceId: 'ws-1',
      repo: 'org/repo',
      taskId: null,
      task: null,
    })
    mockUpdateTaskId.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })

    const result = await taskService.linkPullRequest('task-1', {
      url: 'https://github.com/org/repo/pull/42',
    })

    expect(mockUpdateTaskId).toHaveBeenCalledWith('pr-1', 'task-1')
    expect(result).toEqual({ id: 'pr-1', taskId: 'task-1' })
  })

  it('returns conflict when PR is linked to another task and force is false', async () => {
    mockFindByRepoAndNumber.mockResolvedValue({
      id: 'pr-1',
      workspaceId: 'ws-1',
      taskId: 'task-other',
      task: {
        id: 'task-other',
        number: 45,
        title: 'Other task',
        team: { identifier: 'ENG' },
      },
    })

    await expect(
      taskService.linkPullRequest('task-1', {
        url: 'https://github.com/org/repo/pull/42',
        force: false,
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('overwrites existing link when force is true', async () => {
    mockFindByRepoAndNumber.mockResolvedValue({
      id: 'pr-1',
      workspaceId: 'ws-1',
      taskId: 'task-other',
      task: {
        id: 'task-other',
        number: 45,
        title: 'Other',
        team: { identifier: 'ENG' },
      },
    })
    mockUpdateTaskId.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })

    const result = await taskService.linkPullRequest('task-1', {
      url: 'https://github.com/org/repo/pull/42',
      force: true,
    })

    expect(mockUpdateTaskId).toHaveBeenCalledWith('pr-1', 'task-1')
    expect(result).toEqual({ id: 'pr-1', taskId: 'task-1' })
  })

  it('throws 400 for invalid GitHub PR URL', async () => {
    await expect(
      taskService.linkPullRequest('task-1', {
        url: 'https://example.com/not-a-pr',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 404 when PR not found by prId', async () => {
    mockFindById.mockResolvedValue(null)
    await expect(
      taskService.linkPullRequest('task-1', { prId: 'nonexistent' })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 403 when PR belongs to different workspace', async () => {
    mockFindById.mockResolvedValue({
      id: 'pr-1',
      workspaceId: 'ws-other',
      taskId: null,
      task: null,
    })
    await expect(
      taskService.linkPullRequest('task-1', { prId: 'pr-1' })
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('taskService.unlinkPullRequest', () => {
  it('throws 404 when task not found', async () => {
    mockFindWithProject.mockResolvedValue(null)
    await expect(
      taskService.unlinkPullRequest('nonexistent', 'pr-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when PR is not linked to the given task', async () => {
    mockFindWithProject.mockResolvedValue({
      id: 'task-1',
      project: { workspaceId: 'ws-1' },
    })
    mockFindById.mockResolvedValue({ id: 'pr-1', taskId: 'task-other' })

    await expect(
      taskService.unlinkPullRequest('task-1', 'pr-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 when PR not found', async () => {
    mockFindWithProject.mockResolvedValue({
      id: 'task-1',
      project: { workspaceId: 'ws-1' },
    })
    mockFindById.mockResolvedValue(null)

    await expect(
      taskService.unlinkPullRequest('task-1', 'pr-nonexistent')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('sets taskId to null on successful unlink', async () => {
    mockFindWithProject.mockResolvedValue({
      id: 'task-1',
      project: { workspaceId: 'ws-1' },
    })
    mockFindById.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })
    mockUpdateTaskId.mockResolvedValue({ id: 'pr-1', taskId: null })

    const result = await taskService.unlinkPullRequest('task-1', 'pr-1')

    expect(mockUpdateTaskId).toHaveBeenCalledWith('pr-1', null)
    expect(result).toEqual({ id: 'pr-1', taskId: null })
  })
})
