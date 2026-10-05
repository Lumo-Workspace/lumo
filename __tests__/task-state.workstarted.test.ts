import { updateTask } from '@/lib/services/task-state.service'
import { taskRepository } from '@/lib/repositories/task.repository'

// updateTask deps mocked to isolate the LUM-437 set-once workStartedAt hook.
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForUpdate: jest.fn(), update: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn(() => []),
    syncTaskTags: jest.fn(),
    addTaskTags: jest.fn(),
    removeTaskTags: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
// LUM-426 boundary gate — default "nothing flagged" so tests isolate LUM-437.
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(() => Promise.resolve([])),
    isGateEnabledForWorkspace: jest.fn(() => Promise.resolve(true)),
  },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock

/** Base TODO task with no workStartedAt yet. */
const TODO_TASK = {
  id: 't-1',
  status: 'TODO',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
  workStartedAt: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  update.mockImplementation((_id: string, data: Record<string, unknown>) =>
    Promise.resolve({
      ...TODO_TASK,
      status: 'IN_PROGRESS',
      team: { identifier: 'LUM' },
      teamId: 'team-1',
      ...data,
    })
  )
})

describe('workStartedAt set-once (LUM-437)', () => {
  it('stamps workStartedAt when a TODO task first moves to IN_PROGRESS', async () => {
    findForUpdate.mockResolvedValue({
      ...TODO_TASK,
      status: 'TODO',
      workStartedAt: null,
    })

    const before = new Date()
    const result = await updateTask('t-1', 'w-1', { status: 'IN_PROGRESS' })
    const after = new Date()

    // update() must have been called with a non-null workStartedAt
    expect(update).toHaveBeenCalledWith(
      't-1',
      'w-1',
      expect.objectContaining({ workStartedAt: expect.any(Date) })
    )

    // The returned task carries a workStartedAt in range
    const stamped = (update.mock.calls[0][2] as Record<string, unknown>)
      .workStartedAt as Date
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(stamped.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(result).toBeDefined()
  })

  it('does NOT reset workStartedAt when a task that already started bounces back to TODO then moves forward again', async () => {
    const T0 = new Date('2025-01-01T00:00:00Z')

    // The task was already started (workStartedAt = T0) and is now IN_PROGRESS.
    // Simulate it being bounced back to TODO then moved forward: the pre-update
    // row has workStartedAt already set, so the hook must NOT overwrite it.
    findForUpdate.mockResolvedValue({
      ...TODO_TASK,
      status: 'TODO',
      workStartedAt: T0,
    })

    await updateTask('t-1', 'w-1', { status: 'IN_PROGRESS' })

    const callData = update.mock.calls[0][2] as Record<string, unknown>
    // The hook guard (task.workStartedAt == null) must prevent writing a new stamp.
    expect(callData).not.toHaveProperty('workStartedAt')
  })
})
