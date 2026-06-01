import type { GoogleTokenResponse } from './types'

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// Read-only Drive access is enough to export a Doc as markdown; openid+email
// let us identify the connected account for the settings card.
export const GOOGLE_DRIVE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'openid',
  'email',
] as const

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export function getAuthorizeUrl(opts: { state: string }): string {
  const url = new URL(GOOGLE_AUTH_BASE)
  url.searchParams.set('client_id', requireEnv('GOOGLE_CLIENT_ID'))
  url.searchParams.set(
    'redirect_uri',
    requireEnv('GOOGLE_DRIVE_OAUTH_REDIRECT_URI')
  )
  url.searchParams.set('scope', GOOGLE_DRIVE_OAUTH_SCOPES.join(' '))
  url.searchParams.set('response_type', 'code')
  // access_type=offline + prompt=consent guarantees a refresh_token even on
  // re-consent, which the owner-token re-sync model depends on.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export async function exchangeCode(code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirect_uri: requireEnv('GOOGLE_DRIVE_OAUTH_REDIRECT_URI'),
    code,
    grant_type: 'authorization_code',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`)
  return (await res.json()) as GoogleTokenResponse
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`)
  // Note: refresh responses usually omit refresh_token — callers must keep the
  // existing one when the response doesn't include a new value.
  return (await res.json()) as GoogleTokenResponse
}
