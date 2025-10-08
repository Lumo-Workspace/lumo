import { PrismaClient } from '@prisma/client'
import { encryptOAuthToken } from '@/lib/utils/encryption'
import { AuthLogger } from '@/lib/utils/logger'

export interface GoogleProfile {
  id: string
  email: string
  name: string
  picture?: string | null
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  tokenType?: string
  scope?: string
  idToken?: string
}

export interface AccountLinkingResult {
  success: boolean
  account?: {
    id: string
    provider: string
    providerAccountId: string
    userId: string
    linkedAt: Date
  }
  error?: string
}

export async function linkGoogleAccountToUser(
  userId: string,
  profile: GoogleProfile,
  tokens: OAuthTokens,
  prisma: PrismaClient = new PrismaClient()
): Promise<AccountLinkingResult> {
  try {
    AuthLogger.logAccountLinkingAttempt(userId, 'google', profile.email)

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      AuthLogger.logAccountLinkingError(userId, 'google', 'User not found')
      return {
        success: false,
        error: 'User not found',
      }
    }

    // Check if Google account is already linked to this user
    const existingUserAccount = await prisma.account.findFirst({
      where: {
        userId,
        provider: 'google',
      },
    })

    if (existingUserAccount) {
      AuthLogger.logAccountLinkingError(
        userId,
        'google',
        'Account already linked to this user'
      )
      return {
        success: false,
        error: 'Google account already linked to this user',
      }
    }

    // Check if Google account is already linked to another user
    const existingGoogleAccount = await prisma.account.findFirst({
      where: {
        provider: 'google',
        providerAccountId: profile.id,
      },
    })

    if (existingGoogleAccount && existingGoogleAccount.userId !== userId) {
      AuthLogger.logAccountLinkingError(
        userId,
        'google',
        'Account already linked to another user'
      )
      return {
        success: false,
        error: 'Google account already linked to another user',
      }
    }

    // Validate email match
    if (user.email !== profile.email) {
      AuthLogger.logAccountLinkingError(userId, 'google', 'Email mismatch')
      return {
        success: false,
        error: 'Email mismatch: Google account email does not match user email',
      }
    }

    // Encrypt tokens
    const encryptedAccessToken = encryptOAuthToken(tokens.accessToken, 'access')
    const encryptedRefreshToken = encryptOAuthToken(
      tokens.refreshToken,
      'refresh'
    )

    // Create account link
    const account = await prisma.account.create({
      data: {
        userId: user.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: profile.id,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        expires_at: tokens.expiresAt.getTime(),
        token_type: tokens.tokenType || 'Bearer',
        scope: tokens.scope || 'openid email profile',
        id_token: tokens.idToken || null,
      },
    })

    AuthLogger.logAccountLinkingSuccess(userId, 'google', account.id)

    return {
      success: true,
      account: {
        id: account.id,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        userId: account.userId,
        linkedAt: new Date(),
      },
    }
  } catch (error) {
    AuthLogger.logAccountLinkingError(
      userId,
      'google',
      error instanceof Error ? error.message : 'Unknown error'
    )
    return {
      success: false,
      error: `Account linking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

export async function unlinkGoogleAccountFromUser(
  userId: string,
  provider: string = 'google',
  prisma: PrismaClient = new PrismaClient()
): Promise<AccountLinkingResult> {
  try {
    AuthLogger.logAccountUnlinkingAttempt(userId, provider)

    // Find the account to unlink
    const account = await prisma.account.findFirst({
      where: {
        userId,
        provider,
      },
    })

    if (!account) {
      AuthLogger.logAccountUnlinkingError(userId, provider, 'Account not found')
      return {
        success: false,
        error: 'Account not found',
      }
    }

    // Check if this is the last authentication method
    const allUserAccounts = await prisma.account.findMany({
      where: { userId },
    })

    if (allUserAccounts.length <= 1) {
      AuthLogger.logAccountUnlinkingError(
        userId,
        provider,
        'Cannot unlink last authentication method'
      )
      return {
        success: false,
        error: 'Cannot unlink last authentication method',
      }
    }

    // Delete the account
    await prisma.account.delete({
      where: { id: account.id },
    })

    AuthLogger.logAccountUnlinkingSuccess(userId, provider, account.id)

    return {
      success: true,
    }
  } catch (error) {
    AuthLogger.logAccountUnlinkingError(
      userId,
      provider,
      error instanceof Error ? error.message : 'Unknown error'
    )
    return {
      success: false,
      error: `Account unlinking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

export async function getUserLinkedAccounts(
  userId: string,
  prisma: PrismaClient = new PrismaClient()
): Promise<
  Array<{
    id: string
    provider: string
    providerAccountId: string
    linkedAt: Date
    isActive: boolean
  }>
> {
  try {
    const accounts = await prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
      },
    })

    return accounts.map(account => ({
      id: account.id,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      linkedAt: new Date(), // Use current date as fallback
      isActive: true, // Assume active if exists
    }))
  } catch (error) {
    AuthLogger.logError('Failed to get user linked accounts', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return []
  }
}
