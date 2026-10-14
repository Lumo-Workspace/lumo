/**
 * @jest-environment node
 */

/**
 * LUM-916: a task's evidence blobs used to survive the task until the whole
 * workspace was deleted. Deleting a project now sweeps
 * `test-evidence/<taskId>/` — after the rows are gone, and never at the cost
 * of the delete itself. Deleting a single task only moves it to the trash
 * (LUM-918), so its evidence stays for a restore; the trash purge sweeps it
 * (see __tests__/trash/trash-purge.test.ts).
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
    findTaskIdsWithTestCasesInProject: jest.fn(),
    findMilestoneIdsWithTestCasesInProject: jest.fn(),
  },
}))
jest.mock('@/lib/services/trash.service', () => ({
  trashService: {
    trashTask: jest.fn(async () => {
      order.push('trash-row')
      return 0
    }),
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

const projectTaskIds =
  privateFileRepository.findTaskIdsWithTestCasesInProject as jest.Mock

const projectMilestoneIds =
  privateFileRepository.findMilestoneIdsWithTestCasesInProject as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  projectMilestoneIds.mockResolvedValue([])
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

describe('deleting a task keeps its evidence for a restore', () => {
  it('moves the task to the trash and does not touch the blob store', async () => {
    await expect(taskService.deleteTask('t-1', 'clerk-1')).resolves.toEqual({
      workspaceId: 'ws-1',
    })
    expect(order).toEqual(['trash-row'])
    expect(taskRepository.delete).not.toHaveBeenCalled()
    expect(deleteBlobsByPrefixInBothStores).not.toHaveBeenCalled()
  })
})

describe('deleting a project removes its evidence blobs', () => {
  it('deleting a project sweeps every one of its tasks with test cases', async () => {
    projectTaskIds.mockResolvedValue(['t-1', 't-2'])
    await projectService.deleteProject('p-1', 'acme', 'm-1')
    expect(order).toEqual([
      'delete-row',
      'sweep test-evidence/t-1/',
      'sweep test-evidence/t-2/',
    ])
  })

  it('LUM-1135: also sweeps the evidence of milestones with test cases, after the row delete', async () => {
    projectTaskIds.mockResolvedValue([])
    projectMilestoneIds.mockResolvedValue(['ms-1'])
    await projectService.deleteProject('p-1', 'acme', 'm-1')
    expect(order).toEqual(['delete-row', 'sweep milestone-evidence/ms-1/'])
  })
})
