/**
 * LUM-1044 — OAuth discovery documents of a self-hosted (Better Auth) Lumo:
 *   /.well-known/oauth-authorization-server  RFC 8414, from the OAuth provider
 *   /.well-known/oauth-protected-resource    RFC 9728, for /api/mcp
 * Both are public, cacheable and CORS-open (browser MCP clients read them).
 */
import {
  buildProtectedResourceMetadata,
  resolveMcpOAuthUrls,
} from './mcp-oauth-config'
import { mcpOAuthUnsupportedResponse } from './mcp'

export const METADATA_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
}

function metadataJson(body: unknown): Response {
  return Response.json(body, {
    headers: {
      'Cache-Control': 'max-age=3600',
      ...METADATA_CORS_HEADERS,
    },
  })
}

/** GET /.well-known/oauth-authorization-server (RFC 8414). */
export async function authorizationServerMetadata(): Promise<Response> {
  if (!resolveMcpOAuthUrls()) return mcpOAuthUnsupportedResponse()
  const { getBetterAuth } = await import('./server')
  const api = getBetterAuth().api as unknown as {
    getOAuthServerConfig: () => Promise<unknown>
  }
  return metadataJson(await api.getOAuthServerConfig())
}

/** GET /.well-known/oauth-protected-resource (RFC 9728). */
export async function protectedResourceMetadata(): Promise<Response> {
  const urls = resolveMcpOAuthUrls()
  if (!urls) return mcpOAuthUnsupportedResponse()
  return metadataJson(buildProtectedResourceMetadata(urls))
}
