/**
 * LUM-1044 — the Better Auth plugins that make a self-hosted Lumo the OAuth
 * authorization server for its own MCP endpoint (/api/mcp):
 *
 *   jwt()            signs resource-bound access tokens (keys in auth_jwks)
 *   oauthProvider()  @better-auth/oauth-provider: /oauth2/authorize, /token,
 *                    /register (RFC 7591), /consent, /revoke, /introspect
 *   lumoMcpOAuth     Lumo's policy on top (./mcp-oauth-config): registration
 *                    redirect-URI rules, mandatory PKCE S256, and a
 *                    server-only token check used by /api/mcp
 *
 * Package docs are not shipped with the npm tarball; the options used here are
 * documented in node_modules/@better-auth/oauth-provider/dist/oauth-*.d.mts
 * (`interface OAuthOptions`) and the JWT plugin in
 * node_modules/better-auth/dist/plugins/jwt/index.d.mts.
 */
import { jwt } from 'better-auth/plugins'
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import {
  getOAuthProviderApi,
  oauthProvider,
  type OAuthOptions,
  type Scope,
} from '@better-auth/oauth-provider'
import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_AUTH_CODE_TTL_SECONDS,
  MCP_OAUTH_CONSENT_PAGE,
  MCP_OAUTH_LOGIN_PAGE,
  MCP_OAUTH_SCOPES,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
  MCP_REGISTER_RATE_LIMIT,
  checkAuthorizationPkce,
  checkClientRegistration,
  type McpOAuthUrls,
} from './mcp-oauth-config'

/** Prisma model names (prisma/schema.prisma, LUM-1044). */
const OAUTH_MODEL_NAMES = {
  oauthClient: { modelName: 'authOauthClient' },
  oauthResource: { modelName: 'authOauthResource' },
  oauthClientResource: { modelName: 'authOauthClientResource' },
  oauthRefreshToken: { modelName: 'authOauthRefreshToken' },
  oauthAccessToken: { modelName: 'authOauthAccessToken' },
  oauthConsent: { modelName: 'authOauthConsent' },
  oauthClientAssertion: { modelName: 'authOauthClientAssertion' },
} as const

/** Server-only endpoint /api/mcp calls to check a bearer token. */
export const VERIFY_MCP_ACCESS_TOKEN_PATH = '/lumo/mcp/verify-access-token'

/** Paths of Better Auth endpoints Lumo does not expose. */
export const MCP_OAUTH_DISABLED_PATHS = [
  // jwt plugin: session → JWT exchange. Not needed (no session JWTs leave the
  // server), and closing it means the only JWTs this server signs are OAuth
  // access tokens issued through consent.
  '/token',
  // oauth-provider: signed-in users managing their own OAuth clients. Lumo
  // has no UI for it, and RFC 7591 registration (/oauth2/register, behind
  // Lumo's redirect-URI policy) is the only way a client comes to exist.
  '/oauth2/create-client',
  '/oauth2/update-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/delete-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
]

function oauthProviderOptions(urls: McpOAuthUrls) {
  const scopes: Scope[] = [...MCP_OAUTH_SCOPES]
  return {
    schema: OAUTH_MODEL_NAMES,
    scopes,
    grantTypes: ['authorization_code', 'refresh_token'],
    loginPage: MCP_OAUTH_LOGIN_PAGE,
    consentPage: MCP_OAUTH_CONSENT_PAGE,
    // The MCP endpoint is the one protected resource; every dynamically
    // registered client is linked to it and may request only it.
    resources: [
      {
        identifier: urls.resource,
        name: 'Lumo MCP',
        allowedScopes: scopes,
      },
    ],
    resourceSeedMode: 'overwrite',
    cachedResources: new Set([urls.resource]),
    enforcePerClientResources: true,
    clientRegistrationDefaultResources: [urls.resource],
    // RFC 7591 open registration — MCP clients register themselves. Kept
    // safe by: consent on every new client (DCR cannot set skip_consent),
    // redirect-URI policy + mandatory PKCE (lumoMcpOAuthPlugin), and the
    // per-IP rate limit below.
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationRequirePKCE: true,
    // Exact match only: a loopback client may NOT swap ports (stricter than
    // RFC 8252 §7.3, which Better Auth would allow by default).
    validateRedirectUri: (uri: string, registered: readonly string[]) =>
      registered.includes(uri),
    accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresIn: MCP_REFRESH_TOKEN_TTL_SECONDS,
    codeExpiresIn: MCP_AUTH_CODE_TTL_SECONDS,
    rateLimit: { register: { ...MCP_REGISTER_RATE_LIMIT } },
  } satisfies OAuthOptions<Scope[]>
}

