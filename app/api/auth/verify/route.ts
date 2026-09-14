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
 * This endpoint enriches the DB identity with the caller's Clerk profile
 * (email + display name) — that's what makes it a display endpoint
 * rather than a pure auth check. Machine-only paths (hooks, MCP, etc.)
 * should call `authService.verifyApiKey` directly and skip the profile
 * round-trip to Clerk.
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
    if ((identity.apiKey.scope ?? null) !== null) {
      return NextResponse.json(
        {
          error: 'This key is scoped to CI ingest and cannot be used to log in',
        },
        { status: 401 }
      )
    }

    const profile = await authService.fetchUserProfile(identity.user.id)

    return NextResponse.json({
      user: { id: identity.user.id, email: profile.email, name: profile.name },
      workspace: identity.workspace,
      apiKey: identity.apiKey,
    })
  } catch (error) {
    console.error('GET /api/auth/verify error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
