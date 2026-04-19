// OAuth 2.0 Authorization Server Metadata (RFC 8414). Proxies Clerk's
// authorization-server metadata so MCP clients that only discover via the
// resource server's own domain can still find Clerk's OAuth endpoints.
import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next'

export const GET = authServerMetadataHandlerClerk()
export const OPTIONS = metadataCorsOptionsRequestHandler()
