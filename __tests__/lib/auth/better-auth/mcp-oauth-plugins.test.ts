/**
 * @jest-environment node
 *
 * LUM-1044 — the MCP OAuth plugins (jwt + @better-auth/oauth-provider +
 * Lumo's policy plugin) inside a real Better Auth instance on the in-memory
 * adapter, so the authorization server's security boundary is exercised on
 * every `npm test` run (the Postgres + route-level flow is the opt-in
 * __tests__/integration/better-auth.mcp-oauth.test.ts).
 */
import { createHash, randomBytes } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import {
  MCP_OAUTH_DISABLED_PATHS,
  mcpOAuthPlugins,
} from '@/lib/auth/better-auth/mcp-oauth-plugins'
import {
  resolveMcpOAuthUrls,
  toMcpAuthInfo,
} from '@/lib/auth/better-auth/mcp-oauth-config'

const BASE = 'http://localhost:3000'
const urls = resolveMcpOAuthUrls({ BETTER_AUTH_URL: BASE })!
const REDIRECT_URI = 'http://127.0.0.1:7777/callback'

// The memory adapter needs every table up front (Prisma model names).
const db: Record<string, unknown[]> = Object.fromEntries(
  [
    'authUser',
    'authSession',
    'authAccount',
    'authVerification',
    'authJwks',
    'authOauthClient',
    'authOauthResource',
    'authOauthClientResource',
    'authOauthRefreshToken',
    'authOauthAccessToken',
    'authOauthConsent',
    'authOauthClientAssertion',
  ].map(t => [t, []])
)
const auth = betterAuth({
  secret: randomBytes(32).toString('base64'),
  baseURL: BASE,
  basePath: '/api/auth',
  database: memoryAdapter(db),
  telemetry: { enabled: false },
  emailAndPassword: { enabled: true },
  user: { modelName: 'authUser' },
  session: { modelName: 'authSession' },
  account: { modelName: 'authAccount' },
  verification: { modelName: 'authVerification' },
  // As in lib/auth/better-auth/server.ts.
  disabledPaths: MCP_OAUTH_DISABLED_PATHS,
  plugins: mcpOAuthPlugins(urls),
})

const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')

const call = (path: string, init: RequestInit = {}) =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        ...(init.headers ?? {}),
      },
    })
  )

let cookie = ''
let clientId = ''

const authorizePath = (extra: Record<string, string | null> = {}) => {
  const p: Record<string, string | null> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'mcp offline_access',
    state: 'st',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: urls.resource,
    ...extra,
  }
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== null) q.set(k, v)
  return `/oauth2/authorize?${q}`
}

beforeAll(async () => {
  const res = await call('/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test User',
      email: 'mcp-oauth@example.test',
      password: `pw-${randomBytes(8).toString('hex')}`,
    }),
  })
  cookie = res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ')
})

describe('MCP OAuth plugins (in-memory Better Auth)', () => {
  it('closes the session → JWT exchange', async () => {
    const res = await call('/token', { headers: { cookie } })
    expect(res.status).toBe(404)
  })

  it('closes the signed-in client-management endpoints (DCR is the only way in)', async () => {
    const res = await call('/oauth2/create-client', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({
        redirect_uris: ['https://evil.example.com/cb'],
        client_name: 'sneaky',
      }),
    })
    expect(res.status).toBe(404)
    const list = await call('/oauth2/get-clients', { headers: { cookie } })
    expect(list.status).toBe(404)
  })

  it('rejects registering a non-loopback http redirect URI', async () => {
    const res = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        redirect_uris: ['http://example.com/cb'],
        token_endpoint_auth_method: 'none',
      }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_redirect_uri',
    })
  })

  it('registers a loopback public client as native, linked to the MCP resource', async () => {
    const res = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        client_name: 'Unit Client',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    clientId = body.client_id as string
    expect(body.application_type).toBe('native')
  })

  it('rejects an authorization request without PKCE, without redirecting', async () => {
    const res = await call(
      authorizePath({ code_challenge: null, code_challenge_method: null }),
      { headers: { cookie } }
    )
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it('rejects a POSTed authorization request whose PKCE is only in the query', async () => {
    const res = await call(authorizePath(), {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: 'mcp',
      }).toString(),
    })
    expect(res.status).toBe(400)
  })

  it('checks the body of a POST to a non-canonical authorize path too (trailing slash)', async () => {
    const res = await auth.handler(
      new Request(
        `${BASE}/api/auth/oauth2/authorize/?code_challenge=${challenge}&code_challenge_method=S256`,
        {
          method: 'POST',
          headers: {
            cookie,
            origin: BASE,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
            scope: 'mcp',
          }).toString(),
        }
      )
    )
    expect(res.headers.get('location') ?? '').not.toContain('code=')
    expect([400, 404]).toContain(res.status)
  })

  it('issues a resource-bound token that the verify endpoint maps to AuthInfo', async () => {
    const authz = await call(authorizePath(), { headers: { cookie } })
    const consentUrl = new URL(authz.headers.get('location') ?? '', BASE)
    expect(consentUrl.pathname).toBe('/oauth/consent')
    const consent = await call('/oauth2/consent', {
      method: 'POST',
      headers: { cookie, accept: 'application/json' },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentUrl.search.slice(1),
      }),
    })
    const { url } = (await consent.json()) as { url: string }
    const code = new URL(url).searchParams.get('code') ?? ''
    const tokenRes = await call('/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource: urls.resource,
      }).toString(),
    })
    expect(tokenRes.status).toBe(200)
    const { access_token } = (await tokenRes.json()) as { access_token: string }

    const api = auth.api as unknown as {
      lumoVerifyMcpAccessToken: (i: { body: { token: string } }) => Promise<{
        payload: Record<string, unknown> | null
        clientName: string | null
      }>
    }
    const verified = await api.lumoVerifyMcpAccessToken({
      body: { token: access_token },
    })
    expect(verified.clientName).toBe('Unit Client')
    const info = toMcpAuthInfo(access_token, verified.payload, {
      resource: urls.resource,
      nowSeconds: Math.floor(Date.now() / 1000),
    })
    expect(info).toMatchObject({ clientId, scopes: ['mcp', 'offline_access'] })
    expect(info?.userId).toEqual(expect.any(String))

    const garbage = await api.lumoVerifyMcpAccessToken({
      body: { token: 'not-a-token' },
    })
    expect(garbage.payload).toBeNull()
  })

  it('the verify endpoint is not reachable over HTTP', async () => {
    const res = await call('/lumo/mcp/verify-access-token', {
      method: 'POST',
      body: JSON.stringify({ token: 'x' }),
    })
    expect(res.status).toBe(404)
  })
})
