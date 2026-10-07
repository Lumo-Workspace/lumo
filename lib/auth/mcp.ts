/**
 * MCP OAuth entry point (LUM-1026): access-token verification for /api/mcp.
 * The /.well-known/ discovery metadata lives in @/lib/auth/oauth-metadata.
 * Implemented by Clerk today (./clerk/mcp).
 */
export { verifyMcpAccessToken } from './clerk/mcp'
