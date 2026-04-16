/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdWithDefaults: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findMaxOrder: jest.fn(),
    createWithSequence: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { updateState: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { syncTaskTags: jest.fn() },
}))
// Side-effect dispatchers pull in Slack/Clerk — mock them out.
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
  dispatchUpdateTaskSideEffects: jest.fn(),
}))
jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn(),
}))
jest.mock('@/lib/integrations/github', () => ({
  getGithubInstallationToken: jest.fn(),
}))
jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: jest.fn(),
}))

import { taskService } from '@/lib/services/task.service'
import { projectRepository } from '@/lib/repositories/project.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'

describe('taskService.createFromAutomation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(projectRepository.findByIdWithDefaults as jest.Mock).mockResolvedValue({
      id: 'proj1',
      workspaceId: 'ws1',
      teamId: 'team1',
      defaultReviewer: null,
      workspace: { slug: 'acme' },
    })
    ;(taskRepository.findMaxOrder as jest.Mock).mockResolvedValue({ order: 3 })
    ;(taskRepository.createWithSequence as jest.Mock).mockResolvedValue({
      id: 'task1',
      title: 'Boom',
      teamIdentifier: 'LUM',
      number: 42,
      workspaceId: 'ws1',
    })
  })

  it('creates a task with TODO status and passes through all fields', async () => {
    const { task } = await taskService.createFromAutomation('proj1', {
      title: 'Boom',
      description: 'desc',
      priority: 'HIGH',
      assigneeActorId: 'actor1',
      tagIds: ['tag1'],
    })
    expect(task.id).toBe('task1')
    const args = (taskRepository.createWithSequence as jest.Mock).mock
      .calls[0][0]
    expect(args.status).toBe('TODO')
    expect(args.title).toBe('Boom')
    expect(args.description).toBe('desc')
    expect(args.priority).toBe('HIGH')
    expect(args.assigneeActorId).toBe('actor1')
    expect(args.projectId).toBe('proj1')
    expect(args.teamId).toBe('team1')
    expect(args.order).toBe(4)
  })

  it('syncs tag IDs when provided', async () => {
    await taskService.createFromAutomation('proj1', {
      title: 'x',
      description: null,
      priority: 'LOW',
      assigneeActorId: null,
      tagIds: ['tag1', 'tag2'],
    })
    expect(tagRepository.syncTaskTags).toHaveBeenCalledWith('task1', [
      'tag1',
      'tag2',
    ])
  })

  it('does not call syncTaskTags when tagIds is empty', async () => {
    await taskService.createFromAutomation('proj1', {
      title: 'x',
      description: null,
      priority: 'LOW',
      assigneeActorId: null,
      tagIds: [],
    })
    expect(tagRepository.syncTaskTags).not.toHaveBeenCalled()
  })

  it('throws 404 when project is not found', async () => {
    ;(projectRepository.findByIdWithDefaults as jest.Mock).mockResolvedValue(
      null
    )
    await expect(
      taskService.createFromAutomation('missing', {
        title: 't',
        description: null,
        priority: 'LOW',
        assigneeActorId: null,
        tagIds: [],
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})
