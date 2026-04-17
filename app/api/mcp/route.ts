// MCP HTTP endpoint — streamable HTTP transport handled by `mcp-handler`.
// `withMcpAuth` extracts the Bearer token, `verifyClerkToken` translates
// Clerk's machine auth object into MCP AuthInfo that the server middleware
// (registerMcpTools) reads off `extra.authInfo` for every tool call.
import { auth } from '@clerk/nextjs/server'
import { verifyClerkToken } from '@clerk/mcp-tools/server'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { registerMcpTools } from '@/lib/mcp/server'

const mcpHandler = createMcpHandler(
  server => {
    registerMcpTools(server)
  },
  {
    serverInfo: { name: 'lumo', version: '1.0.0' },
  },
  {
    basePath: '/api/mcp',
    maxDuration: 60,
  }
)

const handler = withMcpAuth(
  mcpHandler,
  async (_req, bearerToken) => {
    // `auth({ acceptsToken: 'oauth_token' })` returns a MachineAuthObject
    // that `verifyClerkToken` consumes to produce MCP AuthInfo (with
    // userId / clientId / scopes populated from the verified token).
    const clerkAuth = await auth({ acceptsToken: 'oauth_token' })
    return verifyClerkToken(clerkAuth, bearerToken)
  },
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource',
  }
)

export { handler as GET, handler as POST, handler as DELETE }
