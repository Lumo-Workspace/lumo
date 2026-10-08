// MCP HTTP endpoint — streamable HTTP transport handled by `mcp-handler`.
// `withMcpAuth` extracts the Bearer token, `verifyMcpAccessToken` turns the
// verified OAuth token into MCP AuthInfo that the server middleware
// (registerMcpTools) reads off `extra.authInfo` for every tool call.
import {
  isMcpOAuthSupported,
  mcpOAuthUnsupportedResponse,
  verifyMcpAccessToken,
} from '@/lib/auth/mcp'
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
  // AuthInfo carries userId / clientId / scopes from the verified token.
  async (_req, bearerToken) => verifyMcpAccessToken(bearerToken),
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
  // Self-hosted on Better Auth without a public URL (LUM-1044): no OAuth
  // issuer for MCP tokens — say so plainly instead of a 401 that sends
  // clients into a login loop.
  if (!isMcpOAuthSupported()) return withCors(mcpOAuthUnsupportedResponse())
  return withCors(await authedHandler(req))
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export { handler as GET, handler as POST, handler as DELETE }
