/**
 * @jest-environment node
 */
// LUM-1027 — the @/lib/auth entry points dispatch on AUTH_PROVIDER: Clerk by
// default (unchanged), Better Auth when selected. (The user directory's
// dispatch is exercised by user-directory.conformance.test.ts.)
const mockClerkAuth = jest.fn()
const mockClerkCurrentUser = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({
  auth: () => mockClerkAuth(),
  currentUser: () => mockClerkCurrentUser(),
  clerkClient: jest.fn(),
  createClerkClient: jest.fn(),
}))
const mockBaSession = { getCurrentUserId: jest.fn(), getCurrentUser: jest.fn() }
jest.mock('@/lib/auth/better-auth/session', () => mockBaSession)

import { getCurrentUser, getCurrentUserId } from '@/lib/auth/session'
import { isUserDirectoryConfigured } from '@/lib/auth/users'

const ENV = ['AUTH_PROVIDER', 'CLERK_SECRET_KEY'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  jest.clearAllMocks()
  for (const k of ENV) saved[k] = process.env[k]
  delete process.env.CLERK_SECRET_KEY
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('provider dispatch', () => {
  it('uses Clerk when AUTH_PROVIDER is unset', async () => {
    delete process.env.AUTH_PROVIDER
    mockClerkAuth.mockResolvedValue({ userId: 'user_clerk' })
    mockClerkCurrentUser.mockResolvedValue({ id: 'user_clerk' })
    await expect(getCurrentUserId()).resolves.toBe('user_clerk')
    await expect(getCurrentUser()).resolves.toEqual({ id: 'user_clerk' })
    expect(mockBaSession.getCurrentUserId).not.toHaveBeenCalled()
    expect(isUserDirectoryConfigured()).toBe(false)
  })

  it('uses Better Auth when AUTH_PROVIDER=better-auth', async () => {
    process.env.AUTH_PROVIDER = 'better-auth'
    mockBaSession.getCurrentUserId.mockResolvedValue('ba_user')
    mockBaSession.getCurrentUser.mockResolvedValue({ id: 'ba_user' })
    await expect(getCurrentUserId()).resolves.toBe('ba_user')
    await expect(getCurrentUser()).resolves.toEqual({ id: 'ba_user' })
    expect(isUserDirectoryConfigured()).toBe(true)
    expect(mockClerkAuth).not.toHaveBeenCalled()
  })
})
