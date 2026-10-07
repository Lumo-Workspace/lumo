/**
 * OAuth discovery metadata entry point (LUM-1026): handlers for the
 * /.well-known/oauth-* routes MCP clients read to find the authorization
 * server. Implemented by Clerk today (./clerk/oauth-metadata).
 */
export {
  oauthAuthorizationServerMetadataHandler,
  oauthProtectedResourceMetadataHandler,
  oauthMetadataOptionsHandler,
} from './clerk/oauth-metadata'
