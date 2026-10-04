/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    update: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdWithDefaults: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { updateState: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { syncTaskTags: jest.fn() },
}))
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
}))

import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

describe('taskService.reopen', () => {
  beforeEach(() => jest.clearAllMocks())

  it('throws 404 if task not found', async () => {
    ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue(null)
    await expect(
      taskService.reopen('missing', {
        reason: 'sentry_regression',
        actorId: null,
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('sets status to TODO and writes a SENTRY_ALERT activity when task is DONE', async () => {
    ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'DONE',
      projectId: 'p1',
    })
    ;(taskRepository.update as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'TODO',
    })

    await taskService.reopen('t1', {
      reason: 'sentry_regression',
      actorId: null,
    })

    expect(taskRepository.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: 'TODO' })
    )
    expect(activityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        type: 'SENTRY_ALERT',
        actorId: null,
        payload: expect.objectContaining({
          reason: 'sentry_regression',
          reopened: true,
        }),
      })
    )
  })

  it('is a no-op when task is not in DONE status', async () => {
    ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'TODO',
      projectId: 'p1',
    })

    await taskService.reopen('t1', {
      reason: 'sentry_regression',
      actorId: null,
    })

    expect(taskRepository.update).not.toHaveBeenCalled()
    expect(activityRepository.create).not.toHaveBeenCalled()
  })
})
