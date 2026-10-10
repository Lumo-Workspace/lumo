const mockCanonicalize = jest.fn()
jest.mock('@/lib/services/memory/canonicalize-language', () => ({
  canonicalizeToEnglish: (...a: any[]) => mockCanonicalize(...a),
}))
// The LUM-538 source de-dup gate is exercised in its own suites
// (extraction-gate.test.ts / constitution-redundancy.test.ts). Here it is a
// no-op so these canonicalize/dedup/embedding tests can use terse placeholder
// content without tripping the incomplete-fact screen.
jest.mock('@/lib/services/memory/extraction-gate', () => ({
  screenCandidate: () => ({ ok: true }),
}))
jest.mock('@/lib/services/memory/constitution', () => ({
  loadConstitutionSource: async () => ({ text: null, repo: null }),
}))
// LUM-793: the write gate reads the project's compiled policy; stub it so the
// suite stays DB-free (no rules → the injection/directive checks still run).
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

const mockResolveDedup = jest.fn()
jest.mock('@/lib/services/memory/manual-dedup', () => ({
  resolveManualDedup: (...a: any[]) => mockResolveDedup(...a),
}))
const mockUpdateContent = jest.fn()
const mockSupersede = jest.fn()

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
    updateContent: (...a: any[]) => mockUpdateContent(...a),
    supersede: (...a: any[]) => mockSupersede(...a),
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
  // Default: pass-through canonicalize + ADD
  mockCanonicalize.mockImplementation(
    async (_cat: any, content: any) => content
  )
  mockResolveDedup.mockResolvedValue({ kind: 'ADD' })
  mockUpdateContent.mockResolvedValue({ id: 'u1' })
  mockSupersede.mockResolvedValue({ newId: 'sup1' })
  // Default: empty pool for list calls
  mockListForProject.mockResolvedValue([])
  mockListForTask.mockResolvedValue([])
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
      // LUM-783: content scanned on write; clean → null.
      contentSignals: null,
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
    expect(result).toEqual({ outcome: 'ADD', memory: { id: 'm1' } })
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
      // LUM-397: a manual task-scoped add has an unambiguous birth task.
      sourceTaskId: 't1',
      agent: undefined,
      contentSignals: null,
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
    expect(result).toEqual({ outcome: 'ADD', memory: { id: 'm2' } })
    expect(mockSetEmbedding).not.toHaveBeenCalled()
  })
})

describe('editContent', () => {
  it('updates content only', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'TASK',
      category: 'CONVENTION',
    })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.editContent('m1', { rule: 'r', scope: 's' })
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      content: { rule: 'r', scope: 's' },
      // LUM-793: an edit re-scans and re-stamps the row's signal summary.
      contentSignals: null,
    })
  })

  it('stamps embedding after edit', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'TASK',
      category: 'CONVENTION',
    })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.editContent('m1', {
      summary: 'new rule',
      rule: 'r',
      scope: 's',
    })
    expect(mockEmbedTexts).toHaveBeenCalled()
    expect(mockSetEmbedding).toHaveBeenCalledWith('m1', [0.1, 0.2])
  })

  it('content write succeeds even when embedTexts throws', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'TASK',
      category: 'CONVENTION',
    })
    mockUpdate.mockResolvedValue({
      id: 'm1',
      content: { rule: 'r', scope: 's' },
    })
    mockEmbedTexts.mockRejectedValue(new Error('gateway error'))
    const result = await memoryManagementService.editContent('m1', {
      summary: 'test',
      rule: 'r',
      scope: 's',
    })
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
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'PROJECT',
      category: 'TRAP',
    })
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
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'TASK',
      category: 'TRAP',
    })
    mockUpdate.mockResolvedValue({ id: 'm1', scope: 'PROJECT' })
    const result = await memoryManagementService.promoteToProject('m1')
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      scope: 'PROJECT',
      taskId: null,
    })
    expect(result).toEqual({ id: 'm1', scope: 'PROJECT' })
  })

  it('does NOT stamp embedding when only promoting scope (no content change)', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'TASK',
      category: 'TRAP',
    })
    mockUpdate.mockResolvedValue({ id: 'm1', scope: 'PROJECT' })
    await memoryManagementService.promoteToProject('m1')
    expect(mockEmbedTexts).not.toHaveBeenCalled()
    expect(mockSetEmbedding).not.toHaveBeenCalled()
  })

  it('promotes and edits content in one update when content given', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'TASK',
      category: 'CONVENTION',
    })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    const result = await memoryManagementService.promoteToProject('m1', {
      rule: 'r',
      scope: 's',
    })
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      scope: 'PROJECT',
      taskId: null,
      content: { rule: 'r', scope: 's' },
      contentSignals: null,
    })
    expect(result).toEqual({ id: 'm1' })
  })

  it('stamps embedding when content is provided during promote', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'TASK',
      category: 'CONVENTION',
    })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.promoteToProject('m1', {
      summary: 'rule summary',
      rule: 'r',
      scope: 's',
    })
    expect(mockEmbedTexts).toHaveBeenCalled()
    expect(mockSetEmbedding).toHaveBeenCalledWith('m1', [0.1, 0.2])
  })

  it('content write succeeds even when embedTexts throws during promote', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      scope: 'TASK',
      category: 'CONVENTION',
    })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    mockEmbedTexts.mockRejectedValue(new Error('gateway'))
    const result = await memoryManagementService.promoteToProject('m1', {
      summary: 'rule',
      rule: 'r',
      scope: 's',
    })
    expect(result).toEqual({ id: 'm1' })
    expect(mockSetEmbedding).not.toHaveBeenCalled()
  })
})

