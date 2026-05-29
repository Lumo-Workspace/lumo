const mockListForProject = jest.fn()
const mockListForTask = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
const mockFindByIdWithWorkspace = jest.fn()

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    listForProject: (...a: any[]) => mockListForProject(...a),
    listForTask: (...a: any[]) => mockListForTask(...a),
    create: (...a: any[]) => mockCreate(...a),
    update: (...a: any[]) => mockUpdate(...a),
    delete: (...a: any[]) => mockDelete(...a),
    findByIdWithWorkspace: (...a: any[]) => mockFindByIdWithWorkspace(...a),
  },
}))

import { memoryManagementService } from '@/lib/services/memory-management.service'

beforeEach(() => jest.clearAllMocks())

describe('listProjectMemories', () => {
  it('delegates to repository.listForProject', async () => {
    mockListForProject.mockResolvedValue([{ id: 'm1' }])
    const rows = await memoryManagementService.listProjectMemories('p1')
    expect(mockListForProject).toHaveBeenCalledWith('p1')
    expect(rows).toEqual([{ id: 'm1' }])
  })
})

describe('listTaskMemories', () => {
  it('delegates to repository.listForTask', async () => {
    mockListForTask.mockResolvedValue([{ id: 'm2' }])
    const rows = await memoryManagementService.listTaskMemories('t1')
    expect(mockListForTask).toHaveBeenCalledWith('t1')
    expect(rows).toEqual([{ id: 'm2' }])
  })
})

describe('createForProject', () => {
  it('creates a PROJECT-scope row with taskId null + actor', async () => {
    mockCreate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      actorMemberId: 'mem1',
    })
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'w1',
      projectId: 'p1',
      taskId: null,
      scope: 'PROJECT',
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      sourceSessionId: null,
      createdByMemberId: 'mem1',
    })
  })
})

describe('createForTask', () => {
  it('creates a TASK-scope row bound to the task', async () => {
    mockCreate.mockResolvedValue({ id: 'm2' })
    await memoryManagementService.createForTask({
      taskId: 't1',
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'DECISION',
      content: { what: 'a', why: 'b' },
      actorMemberId: 'mem1',
    })
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'w1',
      projectId: 'p1',
      taskId: 't1',
      scope: 'TASK',
      category: 'DECISION',
      content: { what: 'a', why: 'b' },
      sourceSessionId: null,
      createdByMemberId: 'mem1',
    })
  })
})

describe('editContent', () => {
  it('updates content only', async () => {
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.editContent('m1', { rule: 'r', scope: 's' })
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      content: { rule: 'r', scope: 's' },
    })
  })
})

describe('promoteToProject', () => {
  it('throws 409 when already PROJECT', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'PROJECT' })
    await expect(
      memoryManagementService.promoteToProject('m1')
    ).rejects.toMatchObject({ status: 409 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('throws 404 when the memory is missing', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue(null)
    await expect(
      memoryManagementService.promoteToProject('mX')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('promotes TASK→PROJECT and clears taskId', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK' })
    mockUpdate.mockResolvedValue({ id: 'm1', scope: 'PROJECT' })
    await memoryManagementService.promoteToProject('m1')
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      scope: 'PROJECT',
      taskId: null,
    })
  })

  it('promotes and edits content in one update when content given', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.promoteToProject('m1', { rule: 'r', scope: 's' })
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      scope: 'PROJECT',
      taskId: null,
      content: { rule: 'r', scope: 's' },
    })
  })
})

describe('delete', () => {
  it('hard-deletes via the repository', async () => {
    mockDelete.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.delete('m1')
    expect(mockDelete).toHaveBeenCalledWith('m1')
  })
})
