/**
 * @jest-environment node
 *
 * getLayer2Input (LUM-137) feeds the project constitution into the Layer-2
 * dedup prompt. LUM-778: that constitution is the PROJECT's own CLAUDE.md /
 * AGENTS.md — loaded per (projectId, workspaceId) from its linked repository —
 * and a missing constitution degrades to nulls so consolidation never fails
 * over an absent file. (The loader itself is covered in constitution.test.ts.)
 */
const mockLoadConstitution = jest.fn()
jest.mock('@/lib/services/memory/constitution', () => ({
  loadConstitution: (...a: unknown[]) => mockLoadConstitution(...(a as [])),
}))
const mockFindById = jest.fn()
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findById: (...a: unknown[]) => mockFindById(...(a as [])),
  },
}))
const mockRecentTaskMemories = jest.fn()
const mockActiveProjectMemories = jest.fn()
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findRecentTaskScopeMemoriesByProject: (...a: unknown[]) =>
      mockRecentTaskMemories(...(a as [])),
    findActiveProjectMemories: (...a: unknown[]) =>
      mockActiveProjectMemories(...(a as [])),
  },
}))

import { getLayer2Input } from '@/lib/services/memory/layer2-input'

beforeEach(() => {
  jest.clearAllMocks()
  mockFindById.mockResolvedValue({ id: 'p1', name: 'Proj', workspaceId: 'w1' })
  mockRecentTaskMemories.mockResolvedValue([
    { id: 'm1', taskId: 't1', category: 'TRAP', content: { trigger: 'x' } },
  ])
  mockActiveProjectMemories.mockResolvedValue([])
})

describe('getLayer2Input constitution (LUM-778)', () => {
  it('loads the constitution for the project being consolidated, not the server cwd', async () => {
    mockLoadConstitution.mockResolvedValue({
      claudeMd: '# Claude\nrule',
      agentsMd: '# Agents',
      repo: 'acme/app',
    })
    const input = await getLayer2Input('p1')
    expect(mockLoadConstitution).toHaveBeenCalledWith({
      projectId: 'p1',
      workspaceId: 'w1',
    })
    expect(input?.constitution).toEqual({
      claudeMd: '# Claude\nrule',
      agentsMd: '# Agents',
    })
  })

  it('degrades a missing constitution to nulls without throwing', async () => {
    mockLoadConstitution.mockResolvedValue({
      claudeMd: null,
      agentsMd: null,
      repo: null,
    })
    const input = await getLayer2Input('p1')
    expect(input?.constitution).toEqual({ claudeMd: null, agentsMd: null })
  })

  it('skips the project (null) before touching the constitution when there is nothing to consolidate', async () => {
    mockRecentTaskMemories.mockResolvedValue([])
    await expect(getLayer2Input('p1')).resolves.toBeNull()
    expect(mockLoadConstitution).not.toHaveBeenCalled()
  })
})
