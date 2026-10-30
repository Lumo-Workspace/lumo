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
  toNativeSchemePlaceholder,
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

// LUM-1073 (ruling Q7): allowlisted app-scheme redirect URIs, end to end.
describe('MCP OAuth plugins — app-scheme redirect URIs (cursor://)', () => {
  const CURSOR_CB = 'cursor://anysphere.cursor-mcp/oauth/callback'
  const CURSOR_URIS = [
    CURSOR_CB,
    'https://www.cursor.com/agents/mcp/oauth/callback',
    'http://localhost:8787/callback',
  ]
  let cursorClientId = ''

  const authorize = (extra: Record<string, string | null> = {}) => {
    const p: Record<string, string | null> = {
      response_type: 'code',
      client_id: cursorClientId,
      redirect_uri: CURSOR_CB,
      scope: 'mcp offline_access',
      state: 'cursor-st',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: urls.resource,
      ...extra,
    }
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(p)) if (v !== null) q.set(k, v)
    return call(`/oauth2/authorize?${q}`, { headers: { cookie } })
  }

  it('registers Cursor’s DCR request and stores/returns the real cursor:// URI', async () => {
    const res = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        client_name: 'Cursor',
        redirect_uris: CURSOR_URIS,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    cursorClientId = body.client_id as string
    expect(body.redirect_uris).toEqual(CURSOR_URIS)
    expect(body.application_type).toBe('native')
    const row = (db.authOauthClient as Record<string, unknown>[]).find(
      c => c.clientId === cursorClientId
    )
    expect(row?.redirectUris).toEqual(CURSOR_URIS)
    // Consent stays on: DCR cannot opt a client out of it.
    expect(row?.skipConsent).not.toBe(true)
  })

  it.each([
    ['an app scheme off the allowlist', ['myapp://callback']],
    ['windsurf://', ['windsurf://codeium.windsurf/cb']],
    ['a reverse-domain private-use scheme', ['com.example.app:/callback']],
    [
      'Lumo’s own placeholder sent directly',
      [toNativeSchemePlaceholder(CURSOR_CB)],
    ],
  ])('rejects registering %s with 400', async (_name, redirect_uris) => {
    const before = db.authOauthClient!.length
    const res = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        redirect_uris,
        token_endpoint_auth_method: 'none',
      }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_redirect_uri',
    })
    expect(db.authOauthClient!.length).toBe(before)
  })

  it('rejects an authorization request without PKCE, without redirecting to cursor://', async () => {
    const res = await authorize({
      code_challenge: null,
      code_challenge_method: null,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it('rejects plain PKCE (S256 only)', async () => {
    const res = await authorize({ code_challenge_method: 'plain' })
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it('does not accept the placeholder or a different cursor:// path as redirect_uri', async () => {
    for (const redirect_uri of [
      toNativeSchemePlaceholder(CURSOR_CB),
      'cursor://anysphere.cursor-mcp/oauth/other',
    ]) {
      const res = await authorize({ redirect_uri })
      const location = res.headers.get('location') ?? ''
      expect(location).not.toMatch(/^cursor:|^ai\.uselumo/)
      expect(location).toContain('invalid_redirect')
    }
  })

  it('asks for consent, then redirects to cursor:// with a code that exchanges for an MCP token', async () => {
    const authz = await authorize()
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
    expect(url.startsWith(`${CURSOR_CB}?`)).toBe(true)
    const callback = new URL(url)
    expect(callback.searchParams.get('state')).toBe('cursor-st')
    const code = callback.searchParams.get('code') ?? ''
    expect(code).not.toBe('')

    const tokenRes = await call('/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CURSOR_CB,
        client_id: cursorClientId,
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
    expect(verified.clientName).toBe('Cursor')
    expect(
      toMcpAuthInfo(access_token, verified.payload, {
        resource: urls.resource,
        nowSeconds: Math.floor(Date.now() / 1000),
      })
    ).toMatchObject({ clientId: cursorClientId })
  })
})

// LUM-1344 — a second protected resource, <origin>/api/admin (scope
// `platform-admin`), for the platform admin console. MCP clients must be
// unaffected; tokens of one resource must never pass the other's verifier.
describe('MCP OAuth plugins — platform admin resource (/api/admin)', () => {
  const CONSOLE_CB = 'https://console.example.test/callback'
  type VerifyApi = (i: { body: { token: string } }) => Promise<{
    payload: Record<string, unknown> | null
    clientName?: string | null
  }>
  const api = () =>
    auth.api as unknown as {
      lumoVerifyMcpAccessToken: VerifyApi
      lumoVerifyAdminAccessToken: VerifyApi
      getOAuthServerConfig: () => Promise<Record<string, unknown>>
    }
  const now = () => Math.floor(Date.now() / 1000)
  let consoleClientId = ''

  /** Full authorize → consent → token flow; returns the token response. */
  async function issue(opts: {
    clientId: string
    redirectUri: string
    scope: string
    resource: string
  }) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      scope: opts.scope,
      state: 'adm',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: opts.resource,
    })
    const authz = await call(`/oauth2/authorize?${q}`, { headers: { cookie } })
    const location = authz.headers.get('location') ?? ''
    const consentUrl = new URL(location, BASE)
    let url: string
    if (consentUrl.pathname === '/oauth/consent') {
      const consent = await call('/oauth2/consent', {
        method: 'POST',
        headers: { cookie, accept: 'application/json' },
        body: JSON.stringify({
          accept: true,
          oauth_query: consentUrl.search.slice(1),
        }),
      })
      ;({ url } = (await consent.json()) as { url: string })
    } else if (location.startsWith(`${opts.redirectUri}?`)) {
      // Consent already given earlier for this client and scope.
      url = location
    } else {
      return {
        status: 0,
        location,
        body: null as Record<string, unknown> | null,
      }
    }
    const code = new URL(url).searchParams.get('code') ?? ''
    if (!code) {
      return {
        status: 0,
        location: url,
        body: null as Record<string, unknown> | null,
      }
    }
    const tokenRes = await call('/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: opts.redirectUri,
        client_id: opts.clientId,
        code_verifier: verifier,
        resource: opts.resource,
      }).toString(),
    })
    return {
      status: tokenRes.status,
      location,
      body: (await tokenRes.json()) as Record<string, unknown>,
    }
  }

  it('keeps MCP discovery and DCR capabilities unchanged (platform-admin not advertised)', async () => {
    const meta = await api().getOAuthServerConfig()
    expect(meta.scopes_supported).toEqual(['mcp', 'offline_access'])
    const reg = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:7778/callback'],
        token_endpoint_auth_method: 'none',
      }),
    })
    expect(reg.status).toBe(201)
    const body = (await reg.json()) as Record<string, unknown>
    expect(body.scope).toBe('mcp offline_access')
  })

  it('refuses a dynamically registered client that asks for platform-admin', async () => {
    const reg = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:7779/callback'],
        token_endpoint_auth_method: 'none',
        scope: 'mcp platform-admin',
      }),
    })
    expect(reg.status).toBe(400)
  })

  it('a DCR (MCP) client cannot obtain an admin-audience token', async () => {
    // Scope platform-admin is outside the DCR client's capability set …
    const scoped = await issue({
      clientId,
      redirectUri: REDIRECT_URI,
      scope: 'platform-admin',
      resource: urls.adminResource,
    })
    expect(scoped.body).toBeNull()
    expect(scoped.location).toContain('invalid_scope')
    // … and even with its own scope it is not linked to the admin resource.
    const linked = await issue({
      clientId,
      redirectUri: REDIRECT_URI,
      scope: 'mcp',
      resource: urls.adminResource,
    })
    expect(linked.body?.access_token).toBeUndefined()
    expect(JSON.stringify(linked)).toContain('invalid_target')
  })

  it('issues an admin-audience platform-admin token to a provisioned console client', async () => {
    const created = await (
      auth.api as unknown as {
        adminCreateOAuthClient: (i: {
          headers: Headers
          body: Record<string, unknown>
        }) => Promise<{ client_id: string }>
      }
    ).adminCreateOAuthClient({
      headers: new Headers({ cookie }),
      body: {
        client_name: 'Lumo Admin Console',
        redirect_uris: [CONSOLE_CB],
        token_endpoint_auth_method: 'none',
        scope: 'platform-admin',
        grant_types: ['authorization_code'],
      },
    })
    consoleClientId = created.client_id
    const ctx = await auth.$context
    await ctx.adapter.create({
      model: 'authOauthClientResource',
      data: { clientId: consoleClientId, resourceId: urls.adminResource },
    })

    const issued = await issue({
      clientId: consoleClientId,
      redirectUri: CONSOLE_CB,
      scope: 'platform-admin',
      resource: urls.adminResource,
    })
    expect(issued.status).toBe(200)
    const token = issued.body?.access_token as string

    const admin = await api().lumoVerifyAdminAccessToken({ body: { token } })
    expect(admin.payload).toMatchObject({
      aud: urls.adminResource,
      scope: 'platform-admin',
      client_id: consoleClientId,
    })

    // The MCP endpoint's mapping rejects it (wrong audience, no mcp scope).
    const mcp = await api().lumoVerifyMcpAccessToken({ body: { token } })
    expect(
      toMcpAuthInfo(token, mcp.payload, {
        resource: urls.resource,
        nowSeconds: now(),
      })
    ).toBeUndefined()
  })

  it('the admin verify endpoint rejects an MCP token', async () => {
    const issued = await issue({
      clientId,
      redirectUri: REDIRECT_URI,
      scope: 'mcp',
      resource: urls.resource,
    })
    expect(issued.status).toBe(200)
    const token = issued.body?.access_token as string
    const admin = await api().lumoVerifyAdminAccessToken({ body: { token } })
    expect(admin.payload).toBeNull()
    // Unchanged MCP path still accepts it.
    const mcp = await api().lumoVerifyMcpAccessToken({ body: { token } })
    expect(
      toMcpAuthInfo(token, mcp.payload, {
        resource: urls.resource,
        nowSeconds: now(),
      })
    ).toMatchObject({ clientId, scopes: ['mcp'] })
  })

  it('cannot mint one token for both resources carrying both scopes', async () => {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: consoleClientId,
      redirect_uri: CONSOLE_CB,
      scope: 'platform-admin',
      state: 'adm',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    q.append('resource', urls.adminResource)
    q.append('resource', urls.resource)
    const authz = await call(`/oauth2/authorize?${q}`, { headers: { cookie } })
    const location = authz.headers.get('location') ?? ''
    expect(new URL(location, BASE).pathname).not.toBe('/oauth/consent')
    expect(location).toMatch(/invalid_scope|invalid_target/)
  })

  it('the admin verify endpoint is not reachable over HTTP', async () => {
    const res = await call('/lumo/admin/verify-access-token', {
      method: 'POST',
      body: JSON.stringify({ token: 'x' }),
    })
    expect(res.status).toBe(404)
  })
})
