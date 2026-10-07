// OAuth 2.0 Authorization Server Metadata (RFC 8414). Proxies the auth
// provider's (Clerk's) authorization-server metadata so MCP clients that only
// discover via the resource server's own domain can still find its OAuth
// endpoints.
import {
  oauthAuthorizationServerMetadataHandler,
  oauthMetadataOptionsHandler,
} from '@/lib/auth/oauth-metadata'

export const GET = oauthAuthorizationServerMetadataHandler()
export const OPTIONS = oauthMetadataOptionsHandler()
