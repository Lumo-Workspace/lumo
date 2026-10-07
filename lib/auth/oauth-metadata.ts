/**
 * OAuth discovery metadata entry point (LUM-1026): handlers for the
 * /.well-known/oauth-* routes MCP clients read to find the authorization
 * server. Clerk serves the real documents; under Better Auth (LUM-1027) MCP
 * OAuth is unsupported and both routes answer 501 with an explanation.
 * The provider is checked per request, so building the app needs no keys.
 */
import * as clerk from './clerk/oauth-metadata'
import { isMcpOAuthSupported, mcpOAuthUnsupportedResponse } from './mcp'

type Handler = (request: Request) => Response | Promise<Response>

/** Build `make()` once, on the first request that needs it. */
function lazyClerk(make: () => Handler): Handler {
  let handler: Handler | null = null
  return request => {
    if (!isMcpOAuthSupported()) return mcpOAuthUnsupportedResponse()
    handler ??= make()
    return handler(request)
  }
}

/** GET handler for /.well-known/oauth-authorization-server (RFC 8414). */
export function oauthAuthorizationServerMetadataHandler(): Handler {
  return lazyClerk(
    () => clerk.oauthAuthorizationServerMetadataHandler() as Handler
  )
}

/** GET handler for /.well-known/oauth-protected-resource (RFC 9728). */
export function oauthProtectedResourceMetadataHandler(): Handler {
  return lazyClerk(
    () => clerk.oauthProtectedResourceMetadataHandler() as Handler
  )
}

/** OPTIONS (CORS preflight) handler for both metadata routes. */
export function oauthMetadataOptionsHandler(): Handler {
  // The preflight is provider-neutral CORS; keep Clerk's for both modes.
  let handler: Handler | null = null
  return request => {
    handler ??= clerk.oauthMetadataOptionsHandler() as Handler
    return handler(request)
  }
}
