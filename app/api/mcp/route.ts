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
    // mcp-handler serves streamable HTTP at `${basePath}/mcp`, so the parent
    // segment `/api` makes it answer at `/api/mcp` — the only path Next routes
    // to this file and the URL we publish. `/api/mcp` here would only match
    // `/api/mcp/mcp`, which never reaches this route (LUM-1039).
    basePath: '/api',
    maxDuration: 60,
  }
)

const authedHandler = withMcpAuth(
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

// CORS for browser-based MCP clients (MCP Inspector, etc.). Native clients
// like Claude Desktop do not care about these headers but they are harmless.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version',
  'Access-Control-Expose-Headers': 'mcp-session-id, www-authenticate',
  'Access-Control-Max-Age': '86400',
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

async function handler(req: Request): Promise<Response> {
  return withCors(await authedHandler(req))
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export { handler as GET, handler as POST, handler as DELETE }
