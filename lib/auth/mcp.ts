/**
 * MCP OAuth entry point (LUM-1026): access-token verification for /api/mcp.
 * The /.well-known/ discovery metadata lives in @/lib/auth/oauth-metadata.
 *
 * The authorization server is Clerk in the SaaS deployment and, under Better
 * Auth (LUM-1044), the self-hosted instance itself — once it has a public URL
 * (BETTER_AUTH_URL); before that /api/mcp answers 501 with an explanation
 * instead of a 401 that would send MCP clients into a login loop.
 */
import { verifyMcpAccessToken as verifyClerkMcpAccessToken } from './clerk/mcp'
import {
  isBetterAuthMcpOAuthConfigured,
  mcpOAuthUnsupportedResponse,
  verifyMcpAccessToken as verifyBetterAuthMcpAccessToken,
} from './better-auth/mcp'
import { isBetterAuth } from './provider'

/** Whether this deployment can issue and verify MCP OAuth tokens. */
export function isMcpOAuthSupported(): boolean {
  return !isBetterAuth() || isBetterAuthMcpOAuthConfigured()
}

/**
 * Verify an MCP OAuth access token and translate it into MCP `AuthInfo`
 * (userId / clientId / scopes), or undefined when the token is not valid
 * (always, when MCP OAuth is unsupported).
 */
export async function verifyMcpAccessToken(bearerToken: string | undefined) {
  if (!isMcpOAuthSupported()) return undefined
  if (isBetterAuth()) return verifyBetterAuthMcpAccessToken(bearerToken)
  return verifyClerkMcpAccessToken(bearerToken)
}

export { mcpOAuthUnsupportedResponse }
export { MCP_OAUTH_UNSUPPORTED_MESSAGE } from './better-auth/mcp'
