// OAuth 2.0 Authorization Server Metadata (RFC 8414). Proxies Clerk's
// authorization-server metadata so MCP clients that only discover via the
// resource server's own domain can still find its OAuth endpoints; under
// Better Auth (LUM-1044) this instance is the issuer and serves its own.
import {
  oauthAuthorizationServerMetadataHandler,
  oauthMetadataOptionsHandler,
} from '@/lib/auth/oauth-metadata'

export const GET = oauthAuthorizationServerMetadataHandler()
export const OPTIONS = oauthMetadataOptionsHandler()
