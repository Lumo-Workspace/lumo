/**
 * Clerk implementation of MCP OAuth access-token verification for /api/mcp
 * (LUM-1026).
 */
import { auth } from '@clerk/nextjs/server'
import { verifyClerkToken } from '@clerk/mcp-tools/server'

/**
 * Verify an MCP OAuth access token and translate it into MCP `AuthInfo`
 * (userId / clientId / scopes), or undefined when the token is not valid.
 *
 * `verifyClerkToken` (@clerk/mcp-tools 0.3.1) puts the user only in
 * `extra.userId`, but the MCP server reads `authInfo.userId`
 * (lib/mcp/server.ts), so without lifting it every tool call failed with
 * "missing auth context" (LUM-1047). The lib/auth contract is: `userId` at
 * the top level, as the Better Auth implementation already returns it.
 */
export async function verifyMcpAccessToken(bearerToken: string | undefined) {
  // `acceptsToken: 'oauth_token'` yields the machine auth object that
  // `verifyClerkToken` turns into AuthInfo.
  const machineAuth = await auth({ acceptsToken: 'oauth_token' })
  const authInfo = verifyClerkToken(machineAuth, bearerToken)
  if (!authInfo) return undefined
  const userId = authInfo.extra?.userId
  return typeof userId === 'string' ? { ...authInfo, userId } : authInfo
}
