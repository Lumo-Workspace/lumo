/**
 * @jest-environment node
 *
 * LUM-1282: the status-transition path (`updateTask`) stamps completedAt /
 * canceledAt on entering DONE / CANCELED and clears them on reopen; the
 * Sentry reopen path clears completedAt; a task cannot be born CANCELED and
 * one born DONE carries completedAt.
 */
jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>${md}</p>`) },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    update: jest.fn(),
    findActorById: jest.fn(),
    createWithSequence: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findIdInWorkspace: jest.fn(),
    findByIdWithDefaults: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    syncTaskTags: jest.fn(),
    addTaskTags: jest.fn(),
    removeTaskTags: jest.fn(),
    findByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/services/done-verdict.service', () => ({
  readDoneVerdict: jest.fn(async () => ({ decision: 'CLEAR', blockers: [] })),
}))
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  stampLineageInBackground: jest.fn(),
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchUpdateTaskSideEffects: jest.fn(),
  dispatchCreateTaskSideEffects: jest.fn(),
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))

import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { reopen, updateTask } from '@/lib/services/task-state.service'
import { createTask } from '@/lib/services/task-creation.service'

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock

function row(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'T',
    status,
    projectId: 'proj-1',
    project: { workspaceId: 'ws-1' },
    team: { identifier: 'LUM' },
    sprintId: null,
    milestoneId: null,
    assigneeActorId: null,
    workStartedAt: new Date('2026-10-01T00:00:00.000Z'),
    completedAt: null,
    canceledAt: null,
    ...extra,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  update.mockImplementation(async (_id, _ws, data) => ({
    ...row('TODO'),
    ...data,
    team: { identifier: 'LUM' },
  }))
})

const lastData = () => update.mock.calls[0]![2] as Record<string, unknown>

describe('updateTask terminal stamps', () => {
  it('entering CANCELED stamps canceledAt', async () => {
    findForUpdate.mockResolvedValue(row('IN_PROGRESS'))
    const result = await updateTask('task-1', 'ws-1', { status: 'CANCELED' })
    expect(lastData().status).toBe('CANCELED')
    expect(lastData().canceledAt).toBeInstanceOf(Date)
    expect(lastData()).not.toHaveProperty('completedAt')
    expect(result.changedFields).toContain('canceledAt')
  })

  it('reopening a CANCELED task clears canceledAt', async () => {
    findForUpdate.mockResolvedValue(
      row('CANCELED', { canceledAt: new Date('2026-10-10T00:00:00.000Z') })
    )
    await updateTask('task-1', 'ws-1', { status: 'TODO' })
    expect(lastData().status).toBe('TODO')
    expect(lastData().canceledAt).toBeNull()
  })

  it('entering DONE stamps completedAt; leaving DONE clears it', async () => {
    findForUpdate.mockResolvedValue(row('IN_REVIEW'))
    await updateTask('task-1', 'ws-1', { status: 'DONE' })
    expect(lastData().completedAt).toBeInstanceOf(Date)

    update.mockClear()
    findForUpdate.mockResolvedValue(
      row('DONE', { completedAt: new Date('2026-10-10T00:00:00.000Z') })
    )
    await updateTask('task-1', 'ws-1', { status: 'IN_PROGRESS' })
    expect(lastData().completedAt).toBeNull()
  })

  it('re-asserting the current status keeps the original stamp', async () => {
    findForUpdate.mockResolvedValue(
      row('DONE', { completedAt: new Date('2026-10-10T00:00:00.000Z') })
    )
    await updateTask('task-1', 'ws-1', { status: 'DONE' })
    expect(lastData()).not.toHaveProperty('completedAt')
  })

  it('a non-status patch never touches the stamps', async () => {
    findForUpdate.mockResolvedValue(row('CANCELED'))
    await updateTask('task-1', 'ws-1', { title: 'renamed' })
    expect(lastData()).not.toHaveProperty('canceledAt')
    expect(lastData()).not.toHaveProperty('completedAt')
  })
})

describe('reopen (Sentry regression)', () => {
  it('DONE → TODO clears completedAt', async () => {
    findForUpdate.mockResolvedValue(row('DONE'))
    await reopen('task-1', 'ws-1', {
      reason: 'sentry_regression',
      actorId: null,
    })
    expect(lastData()).toEqual({ status: 'TODO', completedAt: null })
  })
})

describe('createTask', () => {
  beforeEach(() => {
    ;(projectRepository.findByIdWithDefaults as jest.Mock).mockResolvedValue({
      id: 'proj-1',
      workspaceId: 'ws-1',
      teamId: 'team-1',
      defaultAssigneeActorId: null,
    })
    ;(taskRepository.createWithSequence as jest.Mock).mockResolvedValue({
      id: 'task-1',
      number: 1,
      title: 'T',
      status: 'DONE',
      projectId: 'proj-1',
      teamId: 'team-1',
      team: { identifier: 'LUM' },
      assignee: null,
    })
  })

  it('refuses CANCELED as a birth status (400)', async () => {
    await expect(
      createTask(
        'proj-1',
        { title: 'T', status: 'CANCELED', priority: 'MEDIUM' },
        'actor-1',
        'clerk-1',
        'member-1'
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(taskRepository.createWithSequence).not.toHaveBeenCalled()
  })

  it('a task born DONE carries completedAt', async () => {
    await createTask(
      'proj-1',
      { title: 'T', status: 'DONE', priority: 'MEDIUM', order: 1 },
      'actor-1',
      'clerk-1',
      'member-1'
    )
    const data = (taskRepository.createWithSequence as jest.Mock).mock
      .calls[0]![0] as Record<string, unknown>
    expect(data.completedAt).toBeInstanceOf(Date)
  })
})
