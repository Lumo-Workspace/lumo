/**
 * Clerk implementation of MCP OAuth access-token verification for /api/mcp
 * (LUM-1026).
 */
import { auth } from '@clerk/nextjs/server'
import { verifyClerkToken } from '@clerk/mcp-tools/server'

/**
 * Verify an MCP OAuth access token and translate it into MCP `AuthInfo`
 * (userId / clientId / scopes), or undefined when the token is not valid.
 */
export async function verifyMcpAccessToken(bearerToken: string | undefined) {
  // `acceptsToken: 'oauth_token'` yields the machine auth object that
  // `verifyClerkToken` turns into AuthInfo.
  const machineAuth = await auth({ acceptsToken: 'oauth_token' })
  return verifyClerkToken(machineAuth, bearerToken)
}
