import { mcpConnectionRepository } from '@/lib/repositories/mcp-connection.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    mcpConnection: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))

const mockPrisma = prisma as unknown as {
  mcpConnection: {
    findUnique: jest.Mock
    findFirst: jest.Mock
    findMany: jest.Mock
    create: jest.Mock
    update: jest.Mock
    upsert: jest.Mock
  }
}

beforeEach(() => jest.clearAllMocks())

describe('mcpConnectionRepository', () => {
  describe('findByClerkUserAndClient', () => {
    it('returns connection matching clerkUserId + clientId', async () => {
      mockPrisma.mcpConnection.findUnique.mockResolvedValue({ id: 'c1' })
      const result = await mcpConnectionRepository.findByClerkUserAndClient(
        'user_abc',
        'client_xyz'
      )
      expect(mockPrisma.mcpConnection.findUnique).toHaveBeenCalledWith({
        where: {
          clerkUserId_clientId: {
            clerkUserId: 'user_abc',
            clientId: 'client_xyz',
          },
        },
      })
      expect(result).toEqual({ id: 'c1' })
    })
  })

  describe('findLatestBoundSibling (LUM-1073)', () => {
    it('finds the latest other bound connection of the same user + client name', async () => {
      mockPrisma.mcpConnection.findFirst.mockResolvedValue({
        activeWorkspaceId: 'ws-1',
      })
      const result = await mcpConnectionRepository.findLatestBoundSibling(
        'user_abc',
        'Cursor',
        'c-new'
      )
      expect(mockPrisma.mcpConnection.findFirst).toHaveBeenCalledWith({
        where: {
          clerkUserId: 'user_abc',
          clientName: 'Cursor',
          id: { not: 'c-new' },
          activeWorkspaceId: { not: null },
        },
        orderBy: { lastUsedAt: 'desc' },
        select: { activeWorkspaceId: true },
      })
      expect(result).toEqual({ activeWorkspaceId: 'ws-1' })
    })
  })

  describe('listActiveByClerkUser', () => {
    it('excludes revoked rows', async () => {
      mockPrisma.mcpConnection.findMany.mockResolvedValue([])
      await mcpConnectionRepository.listActiveByClerkUser('user_abc')
      expect(mockPrisma.mcpConnection.findMany).toHaveBeenCalledWith({
        where: { clerkUserId: 'user_abc', revokedAt: null },
        orderBy: { lastUsedAt: 'desc' },
      })
    })
  })

  describe('upsertOnConnect', () => {
    it('creates or refreshes lastUsedAt', async () => {
      mockPrisma.mcpConnection.upsert.mockResolvedValue({ id: 'c1' })
      await mcpConnectionRepository.upsertOnConnect({
        clerkUserId: 'user_abc',
        clientId: 'client_xyz',
        clientName: 'Claude Desktop 0.8',
      })
      expect(mockPrisma.mcpConnection.upsert).toHaveBeenCalledWith({
        where: {
          clerkUserId_clientId: {
            clerkUserId: 'user_abc',
            clientId: 'client_xyz',
          },
        },
        create: {
          clerkUserId: 'user_abc',
          clientId: 'client_xyz',
          clientName: 'Claude Desktop 0.8',
        },
        update: {
          clientName: 'Claude Desktop 0.8',
          lastUsedAt: expect.any(Date),
          revokedAt: null,
        },
      })
    })
  })

  describe('setActiveWorkspace', () => {
    it('updates activeWorkspaceId and clears autoBoundAt when manually set', async () => {
      mockPrisma.mcpConnection.update.mockResolvedValue({ id: 'c1' })
      await mcpConnectionRepository.setActiveWorkspace('c1', 'ws-1', {
        auto: false,
      })
      expect(mockPrisma.mcpConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { activeWorkspaceId: 'ws-1', autoBoundAt: null },
      })
    })
    it('sets autoBoundAt when auto binding', async () => {
      mockPrisma.mcpConnection.update.mockResolvedValue({ id: 'c1' })
      await mcpConnectionRepository.setActiveWorkspace('c1', 'ws-1', {
        auto: true,
      })
      expect(mockPrisma.mcpConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { activeWorkspaceId: 'ws-1', autoBoundAt: expect.any(Date) },
      })
    })
  })

  describe('revoke', () => {
    it('sets revokedAt and clears activeWorkspaceId', async () => {
      mockPrisma.mcpConnection.update.mockResolvedValue({ id: 'c1' })
      await mcpConnectionRepository.revoke('c1')
      expect(mockPrisma.mcpConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { revokedAt: expect.any(Date), activeWorkspaceId: null },
      })
    })
  })

  describe('findById', () => {
    it('returns connection by id', async () => {
      mockPrisma.mcpConnection.findUnique.mockResolvedValue({ id: 'c1' })
      const result = await mcpConnectionRepository.findById('c1')
      expect(mockPrisma.mcpConnection.findUnique).toHaveBeenCalledWith({
        where: { id: 'c1' },
      })
      expect(result).toEqual({ id: 'c1' })
    })
  })

  describe('touchLastUsed', () => {
    it('updates lastUsedAt to now', async () => {
      mockPrisma.mcpConnection.update.mockResolvedValue({ id: 'c1' })
      await mcpConnectionRepository.touchLastUsed('c1')
      expect(mockPrisma.mcpConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { lastUsedAt: expect.any(Date) },
      })
    })
  })
})