/** Whether a POST body is itself an authorization request (vs. sign-in / consent). */
function isAuthorizationRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return b.response_type !== undefined || b.client_id !== undefined
}

function badRequest(error: string, description: string): APIError {
  return new APIError('BAD_REQUEST', { error, error_description: description })
}

/** Lumo's policy hooks plus the server-only token check. */
function lumoMcpOAuthPlugin(providerOptions: OAuthOptions<Scope[]>) {
  return {
    id: 'lumo-mcp-oauth',
    hooks: {
      before: [
        {
          matcher: ctx => ctx.path === '/oauth2/register',
          handler: createAuthMiddleware(async ctx => {
            const result = checkClientRegistration(ctx.body)
            if (!result.ok) throw badRequest(result.error, result.description)
            return { context: { body: result.body } }
          }),
        },
        {
          matcher: ctx => ctx.path === '/oauth2/authorize',
          handler: createAuthMiddleware(async ctx => {
            // A GET carries the request in the query, a POST to
            // /oauth2/authorize in the form body. Better Auth also re-runs
            // authorize internally after sign-in / consent (a POST to another
            // path), with ctx.query restored from the server-signed request
            // that already passed this check. Check every place parameters
            // can come from that Better Auth may read — never fewer.
            const candidates: unknown[] = [ctx.query]
            if (ctx.method === 'POST' && isAuthorizationRequest(ctx.body)) {
              candidates.push(ctx.body)
            }
            for (const params of candidates) {
              const problem = checkAuthorizationPkce(params)
              // Plain 400, never a redirect: redirect_uri is not validated yet.
              if (problem) throw badRequest('invalid_request', problem)
            }
          }),
        },
      ],
    },
    endpoints: {
      lumoVerifyMcpAccessToken: createAuthEndpoint(
        VERIFY_MCP_ACCESS_TOKEN_PATH,
        { method: 'POST', metadata: { SERVER_ONLY: true } },
        async ctx => {
          const token = (ctx.body as { token?: unknown } | undefined)?.token
          if (typeof token !== 'string' || token.length === 0) {
            return ctx.json({ payload: null, clientName: null })
          }
          const provider = getOAuthProviderApi(ctx, providerOptions)
          let payload: Record<string, unknown> | null
          try {
            payload = (await provider.validateAccessToken(token)) as Record<
              string,
              unknown
            >
          } catch {
            payload = null
          }
          const clientId = payload?.client_id ?? payload?.azp
          if (!payload?.active || typeof clientId !== 'string') {
            return ctx.json({ payload: null, clientName: null })
          }
          const client = await provider.getClient(clientId)
          if (!client || client.disabled) {
            return ctx.json({ payload: null, clientName: null })
          }
          return ctx.json({ payload, clientName: client.name ?? null })
        }
      ),
    },
  } satisfies BetterAuthPlugin
}

/** All plugins for the MCP authorization server at `urls`. */
export function mcpOAuthPlugins(urls: McpOAuthUrls): BetterAuthPlugin[] {
  const provider = oauthProvider(oauthProviderOptions(urls))
  return [
    jwt({
      schema: { jwks: { modelName: 'authJwks' } },
      // Issuer = the public origin, so RFC 8414 metadata lives at the root
      // /.well-known/oauth-authorization-server MCP clients look for.
      jwt: { issuer: urls.issuer },
      disableSettingJwtHeader: true,
    }),
    // The package's endpoint OpenAPI metadata types do not satisfy
    // BetterAuthPlugin under this repo's exactOptionalPropertyTypes; the
    // runtime shape is a regular plugin.
    provider as unknown as BetterAuthPlugin,
    // `provider.options` holds the resolved options (defaults applied).
    lumoMcpOAuthPlugin(provider.options as OAuthOptions<Scope[]>),
  ]
}
