import { resolveLumoContext } from '@/lib/mcp/context'

const mockUpsertOnConnect = jest.fn()
const mockSetActiveWorkspace = jest.fn()
const mockFindByClerkUserAndClient = jest.fn()

jest.mock('@/lib/repositories/mcp-connection.repository', () => ({
  mcpConnectionRepository: {
    upsertOnConnect: (...a: any[]) => mockUpsertOnConnect(...a),
    setActiveWorkspace: (...a: any[]) => mockSetActiveWorkspace(...a),
    findByClerkUserAndClient: (...a: any[]) => mockFindByClerkUserAndClient(...a),
  },
}))

const mockFindByClerkId = jest.fn()
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByClerkId: (...a: any[]) => mockFindByClerkId(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('resolveLumoContext', () => {
  const input = { clerkUserId: 'u1', clientId: 'cli1', clientName: 'Claude' }

  it('uses bound workspace when valid', async () => {
    mockUpsertOnConnect.mockResolvedValue({
      id: 'c1',
      activeWorkspaceId: 'ws-1',
    })
    mockFindByClerkId.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER' },
    ])
    const ctx = await resolveLumoContext(input)
    expect(ctx.workspaceId).toBe('ws-1')
    expect(ctx.memberRole).toBe('MEMBER')
    expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
  })

  it('auto-binds single workspace when no binding exists', async () => {
    mockUpsertOnConnect.mockResolvedValue({
      id: 'c1',
      activeWorkspaceId: null,
    })
    mockFindByClerkId.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'ADMIN' },
    ])
    mockSetActiveWorkspace.mockResolvedValue({
      id: 'c1',
      activeWorkspaceId: 'ws-1',
    })
    const ctx = await resolveLumoContext(input)
    expect(ctx.workspaceId).toBe('ws-1')
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('c1', 'ws-1', {
      auto: true,
    })
  })

  it('bootstrap mode when multiple workspaces and no binding', async () => {
    mockUpsertOnConnect.mockResolvedValue({
      id: 'c1',
      activeWorkspaceId: null,
    })
    mockFindByClerkId.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER' },
      { id: 'm2', workspaceId: 'ws-2', role: 'MEMBER' },
    ])
    const ctx = await resolveLumoContext(input)
    expect(ctx.workspaceId).toBeUndefined()
    expect(ctx.memberRole).toBeUndefined()
    expect(ctx.connectionId).toBe('c1')
    expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
  })

  it('falls back to bootstrap when bound workspace is no longer accessible', async () => {
    mockUpsertOnConnect.mockResolvedValue({
      id: 'c1',
      activeWorkspaceId: 'ws-gone',
    })
    mockFindByClerkId.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER' },
      { id: 'm2', workspaceId: 'ws-2', role: 'MEMBER' },
    ])
    const ctx = await resolveLumoContext(input)
    expect(ctx.workspaceId).toBeUndefined()
    expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
  })

  it('returns bootstrap context when user has zero memberships', async () => {
    mockUpsertOnConnect.mockResolvedValue({
      id: 'c1',
      activeWorkspaceId: null,
    })
    mockFindByClerkId.mockResolvedValue([])
    const ctx = await resolveLumoContext(input)
    expect(ctx.workspaceId).toBeUndefined()
    expect(ctx.memberRole).toBeUndefined()
    expect(ctx.connectionId).toBe('c1')
    expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
  })

  it('auto-binds when bound workspace gone but user has exactly 1 remaining', async () => {
    mockUpsertOnConnect.mockResolvedValue({
      id: 'c1',
      activeWorkspaceId: 'ws-gone',
    })
    mockFindByClerkId.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER' },
    ])
    mockSetActiveWorkspace.mockResolvedValue({
      id: 'c1',
      activeWorkspaceId: 'ws-1',
    })
    const ctx = await resolveLumoContext(input)
    expect(ctx.workspaceId).toBe('ws-1')
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('c1', 'ws-1', {
      auto: true,
    })
  })
})
