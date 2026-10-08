/**
 * OAuth discovery metadata entry point (LUM-1026): handlers for the
 * /.well-known/oauth-* routes MCP clients read to find the authorization
 * server. Clerk serves the real documents in the SaaS deployment; under
 * Better Auth (LUM-1044) the self-hosted instance serves its own, or 501 when
 * it has no public URL yet. The provider is checked per request, so building
 * the app needs no keys.
 */
import * as clerk from './clerk/oauth-metadata'
import * as betterAuth from './better-auth/oauth-metadata'
import { isMcpOAuthSupported, mcpOAuthUnsupportedResponse } from './mcp'
import { isBetterAuth } from './provider'

type Handler = (request: Request) => Response | Promise<Response>

/**
 * Pick the provider per request; build the Clerk handler once, on the first
 * request that needs it.
 */
function perProvider(
  makeClerk: () => Handler,
  betterAuthHandler: () => Promise<Response>
): Handler {
  let clerkHandler: Handler | null = null
  return request => {
    if (!isMcpOAuthSupported()) return mcpOAuthUnsupportedResponse()
    if (isBetterAuth()) return betterAuthHandler()
    clerkHandler ??= makeClerk()
    return clerkHandler(request)
  }
}

/** GET handler for /.well-known/oauth-authorization-server (RFC 8414). */
export function oauthAuthorizationServerMetadataHandler(): Handler {
  return perProvider(
    () => clerk.oauthAuthorizationServerMetadataHandler() as Handler,
    betterAuth.authorizationServerMetadata
  )
}

/** GET handler for /.well-known/oauth-protected-resource (RFC 9728). */
export function oauthProtectedResourceMetadataHandler(): Handler {
  return perProvider(
    () => clerk.oauthProtectedResourceMetadataHandler() as Handler,
    betterAuth.protectedResourceMetadata
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
