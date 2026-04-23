import { NextResponse } from 'next/server'
import { authService } from '@/lib/services/auth.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * GET /api/auth/verify
 *
 * Verifies a Lumo CLI bearer token and returns the resolved identity
 * (user, workspace, api key) so the CLI can confirm the token and
 * display "logged in as" details to the user.
 *
 * Header: `Authorization: Bearer lum_xxxxxxxx...`
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 })
    }

    const token = authHeader.slice(7).trim()
    if (!token) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 })
    }

    const identity = await authService.verifyApiKey(token)
    if (!identity) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 })
    }

    return NextResponse.json(identity)
  } catch (error) {
    console.error('GET /api/auth/verify error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
