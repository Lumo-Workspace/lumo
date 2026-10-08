/**
 * LUM-1044 — pure helpers for the MCP OAuth consent page and the sign-in
 * continuation (no React, no SDK).
 *
 * The authorization endpoint sends the browser to /oauth/consent (or /signin)
 * with the original authorization request plus a signature (`sig`); the
 * page reads what to show from those parameters. They are only displayed —
 * the decision is posted back with the signed query, which the server
 * verifies, so editing the URL cannot change what is granted.
 */
import { MCP_SCOPE, OFFLINE_ACCESS_SCOPE } from './mcp-oauth-config'

export interface ConsentRequest {
  clientId: string
  scopes: string[]
  /** Host the user returns to (the client's redirect_uri). */
  redirectHost: string
}

/** What the consent page shows, or null for a missing / unsigned request. */
export function parseConsentRequest(search: string): ConsentRequest | null {
  const params = new URLSearchParams(search)
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  if (!clientId || !redirectUri || !params.get('sig')) return null
  let redirectHost: string
  try {
    redirectHost = new URL(redirectUri).host
  } catch {
    return null
  }
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean)
  return { clientId, scopes: [...new Set(scopes)], redirectHost }
}

const SCOPE_MESSAGE_IDS: Record<string, string> = {
  [MCP_SCOPE]: 'oauth.consent.scope.mcp',
  [OFFLINE_ACCESS_SCOPE]: 'oauth.consent.scope.offlineAccess',
}

/** react-intl id describing a scope, or null to show the raw scope name. */
export function scopeMessageId(scope: string): string | null {
  return SCOPE_MESSAGE_IDS[scope] ?? null
}

/**
 * The URL an OAuth endpoint answered `{ redirect: true, url }` with (consent
 * decision, or sign-in that continues an authorization), or null. Only http(s)
 * URLs are followed.
 */
export function oauthRedirectUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const { redirect, url } = data as { redirect?: unknown; url?: unknown }
  if (redirect !== true || typeof url !== 'string') return null
  try {
    const parsed = new URL(url, 'http://lumo.invalid')
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? url
      : null
  } catch {
    return null
  }
}
