/**
 * MCP OAuth entry point (LUM-1026): access-token verification for /api/mcp.
 * The /.well-known/ discovery metadata lives in @/lib/auth/oauth-metadata.
 *
 * Clerk is the OAuth authorization server for MCP. Under Better Auth
 * (LUM-1027) MCP OAuth is not supported yet — see ./better-auth/mcp — and
 * /api/mcp answers 501 with an explanation instead of a bare 401.
 */
import { verifyMcpAccessToken as verifyClerkMcpAccessToken } from './clerk/mcp'
import { mcpOAuthUnsupportedResponse } from './better-auth/mcp'
import { isBetterAuth } from './provider'

/** Whether this deployment can issue and verify MCP OAuth tokens. */
export function isMcpOAuthSupported(): boolean {
  return !isBetterAuth()
}

/**
 * Verify an MCP OAuth access token and translate it into MCP `AuthInfo`
 * (userId / clientId / scopes), or undefined when the token is not valid
 * (always, when MCP OAuth is unsupported).
 */
export async function verifyMcpAccessToken(bearerToken: string | undefined) {
  if (!isMcpOAuthSupported()) return undefined
  return verifyClerkMcpAccessToken(bearerToken)
}

export { mcpOAuthUnsupportedResponse }
export { MCP_OAUTH_UNSUPPORTED_MESSAGE } from './better-auth/mcp'
