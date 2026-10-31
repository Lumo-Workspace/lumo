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
 *   adminResource https://lumo.example.com/api/admin (LUM-1344; the `aud` of
 *                                                  platform admin console tokens)
 *   endpoints     https://lumo.example.com/api/auth/oauth2/{authorize,token,register,…}
 */
import { resolveBetterAuthBaseUrl, BETTER_AUTH_BASE_PATH } from './config'

type Env = Record<string, string | undefined>

/** Path of the MCP endpoint (app/api/mcp/route.ts). */
export const MCP_ENDPOINT_PATH = '/api/mcp'

/**
 * LUM-1344 — path of the platform admin API (app/api/admin/*), the second
 * protected resource. Its tokens carry `aud` = <origin>/api/admin and the
 * `platform-admin` scope; they are never accepted by /api/mcp and MCP tokens
 * are never accepted by the admin API.
 */
export const ADMIN_API_PATH = '/api/admin'

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

/**
 * LUM-1344 — the only scope the admin resource grants. Not advertised in
 * discovery and outside every dynamically registered client's capability
 * set: only an operator-provisioned client linked to the admin resource can
 * request it, and the admin API still requires `auth_users.role = 'admin'`.
 */
export const PLATFORM_ADMIN_SCOPE = 'platform-admin'

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
  /** LUM-1344 — the platform admin API resource (<origin>/api/admin). */
  adminResource: string
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
    adminResource: `${origin}${ADMIN_API_PATH}`,
    authBaseUrl: `${origin}${BETTER_AUTH_BASE_PATH}`,
  }
}

