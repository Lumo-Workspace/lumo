/**
 * @jest-environment node
 */

/**
 * LUM-916: a task's evidence blobs used to survive the task until the whole
 * workspace was deleted. Deleting a task (or its project) now sweeps
 * `test-evidence/<taskId>/` — after the rows are gone, and never at the cost
 * of the delete itself.
 */
const deleteBlobsByPrefixInBothStores = jest.fn()
jest.mock('@/lib/services/workspace-deletion-blob', () => ({
  deleteBlobsByPrefixInBothStores: (...a: unknown[]) =>
    deleteBlobsByPrefixInBothStores(...a),
}))

const order: string[] = []
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findWithProject: jest.fn(),
    delete: jest.fn(async () => {
      order.push('delete-row')
    }),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findById: jest.fn(),
    delete: jest.fn(async () => {
      order.push('delete-row')
    }),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findById: jest.fn().mockResolvedValue({ id: 'm-1', workspaceId: 'ws-1' }),
  },
}))
jest.mock('@/lib/repositories/private-file.repository', () => ({
  privateFileRepository: {
    taskHasTestCases: jest.fn(),
    findTaskIdsWithTestCasesInProject: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/pusher/server', () => ({
  pushWorkspaceEvent: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/integrations/github', () => ({ getRepoToken: jest.fn() }))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
const warn = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), error: jest.fn() },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { privateFileRepository } from '@/lib/repositories/private-file.repository'
import { taskService } from '@/lib/services/task.service'
import { projectService } from '@/lib/services/project.service'

const hasTestCases = privateFileRepository.taskHasTestCases as jest.Mock
const projectTaskIds =
  privateFileRepository.findTaskIdsWithTestCasesInProject as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  order.length = 0
  ;(taskRepository.findWithProject as jest.Mock).mockResolvedValue({
    id: 't-1',
    project: { workspaceId: 'ws-1' },
  })
  ;(projectRepository.findById as jest.Mock).mockResolvedValue({
    id: 'p-1',
    workspaceId: 'ws-1',
    isIdea: false,
    createdByMemberId: 'm-1',
  })
  deleteBlobsByPrefixInBothStores.mockImplementation(async (prefix: string) => {
    order.push(`sweep ${prefix}`)
    return 1
  })
})

describe('deleting a task removes its evidence blobs', () => {
  it('sweeps the task evidence prefix after the row is deleted', async () => {
    hasTestCases.mockResolvedValue(true)
    await expect(taskService.deleteTask('t-1')).resolves.toEqual({
      workspaceId: 'ws-1',
    })
    expect(order).toEqual(['delete-row', 'sweep test-evidence/t-1/'])
  })

  it('does not touch the blob store for a task that never had test cases', async () => {
    hasTestCases.mockResolvedValue(false)
    await taskService.deleteTask('t-1')
    expect(deleteBlobsByPrefixInBothStores).not.toHaveBeenCalled()
  })

  it('logs a blob-store failure and still reports the delete as done', async () => {
    hasTestCases.mockResolvedValue(true)
    deleteBlobsByPrefixInBothStores.mockRejectedValue(
      new Error('blob store down')
    )
    await expect(taskService.deleteTask('t-1')).resolves.toEqual({
      workspaceId: 'ws-1',
    })
    expect(taskRepository.delete).toHaveBeenCalledWith('t-1')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('evidence cleanup failed'),
      expect.objectContaining({ taskIds: ['t-1'], error: 'blob store down' })
    )
  })

  it('deleting a project sweeps every one of its tasks with test cases', async () => {
    projectTaskIds.mockResolvedValue(['t-1', 't-2'])
    await projectService.deleteProject('p-1', 'acme', 'm-1')
    expect(order).toEqual([
      'delete-row',
      'sweep test-evidence/t-1/',
      'sweep test-evidence/t-2/',
    ])
  })
})