describe('editContent — canonicalize', () => {
  it('canonicalizes the new content before update', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', category: 'TRAP' })
    mockCanonicalize.mockResolvedValue({ trigger: 'EN', outcome: 'EN out' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.editContent('m1', {
      trigger: '中',
      outcome: '文',
    })
    expect(mockCanonicalize).toHaveBeenCalledWith('TRAP', {
      trigger: '中',
      outcome: '文',
    })
    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      content: { trigger: 'EN', outcome: 'EN out' },
      contentSignals: null,
    })
  })
})

describe('promoteToProject — canonicalize on content override', () => {
  it('canonicalizes the overridden content', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({
      id: 'm1',
      category: 'TRAP',
      scope: 'TASK',
    })
    mockCanonicalize.mockResolvedValue({ trigger: 'EN', outcome: 'EN out' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.promoteToProject('m1', {
      trigger: '中',
      outcome: '文',
    })
    expect(mockCanonicalize).toHaveBeenCalledWith('TRAP', {
      trigger: '中',
      outcome: '文',
    })
    expect(mockUpdate).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        scope: 'PROJECT',
        taskId: null,
        content: { trigger: 'EN', outcome: 'EN out' },
      })
    )
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

describe('createForProject — canonicalize + dedup', () => {
  it('canonicalizes content before storing (ADD path)', async () => {
    mockCanonicalize.mockResolvedValue({
      trigger: 'EN trigger',
      outcome: 'EN outcome',
    })
    mockResolveDedup.mockResolvedValue({ kind: 'ADD' })
    mockCreate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: '触发', outcome: '后果' },
      actorMemberId: 'mem1',
    })
    expect(mockCanonicalize).toHaveBeenCalledWith('TRAP', {
      trigger: '触发',
      outcome: '后果',
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { trigger: 'EN trigger', outcome: 'EN outcome' },
      })
    )
  })

  it('NOOP → no create, returns the duplicate neighbor id', async () => {
    mockResolveDedup.mockResolvedValue({ kind: 'NOOP', id: 'dup1' })
    const r = await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
      actorMemberId: 'mem1',
    })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(r).toEqual({ outcome: 'NOOP', memory: { id: 'dup1' } })
  })

  it('UPDATE → updateContent on the neighbor, returns its id', async () => {
    mockResolveDedup.mockResolvedValue({
      kind: 'UPDATE',
      id: 'n1',
      content: { trigger: 't', outcome: 'o' },
    })
    const r = await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
      actorMemberId: 'mem1',
    })
    expect(mockUpdateContent).toHaveBeenCalledWith(
      'n1',
      { trigger: 't', outcome: 'o' },
      undefined,
      // LUM-783: the neighbour's new content is scanned; clean → null.
      null
    )
    expect(mockCreate).not.toHaveBeenCalled()
    expect(r).toEqual({ outcome: 'UPDATE', memory: { id: 'n1' } })
  })

  it('SUPERSEDE → supersede on the neighbor, returns the new id', async () => {
    mockResolveDedup.mockResolvedValue({
      kind: 'SUPERSEDE',
      id: 'n1',
      content: { trigger: 't', outcome: 'o' },
    })
    mockSupersede.mockResolvedValue({ newId: 'new9' })
    const r = await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
      actorMemberId: 'mem1',
    })
    expect(mockSupersede).toHaveBeenCalledWith(
      'n1',
      { trigger: 't', outcome: 'o' },
      undefined,
      null
    )
    expect(r).toEqual({ outcome: 'SUPERSEDE', memory: { id: 'new9' } })
  })
})

describe('createForTask — canonicalize + dedup', () => {
  it('ADD — canonicalizes content before storing', async () => {
    mockCanonicalize.mockResolvedValue({
      trigger: 'EN trigger',
      outcome: 'EN outcome',
    })
    mockResolveDedup.mockResolvedValue({ kind: 'ADD' })
    mockCreate.mockResolvedValue({ id: 'mt1' })
    await memoryManagementService.createForTask({
      taskId: 't1',
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: '触发', outcome: '后果' },
      actorMemberId: 'mem1',
    })
    expect(mockCanonicalize).toHaveBeenCalledWith('TRAP', {
      trigger: '触发',
      outcome: '后果',
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'TASK',
        taskId: 't1',
        content: { trigger: 'EN trigger', outcome: 'EN outcome' },
      })
    )
  })

  it('NOOP → no create, returns the duplicate neighbor id', async () => {
    mockResolveDedup.mockResolvedValue({ kind: 'NOOP', id: 'dup1' })
    const r = await memoryManagementService.createForTask({
      taskId: 't1',
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
      actorMemberId: 'mem1',
    })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(r).toEqual({ outcome: 'NOOP', memory: { id: 'dup1' } })
  })
})
