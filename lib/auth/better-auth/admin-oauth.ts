/**
 * LUM-1344 — verification of the OAuth access tokens the platform admin
 * console presents to /api/admin/*. The tokens come from this instance's own
 * authorization server (./mcp-oauth-plugins) for the resource
 * <origin>/api/admin with the `platform-admin` scope; MCP tokens never pass.
 * Role checks are not done here — see lib/auth/platform-admin.ts.
 */
import {
  resolveMcpOAuthUrls,
  toAdminTokenIdentity,
  type AccessTokenPayload,
  type AdminTokenIdentity,
} from './mcp-oauth-config'
import { logger } from '@/lib/logger'

/** The server-only endpoint added by ./mcp-oauth-plugins. */
type VerifyAdminEndpoint = (input: {
  body: { token: string }
}) => Promise<{ payload: AccessTokenPayload | null }>

/**
 * The user and client an admin-API access token acts for, or undefined when
 * it is missing, invalid, expired, revoked, not issued for the admin
 * resource, or lacking the `platform-admin` scope. Fails closed: any error
 * while verifying is treated as no token.
 */
export async function verifyAdminAccessToken(
  bearerToken: string | undefined
): Promise<AdminTokenIdentity | undefined> {
  if (!bearerToken) return undefined
  const urls = resolveMcpOAuthUrls()
  if (!urls) return undefined
  let payload: AccessTokenPayload | null
  try {
    const { getBetterAuth } = await import('./server')
    const api = getBetterAuth().api as unknown as {
      lumoVerifyAdminAccessToken: VerifyAdminEndpoint
    }
    ;({ payload } = await api.lumoVerifyAdminAccessToken({
      body: { token: bearerToken },
    }))
  } catch (err) {
    logger.warn('[admin-oauth] access-token verification failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
  // Re-checked here (not only in the endpoint): audience, scope and expiry.
  return toAdminTokenIdentity(payload, {
    resource: urls.adminResource,
    nowSeconds: Math.floor(Date.now() / 1000),
  })
}
