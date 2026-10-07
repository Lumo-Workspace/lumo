/**
 * LUM-1027 — MCP OAuth under Better Auth: NOT SUPPORTED in this version.
 *
 * Clerk acts as the OAuth authorization server for /api/mcp in the SaaS
 * deployment. better-auth 1.7.7 no longer ships an authorization-server
 * plugin in its core package (the former `mcp` / `oidcProvider` plugins moved
 * to the separate `@better-auth/oauth-provider` package), so a self-hosted
 * instance has no issuer for MCP access tokens. Until that is added, the MCP
 * endpoint and its /.well-known/ discovery documents answer 501 with this
 * explanation; the CLI, hooks and every API keep working with API keys.
 */
export const MCP_OAUTH_UNSUPPORTED_MESSAGE =
  'MCP OAuth is not supported when AUTH_PROVIDER=better-auth (self-hosted). ' +
  'Use the Lumo CLI with an API key (Settings → API Keys) instead.'

/** A 501 JSON response explaining that MCP OAuth is unavailable. */
export function mcpOAuthUnsupportedResponse(): Response {
  return Response.json(
    {
      error: 'not_implemented',
      error_description: MCP_OAUTH_UNSUPPORTED_MESSAGE,
    },
    { status: 501 }
  )
}
