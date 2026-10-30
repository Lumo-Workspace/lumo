/**
 * LUM-1044 — the Better Auth plugins that make a self-hosted Lumo the OAuth
 * authorization server for its own MCP endpoint (/api/mcp):
 *
 *   jwt()            signs resource-bound access tokens (keys in auth_jwks)
 *   oauthProvider()  @better-auth/oauth-provider: /oauth2/authorize, /token,
 *                    /register (RFC 7591), /consent, /revoke, /introspect
 *   lumoMcpOAuth     Lumo's policy on top (./mcp-oauth-config): registration
 *                    redirect-URI rules (incl. the allowlisted app schemes,
 *                    LUM-1073), mandatory PKCE S256, and a
 *                    server-only token check used by /api/mcp
 *
 * LUM-1344 adds a second protected resource, <origin>/api/admin (scope
 * `platform-admin`), for the platform admin console, plus a server-only
 * check for its tokens. MCP clients are unaffected: dynamic registration,
 * discovery and the MCP resource keep exactly the `mcp` / `offline_access`
 * scopes, so no DCR client can request the admin scope or resource.
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
  PLATFORM_ADMIN_SCOPE,
  checkAuthorizationPkce,
  checkClientRegistration,
  restoreNativeSchemeRedirectUris,
  toAdminTokenIdentity,
  type AccessTokenPayload,
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

/** LUM-1344 — server-only endpoint the admin API calls to check a bearer token. */
export const VERIFY_ADMIN_ACCESS_TOKEN_PATH = '/lumo/admin/verify-access-token'

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
  const mcpScopes: Scope[] = [...MCP_OAUTH_SCOPES]
  // Every scope this server knows. `platform-admin` is listed here only so
  // the provisioned admin console client may hold it; everything an MCP
  // client sees (DCR capabilities, discovery, the MCP resource) stays
  // `mcpScopes`.
  const scopes: Scope[] = [...mcpScopes, PLATFORM_ADMIN_SCOPE]
  return {
    schema: OAUTH_MODEL_NAMES,
    scopes,
    clientRegistrationDefaultScopes: mcpScopes,
    advertisedMetadata: { scopes_supported: mcpScopes },
    grantTypes: ['authorization_code', 'refresh_token'],
    loginPage: MCP_OAUTH_LOGIN_PAGE,
    consentPage: MCP_OAUTH_CONSENT_PAGE,
    // Two protected resources. Every dynamically registered client is
    // linked to the MCP endpoint only and may request only it; the admin
    // API (LUM-1344) is reachable only by a client an operator links to it.
    // The token `aud` is the RFC 8707 `resource` the request names, and each
    // resource's allowedScopes intersects the requested scopes, so an MCP
    // token never carries `platform-admin` and an admin token never `mcp`.
    // Refresh tokens are a per-client matter, not a per-resource one: the
    // provider issues one whenever the client requests `offline_access` and
    // holds the `refresh_token` grant. The console client is provisioned
    // (scripts/admin-oauth) with neither, so admin sessions get no refresh
    // token and the admin signs in again when the access token expires.
    resources: [
      {
        identifier: urls.resource,
        name: 'Lumo MCP',
        allowedScopes: mcpScopes,
      },
      {
        identifier: urls.adminResource,
        name: 'Lumo platform admin API',
        allowedScopes: [PLATFORM_ADMIN_SCOPE],
      },
    ],
    resourceSeedMode: 'overwrite',
    cachedResources: new Set([urls.resource, urls.adminResource]),
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

interface ValidatedToken {
  payload: Record<string, unknown> | null
  clientName: string | null
}

const NO_TOKEN: ValidatedToken = { payload: null, clientName: null }

/**
 * The provider's validation of an access token (signature / revocation /
 * expiry), or NO_TOKEN when it is invalid or its client is gone or disabled.
 * Audience and scope are the caller's to check.
 */
async function validateWithProvider(
  ctx: Parameters<typeof getOAuthProviderApi>[0],
  providerOptions: OAuthOptions<Scope[]>,
  token: unknown
): Promise<ValidatedToken> {
  if (typeof token !== 'string' || token.length === 0) return NO_TOKEN
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
  if (!payload?.active || typeof clientId !== 'string') return NO_TOKEN
  const client = await provider.getClient(clientId)
  if (!client || client.disabled) return NO_TOKEN
  return { payload, clientName: client.name ?? null }
}

/** Lumo's policy hooks plus the server-only token checks. */
function lumoMcpOAuthPlugin(
  providerOptions: OAuthOptions<Scope[]>,
  urls: McpOAuthUrls
) {
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
      after: [
        {
          // LUM-1073: the registration hook above handed Better Auth
          // placeholders for allowlisted app-scheme redirect URIs
          // (cursor://…); write the real URIs back to the stored client and
          // to the RFC 7591 response, so /oauth2/authorize matches them
          // exactly (validateRedirectUri) and the client sees what it sent.
          matcher: ctx => ctx.path === '/oauth2/register',
          handler: createAuthMiddleware(async ctx => {
            const returned = ctx.context.returned
            if (!returned || typeof returned !== 'object') return
            if (returned instanceof Response || returned instanceof Error) {
              return
            }
            const client = returned as Record<string, unknown>
            const restored = restoreNativeSchemeRedirectUris(
              client.redirect_uris
            )
            const clientId = client.client_id
            if (!restored || typeof clientId !== 'string') return
            const model =
              providerOptions.schema?.oauthClient?.modelName ?? 'oauthClient'
            const where = [{ field: 'clientId', value: clientId }]
            try {
              const updated = await ctx.context.adapter.update({
                model,
                where,
                update: { redirectUris: restored, updatedAt: new Date() },
              })
              if (!updated) throw new Error('client row not found')
            } catch (error) {
              // Fail closed: a client left with placeholders could never
              // complete an authorization anyway — remove it and report.
              ctx.context.logger.error(
                'MCP OAuth: restoring app-scheme redirect URIs failed',
                error
              )
              await ctx.context.adapter
                .delete({ model, where })
                .catch(() => undefined)
              throw new APIError('INTERNAL_SERVER_ERROR', {
                error: 'server_error',
                error_description: 'client registration could not be completed',
              })
            }
            ctx.setStatus(201)
            return ctx.json({ ...client, redirect_uris: restored })
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
          return ctx.json(
            await validateWithProvider(ctx, providerOptions, token)
          )
        }
      ),
      // LUM-1344: like the MCP check, but only a token for the admin
      // resource carrying `platform-admin` comes back — anything else
      // (an MCP token included) answers `payload: null`.
      lumoVerifyAdminAccessToken: createAuthEndpoint(
        VERIFY_ADMIN_ACCESS_TOKEN_PATH,
        { method: 'POST', metadata: { SERVER_ONLY: true } },
        async ctx => {
          const token = (ctx.body as { token?: unknown } | undefined)?.token
          const { payload } = await validateWithProvider(
            ctx,
            providerOptions,
            token
          )
          const identity = toAdminTokenIdentity(
            payload as AccessTokenPayload | null,
            {
              resource: urls.adminResource,
              nowSeconds: Math.floor(Date.now() / 1000),
            }
          )
          return ctx.json({ payload: identity ? payload : null })
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
    lumoMcpOAuthPlugin(provider.options as OAuthOptions<Scope[]>, urls),
  ]
}
