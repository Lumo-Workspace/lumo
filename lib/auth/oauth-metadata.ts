/**
 * OAuth discovery metadata entry point (LUM-1026): handlers for the
 * /.well-known/oauth-* routes MCP clients read to find the authorization
 * server. This instance serves its own documents (Better Auth, LUM-1044), or
 * 501 when it has no public URL yet. Checked per request, so building the app
 * needs no keys.
 */
import * as betterAuth from './better-auth/oauth-metadata'
import { isMcpOAuthSupported, mcpOAuthUnsupportedResponse } from './mcp'

type Handler = (request: Request) => Response | Promise<Response>

function whenSupported(serve: () => Promise<Response>): Handler {
  return () => {
    if (!isMcpOAuthSupported()) return mcpOAuthUnsupportedResponse()
    return serve()
  }
}

/** GET handler for /.well-known/oauth-authorization-server (RFC 8414). */
export function oauthAuthorizationServerMetadataHandler(): Handler {
  return whenSupported(betterAuth.authorizationServerMetadata)
}

/** GET handler for /.well-known/oauth-protected-resource (RFC 9728). */
export function oauthProtectedResourceMetadataHandler(): Handler {
  return whenSupported(betterAuth.protectedResourceMetadata)
}

/** OPTIONS (CORS preflight) handler for both metadata routes. */
export function oauthMetadataOptionsHandler(): Handler {
  return () =>
    new Response(null, {
      status: 200,
      headers: betterAuth.METADATA_CORS_HEADERS,
    })
}
