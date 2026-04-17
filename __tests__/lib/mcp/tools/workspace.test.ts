import { makeWorkspaceHandlers } from '@/lib/mcp/tools/workspace'

const mockFindByClerkId = jest.fn()
const mockBindWorkspace = jest.fn()
const mockFindById = jest.fn()

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findByClerkId: (...a: any[]) => mockFindByClerkId(...a) },
}))
jest.mock('@/lib/services/mcp-connection.service', () => ({
  mcpConnectionService: {
    bindWorkspace: (...a: any[]) => mockBindWorkspace(...a),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findById: (...a: any[]) => mockFindById(...a) },
}))

beforeEach(() => jest.clearAllMocks())

const boundCtx = {
  clerkUserId: 'u1',
  connectionId: 'c1',
  workspaceId: 'ws-1',
  memberId: 'm-1',
  memberRole: 'MEMBER' as const,
}
const bootstrapCtx = { clerkUserId: 'u1', connectionId: 'c1' }

describe('list_my_workspaces', () => {
  it('lists workspace memberships for the current user', async () => {
    mockFindByClerkId.mockResolvedValue([
      { workspaceId: 'ws-1', role: 'OWNER', workspace: { name: 'Foo', slug: 'foo' } },
    ])
    const h = makeWorkspaceHandlers(async () => bootstrapCtx as any)
    const out = await h.list_my_workspaces()
    expect(out).toEqual([{ workspaceId: 'ws-1', name: 'Foo', slug: 'foo', role: 'OWNER' }])
  })
})

describe('select_workspace', () => {
  it('delegates to mcpConnectionService.bindWorkspace', async () => {
    mockBindWorkspace.mockResolvedValue({ activeWorkspaceId: 'ws-1' })
    const h = makeWorkspaceHandlers(async () => bootstrapCtx as any)
    const out = await h.select_workspace({ workspaceId: 'ws-1' })
    expect(mockBindWorkspace).toHaveBeenCalledWith('c1', 'u1', 'ws-1', { auto: false })
    expect(out.activeWorkspaceId).toBe('ws-1')
  })
})

describe('get_active_workspace', () => {
  it('returns null in bootstrap mode', async () => {
    const h = makeWorkspaceHandlers(async () => bootstrapCtx as any)
    const out = await h.get_active_workspace()
    expect(out.activeWorkspaceId).toBeNull()
  })
  it('returns workspace details when bound', async () => {
    mockFindById.mockResolvedValue({ id: 'ws-1', name: 'Foo', slug: 'foo' })
    const h = makeWorkspaceHandlers(async () => boundCtx as any)
    const out = await h.get_active_workspace()
    expect(out).toEqual({
      activeWorkspaceId: 'ws-1',
      name: 'Foo',
      slug: 'foo',
      memberRole: 'MEMBER',
    })
  })
  it('throws ResourceNotFound when workspaceId points to a missing workspace', async () => {
    mockFindById.mockResolvedValue(null)
    const h = makeWorkspaceHandlers(async () => boundCtx as any)
    await expect(h.get_active_workspace()).rejects.toMatchObject({
      code: -32001,
    })
  })
})
