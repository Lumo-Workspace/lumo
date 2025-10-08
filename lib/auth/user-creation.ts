import { PrismaClient } from '@prisma/client'
import { encryptOAuthToken } from '@/lib/utils/encryption'

// Default Prisma client instance
const defaultPrisma = new PrismaClient()

interface GoogleProfile {
  id: string
  email: string
  name?: string
  picture?: string
  verified_email?: boolean
}

interface AccountData {
  provider: string
  type: string
  providerAccountId: string
  access_token: string
  refresh_token: string
  expires_at: number
  token_type: string
  scope: string
}

/**
 * Validates email format
 */
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Creates a new user from Google profile data
 * Handles both new user creation and existing user lookup
 */
export async function createUserFromGoogleProfile(
  googleProfile: GoogleProfile,
  accountData: AccountData,
  prisma: PrismaClient = defaultPrisma
) {
  // Validate email format
  if (!validateEmail(googleProfile.email)) {
    throw new Error('Invalid email format')
  }

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: googleProfile.email },
    })

    if (existingUser) {
      // User exists - this is an account linking scenario
      return existingUser
    }

    // Create new user
    const newUser = await prisma.user.create({
      data: {
        email: googleProfile.email,
        name: googleProfile.name || null,
        profileImage: googleProfile.picture || null,
      },
    })

    // Create user profile
    await prisma.userProfile.create({
      data: {
        userId: newUser.id,
        preferences: {},
        settings: {},
      },
    })

    // Create account with encrypted tokens
    await prisma.account.create({
      data: {
        userId: newUser.id,
        provider: accountData.provider,
        type: accountData.type,
        providerAccountId: accountData.providerAccountId,
        access_token: encryptOAuthToken(accountData.access_token, 'access'),
        refresh_token: encryptOAuthToken(accountData.refresh_token, 'refresh'),
        expires_at: accountData.expires_at,
        token_type: accountData.token_type,
        scope: accountData.scope,
      },
    })

    return newUser
  } catch (error) {
    console.error('Error creating user from Google profile:', error)
    throw error
  }
}

/**
 * Links a Google account to an existing user
 */
export async function linkGoogleAccountToUser(
  userId: string,
  googleProfile: GoogleProfile,
  accountData: AccountData,
  prisma: PrismaClient = defaultPrisma
) {
  try {
    // Check if Google account is already linked to another user
    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: googleProfile.id,
        },
      },
    })

    if (existingAccount && existingAccount.userId !== userId) {
      throw new Error('Google account is already linked to another user')
    }

    // Create or update account
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: googleProfile.id,
        },
      },
      update: {
        access_token: encryptOAuthToken(accountData.access_token, 'access'),
        refresh_token: encryptOAuthToken(accountData.refresh_token, 'refresh'),
        expires_at: accountData.expires_at,
        token_type: accountData.token_type,
        scope: accountData.scope,
      },
      create: {
        userId,
        provider: accountData.provider,
        type: accountData.type,
        providerAccountId: accountData.providerAccountId,
        access_token: encryptOAuthToken(accountData.access_token, 'access'),
        refresh_token: encryptOAuthToken(accountData.refresh_token, 'refresh'),
        expires_at: accountData.expires_at,
        token_type: accountData.token_type,
        scope: accountData.scope,
      },
    })

    // Update user profile with Google data if not already set
    const updateData: any = {}
    if (googleProfile.name) {
      updateData.name = googleProfile.name
    }
    if (googleProfile.picture) {
      updateData.profileImage = googleProfile.picture
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      })
    }
  } catch (error) {
    console.error('Error linking Google account:', error)
    throw error
  }
}

/**
 * Unlinks a Google account from a user
 */
export async function unlinkGoogleAccount(
  userId: string,
  prisma: PrismaClient = defaultPrisma
) {
  try {
    await prisma.account.deleteMany({
      where: {
        userId,
        provider: 'google',
      },
    })
  } catch (error) {
    console.error('Error unlinking Google account:', error)
    throw error
  }
}
