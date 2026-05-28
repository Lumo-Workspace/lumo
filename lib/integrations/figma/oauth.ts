import type { FigmaTokenResponse } from './types'

const FIGMA_OAUTH_BASE = 'https://www.figma.com/oauth'
const FIGMA_TOKEN_URL = 'https://api.figma.com/v1/oauth/token'

/**
 * Granular OAuth scopes required by the integration. The legacy `files:read`
 * is deprecated in favour of per-endpoint scopes:
 *   - `file_content:read`  — `/v1/files/:key`, `/v1/files/:key/nodes`, `/v1/images/:key`
 *   - `file_metadata:read` — `/v1/files/:key` name field
 *   - `current_user:read`  — `/v1/me`
 * All three must be enabled on the OAuth app at figma.com/developers/apps.
 */
export const FIGMA_OAUTH_SCOPES = [
  'file_content:read',
  'file_metadata:read',
  'current_user:read',
] as const

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export function getAuthorizeUrl(opts: { state: string }): string {
  const url = new URL(FIGMA_OAUTH_BASE)
  url.searchParams.set('client_id', requireEnv('FIGMA_OAUTH_CLIENT_ID'))
  url.searchParams.set('redirect_uri', requireEnv('FIGMA_OAUTH_REDIRECT_URI'))
  url.searchParams.set('scope', FIGMA_OAUTH_SCOPES.join(' '))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export async function exchangeCode(code: string): Promise<FigmaTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('FIGMA_OAUTH_CLIENT_ID'),
    client_secret: requireEnv('FIGMA_OAUTH_CLIENT_SECRET'),
    redirect_uri: requireEnv('FIGMA_OAUTH_REDIRECT_URI'),
    code,
    grant_type: 'authorization_code',
  })
  const res = await fetch(FIGMA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Figma token exchange failed: ${res.status}`)
  return (await res.json()) as FigmaTokenResponse
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<FigmaTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('FIGMA_OAUTH_CLIENT_ID'),
    client_secret: requireEnv('FIGMA_OAUTH_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(FIGMA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Figma token refresh failed: ${res.status}`)
  return (await res.json()) as FigmaTokenResponse
}
