/**
 * LUM-1044 — MCP OAuth under Better Auth (self-hosted).
 *
 * The instance is its own OAuth authorization server for /api/mcp
 * (./mcp-oauth-plugins). This module verifies the bearer token an MCP client
 * presents and maps it to the MCP AuthInfo the server middleware reads
 * (lib/mcp/server.ts): `userId` = the Better Auth user id — the identity Lumo
 * stores where Clerk ids go — plus `clientId`, `scopes`, `expiresAt`.
 *
 * Without a fixed public URL (BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL) there is
 * no stable issuer or token audience, so MCP OAuth stays off and the MCP
 * endpoint and discovery documents answer 501 saying what to set.
 */
import {
  resolveMcpOAuthUrls,
  toMcpAuthInfo,
  type AccessTokenPayload,
  type McpAuthInfo,
} from './mcp-oauth-config'
import { BETTER_AUTH_URL_ENV } from './config'
import { logger } from '@/lib/logger'

export const MCP_OAUTH_UNSUPPORTED_MESSAGE =
  `MCP OAuth needs a public URL when AUTH_PROVIDER=better-auth: set ${BETTER_AUTH_URL_ENV} ` +
  '(e.g. https://lumo.example.com). Until then use the Lumo CLI with an API key ' +
  '(Settings → API Keys).'

/** Whether this self-hosted instance can issue and verify MCP tokens. */
export function isBetterAuthMcpOAuthConfigured(): boolean {
  return resolveMcpOAuthUrls() !== null
}

/** A 501 JSON response explaining that MCP OAuth is unavailable. */
export function mcpOAuthUnsupportedResponse(): Response {
  return Response.json(
    {
      error: 'not_implemented',
      error_description: MCP_OAUTH_UNSUPPORTED_MESSAGE,
    },
    { status: 501 }
  )
}

interface VerifyResult {
  payload: AccessTokenPayload | null
  clientName: string | null
}

/** The server-only endpoint added by ./mcp-oauth-plugins. */
type VerifyEndpoint = (input: {
  body: { token: string }
}) => Promise<VerifyResult>

/**
 * Verify an MCP OAuth access token, or undefined when it is missing, invalid,
 * expired, revoked (its client disabled or its session ended), not issued for
 * this instance's MCP resource, or lacking the `mcp` scope.
 */
export async function verifyMcpAccessToken(
  bearerToken: string | undefined
): Promise<McpAuthInfo | undefined> {
  if (!bearerToken) return undefined
  const urls = resolveMcpOAuthUrls()
  if (!urls) return undefined
  let result: VerifyResult
  try {
    const { getBetterAuth } = await import('./server')
    const api = getBetterAuth().api as unknown as {
      lumoVerifyMcpAccessToken: VerifyEndpoint
    }
    result = await api.lumoVerifyMcpAccessToken({
      body: { token: bearerToken },
    })
  } catch (err) {
    // Fail closed: an unverifiable token is no token (401, not 500).
    logger.warn('[mcp-oauth] access-token verification failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
  const { payload, clientName } = result
  return toMcpAuthInfo(bearerToken, payload, {
    resource: urls.resource,
    nowSeconds: Math.floor(Date.now() / 1000),
    clientName,
  })
}
