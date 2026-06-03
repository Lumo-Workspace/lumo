/**
 * @jest-environment node
 *
 * Verifies LUM-170 wiring: updateTaskWithSideEffects sediments task
 * complexity only when a task transitions to DONE, threading teamId.
 * Mirrors task-state-layer2-trigger.test.ts.
 */
const waitUntilPromises: Array<Promise<unknown>> = []
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(p)
    return p
  },
}))
async function flushWaitUntil() {
  await Promise.all(waitUntilPromises.splice(0))
}
jest.mock('@/lib/services/task-complexity.service', () => ({
  taskComplexityService: {
    sedimentForTask: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/memory/layer2.service', () => ({
  layer2Service: {
    triggerForTaskCompletion: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchUpdateTaskSideEffects: jest.fn(),
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    update: jest.fn(),
    findChildren: jest.fn().mockResolvedValue([]),
    findProjectIdById: jest.fn(),
    findActorById: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    syncTaskTags: jest.fn(),
    findByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: () => true,
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskComplexityService } from '@/lib/services/task-complexity.service'
import { updateTaskWithSideEffects } from '@/lib/services/task-state.service'

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const sediment = taskComplexityService.sedimentForTask as jest.Mock

function mockTaskRow(overrides: {
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
}) {
  return {
    id: 'task_1',
    title: 'T',
    status: overrides.status,
    projectId: 'proj_1',
    teamId: 'team_1',
    project: { workspaceId: 'ws_1' },
    team: { identifier: 'LUM' },
    sprintId: null,
    assigneeActorId: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  update.mockImplementation(async (_id, data) => ({
    ...mockTaskRow({ status: 'DONE' }),
    ...data,
    team: { identifier: 'LUM' },
  }))
})

describe('updateTaskWithSideEffects → complexity sediment', () => {
  it('sediments with (taskId, teamId) when status transitions to DONE', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'IN_REVIEW' }))
    await updateTaskWithSideEffects(
      'task_1',
      { status: 'DONE' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()
    expect(sediment).toHaveBeenCalledWith('task_1', 'team_1')
  })

  it('does NOT sediment when status moves to IN_PROGRESS', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'TODO' }))
    await updateTaskWithSideEffects(
      'task_1',
      { status: 'IN_PROGRESS' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()
    expect(sediment).not.toHaveBeenCalled()
  })

  it('does NOT sediment when only non-status fields change', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'IN_PROGRESS' }))
    await updateTaskWithSideEffects(
      'task_1',
      { title: 'renamed' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()
    expect(sediment).not.toHaveBeenCalled()
  })
})
