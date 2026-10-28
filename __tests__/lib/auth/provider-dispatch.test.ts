/**
 * @jest-environment node
 */
// LUM-1027 / LUM-1077 — the @/lib/auth entry points serve Better Auth, with
// or without AUTH_PROVIDER set. (The user directory is exercised by
// user-directory.conformance.test.ts.)
const mockBaSession = { getCurrentUserId: jest.fn(), getCurrentUser: jest.fn() }
jest.mock('@/lib/auth/better-auth/session', () => mockBaSession)

import { getCurrentUser, getCurrentUserId } from '@/lib/auth/session'
import { isUserDirectoryConfigured } from '@/lib/auth/users'

const saved = process.env.AUTH_PROVIDER
beforeEach(() => jest.clearAllMocks())
afterEach(() => {
  if (saved === undefined) delete process.env.AUTH_PROVIDER
  else process.env.AUTH_PROVIDER = saved
})

describe('session entry point', () => {
  it.each([undefined, 'better-auth'])(
    'uses Better Auth when AUTH_PROVIDER is %s',
    async value => {
      if (value === undefined) delete process.env.AUTH_PROVIDER
      else process.env.AUTH_PROVIDER = value
      mockBaSession.getCurrentUserId.mockResolvedValue('ba_user')
      mockBaSession.getCurrentUser.mockResolvedValue({ id: 'ba_user' })
      await expect(getCurrentUserId()).resolves.toBe('ba_user')
      await expect(getCurrentUser()).resolves.toEqual({ id: 'ba_user' })
      expect(isUserDirectoryConfigured()).toBe(true)
    }
  )
})
