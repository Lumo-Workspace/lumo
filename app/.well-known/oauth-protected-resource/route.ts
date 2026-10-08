// OAuth 2.0 Protected Resource Metadata (RFC 9728). MCP clients read this
// endpoint to discover which authorization server to use (Clerk, or the
// self-hosted instance itself under Better Auth — LUM-1044), so they can
// obtain a Bearer token before calling /api/mcp.
//
// The Clerk implementation derives the issuer URL from
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY at runtime; Better Auth uses
// BETTER_AUTH_URL.
import {
  oauthProtectedResourceMetadataHandler,
  oauthMetadataOptionsHandler,
} from '@/lib/auth/oauth-metadata'

export const GET = oauthProtectedResourceMetadataHandler()
export const OPTIONS = oauthMetadataOptionsHandler()
