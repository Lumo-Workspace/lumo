/**
 * LUM-1044 — policy of the MCP OAuth authorization server that a self-hosted
 * (AUTH_PROVIDER=better-auth) Lumo runs for /api/mcp. Pure functions and
 * constants only (no SDK, no env reads except through the `env` argument), so
 * every security decision here is unit-testable on its own.
 *
 * Identifiers, for BETTER_AUTH_URL=https://lumo.example.com:
 *   issuer        https://lumo.example.com        (RFC 8414 metadata at the
 *                                                  root /.well-known/…)
 *   resource      https://lumo.example.com/api/mcp (RFC 8707 / RFC 9728; the
 *                                                  `aud` of every MCP token)
 *   endpoints     https://lumo.example.com/api/auth/oauth2/{authorize,token,register,…}
 */
import { resolveBetterAuthBaseUrl, BETTER_AUTH_BASE_PATH } from './config'

type Env = Record<string, string | undefined>

/** Path of the MCP endpoint (app/api/mcp/route.ts). */
export const MCP_ENDPOINT_PATH = '/api/mcp'

/** Path of the RFC 9728 protected-resource metadata MCP clients are sent to. */
export const PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource'

/**
 * Scopes this authorization server knows. `mcp` — use Lumo's MCP tools as
 * the user — is required on every token /api/mcp accepts; `offline_access`
 * asks for a refresh token.
 */
export const MCP_SCOPE = 'mcp'
export const OFFLINE_ACCESS_SCOPE = 'offline_access'
export const MCP_OAUTH_SCOPES = [MCP_SCOPE, OFFLINE_ACCESS_SCOPE] as const

/** Token lifetimes (seconds). */
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 // 1 hour
export const MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days
export const MCP_AUTH_CODE_TTL_SECONDS = 10 * 60 // 10 minutes

/** Dynamic client registrations per client IP per window (production). */
export const MCP_REGISTER_RATE_LIMIT = { window: 60, max: 5 } as const

/** Where the authorization endpoint sends the user to sign in / consent. */
export const MCP_OAUTH_LOGIN_PAGE = '/signin'
export const MCP_OAUTH_CONSENT_PAGE = '/oauth/consent'

export interface McpOAuthUrls {
  /** Public origin of this instance, e.g. https://lumo.example.com */
  origin: string
  /** Authorization-server issuer (RFC 8414 `issuer`) — the origin. */
  issuer: string
  /** The protected resource (RFC 8707 `resource`, token `aud`). */
  resource: string
  /** Base of Better Auth's own endpoints (…/api/auth). */
  authBaseUrl: string
}

/**
 * The URLs of the MCP authorization server, or null when the instance has no
 * fixed public URL (BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL unset): an issuer
 * and a token audience must be stable, so MCP OAuth stays off until one is set.
 */
export function resolveMcpOAuthUrls(
  env: Env = process.env
): McpOAuthUrls | null {
  const base = resolveBetterAuthBaseUrl(env)
  if (!base) return null
  let origin: string
  try {
    origin = new URL(base).origin
  } catch {
    return null
  }
  if (origin === 'null') return null
  return {
    origin,
    issuer: origin,
    resource: `${origin}${MCP_ENDPOINT_PATH}`,
    authBaseUrl: `${origin}${BETTER_AUTH_BASE_PATH}`,
  }
}

// ─── Dynamic client registration policy ─────────────────────────────────────

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export type RedirectUriKind = 'web' | 'native'

/**
 * Classify a redirect URI a client wants to register, or return null when
 * Lumo does not accept it:
 *   https://<non-loopback host>/…           → 'web'
 *   http://localhost|127.0.0.1|[::1][:port]/… → 'native' (RFC 8252 loopback)
 * Everything else — plain http on another host, https on loopback, custom
 * schemes (cursor://, vscode://, com.example.app:/), javascript:, data:, a
 * fragment or user info — is rejected.
 */
export function classifyRedirectUri(raw: string): RedirectUriKind | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (raw.includes('#') || url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  const isLoopback = LOOPBACK_HOSTS.has(host)
  if (url.protocol === 'https:') return isLoopback ? null : 'web'
  if (url.protocol === 'http:') return isLoopback ? 'native' : null
  return null
}

export type RegistrationCheck =
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false
      /** RFC 7591 §3.2.2 error code. */
      error: 'invalid_redirect_uri' | 'invalid_client_metadata'
      description: string
    }

const invalidMetadata = (description: string): RegistrationCheck => ({
  ok: false,
  error: 'invalid_client_metadata',
  description,
})
const invalidRedirect = (description: string): RegistrationCheck => ({
  ok: false,
  error: 'invalid_redirect_uri',
  description,
})

/**
 * Apply Lumo's registration policy to an RFC 7591 request body:
 *   - every redirect URI must pass {@link classifyRedirectUri};
 *   - all redirect URIs must be of one kind (web or native);
 *   - `application_type` is inferred from them when the client omits it
 *     (MCP clients rarely send it; Better Auth would otherwise treat a
 *     loopback-only client as `web` and reject it), and must agree when sent;
 *   - only the authorization-code and refresh-token grants may be requested.
 * Returns the body to hand on to Better Auth, or why it is rejected.
 */
