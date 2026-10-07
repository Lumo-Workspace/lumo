/**
 * Clerk implementation of the OAuth discovery metadata served under
 * /.well-known/ (LUM-1026), so MCP clients can find the authorization server:
 * RFC 8414 authorization-server metadata and RFC 9728 protected-resource
 * metadata.
 */
import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from '@clerk/mcp-tools/next'

/** GET handler for /.well-known/oauth-authorization-server (RFC 8414). */
export function oauthAuthorizationServerMetadataHandler() {
  return authServerMetadataHandlerClerk()
}

/**
 * GET handler for /.well-known/oauth-protected-resource (RFC 9728). The
 * authorization server is derived from the provider's public config at
 * runtime — no extra env var.
 */
export function oauthProtectedResourceMetadataHandler() {
  return protectedResourceHandlerClerk()
}

/** OPTIONS (CORS preflight) handler for both metadata routes. */
export function oauthMetadataOptionsHandler() {
  return metadataCorsOptionsRequestHandler()
}
