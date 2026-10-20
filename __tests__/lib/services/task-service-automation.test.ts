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
  tagRepository: {
    syncTaskTags: jest.fn(),
    findByTask: jest.fn().mockResolvedValue([]),
  },
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
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: jest.fn(),
  // LUM-1282: terminal stamps are covered in lum1282-* suites.
  terminalTimestampPatch: () => ({}),
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
      owner: null,
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
    // createFromAutomation normalizes markdown → HTML rich text (normalizeRichText)
    expect(args.description).toBe('<p>desc</p>\n')
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

// ── createTask tagIds tests ──────────────────────────────────────────────────

describe('taskService.createTask — tagIds', () => {
  const baseInput = {
    title: 'Tagged Task',
    description: null,
    status: 'TODO' as const,
    priority: 'MEDIUM' as const,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(projectRepository.findByIdWithDefaults as jest.Mock).mockResolvedValue({
      id: 'proj1',
      workspaceId: 'ws1',
      teamId: 'team1',
      owner: null,
      workspace: { slug: 'acme' },
    })
    ;(taskRepository.findMaxOrder as jest.Mock).mockResolvedValue({ order: 0 })
    ;(taskRepository.createWithSequence as jest.Mock).mockResolvedValue({
      id: 'task-new',
      title: 'Tagged Task',
      teamIdentifier: 'LUM',
      number: 10,
      workspaceId: 'ws1',
    })
  })

  it('calls syncTaskTags after create when tagIds has entries', async () => {
    await taskService.createTask(
      'proj1',
      { ...baseInput, tagIds: ['tag-1', 'tag-2'] },
      'actor1',
      'clerk1',
      'member1'
    )

    expect(tagRepository.syncTaskTags).toHaveBeenCalledWith('task-new', [
      'tag-1',
      'tag-2',
    ])
  })

  it('does not call syncTaskTags when tagIds is undefined', async () => {
    await taskService.createTask(
      'proj1',
      baseInput,
      'actor1',
      'clerk1',
      'member1'
    )

    expect(tagRepository.syncTaskTags).not.toHaveBeenCalled()
  })

  it('does not call syncTaskTags when tagIds is an empty array', async () => {
    await taskService.createTask(
      'proj1',
      { ...baseInput, tagIds: [] },
      'actor1',
      'clerk1',
      'member1'
    )

    expect(tagRepository.syncTaskTags).not.toHaveBeenCalled()
  })
})