export function checkClientRegistration(body: unknown): RegistrationCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return invalidMetadata('registration body must be an object')
  }
  const input = body as Record<string, unknown>
  const uris = input.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0) {
    return invalidRedirect('redirect_uris is required')
  }
  const kinds = new Set<RedirectUriKind>()
  for (const uri of uris) {
    const kind = typeof uri === 'string' ? classifyRedirectUri(uri) : null
    if (!kind) {
      return invalidRedirect(
        'redirect_uris must be https URLs or http loopback URLs ' +
          `(localhost, 127.0.0.1, [::1]); got ${String(uri)}`
      )
    }
    kinds.add(kind)
  }
  if (kinds.size > 1) {
    return invalidRedirect('redirect_uris must be all https or all loopback')
  }
  const inferred = [...kinds][0]
  if (
    input.application_type !== undefined &&
    input.application_type !== inferred
  ) {
    return invalidMetadata(
      `application_type ${String(input.application_type)} does not match the redirect_uris`
    )
  }
  const grants = input.grant_types
  if (
    grants !== undefined &&
    (!Array.isArray(grants) ||
      grants.some(g => g !== 'authorization_code' && g !== 'refresh_token'))
  ) {
    return invalidMetadata(
      'only the authorization_code and refresh_token grants are supported'
    )
  }
  return { ok: true, body: { ...input, application_type: inferred } }
}

// ─── Authorization request policy ───────────────────────────────────────────

/**
 * PKCE with S256 is required on every authorization request — for public and
 * confidential clients alike, with or without `openid`. Returns why a request
 * is rejected, or null when it passes.
 */
export function checkAuthorizationPkce(query: unknown): string | null {
  const q = (query && typeof query === 'object' ? query : {}) as Record<
    string,
    unknown
  >
  // No exemption for pushed requests (request_uri): Lumo does not enable PAR,
  // and a request without its own S256 challenge is refused here regardless.
  if (typeof q.code_challenge !== 'string' || q.code_challenge.length === 0) {
    return 'code_challenge is required (PKCE)'
  }
  if (q.code_challenge_method !== 'S256') {
    return 'code_challenge_method must be S256'
  }
  return null
}

// ─── Access-token → MCP AuthInfo ────────────────────────────────────────────

/** The token payload the authorization server's validation returns. */
export interface AccessTokenPayload {
  active?: unknown
  sub?: unknown
  aud?: unknown
  client_id?: unknown
  azp?: unknown
  scope?: unknown
  exp?: unknown
}

/**
 * MCP `AuthInfo` (token / clientId / scopes / expiresAt / resource / extra),
 * plus a top-level `userId`: the shape lib/mcp/server.ts reads off
 * `extra.authInfo` — the same identity fields the Clerk path supplies.
 */
export interface McpAuthInfo {
  token: string
  clientId: string
  clientName?: string
  scopes: string[]
  expiresAt: number
  resource: URL
  /** The Lumo user id (Better Auth user id; stored where Clerk ids go). */
  userId: string
  extra: { userId: string }
}

function audienceList(aud: unknown): string[] {
  if (typeof aud === 'string') return [aud]
  if (Array.isArray(aud)) return aud.filter(a => typeof a === 'string')
  return []
}

/**
 * Turn a validated access-token payload into MCP AuthInfo, or undefined when
 * /api/mcp must not accept it: inactive, expired (`exp` ≤ now), not issued
 * for this MCP resource (`aud`), without the `mcp` scope, or missing the
 * user / client it acts for.
 */
export function toMcpAuthInfo(
  token: string,
  payload: AccessTokenPayload | null | undefined,
  options: { resource: string; nowSeconds: number; clientName?: string | null }
): McpAuthInfo | undefined {
  if (!payload || payload.active !== true) return undefined
  const { sub, exp, scope } = payload
  const clientId =
    typeof payload.client_id === 'string' ? payload.client_id : payload.azp
  if (typeof sub !== 'string' || sub.length === 0) return undefined
  if (typeof clientId !== 'string' || clientId.length === 0) return undefined
  if (typeof exp !== 'number' || exp <= options.nowSeconds) return undefined
  if (!audienceList(payload.aud).includes(options.resource)) return undefined
  const scopes =
    typeof scope === 'string' ? scope.split(' ').filter(Boolean) : []
  if (!scopes.includes(MCP_SCOPE)) return undefined
  return {
    token,
    clientId,
    ...(options.clientName ? { clientName: options.clientName } : {}),
    scopes,
    expiresAt: exp,
    resource: new URL(options.resource),
    userId: sub,
    extra: { userId: sub },
  }
}

// ─── Discovery metadata ─────────────────────────────────────────────────────

/**
 * RFC 9728 protected-resource metadata for /api/mcp. Field set follows the
 * Clerk-mode document where the field applies to this server (`resource`,
 * `authorization_servers`, `token_types_supported`,
 * `authorization_data_*`, `key_challenges_supported`); Clerk's
 * `token_introspection_endpoint`, `jwks_uri` and `service_documentation`
 * describe Clerk's own services and are omitted. RFC 9728's
 * `scopes_supported` / `bearer_methods_supported` / `resource_name` are added.
 */
export function buildProtectedResourceMetadata(urls: McpOAuthUrls) {
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Lumo MCP',
    token_types_supported: ['urn:ietf:params:oauth:token-type:access_token'],
    authorization_data_types_supported: ['oauth_scope'],
    authorization_data_locations_supported: ['header', 'body'],
    key_challenges_supported: [
      {
        challenge_type: 'urn:ietf:params:oauth:pkce:code_challenge',
        challenge_algs: ['S256'],
      },
    ],
  }
}
