/**
 * NextAuth Callbacks Unit Tests
 *
 * Tests JWT and session callbacks
 *
 * Requirements:
 * - UR-001: Auto-create profile on first login
 * - SR-015: Enforce concurrent session limits
 */

import { authOptions } from '@/lib/auth/config'
import { prismaMock, resetPrismaMock } from '../__mocks__/prisma'
import {
  createMockToken,
  createMockSession,
  createMockUser,
  createMockAccount,
  createMockGoogleProfile,
} from './test-utils'

describe('NextAuth Callbacks', () => {
  beforeEach(() => {
    resetPrismaMock()
  })

  describe('jwt callback', () => {
    const jwtCallback = authOptions.callbacks?.jwt!

    it('should add user info to token on initial sign in', async () => {
      const token = createMockToken()
      const user = createMockUser()
      const account = createMockAccount()
      const profile = createMockGoogleProfile()

      const result = await jwtCallback({
        token,
        user,
        account,
        profile,
        trigger: 'signIn',
        isNewUser: true,
        session: undefined,
      })

      expect(result.userId).toBe(user.id)
      expect(result.email).toBe(user.email)
      expect(result.picture).toBe(user.image)
      expect(result.name).toBe(user.name)
    })

    it('should preserve existing token data when no account/profile provided', async () => {
      const existingToken = createMockToken({
        userId: 'existing-user-id',
        email: 'existing@example.com',
        name: 'Existing User',
      })

      const result = await jwtCallback({
        token: existingToken,
        trigger: 'update',
        session: undefined,
      })

      expect(result.userId).toBe('existing-user-id')
      expect(result.email).toBe('existing@example.com')
      expect(result.name).toBe('Existing User')
    })

    it('should handle missing profile gracefully', async () => {
      const token = createMockToken()
      const user = createMockUser()
      const account = createMockAccount()

      const result = await jwtCallback({
        token,
        user,
        account,
        profile: undefined,
        trigger: 'signIn',
        isNewUser: true,
        session: undefined,
      })

      // Should still set user data from user object
      expect(result.userId).toBe(user.id)
      expect(result.email).toBe(user.email)
    })
  })

  describe('session callback', () => {
    const sessionCallback = authOptions.callbacks?.session!

    it('should include user info in session from token', async () => {
      const session = createMockSession()
      const token = createMockToken({
        userId: 'token-user-id',
        email: 'token@example.com',
        picture: 'https://example.com/token-avatar.jpg',
        name: 'Token User',
      })

      const result = await sessionCallback({
        session,
        token,
        user: createMockUser(),
        trigger: 'getSession',
        newSession: undefined,
      })

      expect(result.user?.id).toBe('token-user-id')
      expect(result.user?.email).toBe('token@example.com')
      expect(result.user?.image).toBe('https://example.com/token-avatar.jpg')
      expect(result.user?.name).toBe('Token User')
    })

    it('should preserve other session properties', async () => {
      const session = createMockSession({
        expires: '2025-12-31T23:59:59.000Z',
      })
      const token = createMockToken()

      const result = await sessionCallback({
        session,
        token,
        user: createMockUser(),
        trigger: 'getSession',
        newSession: undefined,
      })

      expect(result.expires).toBe('2025-12-31T23:59:59.000Z')
    })

    it('should handle missing token gracefully', async () => {
      const session = createMockSession()

      const result = await sessionCallback({
        session,
        token: {} as any,
        user: createMockUser(),
        trigger: 'getSession',
        newSession: undefined,
      })

      // Session should still be returned even with empty token
      expect(result).toBeDefined()
      expect(result.user).toBeDefined()
    })
  })

  describe('signIn callback', () => {
    const signInCallback = authOptions.callbacks?.signIn!

    beforeEach(() => {
      // Mock console.error to suppress expected error logs
      jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should allow sign in with valid Google provider', async () => {
      const user = createMockUser()
      const account = createMockAccount()
      const profile = createMockGoogleProfile()

      prismaMock.session.count.mockResolvedValue(0)

      const result = await signInCallback({
        user,
        account,
        profile,
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(true)
    })

    it('should reject non-Google providers', async () => {
      const user = createMockUser()
      const account = createMockAccount({ provider: 'github' })
      const profile = createMockGoogleProfile()

      const result = await signInCallback({
        user,
        account,
        profile,
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(false)
      expect(console.error).toHaveBeenCalledWith(
        'Invalid OAuth provider:',
        'github'
      )
    })

    it('should reject sign in when email is missing from profile', async () => {
      const user = createMockUser()
      const account = createMockAccount()
      const profile = createMockGoogleProfile({ email: undefined })

      const result = await signInCallback({
        user,
        account,
        profile,
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(false)
      expect(console.error).toHaveBeenCalledWith(
        'No email provided by Google OAuth'
      )
    })

    it('should enforce max concurrent sessions limit (SR-015)', async () => {
      const user = createMockUser({ id: 'user-with-sessions' })
      const account = createMockAccount()
      const profile = createMockGoogleProfile()

      // Mock 3 active sessions (at limit)
      prismaMock.session.count.mockResolvedValue(3)

      const oldestSession = {
        id: 'oldest-session-id',
        sessionToken: 'oldest-token',
        userId: 'user-with-sessions',
        expires: new Date(Date.now() + 1000),
        createdAt: new Date(Date.now() - 10000),
      }

      prismaMock.session.findFirst.mockResolvedValue(oldestSession)
      prismaMock.session.delete.mockResolvedValue(oldestSession)

      const result = await signInCallback({
        user,
        account,
        profile,
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(true)
      // Should delete oldest session
      expect(prismaMock.session.delete).toHaveBeenCalledWith({
        where: { id: 'oldest-session-id' },
      })
    })

    it('should allow sign in when under session limit', async () => {
      const user = createMockUser({ id: 'user-with-few-sessions' })
      const account = createMockAccount()
      const profile = createMockGoogleProfile()

      // Mock 2 active sessions (under limit of 3)
      prismaMock.session.count.mockResolvedValue(2)

      const result = await signInCallback({
        user,
        account,
        profile,
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(true)
      // Should NOT delete any sessions
      expect(prismaMock.session.delete).not.toHaveBeenCalled()
    })

    it('should handle database errors gracefully during session check', async () => {
      const user = createMockUser()
      const account = createMockAccount()
      const profile = createMockGoogleProfile()

      prismaMock.session.count.mockRejectedValue(new Error('Database error'))

      // Should still attempt sign in even if session count fails
      await expect(
        signInCallback({
          user,
          account,
          profile,
          email: { verificationRequest: false },
          credentials: undefined,
        })
      ).rejects.toThrow('Database error')
    })
  })
})
