const mockListForProject = jest.fn()
const mockListForTask = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
const mockFindByIdWithWorkspace = jest.fn()
const mockSetEmbedding = jest.fn()

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    listForProject: (...a: any[]) => mockListForProject(...a),
    listForTask: (...a: any[]) => mockListForTask(...a),
    create: (...a: any[]) => mockCreate(...a),
    update: (...a: any[]) => mockUpdate(...a),
    delete: (...a: any[]) => mockDelete(...a),
    findByIdWithWorkspace: (...a: any[]) => mockFindByIdWithWorkspace(...a),
    setEmbedding: (...a: any[]) => mockSetEmbedding(...a),
  },
}))

const mockEmbedTexts = jest.fn()
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: (...a: any[]) => mockEmbedTexts(...a),
}))

import { memoryManagementService } from '@/lib/services/memory-management.service'

beforeEach(() => {
  jest.clearAllMocks()
  // Default: embed succeeds with a 2-d stub vector
  mockEmbedTexts.mockResolvedValue([[0.1, 0.2]])
  mockSetEmbedding.mockResolvedValue(undefined)
})

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
      agent: undefined,
    })
  })

  it('stamps embedding after create (best-effort)', async () => {
    mockCreate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { summary: 'test trap', trigger: 'x', outcome: 'y' },
      actorMemberId: 'mem1',
    })
    expect(mockEmbedTexts).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('test trap')])
    )
    expect(mockSetEmbedding).toHaveBeenCalledWith('m1', [0.1, 0.2])
  })

  it('content write succeeds even when embedTexts throws', async () => {
    mockCreate.mockResolvedValue({ id: 'm1' })
    mockEmbedTexts.mockRejectedValue(new Error('gateway down'))
    // Should not throw
    const result = await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { summary: 'trap', trigger: 'x', outcome: 'y' },
      actorMemberId: 'mem1',
    })
    expect(result).toEqual({ id: 'm1' })
    expect(mockSetEmbedding).not.toHaveBeenCalled()
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
      agent: undefined,
    })
  })

  it('stamps embedding after create (best-effort)', async () => {
    mockCreate.mockResolvedValue({ id: 'm2' })
    await memoryManagementService.createForTask({
      taskId: 't1',
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'DECISION',
      content: { summary: 'my decision', what: 'a', why: 'b' },
      actorMemberId: 'mem1',
    })
    expect(mockEmbedTexts).toHaveBeenCalled()
    expect(mockSetEmbedding).toHaveBeenCalledWith('m2', [0.1, 0.2])
  })

  it('content write succeeds even when embedTexts throws', async () => {
    mockCreate.mockResolvedValue({ id: 'm2' })
    mockEmbedTexts.mockRejectedValue(new Error('no key'))
    const result = await memoryManagementService.createForTask({
      taskId: 't1',
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'DECISION',
      content: { summary: 'my decision', what: 'a', why: 'b' },
      actorMemberId: 'mem1',
    })
    expect(result).toEqual({ id: 'm2' })
    expect(mockSetEmbedding).not.toHaveBeenCalled()
  })
})

describe('editContent', () => {
  it('updates content only', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK', category: 'CONVENTION' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.editContent('m1', { rule: 'r', scope: 's' })
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      content: { rule: 'r', scope: 's' },
    })
  })

  it('stamps embedding after edit', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK', category: 'CONVENTION' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.editContent('m1', { summary: 'new rule', rule: 'r', scope: 's' })
    expect(mockEmbedTexts).toHaveBeenCalled()
    expect(mockSetEmbedding).toHaveBeenCalledWith('m1', [0.1, 0.2])
  })

  it('content write succeeds even when embedTexts throws', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK', category: 'CONVENTION' })
    mockUpdate.mockResolvedValue({ id: 'm1', content: { rule: 'r', scope: 's' } })
    mockEmbedTexts.mockRejectedValue(new Error('gateway error'))
    const result = await memoryManagementService.editContent('m1', { summary: 'test', rule: 'r', scope: 's' })
    expect(result).toEqual({ id: 'm1', content: { rule: 'r', scope: 's' } })
    expect(mockSetEmbedding).not.toHaveBeenCalled()
  })

  it('skips embedding when existing row not found', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue(null)
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.editContent('m1', { rule: 'r', scope: 's' })
    expect(mockEmbedTexts).not.toHaveBeenCalled()
  })
})

describe('promoteToProject', () => {
  it('throws 409 when already PROJECT', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'PROJECT', category: 'TRAP' })
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
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK', category: 'TRAP' })
    mockUpdate.mockResolvedValue({ id: 'm1', scope: 'PROJECT' })
    const result = await memoryManagementService.promoteToProject('m1')
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      scope: 'PROJECT',
      taskId: null,
    })
    expect(result).toEqual({ id: 'm1', scope: 'PROJECT' })
  })

  it('does NOT stamp embedding when only promoting scope (no content change)', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK', category: 'TRAP' })
    mockUpdate.mockResolvedValue({ id: 'm1', scope: 'PROJECT' })
    await memoryManagementService.promoteToProject('m1')
    expect(mockEmbedTexts).not.toHaveBeenCalled()
    expect(mockSetEmbedding).not.toHaveBeenCalled()
  })

  it('promotes and edits content in one update when content given', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK', category: 'CONVENTION' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    const result = await memoryManagementService.promoteToProject('m1', {
      rule: 'r',
      scope: 's',
    })
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      scope: 'PROJECT',
      taskId: null,
      content: { rule: 'r', scope: 's' },
    })
    expect(result).toEqual({ id: 'm1' })
  })

  it('stamps embedding when content is provided during promote', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK', category: 'CONVENTION' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.promoteToProject('m1', { summary: 'rule summary', rule: 'r', scope: 's' })
    expect(mockEmbedTexts).toHaveBeenCalled()
    expect(mockSetEmbedding).toHaveBeenCalledWith('m1', [0.1, 0.2])
  })

  it('content write succeeds even when embedTexts throws during promote', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', scope: 'TASK', category: 'CONVENTION' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    mockEmbedTexts.mockRejectedValue(new Error('gateway'))
    const result = await memoryManagementService.promoteToProject('m1', { summary: 'rule', rule: 'r', scope: 's' })
    expect(result).toEqual({ id: 'm1' })
    expect(mockSetEmbedding).not.toHaveBeenCalled()
  })
})

describe('delete', () => {
  it('hard-deletes via the repository', async () => {
    mockDelete.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.delete('m1')
    expect(mockDelete).toHaveBeenCalledWith('m1')
  })
})

describe('agent forwarding', () => {
  it('createForTask forwards agent to the repository', async () => {
    mockCreate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.createForTask({
      taskId: 't1',
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      actorMemberId: 'mem1',
      agent: 'CURSOR',
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'CURSOR' })
    )
  })

  it('createForProject without agent passes agent: undefined (DB default applies)', async () => {
    mockCreate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      actorMemberId: 'mem1',
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ agent: undefined })
    )
  })
})
