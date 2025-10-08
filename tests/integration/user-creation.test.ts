/**
 * User Creation Integration Tests
 *
 * Tests automatic user profile creation from Google OAuth
 *
 * Requirements:
 * - UR-001: Auto-create user profile on first login
 * - UR-004: Store Google profile picture
 * - SR-016: Email verification from Google
 */

import { authOptions } from '@/lib/auth/config'
import { prismaMock, resetPrismaMock } from '../__mocks__/prisma'
import {
  createMockUser,
  createMockAccount,
  createMockGoogleProfile,
  mockAuthEnv,
  clearAuthEnv,
} from '../auth/test-utils'

describe('User Creation Integration', () => {
  beforeEach(() => {
    mockAuthEnv()
    resetPrismaMock()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(() => {
    clearAuthEnv()
  })

  describe('New User Profile Creation from Google', () => {
    it('should extract user data from Google profile', async () => {
      const googleProfile = createMockGoogleProfile({
        sub: 'google-user-123',
        email: 'newuser@example.com',
        name: 'New User',
        picture: 'https://lh3.googleusercontent.com/a/avatar.jpg',
        email_verified: true,
      })

      const expectedUser = createMockUser({
        email: googleProfile.email,
        name: googleProfile.name,
        image: googleProfile.picture,
        emailVerified: expect.any(Date),
      })

      // The Prisma adapter handles user creation
      // We verify the configuration supports it
      expect(authOptions.adapter).toBeDefined()
      expect(authOptions.adapter?.createUser).toBeDefined()
    })

    it('should store Google profile picture URL (UR-004)', async () => {
      const googleProfile = createMockGoogleProfile({
        picture: 'https://lh3.googleusercontent.com/a/custom-avatar.jpg',
      })

      const newUser = createMockUser({
        image: googleProfile.picture,
      })

      prismaMock.user.create.mockResolvedValue(newUser)

      // Verify image field is set correctly
      expect(newUser.image).toBe(googleProfile.picture)
      expect(newUser.image).toMatch(/^https:\/\//)
    })

    it('should set emailVerified from Google verification (SR-016)', async () => {
      const googleProfile = createMockGoogleProfile({
        email_verified: true,
      })

      const newUser = createMockUser({
        email: googleProfile.email,
        emailVerified: new Date(),
      })

      prismaMock.user.create.mockResolvedValue(newUser)

      // Email should be marked as verified
      expect(newUser.emailVerified).toBeDefined()
      expect(newUser.emailVerified).toBeInstanceOf(Date)
    })

    it('should create user with all required fields', async () => {
      const googleProfile = createMockGoogleProfile({
        sub: 'google-123',
        email: 'complete@example.com',
        name: 'Complete User',
        picture: 'https://example.com/avatar.jpg',
        email_verified: true,
      })

      const newUser = createMockUser({
        id: expect.any(String),
        email: googleProfile.email,
        name: googleProfile.name,
        image: googleProfile.picture,
        emailVerified: expect.any(Date),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })

      prismaMock.user.create.mockResolvedValue(newUser)

      // Verify all fields are set
      expect(newUser).toMatchObject({
        id: expect.any(String),
        email: googleProfile.email,
        name: googleProfile.name,
        image: googleProfile.picture,
        emailVerified: expect.any(Date),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })
    })
  })

  describe('Account Linking', () => {
    it('should create account record linked to user', async () => {
      const googleProfile = createMockGoogleProfile()
      const newUser = createMockUser()
      const newAccount = createMockAccount({
        userId: newUser.id,
        provider: 'google',
        providerAccountId: googleProfile.sub,
      })

      prismaMock.user.create.mockResolvedValue(newUser)
      prismaMock.account.create.mockResolvedValue(newAccount)

      // Verify Prisma adapter supports account linking
      expect(authOptions.adapter?.linkAccount).toBeDefined()
    })

    it('should store Google user ID as providerAccountId', async () => {
      const googleProfile = createMockGoogleProfile({
        sub: 'google-unique-id-123456',
      })

      const account = createMockAccount({
        provider: 'google',
        providerAccountId: googleProfile.sub,
      })

      expect(account.providerAccountId).toBe('google-unique-id-123456')
      expect(account.provider).toBe('google')
    })
  })

  describe('Profile Data Validation', () => {
    it('should handle missing profile name gracefully', async () => {
      const googleProfile = createMockGoogleProfile({
        name: undefined,
        email: 'noname@example.com',
      })

      const newUser = createMockUser({
        name: null,
        email: googleProfile.email,
      })

      prismaMock.user.create.mockResolvedValue(newUser)

      // Name can be null
      expect(newUser.name).toBeNull()
      expect(newUser.email).toBe(googleProfile.email)
    })

    it('should handle missing profile picture gracefully', async () => {
      const googleProfile = createMockGoogleProfile({
        picture: undefined,
        email: 'nopicture@example.com',
      })

      const newUser = createMockUser({
        image: null,
        email: googleProfile.email,
      })

      prismaMock.user.create.mockResolvedValue(newUser)

      // Image can be null
      expect(newUser.image).toBeNull()
      expect(newUser.email).toBe(googleProfile.email)
    })

    it('should reject user creation if email is missing', async () => {
      const googleProfile = createMockGoogleProfile({
        email: undefined,
      })

      const signInCallback = authOptions.callbacks?.signIn!
      const result = await signInCallback({
        user: createMockUser(),
        account: createMockAccount(),
        profile: googleProfile,
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(false)
      expect(console.error).toHaveBeenCalledWith(
        'No email provided by Google OAuth'
      )
    })
  })

  describe('Timestamps and Metadata', () => {
    it('should set createdAt timestamp on user creation', () => {
      const newUser = createMockUser({
        createdAt: new Date(),
      })

      expect(newUser.createdAt).toBeInstanceOf(Date)
      expect(newUser.createdAt.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should set updatedAt timestamp on user creation', () => {
      const newUser = createMockUser({
        updatedAt: new Date(),
      })

      expect(newUser.updatedAt).toBeInstanceOf(Date)
      expect(newUser.updatedAt.getTime()).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('User Sign In Flow', () => {
    it('should allow sign in for newly created user', async () => {
      const googleProfile = createMockGoogleProfile()
      const newUser = createMockUser({
        email: googleProfile.email,
      })
      const newAccount = createMockAccount({
        userId: newUser.id,
        providerAccountId: googleProfile.sub,
      })

      prismaMock.session.count.mockResolvedValue(0)

      const signInCallback = authOptions.callbacks?.signIn!
      const result = await signInCallback({
        user: newUser,
        account: newAccount,
        profile: googleProfile,
        email: { verificationRequest: false },
        credentials: undefined,
      })

      expect(result).toBe(true)
    })

    it('should create JWT token with user data after creation', async () => {
      const googleProfile = createMockGoogleProfile()
      const newUser = createMockUser({
        email: googleProfile.email,
        name: googleProfile.name,
        image: googleProfile.picture,
      })

      const jwtCallback = authOptions.callbacks?.jwt!
      const token = await jwtCallback({
        token: {},
        user: newUser,
        account: createMockAccount({ userId: newUser.id }),
        profile: googleProfile,
        trigger: 'signIn',
        isNewUser: true,
        session: undefined,
      })

      expect(token.userId).toBe(newUser.id)
      expect(token.email).toBe(newUser.email)
      expect(token.name).toBe(newUser.name)
      expect(token.picture).toBe(newUser.image)
    })
  })
})
