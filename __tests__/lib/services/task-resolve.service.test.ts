/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
// task.service.ts pulls in a constellation of repositories + services at
// module scope. Stub every import it doesn't need for identifier resolve so
// the test stays focused and doesn't pay for unrelated module loading.
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {},
}))
jest.mock('@/lib/repositories/tag.repository', () => ({ tagRepository: {} }))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {},
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {},
}))
jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn(),
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
  dispatchUpdateTaskSideEffects: jest.fn(),
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskService } from '@/lib/services/task.service'

const findByIdent = taskRepository.findByWorkspaceIdentifier as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskService.resolveIdentifier', () => {
  it('returns null for malformed identifiers', async () => {
    expect(await taskService.resolveIdentifier('ws_1', 'LUM')).toBeNull()
    expect(await taskService.resolveIdentifier('ws_1', 'LUM-')).toBeNull()
    expect(await taskService.resolveIdentifier('ws_1', 'LUM-abc')).toBeNull()
    expect(findByIdent).not.toHaveBeenCalled()
  })

  it('upper-cases the team portion and parses the number', async () => {
    findByIdent.mockResolvedValueOnce(null)
    await taskService.resolveIdentifier('ws_1', 'lum-30')
    expect(findByIdent).toHaveBeenCalledWith('ws_1', 'LUM', 30)
  })

  it('supports team identifiers containing hyphens', async () => {
    findByIdent.mockResolvedValueOnce(null)
    await taskService.resolveIdentifier('ws_1', 'FOO-BAR-12')
    expect(findByIdent).toHaveBeenCalledWith('ws_1', 'FOO-BAR', 12)
  })

  it('returns null when no task matches', async () => {
    findByIdent.mockResolvedValueOnce(null)
    expect(await taskService.resolveIdentifier('ws_1', 'LUM-99')).toBeNull()
  })

  it('returns a compact descriptor with re-assembled identifier', async () => {
    findByIdent.mockResolvedValueOnce({
      id: 'task_cmoc',
      number: 30,
      title: 'T',
      status: 'IN_PROGRESS',
      team: { identifier: 'LUM' },
    })
    expect(await taskService.resolveIdentifier('ws_1', 'lum-30')).toEqual({
      id: 'task_cmoc',
      identifier: 'LUM-30',
      title: 'T',
      status: 'IN_PROGRESS',
    })
  })
})
