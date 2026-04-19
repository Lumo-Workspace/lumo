// OAuth 2.0 Protected Resource Metadata (RFC 9728). MCP clients read this
// endpoint to discover which authorization server to use (Clerk), so they
// can obtain a Bearer token before calling /api/mcp.
//
// The Clerk-aware helper derives the Clerk issuer URL from
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY at runtime — no extra env var required.
import {
  protectedResourceHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next'

export const GET = protectedResourceHandlerClerk()
export const OPTIONS = metadataCorsOptionsRequestHandler()
