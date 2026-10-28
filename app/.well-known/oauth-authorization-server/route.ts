// OAuth 2.0 Authorization Server Metadata (RFC 8414). This instance is the
// issuer (Better Auth, LUM-1044) and serves its own, so MCP clients that only
// discover via the resource server's own domain find its OAuth endpoints.
import {
  oauthAuthorizationServerMetadataHandler,
  oauthMetadataOptionsHandler,
} from '@/lib/auth/oauth-metadata'

export const GET = oauthAuthorizationServerMetadataHandler()
export const OPTIONS = oauthMetadataOptionsHandler()
