/**
 * Prisma Client Mock for Testing
 *
 * Provides a mock Prisma client with all necessary methods
 * Used to test database operations without a real database
 */

import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended'

// Create a mock Prisma client
export const prismaMock = mockDeep<PrismaClient>()

// Reset mock between tests
export function resetPrismaMock() {
  mockReset(prismaMock)
}

// Export type for use in tests
export type MockPrismaClient = DeepMockProxy<PrismaClient>

/**
 * Mock Prisma module
 */
jest.mock('@/lib/db/prisma', () => ({
  __esModule: true,
  prisma: prismaMock,
}))

/**
 * Helper functions for common mock responses
 */

export function mockUserFindUnique(user: any) {
  prismaMock.user.findUnique.mockResolvedValue(user)
}

export function mockUserCreate(user: any) {
  prismaMock.user.create.mockResolvedValue(user)
}

export function mockAccountFindFirst(account: any) {
  prismaMock.account.findFirst.mockResolvedValue(account)
}

export function mockAccountCreate(account: any) {
  prismaMock.account.create.mockResolvedValue(account)
}

export function mockSessionCreate(session: any) {
  prismaMock.session.create.mockResolvedValue(session)
}

export function mockSessionCount(count: number) {
  prismaMock.session.count.mockResolvedValue(count)
}

export function mockSessionFindFirst(session: any) {
  prismaMock.session.findFirst.mockResolvedValue(session)
}

export function mockSessionDelete(session: any) {
  prismaMock.session.delete.mockResolvedValue(session)
}

/**
 * Create a complete mock database state for testing
 */
export function createMockDatabaseState(
  options: {
    users?: any[]
    accounts?: any[]
    sessions?: any[]
  } = {}
) {
  const { users = [], accounts = [], sessions = [] } = options

  // Mock user queries
  prismaMock.user.findUnique.mockImplementation((args: any) => {
    const user = users.find(u => {
      if (args.where.id) return u.id === args.where.id
      if (args.where.email) return u.email === args.where.email
      return false
    })
    return Promise.resolve(user || null)
  })

  prismaMock.user.findMany.mockResolvedValue(users)

  // Mock account queries
  prismaMock.account.findFirst.mockImplementation((args: any) => {
    const account = accounts.find(a => {
      if (args.where.userId) return a.userId === args.where.userId
      if (args.where.provider && args.where.providerAccountId) {
        return (
          a.provider === args.where.provider &&
          a.providerAccountId === args.where.providerAccountId
        )
      }
      return false
    })
    return Promise.resolve(account || null)
  })

  // Mock session queries
  prismaMock.session.findFirst.mockImplementation((args: any) => {
    const session = sessions.find(s => {
      if (args.where.sessionToken)
        return s.sessionToken === args.where.sessionToken
      if (args.where.userId) return s.userId === args.where.userId
      return false
    })
    return Promise.resolve(session || null)
  })

  prismaMock.session.count.mockImplementation((args: any) => {
    const matchingSessions = sessions.filter(s => {
      if (args.where.userId) return s.userId === args.where.userId
      if (args.where.expires?.gt) return s.expires > args.where.expires.gt
      return true
    })
    return Promise.resolve(matchingSessions.length)
  })
}
