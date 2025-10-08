import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { validateUserSession } from './user-lookup'
import { AuthLogger } from '@/lib/utils/logger'

/**
 * Middleware to validate user sessions
 */
export async function validateSessionMiddleware(
  request: NextRequest
): Promise<NextResponse | null> {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET!!,
    })

    if (!token) {
      AuthLogger.log({
        timestamp: new Date().toISOString(),
        action: 'session_validation',
        result: 'failure',
        ip:
          request.headers.get('x-forwarded-for') ||
          request.headers.get('x-real-ip') ||
          'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
        details: { reason: 'no_token' },
      })

      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Validate the session
    const sessionValidation = await validateUserSession(
      token.sub || '',
      token.sessionToken as string
    )

    if (!sessionValidation.valid) {
      AuthLogger.log({
        timestamp: new Date().toISOString(),
        action: 'session_validation',
        result: 'failure',
        userId: token.sub || 'unknown',
        ip:
          request.headers.get('x-forwarded-for') ||
          request.headers.get('x-real-ip') ||
          'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
        details: { reason: 'invalid_session' },
      })

      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Session is valid, continue
    AuthLogger.log({
      timestamp: new Date().toISOString(),
      action: 'session_validation',
      result: 'success',
      userId: token.sub || 'unknown',
      ip:
        request.headers.get('x-forwarded-for') ||
        request.headers.get('x-real-ip') ||
        'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    })

    return null // Continue to the requested page
  } catch (error) {
    console.error('Session validation error:', error)

    AuthLogger.log({
      timestamp: new Date().toISOString(),
      action: 'session_validation',
      result: 'failure',
      ip:
        request.headers.get('x-forwarded-for') ||
        request.headers.get('x-real-ip') ||
        'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    })

    return NextResponse.redirect(new URL('/login', request.url))
  }
}

/**
 * API route middleware for session validation
 */
export async function validateApiSession(
  request: NextRequest
): Promise<{ valid: boolean; user?: any; error?: string }> {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET!!,
    })

    if (!token) {
      return {
        valid: false,
        error: 'No authentication token provided',
      }
    }

    // Validate the session
    const sessionValidation = await validateUserSession(
      token.sub || '',
      token.sessionToken as string
    )

    if (!sessionValidation.valid) {
      return {
        valid: false,
        error: 'Invalid or expired session',
      }
    }

    return {
      valid: true,
      user: sessionValidation.user,
    }
  } catch (error) {
    console.error('API session validation error:', error)

    return {
      valid: false,
      error: 'Session validation failed',
    }
  }
}

/**
 * Helper function to get current user from request
 */
export async function getCurrentUser(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET!,
  })

  if (!token) {
    return null
  }

  const sessionValidation = await validateUserSession(
    token.sub || '',
    token.sessionToken as string
  )

  return sessionValidation.valid ? sessionValidation.user : null
}

/**
 * Helper function to check if user is authenticated
 */
export async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET!,
  })

  if (!token) {
    return false
  }

  const sessionValidation = await validateUserSession(
    token.sub || '',
    token.sessionToken as string
  )

  return sessionValidation.valid
}
