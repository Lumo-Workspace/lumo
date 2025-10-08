import { PrismaClient } from '@prisma/client'
import { AuthLogger } from '@/lib/utils/logger'

export interface AccountMergeResult {
  success: boolean
  mergedAccountId?: string
  preservedData?: {
    originalUserId: string
    originalEmail: string | null
    originalName: string
    originalBio?: string
    originalPreferences?: any
    originalCreatedAt: Date
    profileCreatedAt?: Date
  }
  error?: string
}

export async function mergeGoogleAccountWithExistingUser(
  existingUserId: string,
  googleProfile: {
    id: string
    email: string
    name: string
    picture?: string
  },
  oauthTokens: {
    accessToken: string
    refreshToken: string
    expiresAt: Date
  },
  prisma: PrismaClient = new PrismaClient()
): Promise<AccountMergeResult> {
  try {
    AuthLogger.logAccountMergeAttempt(existingUserId, googleProfile.email)

    // Get existing user data
    const existingUser = await prisma.user.findUnique({
      where: { id: existingUserId },
      include: {
        profile: true,
        accounts: true,
      },
    })

    if (!existingUser) {
      return {
        success: false,
        error: 'Existing user not found',
      }
    }

    // Preserve original data
    const preservedData = {
      originalUserId: existingUser.id,
      originalEmail: existingUser.email,
      originalName: existingUser.name || '',
      originalPreferences: existingUser.profile?.preferences,
      originalCreatedAt: existingUser.createdAt,
    }

    // Check if Google account is already linked
    const existingGoogleAccount = existingUser.accounts.find(
      account => account.provider === 'google'
    )

    if (existingGoogleAccount) {
      return {
        success: false,
        error: 'Google account already linked to this user',
      }
    }

    // Create Google account link
    const googleAccount = await prisma.account.create({
      data: {
        userId: existingUser.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: googleProfile.id,
        access_token: oauthTokens.accessToken,
        refresh_token: oauthTokens.refreshToken,
        expires_at: oauthTokens.expiresAt.getTime(),
        token_type: 'Bearer',
        scope: 'openid email profile',
      },
    })

    // Update user profile with Google picture if not already set
    if (!existingUser.image && googleProfile.picture) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          image: googleProfile.picture,
        },
      })
    }

    AuthLogger.logAccountMergeSuccess(existingUserId, googleAccount.id)

    return {
      success: true,
      mergedAccountId: googleAccount.id,
      preservedData,
    }
  } catch (error) {
    AuthLogger.logAccountMergeError(
      existingUserId,
      error instanceof Error ? error.message : 'Unknown error'
    )
    return {
      success: false,
      error: `Account merging failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

export async function handleAccountLinkingConflict(
  existingUserId: string,
  googleUserId: string,
  prisma: PrismaClient = new PrismaClient()
): Promise<AccountMergeResult> {
  try {
    AuthLogger.logAccountConflictResolution(existingUserId, googleUserId)

    // Get both user records
    const existingUser = await prisma.user.findUnique({
      where: { id: existingUserId },
      include: { profile: true, accounts: true },
    })

    const googleUser = await prisma.user.findUnique({
      where: { id: googleUserId },
      include: { profile: true, accounts: true },
    })

    if (!existingUser || !googleUser) {
      return {
        success: false,
        error: 'One or both users not found',
      }
    }

    // Preserve existing user data
    const preservedData = {
      originalUserId: existingUser.id,
      originalEmail: existingUser.email,
      originalName: existingUser.name || '',
      originalPreferences: existingUser.profile?.preferences,
      originalCreatedAt: existingUser.createdAt,
    }

    // Transfer Google account to existing user
    const googleAccount = googleUser.accounts.find(
      account => account.provider === 'google'
    )

    if (googleAccount) {
      await prisma.account.update({
        where: { id: googleAccount.id },
        data: { userId: existingUser.id },
      })
    }

    // Merge user profiles if needed
    if (googleUser.profile && !existingUser.profile) {
      await prisma.userProfile.create({
        data: {
          userId: existingUser.id,
          preferences: googleUser.profile.preferences || {},
        },
      })
    }

    // Delete the duplicate Google user
    await prisma.user.delete({
      where: { id: googleUserId },
    })

    AuthLogger.logAccountConflictResolutionSuccess(existingUserId, googleUserId)

    return {
      success: true,
      mergedAccountId: googleAccount?.id || '',
      preservedData,
    }
  } catch (error) {
    AuthLogger.logAccountConflictResolutionError(
      existingUserId,
      googleUserId,
      error instanceof Error ? error.message : 'Unknown error'
    )
    return {
      success: false,
      error: `Account conflict resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

export async function validateAccountMergeData(
  existingUserId: string,
  googleProfile: { email: string; id: string },
  prisma: PrismaClient = new PrismaClient()
): Promise<{ isValid: boolean; error?: string }> {
  try {
    // Check if existing user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: existingUserId },
    })

    if (!existingUser) {
      return {
        isValid: false,
        error: 'Existing user not found',
      }
    }

    // Check email match
    if (existingUser.email !== googleProfile.email) {
      return {
        isValid: false,
        error:
          'Email mismatch: Google account email does not match existing user email',
      }
    }

    // Check if Google account is already linked to another user
    const existingGoogleAccount = await prisma.account.findFirst({
      where: {
        provider: 'google',
        providerAccountId: googleProfile.id,
      },
    })

    if (
      existingGoogleAccount &&
      existingGoogleAccount.userId !== existingUserId
    ) {
      return {
        isValid: false,
        error: 'Google account already linked to another user',
      }
    }

    return { isValid: true }
  } catch (error) {
    return {
      isValid: false,
      error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}
