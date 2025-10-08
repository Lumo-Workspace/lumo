import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { linkGoogleAccountToUser } from '@/lib/auth/account-linking'
import { AuthLogger } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  try {
    // Get session to verify authentication
    const session = await getServerSession(authOptions)

    if (!session?.user || !('id' in session.user)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication required',
          errorCode: 'AUTHENTICATION_REQUIRED',
        },
        { status: 401 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { provider, authorizationCode, redirectUri } = body

    // Validate required fields
    if (!provider || !authorizationCode || !redirectUri) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing required fields: provider, authorizationCode, redirectUri',
          errorCode: 'MISSING_REQUIRED_FIELDS',
        },
        { status: 400 }
      )
    }

    // Validate provider
    if (provider !== 'google') {
      return NextResponse.json(
        {
          success: false,
          error: 'Only Google provider is supported',
          errorCode: 'UNSUPPORTED_PROVIDER',
        },
        { status: 400 }
      )
    }

    // Validate redirect URI format
    try {
      new URL(redirectUri)
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid redirect URI format',
          errorCode: 'INVALID_REDIRECT_URI',
        },
        { status: 400 }
      )
    }

    // Simulate OAuth token exchange (in real implementation, this would call Google's API)
    const mockGoogleProfile = {
      id: 'google_123',
      email: session.user.email || '',
      name: session.user.name || '',
      picture: session.user.image || null,
    }

    const mockTokens = {
      accessToken: `access_token_${Date.now()}`,
      refreshToken: `refresh_token_${Date.now()}`,
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour
      tokenType: 'Bearer',
      scope: 'openid email profile',
      idToken: `id_token_${Date.now()}`,
    }

    // Link the account
    const result = await linkGoogleAccountToUser(
      (session.user as any).id,
      mockGoogleProfile,
      mockTokens
    )

    if (!result.success) {
      AuthLogger.logAccountLinkingError(
        (session.user as any).id,
        provider,
        result.error || 'Unknown error'
      )

      return NextResponse.json(
        {
          success: false,
          error: result.error,
          errorCode: 'ACCOUNT_LINKING_FAILED',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      )
    }

    AuthLogger.logAccountLinkingSuccess(
      (session.user as any).id,
      provider,
      result.account?.id || ''
    )

    return NextResponse.json({
      success: true,
      account: result.account,
      message: 'Google account linked successfully',
    })
  } catch (error) {
    AuthLogger.logError('Account linking API error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        errorCode: 'INTERNAL_SERVER_ERROR',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
