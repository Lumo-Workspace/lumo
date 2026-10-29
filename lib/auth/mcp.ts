/**
 * MCP OAuth entry point (LUM-1026): access-token verification for /api/mcp.
 * The /.well-known/ discovery metadata lives in @/lib/auth/oauth-metadata.
 *
 * The authorization server is this Lumo instance itself (Better Auth,
 * LUM-1044) — once it has a public URL (BETTER_AUTH_URL); before that
 * /api/mcp answers 501 with an explanation instead of a 401 that would send
 * MCP clients into a login loop.
 */
import {
  isBetterAuthMcpOAuthConfigured,
  mcpOAuthUnsupportedResponse,
  verifyMcpAccessToken as verifyBetterAuthMcpAccessToken,
} from './better-auth/mcp'

/** Whether this deployment can issue and verify MCP OAuth tokens. */
export function isMcpOAuthSupported(): boolean {
  return isBetterAuthMcpOAuthConfigured()
}

/**
 * Verify an MCP OAuth access token and translate it into MCP `AuthInfo`
 * (userId / clientId / scopes), or undefined when the token is not valid
 * (always, when MCP OAuth is unsupported).
 */
export async function verifyMcpAccessToken(bearerToken: string | undefined) {
  if (!isMcpOAuthSupported()) return undefined
  return verifyBetterAuthMcpAccessToken(bearerToken)
}

export { mcpOAuthUnsupportedResponse }
export { MCP_OAUTH_UNSUPPORTED_MESSAGE } from './better-auth/mcp'
