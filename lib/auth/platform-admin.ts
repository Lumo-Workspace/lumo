/**
 * LUM-1344 — the guard every /api/admin/* route calls first.
 *
 * Authentication: an `Authorization: Bearer <token>` OAuth access token that
 * this instance issued for <origin>/api/admin with the `platform-admin` scope
 * (./better-auth/admin-oauth). Nothing else authenticates — not session
 * cookies, not `lum_` CLI API keys, not MCP tokens. → 401 otherwise.
 *
 * Authorization: the token's user must exist, have `auth_users.role =
 * 'admin'` and not be banned. This role check is the authority: holding a
 * `platform-admin` token is not enough. → 403 otherwise.
 */
import { NextResponse } from 'next/server'
import { verifyAdminAccessToken } from './better-auth/admin-oauth'
import { authUserRepository } from '@/lib/repositories/auth-user.repository'

/** The authenticated platform admin a route acts for. */
export interface PlatformAdmin {
  userId: string
  email: string
}

/** Role string Lumo assigns to platform admins on `auth_users.role`. */
export const PLATFORM_ADMIN_ROLE = 'admin'

/** Prefix of Lumo CLI API keys — refused outright on the admin API. */
const CLI_API_KEY_PREFIX = 'lum_'

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
  )
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/** The bearer token of a request, or null (scheme matched case-insensitively). */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  return token.length > 0 ? token : null
}

/**
 * The platform admin behind the request, or the 401 / 403 response the
 * route must return as is.
 */
export async function requirePlatformAdmin(
  request: Request
): Promise<PlatformAdmin | NextResponse> {
  const token = bearerToken(request)
  if (!token || token.startsWith(CLI_API_KEY_PREFIX)) return unauthorized()
  const identity = await verifyAdminAccessToken(token)
  if (!identity) return unauthorized()
  const user = await authUserRepository.findPlatformAccessById(identity.userId)
  if (!user || user.role !== PLATFORM_ADMIN_ROLE || user.banned) {
    return forbidden()
  }
  return { userId: user.id, email: user.email }
}
