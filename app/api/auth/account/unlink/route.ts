import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { unlinkGoogleAccountFromUser } from '@/lib/auth/account-linking'
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
    const { provider } = body

    // Validate required fields
    if (!provider) {
      return NextResponse.json(
        {
          success: false,
          error: 'Provider is required',
          errorCode: 'MISSING_PROVIDER',
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

    // Unlink the account
    const result = await unlinkGoogleAccountFromUser(
      (session.user as any).id,
      provider
    )

    if (!result.success) {
      AuthLogger.logAccountUnlinkingError(
        (session.user as any).id,
        provider,
        result.error || 'Unknown error'
      )

      return NextResponse.json(
        {
          success: false,
          error: result.error,
          errorCode: 'ACCOUNT_UNLINKING_FAILED',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      )
    }

    AuthLogger.logAccountUnlinkingSuccess(
      (session.user as any).id,
      provider,
      'unlinked_account_id'
    )

    return NextResponse.json({
      success: true,
      message: 'Google account unlinked successfully',
      unlinkedAt: new Date().toISOString(),
    })
  } catch (error) {
    AuthLogger.logError('Account unlinking API error', {
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
