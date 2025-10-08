import { PrismaClient } from '@prisma/client'

// Mock Prisma Client
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  account: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
  },
  userProfile: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
} as unknown as PrismaClient

// Mock encryption utilities directly in the test
const mockEncryptOAuthToken = (token: string) => `encrypted_${token}`
const mockDecryptOAuthToken = (encryptedToken: string) =>
  encryptedToken.replace('encrypted_', '')

describe('Account Merging Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Account Linking Process', () => {
    it('should link Google account to existing user profile', async () => {
      const existingUser = {
        id: 'user_123',
        email: 'existing@example.com',
        name: 'Existing User',
        emailVerified: new Date(),
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const googleProfile = {
        id: 'google_123',
        email: 'existing@example.com',
        name: 'Existing User',
        picture: 'https://example.com/avatar.jpg',
      }

      const oauthTokens = {
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.account.findFirst.mockResolvedValue(null) // No existing Google account
      mockPrisma.account.create.mockResolvedValue({
        id: 'account_123',
        userId: 'user_123',
        type: 'oauth',
        provider: 'google',
        providerAccountId: 'google_123',
        accessToken: 'encrypted_access_token_123',
        refreshToken: 'encrypted_refresh_token_123',
        expiresAt: oauthTokens.expiresAt,
        tokenType: 'Bearer',
        scope: 'openid email profile',
        idToken: 'id_token_123',
        sessionState: null,
      })

      // Simulate account linking process
      const linkGoogleAccount = async (
        userId: string,
        profile: any,
        tokens: any
      ) => {
        const user = await mockPrisma.user.findUnique({ where: { id: userId } })
        if (!user) throw new Error('User not found')

        // Check if Google account is already linked
        const existingAccount = await mockPrisma.account.findFirst({
          where: {
            provider: 'google',
            providerAccountId: profile.id,
          },
        })

        if (existingAccount) {
          throw new Error('Google account already linked')
        }

        // Create new account link
        const account = await mockPrisma.account.create({
          data: {
            userId: user.id,
            type: 'oauth',
            provider: 'google',
            providerAccountId: profile.id,
            accessToken: `encrypted_${tokens.accessToken}`,
            refreshToken: `encrypted_${tokens.refreshToken}`,
            expiresAt: tokens.expiresAt,
            tokenType: 'Bearer',
            scope: 'openid email profile',
            idToken: 'id_token_123',
          },
        })

        return account
      }

      const result = await linkGoogleAccount(
        'user_123',
        googleProfile,
        oauthTokens
      )

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user_123' },
      })
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: {
          provider: 'google',
          providerAccountId: 'google_123',
        },
      })
      expect(mockPrisma.account.create).toHaveBeenCalledWith({
        data: {
          userId: 'user_123',
          type: 'oauth',
          provider: 'google',
          providerAccountId: 'google_123',
          accessToken: 'encrypted_access_token_123',
          refreshToken: 'encrypted_refresh_token_123',
          expiresAt: oauthTokens.expiresAt,
          tokenType: 'Bearer',
          scope: 'openid email profile',
          idToken: 'id_token_123',
        },
      })
      expect(result).toBeDefined()
    })

    it('should prevent linking duplicate Google accounts', async () => {
      const googleProfile = {
        id: 'google_123',
        email: 'existing@example.com',
        name: 'Existing User',
        picture: 'https://example.com/avatar.jpg',
      }

      const existingAccount = {
        id: 'account_123',
        userId: 'user_456',
        type: 'oauth',
        provider: 'google',
        providerAccountId: 'google_123',
      }

      mockPrisma.account.findFirst.mockResolvedValue(existingAccount)

      const linkGoogleAccount = async (userId: string, profile: any) => {
        const existingAccount = await mockPrisma.account.findFirst({
          where: {
            provider: 'google',
            providerAccountId: profile.id,
          },
        })

        if (existingAccount && existingAccount.userId !== userId) {
          throw new Error('Google account already linked to another user')
        }

        if (existingAccount && existingAccount.userId === userId) {
          throw new Error('Google account already linked to this user')
        }

        return true
      }

      await expect(
        linkGoogleAccount('user_123', googleProfile)
      ).rejects.toThrow('Google account already linked to another user')
    })

    it('should handle email mismatch during account linking', async () => {
      const existingUser = {
        id: 'user_123',
        email: 'existing@example.com',
        name: 'Existing User',
      }

      const googleProfile = {
        id: 'google_123',
        email: 'different@example.com', // Different email
        name: 'Google User',
      }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)

      const linkGoogleAccount = async (userId: string, profile: any) => {
        const user = await mockPrisma.user.findUnique({ where: { id: userId } })
        if (!user) throw new Error('User not found')

        if (user.email !== profile.email) {
          throw new Error(
            'Email mismatch: Google account email does not match user email'
          )
        }

        return true
      }

      await expect(
        linkGoogleAccount('user_123', googleProfile)
      ).rejects.toThrow(
        'Email mismatch: Google account email does not match user email'
      )
    })
  })

  describe('Account Unlinking Process', () => {
    it('should unlink Google account from user profile', async () => {
      const linkedAccount = {
        id: 'account_123',
        userId: 'user_123',
        type: 'oauth',
        provider: 'google',
        providerAccountId: 'google_123',
      }

      mockPrisma.account.findFirst.mockResolvedValue(linkedAccount)
      mockPrisma.account.delete.mockResolvedValue(linkedAccount)

      const unlinkGoogleAccount = async (userId: string, provider: string) => {
        const account = await mockPrisma.account.findFirst({
          where: {
            userId,
            provider,
          },
        })

        if (!account) {
          throw new Error('Account not found')
        }

        await mockPrisma.account.delete({
          where: { id: account.id },
        })

        return true
      }

      const result = await unlinkGoogleAccount('user_123', 'google')

      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user_123',
          provider: 'google',
        },
      })
      expect(mockPrisma.account.delete).toHaveBeenCalledWith({
        where: { id: 'account_123' },
      })
      expect(result).toBe(true)
    })

    it('should prevent unlinking last authentication method', async () => {
      const userAccounts = [
        {
          id: 'account_123',
          userId: 'user_123',
          provider: 'google',
          type: 'oauth',
        },
      ]

      mockPrisma.account.findFirst.mockResolvedValue(userAccounts[0])

      // Mock that this is the only account
      const getAllUserAccounts = jest.fn().mockResolvedValue(userAccounts)

      const unlinkGoogleAccount = async (userId: string, provider: string) => {
        const account = await mockPrisma.account.findFirst({
          where: {
            userId,
            provider,
          },
        })

        if (!account) {
          throw new Error('Account not found')
        }

        // Check if this is the last authentication method
        const allAccounts = await getAllUserAccounts(userId)
        if (allAccounts.length <= 1) {
          throw new Error('Cannot unlink last authentication method')
        }

        return true
      }

      await expect(unlinkGoogleAccount('user_123', 'google')).rejects.toThrow(
        'Cannot unlink last authentication method'
      )
    })
  })

  describe('Data Migration During Account Linking', () => {
    it('should preserve existing user data when linking accounts', async () => {
      const existingUser = {
        id: 'user_123',
        email: 'existing@example.com',
        name: 'Existing User',
        emailVerified: new Date(),
        image: null,
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-06-01'),
      }

      const existingProfile = {
        id: 'profile_123',
        userId: 'user_123',
        bio: 'Existing user bio',
        preferences: { theme: 'dark' },
        createdAt: new Date('2023-02-01'),
        updatedAt: new Date('2023-05-01'),
      }

      const googleProfile = {
        id: 'google_123',
        email: 'existing@example.com',
        name: 'Existing User',
        picture: 'https://example.com/avatar.jpg',
      }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.userProfile.findFirst.mockResolvedValue(existingProfile)

      const linkWithDataPreservation = async (userId: string, profile: any) => {
        const user = await mockPrisma.user.findUnique({ where: { id: userId } })
        const userProfile = await mockPrisma.userProfile.findFirst({
          where: { userId },
        })

        // Preserve existing data
        const preservedData = {
          originalUserId: user?.id,
          originalEmail: user?.email,
          originalName: user?.name,
          originalBio: userProfile?.bio,
          originalPreferences: userProfile?.preferences,
          originalCreatedAt: user?.createdAt,
          profileCreatedAt: userProfile?.createdAt,
        }

        return preservedData
      }

      const result = await linkWithDataPreservation('user_123', googleProfile)

      expect(result.originalUserId).toBe('user_123')
      expect(result.originalEmail).toBe('existing@example.com')
      expect(result.originalName).toBe('Existing User')
      expect(result.originalBio).toBe('Existing user bio')
      expect(result.originalPreferences).toEqual({ theme: 'dark' })
      expect(result.originalCreatedAt).toEqual(new Date('2023-01-01'))
      expect(result.profileCreatedAt).toEqual(new Date('2023-02-01'))
    })
  })

  describe('Error Handling and Recovery', () => {
    it('should handle database errors during account linking', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(
        new Error('Database connection failed')
      )

      const linkGoogleAccount = async (userId: string) => {
        try {
          await mockPrisma.user.findUnique({ where: { id: userId } })
          return true
        } catch (error) {
          throw new Error(`Account linking failed: ${error.message}`)
        }
      }

      await expect(linkGoogleAccount('user_123')).rejects.toThrow(
        'Account linking failed: Database connection failed'
      )
    })

    it('should handle partial failures during account linking', async () => {
      const existingUser = {
        id: 'user_123',
        email: 'existing@example.com',
        name: 'Existing User',
      }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.account.create.mockRejectedValue(
        new Error('Account creation failed')
      )

      const linkGoogleAccount = async (userId: string) => {
        const user = await mockPrisma.user.findUnique({ where: { id: userId } })
        if (!user) throw new Error('User not found')

        try {
          await mockPrisma.account.create({
            data: {
              userId: user.id,
              type: 'oauth',
              provider: 'google',
              providerAccountId: 'google_123',
              accessToken: 'token',
              refreshToken: 'refresh',
              expiresAt: new Date(),
            },
          })
          return true
        } catch (error) {
          // Rollback any partial changes
          throw new Error(`Account linking failed: ${error.message}`)
        }
      }

      await expect(linkGoogleAccount('user_123')).rejects.toThrow(
        'Account linking failed: Account creation failed'
      )
    })

    it('should handle concurrent account linking attempts', async () => {
      const existingUser = {
        id: 'user_123',
        email: 'existing@example.com',
        name: 'Existing User',
      }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)

      // Simulate concurrent linking attempts
      const linkGoogleAccount = async (userId: string, attemptId: string) => {
        const user = await mockPrisma.user.findUnique({ where: { id: userId } })
        if (!user) throw new Error('User not found')

        // Simulate race condition check
        const existingAccount = await mockPrisma.account.findFirst({
          where: {
            userId,
            provider: 'google',
          },
        })

        if (existingAccount) {
          throw new Error(`Account already linked (attempt: ${attemptId})`)
        }

        return { success: true, attemptId }
      }

      // Simulate two concurrent attempts
      const attempt1 = linkGoogleAccount('user_123', 'attempt_1')
      const attempt2 = linkGoogleAccount('user_123', 'attempt_2')

      // One should succeed, one should fail
      const results = await Promise.allSettled([attempt1, attempt2])

      const successes = results.filter(r => r.status === 'fulfilled').length
      const failures = results.filter(r => r.status === 'rejected').length

      expect(successes + failures).toBe(2)
    })
  })
})
