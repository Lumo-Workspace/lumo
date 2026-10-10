import { resolveLumoContext } from '@/lib/mcp/context'

const mockUpsertOnConnect = jest.fn()
const mockSetActiveWorkspace = jest.fn()
const mockFindByClerkUserAndClient = jest.fn()
const mockFindLatestBoundSibling = jest.fn()

jest.mock('@/lib/repositories/mcp-connection.repository', () => ({
  mcpConnectionRepository: {
    upsertOnConnect: (...a: any[]) => mockUpsertOnConnect(...a),
    setActiveWorkspace: (...a: any[]) => mockSetActiveWorkspace(...a),
    findByClerkUserAndClient: (...a: any[]) =>
      mockFindByClerkUserAndClient(...a),
    findLatestBoundSibling: (...a: any[]) => mockFindLatestBoundSibling(...a),
  },
}))

const mockFindByClerkId = jest.fn()
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByClerkId: (...a: any[]) => mockFindByClerkId(...a),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockFindLatestBoundSibling.mockResolvedValue(null)
})

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

// LUM-1073: a re-registered client (new OAuth client id) inherits the
// workspace the user picked for the same client before.
describe('resolveLumoContext — re-registered client', () => {
  const input = { clerkUserId: 'u1', clientId: 'new-cli', clientName: 'Cursor' }
  const two = [
    { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER' },
    { id: 'm2', workspaceId: 'ws-2', role: 'ADMIN' },
  ]

  it('binds the new connection to the workspace of the latest same-name connection', async () => {
    mockUpsertOnConnect.mockResolvedValue({ id: 'c2', activeWorkspaceId: null })
    mockFindByClerkId.mockResolvedValue(two)
    mockFindLatestBoundSibling.mockResolvedValue({ activeWorkspaceId: 'ws-2' })
    const ctx = await resolveLumoContext(input)
    expect(mockFindLatestBoundSibling).toHaveBeenCalledWith(
      'u1',
      'Cursor',
      'c2'
    )
    expect(ctx).toMatchObject({ workspaceId: 'ws-2', memberRole: 'ADMIN' })
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('c2', 'ws-2', {
      auto: true,
    })
  })

  it('ignores an inherited workspace the user is no longer a member of', async () => {
    mockUpsertOnConnect.mockResolvedValue({ id: 'c2', activeWorkspaceId: null })
    mockFindByClerkId.mockResolvedValue(two)
    mockFindLatestBoundSibling.mockResolvedValue({
      activeWorkspaceId: 'ws-gone',
    })
    const ctx = await resolveLumoContext(input)
    expect(ctx.workspaceId).toBeUndefined()
    expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
  })

  it('does not look for a sibling without a client name', async () => {
    mockUpsertOnConnect.mockResolvedValue({ id: 'c2', activeWorkspaceId: null })
    mockFindByClerkId.mockResolvedValue(two)
    const ctx = await resolveLumoContext({ ...input, clientName: null })
    expect(mockFindLatestBoundSibling).not.toHaveBeenCalled()
    expect(ctx.workspaceId).toBeUndefined()
  })

  it('does not override a connection whose own (now inaccessible) binding exists', async () => {
    mockUpsertOnConnect.mockResolvedValue({
      id: 'c2',
      activeWorkspaceId: 'ws-gone',
    })
    mockFindByClerkId.mockResolvedValue(two)
    mockFindLatestBoundSibling.mockResolvedValue({ activeWorkspaceId: 'ws-1' })
    const ctx = await resolveLumoContext(input)
    expect(mockFindLatestBoundSibling).not.toHaveBeenCalled()
    expect(ctx.workspaceId).toBeUndefined()
  })
})
