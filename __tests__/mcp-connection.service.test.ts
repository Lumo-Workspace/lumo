import { mcpConnectionService } from '@/lib/services/mcp-connection.service'

const mockUpsert = jest.fn()
const mockFindByClerkAndClient = jest.fn()
const mockSetActiveWorkspace = jest.fn()
const mockRevoke = jest.fn()
const mockListActiveByClerkUser = jest.fn()
const mockFindById = jest.fn()

jest.mock('@/lib/repositories/mcp-connection.repository', () => ({
  mcpConnectionRepository: {
    upsertOnConnect: (...a: any[]) => mockUpsert(...a),
    findByClerkUserAndClient: (...a: any[]) => mockFindByClerkAndClient(...a),
    setActiveWorkspace: (...a: any[]) => mockSetActiveWorkspace(...a),
    revoke: (...a: any[]) => mockRevoke(...a),
    listActiveByClerkUser: (...a: any[]) => mockListActiveByClerkUser(...a),
    findById: (...a: any[]) => mockFindById(...a),
  },
}))

const mockFindByClerkId = jest.fn()
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByClerkId: (...a: any[]) => mockFindByClerkId(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('mcpConnectionService', () => {
  describe('registerOrTouch', () => {
    it('delegates to repository upsert', async () => {
      mockUpsert.mockResolvedValue({ id: 'c1' })
      const result = await mcpConnectionService.registerOrTouch({
        clerkUserId: 'u1',
        clientId: 'cli1',
        clientName: 'Claude',
      })
      expect(mockUpsert).toHaveBeenCalledWith({
        clerkUserId: 'u1',
        clientId: 'cli1',
        clientName: 'Claude',
      })
      expect(result).toEqual({ id: 'c1' })
    })
  })

  describe('bindWorkspace', () => {
    it('rejects when user is not a member of the target workspace', async () => {
      mockFindByClerkId.mockResolvedValue([{ workspaceId: 'ws-1' }])
      await expect(
        mcpConnectionService.bindWorkspace('c1', 'u1', 'ws-2', { auto: false })
      ).rejects.toMatchObject({ status: 403 })
      expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
    })

    it('sets active workspace when user is a member', async () => {
      mockFindByClerkId.mockResolvedValue([{ workspaceId: 'ws-1' }])
      mockSetActiveWorkspace.mockResolvedValue({ id: 'c1', activeWorkspaceId: 'ws-1' })
      const result = await mcpConnectionService.bindWorkspace(
        'c1',
        'u1',
        'ws-1',
        { auto: false }
      )
      expect(mockSetActiveWorkspace).toHaveBeenCalledWith('c1', 'ws-1', { auto: false })
      expect(result.activeWorkspaceId).toBe('ws-1')
    })
  })

  describe('listConnections', () => {
    it('returns active connections for a user', async () => {
      mockListActiveByClerkUser.mockResolvedValue([{ id: 'c1' }])
      const result = await mcpConnectionService.listConnections('u1')
      expect(result).toHaveLength(1)
      expect(mockListActiveByClerkUser).toHaveBeenCalledWith('u1')
    })
  })

  describe('disconnect', () => {
    it('rejects if connection is not owned by user', async () => {
      mockFindById.mockResolvedValue({ id: 'c1', clerkUserId: 'OTHER' })
      await expect(
        mcpConnectionService.disconnect('c1', 'u1')
      ).rejects.toMatchObject({ status: 404 })
      expect(mockRevoke).not.toHaveBeenCalled()
    })
    it('revokes when owned', async () => {
      mockFindById.mockResolvedValue({ id: 'c1', clerkUserId: 'u1' })
      mockRevoke.mockResolvedValue({ id: 'c1' })
      await mcpConnectionService.disconnect('c1', 'u1')
      expect(mockRevoke).toHaveBeenCalledWith('c1')
    })
  })
})
