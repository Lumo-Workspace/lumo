/**
 * OAuth Flow Integration Tests
 *
 * End-to-end tests for complete OAuth authentication flow
 *
 * Requirements:
 * - UR-001: New user can sign in with Google
 * - UR-002: Redirect to dashboard after successful login
 * - UR-005: Display errors on OAuth failure
 *
 * Flow: Login page → Google consent → Callback → Dashboard
 */

import { authOptions } from '@/lib/auth/config'
import {
  prismaMock,
  resetPrismaMock,
  createMockDatabaseState,
} from '../__mocks__/prisma'
import {
  createMockUser,
  createMockAccount,
  createMockGoogleProfile,
  mockAuthEnv,
  clearAuthEnv,
} from '../auth/test-utils'

describe('OAuth Flow Integration', () => {
  beforeEach(() => {
    mockAuthEnv()
    resetPrismaMock()
  })

  afterAll(() => {
    clearAuthEnv()
  })

  describe('Complete OAuth Flow - New User', () => {
    it('should complete full OAuth flow for new user', async () => {
      const googleProfile = createMockGoogleProfile()
      const newUser = createMockUser({
        id: 'new-user-id',
        email: googleProfile.email,
        name: googleProfile.name,
        image: googleProfile.picture,
      })

      // Mock Prisma adapter behavior for new user
      prismaMock.user.findUnique.mockResolvedValue(null) // User doesn't exist
      prismaMock.user.create.mockResolvedValue(newUser)
      prismaMock.account.create.mockResolvedValue(
        createMockAccount({ userId: newUser.id })
      )
      prismaMock.session.count.mockResolvedValue(0)

      // Step 1: signIn callback validates provider and profile
      const signInCallback = authOptions.callbacks?.signIn!
      const signInResult = await signInCallback({
        user: newUser,
        account: createMockAccount({ userId: newUser.id }),
        profile: googleProfile,
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(signInResult).toBe(true)

      // Step 2: jwt callback creates token with user info
      const jwtCallback = authOptions.callbacks?.jwt!
      const tokenResult = await jwtCallback({
        token: {},
        user: newUser,
        account: createMockAccount({ userId: newUser.id }),
        profile: googleProfile,
        trigger: 'signIn',
        isNewUser: true,
        session: undefined,
      })

      expect(tokenResult.userId).toBe(newUser.id)
      expect(tokenResult.email).toBe(newUser.email)
      expect(tokenResult.name).toBe(newUser.name)

      // Step 3: session callback creates session with user data
      const sessionCallback = authOptions.callbacks?.session!
      const sessionResult = await sessionCallback({
        session: {
          user: {} as any,
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        token: tokenResult,
        user: newUser,
        trigger: 'getSession',
        newSession: undefined,
      })

      expect(sessionResult.user?.id).toBe(newUser.id)
      expect(sessionResult.user?.email).toBe(newUser.email)
      expect(sessionResult.user?.name).toBe(newUser.name)
      expect(sessionResult.user?.image).toBe(newUser.image)
    })

    it('should auto-create user profile on first login (UR-001)', async () => {
      const googleProfile = createMockGoogleProfile({
        email: 'newuser@example.com',
        name: 'New User',
        picture: 'https://example.com/newuser.jpg',
      })

      const newUser = createMockUser({
        email: googleProfile.email,
        name: googleProfile.name,
        image: googleProfile.picture,
        emailVerified: new Date(),
      })

      prismaMock.user.create.mockResolvedValue(newUser)

      // Verify user creation would happen via Prisma adapter
      expect(authOptions.adapter).toBeDefined()
      expect(authOptions.adapter?.createUser).toBeDefined()
    })
  })

  describe('Complete OAuth Flow - Existing User', () => {
    it('should sign in existing user successfully', async () => {
      const existingUser = createMockUser({
        id: 'existing-user-id',
        email: 'existing@example.com',
      })

      const existingAccount = createMockAccount({
        userId: existingUser.id,
        providerAccountId: 'google-123456',
      })

      // Mock existing user and account
      prismaMock.user.findUnique.mockResolvedValue(existingUser)
      prismaMock.account.findFirst.mockResolvedValue(existingAccount)
      prismaMock.session.count.mockResolvedValue(1) // One existing session

      const signInCallback = authOptions.callbacks?.signIn!
      const signInResult = await signInCallback({
        user: existingUser,
        account: existingAccount,
        profile: createMockGoogleProfile({ email: existingUser.email }),
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(signInResult).toBe(true)
    })

    it('should update lastUsedAt timestamp on sign in', async () => {
      const user = createMockUser()
      const account = createMockAccount({ userId: user.id })

      prismaMock.session.count.mockResolvedValue(0)
      prismaMock.account.updateMany.mockResolvedValue({ count: 1 })

      // Trigger signIn event
      const signInEvent = authOptions.events?.signIn!
      await signInEvent({
        user,
        account,
        profile: createMockGoogleProfile(),
        isNewUser: false,
      })

      // Verify account lastUsedAt was updated
      expect(prismaMock.account.updateMany).toHaveBeenCalledWith({
        where: {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
        data: {
          lastUsedAt: expect.any(Date),
        },
      })
    })
  })

  describe('OAuth Error Scenarios', () => {
    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should reject OAuth flow if provider is not Google', async () => {
      const signInCallback = authOptions.callbacks?.signIn!

      const result = await signInCallback({
        user: createMockUser(),
        account: createMockAccount({ provider: 'github' }),
        profile: createMockGoogleProfile(),
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(false)
      expect(console.error).toHaveBeenCalledWith(
        'Invalid OAuth provider:',
        'github'
      )
    })

    it('should reject OAuth flow if email is missing', async () => {
      const signInCallback = authOptions.callbacks?.signIn!

      const result = await signInCallback({
        user: createMockUser(),
        account: createMockAccount(),
        profile: createMockGoogleProfile({ email: undefined }),
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(false)
      expect(console.error).toHaveBeenCalledWith(
        'No email provided by Google OAuth'
      )
    })

    it('should redirect to error page on callback failure', () => {
      expect(authOptions.pages?.error).toBe('/login')
    })
  })

  describe('Session Management During OAuth', () => {
    it('should enforce concurrent session limit (SR-015)', async () => {
      const user = createMockUser({ id: 'user-with-max-sessions' })
      const account = createMockAccount({ userId: user.id })

      // Mock max sessions (3)
      prismaMock.session.count.mockResolvedValue(3)

      const oldestSession = {
        id: 'oldest-session',
        sessionToken: 'old-token',
        userId: user.id,
        expires: new Date(Date.now() + 1000),
        createdAt: new Date(Date.now() - 100000),
      }

      prismaMock.session.findFirst.mockResolvedValue(oldestSession)
      prismaMock.session.delete.mockResolvedValue(oldestSession)

      const signInCallback = authOptions.callbacks?.signIn!
      const result = await signInCallback({
        user,
        account,
        profile: createMockGoogleProfile(),
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(true)
      expect(prismaMock.session.delete).toHaveBeenCalledWith({
        where: { id: 'oldest-session' },
      })
    })

    it('should create session with 24-hour expiration', () => {
      const expectedSeconds = 24 * 60 * 60
      expect(authOptions.session?.maxAge).toBe(expectedSeconds)
    })
  })

  describe('Redirect Flow', () => {
    it('should redirect to /login on error', () => {
      expect(authOptions.pages?.error).toBe('/login')
    })

    it('should use custom sign in page', () => {
      expect(authOptions.pages?.signIn).toBe('/login')
    })
  })
})