// ─── Dynamic client registration policy ─────────────────────────────────────

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * LUM-1073 (RFC LUM-1069 §4.3, ruling Q7) — the private-use URI schemes
 * (RFC 8252 §7.1) an MCP client may register a redirect URI under. A fixed
 * allowlist on purpose, not configuration: a custom scheme can be claimed by
 * any local app, so each entry is a deliberate security decision, backed by
 * mandatory PKCE S256 on every authorization request and a consent screen
 * for every new client.
 *
 *   cursor           Cursor's MCP DCR registers
 *                    cursor://anysphere.cursor-mcp/oauth/callback (alongside
 *                    https://www.cursor.com/agents/mcp/oauth/callback and
 *                    http://localhost:8787/callback; Cursor 3.14.27, see
 *                    https://forum.cursor.com/t/167608 and /t/165019).
 *   vscode,
 *   vscode-insiders  Named in ruling Q7. VS Code's MCP client currently
 *                    registers https://vscode.dev/redirect plus 127.0.0.1
 *                    loopback URIs (github.com/microsoft/vscode/issues/278512);
 *                    the scheme is VS Code's own URL handler
 *                    (vscode://<extension-id>/…), allowed for clients that use it.
 *
 * Better Auth itself only accepts reverse-domain private-use schemes without
 * an authority (com.example.app:/cb), which none of these are — see
 * {@link toNativeSchemePlaceholder} for how they get past it.
 */
export const MCP_NATIVE_REDIRECT_SCHEMES: readonly string[] = Object.freeze([
  'cursor',
  'vscode',
  'vscode-insiders',
])

export type RedirectUriKind = 'web' | 'native' | 'native-scheme'

/**
 * Classify a redirect URI a client wants to register, or return null when
 * Lumo does not accept it:
 *   https://<non-loopback host>/…           → 'web'
 *   http://localhost|127.0.0.1|[::1][:port]/… → 'native' (RFC 8252 loopback)
 *   <allowlisted scheme>://<host>/…          → 'native-scheme' (RFC 8252
 *                                               §7.1; {@link MCP_NATIVE_REDIRECT_SCHEMES})
 * Everything else — plain http on another host, https on loopback, other
 * custom schemes (com.example.app:/, myapp://), an allowlisted scheme without
 * a host, javascript:, data:, a fragment or user info — is rejected.
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
  const scheme = url.protocol.slice(0, -1)
  if (
    MCP_NATIVE_REDIRECT_SCHEMES.includes(scheme) &&
    raw.toLowerCase().startsWith(`${scheme}://`) &&
    host.length > 0
  ) {
    return 'native-scheme'
  }
  return null
}

// Better Auth 1.7 validates a native client's custom-scheme redirect URI as
// a reverse-domain scheme without an authority (RFC 8252 §7.1's
// recommendation), so cursor://anysphere.cursor-mcp/… never reaches its
// store. Lumo's registration hook hands Better Auth a placeholder of that
// shape instead — `<this scheme>:/<hex of the real URI's UTF-8>` — and an
// after hook writes the real URI back to the stored client and the response
// (lumoMcpOAuthPlugin). The placeholder scheme is not allowlisted, so a
// client can never register a placeholder itself.
const NATIVE_SCHEME_PLACEHOLDER_PREFIX = 'ai.uselumo.mcp-native-redirect:/'

/** The Better Auth-acceptable stand-in for an allowlisted custom-scheme URI. */
export function toNativeSchemePlaceholder(uri: string): string {
  const hex = Array.from(new TextEncoder().encode(uri), b =>
    b.toString(16).padStart(2, '0')
  ).join('')
  return `${NATIVE_SCHEME_PLACEHOLDER_PREFIX}${hex}`
}

/**
 * The original URI behind a placeholder, or null when `value` is not one (or
 * does not decode to an allowlisted custom-scheme URI).
 */
export function fromNativeSchemePlaceholder(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value.startsWith(NATIVE_SCHEME_PLACEHOLDER_PREFIX)
  ) {
    return null
  }
  const encoded = value.slice(NATIVE_SCHEME_PLACEHOLDER_PREFIX.length)
  if (!/^(?:[0-9a-f]{2})+$/.test(encoded)) return null
  const bytes = new Uint8Array(encoded.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(encoded.slice(i * 2, i * 2 + 2), 16)
  }
  let uri: string
  try {
    uri = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return classifyRedirectUri(uri) === 'native-scheme' ? uri : null
}

/**
 * `redirect_uris` with every placeholder swapped back for its original URI,
 * or null when there is nothing to restore.
 */
export function restoreNativeSchemeRedirectUris(
  uris: unknown
): string[] | null {
  if (!Array.isArray(uris)) return null
  let changed = false
  const restored = uris.map(u => {
    const original = fromNativeSchemePlaceholder(u)
    if (original === null) return u
    changed = true
    return original
  })
  return changed ? (restored as string[]) : null
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
 *   - `application_type` is inferred from them when the client omits it
 *     (MCP clients rarely send it; Better Auth would otherwise treat a
 *     loopback-only client as `web` and reject it), and must agree when sent:
 *     `native` as soon as one URI is loopback or an allowlisted custom scheme
 *     (Cursor registers its custom scheme, an https URL and a loopback URL
 *     together — RFC 8252 native clients may use all three), else `web`;
 *   - allowlisted custom-scheme URIs are replaced by placeholders Better Auth
 *     accepts ({@link toNativeSchemePlaceholder}), restored after it stores
 *     the client;
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
  const forBetterAuth: string[] = []
  for (const uri of uris) {
    const kind = typeof uri === 'string' ? classifyRedirectUri(uri) : null
    if (!kind) {
      return invalidRedirect(
        'redirect_uris must be https URLs, http loopback URLs ' +
          '(localhost, 127.0.0.1, [::1]) or use an allowed app scheme ' +
          `(${MCP_NATIVE_REDIRECT_SCHEMES.join(', ')}); got ${String(uri)}`
      )
    }
    kinds.add(kind)
    forBetterAuth.push(
      kind === 'native-scheme'
        ? toNativeSchemePlaceholder(uri as string)
        : (uri as string)
    )
  }
  const inferred: 'web' | 'native' =
    kinds.has('native') || kinds.has('native-scheme') ? 'native' : 'web'
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
  return {
    ok: true,
    body: {
      ...input,
      redirect_uris: forBetterAuth,
      application_type: inferred,
    },
  }
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

// ─── Access-token → platform admin identity (LUM-1344) ──────────────────────

/** Who an admin-API access token acts for. */
export interface AdminTokenIdentity {
  /** The Better Auth user id (`sub`). */
  userId: string
  clientId: string
}

/**
 * The user and client an admin-API access token acts for, or undefined when
 * the admin API must not accept it: inactive, expired, not issued for the
 * admin resource (`aud`), without the `platform-admin` scope, or missing the
 * user / client. Both the audience AND the scope are required, so an MCP
 * token (aud /api/mcp, scope mcp) never passes.
 */
export function toAdminTokenIdentity(
  payload: AccessTokenPayload | null | undefined,
  options: { resource: string; nowSeconds: number }
): AdminTokenIdentity | undefined {
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
  if (!scopes.includes(PLATFORM_ADMIN_SCOPE)) return undefined
  return { userId: sub, clientId }
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
