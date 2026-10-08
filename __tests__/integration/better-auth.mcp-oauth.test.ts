/**
 * @jest-environment node
 *
 * LUM-1044 — MCP OAuth on Better Auth, end to end on a REAL Postgres through
 * the REAL handlers (Better Auth + @better-auth/oauth-provider, the
 * /.well-known/ routes and app/api/mcp/route.ts), AUTH_PROVIDER=better-auth
 * and no CLERK_* variable:
 *
 *   discovery → 401 challenge → dynamic client registration → authorize with
 *   PKCE (login redirect, consent redirect) → consent → token → /api/mcp
 *   tools/list + tools/call as the consenting user → refresh rotation
 *
 * plus the security boundary: PKCE required (S256 only), exact redirect_uri,
 * registration redirect-URI policy, audience / expiry / scope on /api/mcp.
 *
 * Opt-in: set BETTER_AUTH_TEST_DATABASE_URL to a THROWAWAY migrated database
 * (e.g. a local pgvector container + `prisma migrate deploy`); it writes rows.
 */
import { createHash, randomBytes } from 'node:crypto'

const DB_URL = process.env.BETTER_AUTH_TEST_DATABASE_URL
const describeDb = DB_URL ? describe : describe.skip

let requestHeaders = new Headers()
jest.mock('next/headers', () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}))
jest.unmock('@prisma/client')
jest.mock('@/lib/integrations/github/auth', () => ({}))
// The Clerk MCP helpers (ESM-only for jest) must never run in this mode.
const clerkCalled = jest.fn()
jest.mock('@clerk/mcp-tools/server', () => ({
  verifyClerkToken: (...a: unknown[]) => clerkCalled(...a),
}))
jest.mock(
  '@clerk/mcp-tools/next',
  () => ({
    authServerMetadataHandlerClerk: () => clerkCalled,
    protectedResourceHandlerClerk: () => clerkCalled,
    metadataCorsOptionsRequestHandler: () => clerkCalled,
  }),
  { virtual: true }
)

const BASE = 'http://localhost:3000'
const RESOURCE = `${BASE}/api/mcp`
const REDIRECT_URI = 'http://localhost:6274/oauth/callback'
const run = randomBytes(4).toString('hex')
const email = `lum1044-${run}@example.test`
const password = `pw-${randomBytes(12).toString('base64url')}`

const b64url = (buf: Buffer) => buf.toString('base64url')
const verifier = b64url(randomBytes(32))
const challenge = b64url(createHash('sha256').update(verifier).digest())

function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ')
}

async function readMcp(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  const line = text.split('\n').find(l => l.startsWith('data:'))
  return JSON.parse(line ? line.slice(5).trim() : text) as Record<
    string,
    unknown
  >
}

describeDb('MCP OAuth on Better Auth, real database (LUM-1044)', () => {
  let mod: {
    handleAuthRequest: typeof import('@/lib/auth/handler').handleAuthRequest
    mcp: typeof import('@/app/api/mcp/route')
    asMetadata: typeof import('@/app/.well-known/oauth-authorization-server/route')
    prMetadata: typeof import('@/app/.well-known/oauth-protected-resource/route')
    createWorkspace: typeof import('@/app/api/workspaces/route').POST
    prisma: typeof import('@/lib/db/prisma').prisma
    getBetterAuth: typeof import('@/lib/auth/better-auth/server').getBetterAuth
  }
  let userId = ''
  let sessionCookie = ''
  let workspaceId = ''
  let clientId = ''
  let accessToken = ''
  let refreshToken = ''
  const startedAt = new Date()

  const call = (path: string, init: RequestInit = {}) =>
    mod.handleAuthRequest(
      new Request(`${BASE}/api/auth${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          origin: BASE,
          ...(init.headers ?? {}),
        },
      })
    )

  const authorizeUrl = (overrides: Record<string, string | null> = {}) => {
    const params: Record<string, string | null> = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: 'mcp offline_access',
      state: `st-${run}`,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
      ...overrides,
    }
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== null) q.set(k, v)
    return `/oauth2/authorize?${q}`
  }

  const token = (form: Record<string, string>) =>
    call('/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    })

  const mcpPost = (body: unknown, bearer?: string) =>
    mod.mcp.POST(
      new Request(RESOURCE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
      })
    )

  /** Authorize (signed in) → consent → code. */
  async function obtainCode(): Promise<string> {
    const res = await call(authorizeUrl(), {
      headers: { cookie: sessionCookie },
    })
    const location = res.headers.get('location') ?? ''
    if (location.startsWith(REDIRECT_URI)) {
      return new URL(location).searchParams.get('code') ?? ''
    }
    const consent = await call('/oauth2/consent', {
      method: 'POST',
      headers: { cookie: sessionCookie, accept: 'application/json' },
      body: JSON.stringify({
        accept: true,
        oauth_query: new URL(location, BASE).search.slice(1),
      }),
    })
    const decided = (await consent.json()) as { url?: string }
    expect({ status: consent.status, decided }).toMatchObject({
      status: 200,
      decided: { url: expect.stringContaining(REDIRECT_URI) },
    })
    return new URL(decided.url ?? '').searchParams.get('code') ?? ''
  }

  beforeAll(async () => {
    for (const k of Object.keys(process.env)) {
      if (k.includes('CLERK')) delete process.env[k]
    }
    process.env.DATABASE_URL = DB_URL
    process.env.AUTH_PROVIDER = 'better-auth'
    process.env.BETTER_AUTH_URL = BASE
    process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('base64')
    mod = {
      handleAuthRequest: (await import('@/lib/auth/handler')).handleAuthRequest,
      mcp: await import('@/app/api/mcp/route'),
      asMetadata:
        await import('@/app/.well-known/oauth-authorization-server/route'),
      prMetadata:
        await import('@/app/.well-known/oauth-protected-resource/route'),
      createWorkspace: (await import('@/app/api/workspaces/route')).POST,
      prisma: (await import('@/lib/db/prisma')).prisma,
      getBetterAuth: (await import('@/lib/auth/better-auth/server'))
        .getBetterAuth,
    }
    // Signing keys are encrypted with BETTER_AUTH_SECRET; any left in this
    // THROWAWAY database by a run with another secret (an earlier test run,
    // a local server) cannot be decrypted and would break token issuance.
    await mod.prisma.authJwks.deleteMany({})
    const signUp = await call('/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ name: 'Grace Hopper', email, password }),
    })
    userId = ((await signUp.json()) as { user: { id: string } }).user.id
    sessionCookie = cookieHeader(signUp)
    requestHeaders = new Headers({ cookie: sessionCookie })
    const { NextRequest } = await import('next/server')
    const ws = await mod.createWorkspace(
      new NextRequest(`${BASE}/api/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `LUM1044 ${run}`,
          slug: `lum1044-${run}`,
        }),
      })
    )
    workspaceId = ((await ws.json()) as { workspace: { id: string } }).workspace
      .id
    requestHeaders = new Headers()
  })

  afterAll(async () => {
    if (!mod) return
    // Signing keys are encrypted with this run's random secret: drop the
    // ones it created so the next run does not trip over them.
    await mod.prisma.authJwks.deleteMany({
      where: { createdAt: { gte: startedAt } },
    })
    if (userId) {
      await mod.prisma.mcpAuditLog.deleteMany({
        where: { clerkUserId: userId },
      })
    }
    if (clientId) {
      await mod.prisma.mcpConnection.deleteMany({ where: { clientId } })
      await mod.prisma.authOauthClient.deleteMany({ where: { clientId } })
    }
    if (workspaceId) {
      await mod.prisma.workspace.deleteMany({ where: { id: workspaceId } })
    }
    await mod.prisma.authUser.deleteMany({ where: { email } })
    await mod.prisma.$disconnect()
    expect(clerkCalled).not.toHaveBeenCalled()
  })

  // ── Schema ─────────────────────────────────────────────────────────────────

  it('the Prisma schema has every table and column the auth plugins write', async () => {
    const { diffSchema, getExpectedSchema } =
      await import('@better-auth/core/db/internal')
    const expected = Object.fromEntries(
      Object.entries(getExpectedSchema(mod.getBetterAuth().options)).map(
        ([model, table]) => [
          model.charAt(0).toLowerCase() + model.slice(1),
          table,
        ]
      )
    )
    const dataModel = (
      mod.prisma as unknown as {
        _runtimeDataModel: {
          models: Record<
            string,
            {
              fields: Array<{
                kind: string
                name: string
                isRequired?: boolean
                hasDefaultValue?: boolean
                isUpdatedAt?: boolean
              }>
            }
          >
        }
      }
    )._runtimeDataModel
    const actual = Object.entries(dataModel.models).map(
      ([model, { fields }]) => ({
        name: model.charAt(0).toLowerCase() + model.slice(1),
        columns: fields
          .filter(f => f.kind !== 'object')
          .map(f => ({
            name: f.name,
            nullable: f.isRequired !== true,
            hasDefault: f.hasDefaultValue === true || f.isUpdatedAt === true,
          })),
      })
    )
    expect(Object.keys(expected)).toEqual(
      expect.arrayContaining([
        'authOauthClient',
        'authOauthConsent',
        'authJwks',
      ])
    )
    expect(diffSchema(expected, actual)).toEqual([])
    // …and the check is live: dropping one column is reported.
    const withoutRedirects = actual.map(t =>
      t.name === 'authOauthClient'
        ? { ...t, columns: t.columns.filter(c => c.name !== 'redirectUris') }
        : t
    )
    expect(diffSchema(expected, withoutRedirects)).not.toEqual([])
  })

  // ── Discovery ──────────────────────────────────────────────────────────────

  it('serves RFC 9728 protected-resource metadata for /api/mcp', async () => {
    const res = await mod.prMetadata.GET(
      new Request(`${BASE}/.well-known/oauth-protected-resource`)
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    await expect(res.json()).resolves.toMatchObject({
      resource: RESOURCE,
      authorization_servers: [BASE],
      scopes_supported: ['mcp', 'offline_access'],
      bearer_methods_supported: ['header'],
    })
  })

  it('serves RFC 8414 authorization-server metadata with the issuer at the root', async () => {
    const res = await mod.asMetadata.GET(
      new Request(`${BASE}/.well-known/oauth-authorization-server`)
    )
    expect(res.status).toBe(200)
    const md = (await res.json()) as Record<string, unknown>
    expect(md).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/api/auth/oauth2/authorize`,
      token_endpoint: `${BASE}/api/auth/oauth2/token`,
      registration_endpoint: `${BASE}/api/auth/oauth2/register`,
      jwks_uri: `${BASE}/api/auth/jwks`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      scopes_supported: ['mcp', 'offline_access'],
    })
    expect(md.token_endpoint_auth_methods_supported).toContain('none')
  })

  it('/api/mcp without a token is a 401 pointing at the resource metadata', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource"`
    )
  })

  // ── Dynamic client registration ────────────────────────────────────────────

  it.each([
    ['a custom scheme', 'cursor://anysphere.cursor/callback'],
    ['plain http on a public host', 'http://evil.example.com/cb'],
    ['https on loopback', 'https://localhost:8080/cb'],
    ['javascript:', 'javascript:alert(1)'],
    ['a fragment', 'https://app.example.com/cb#x'],
  ])('rejects registering %s', async (_name, uri) => {
    const res = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        redirect_uris: [uri],
        token_endpoint_auth_method: 'none',
        client_name: 'bad',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a registration that tries to skip consent', async () => {
    const res = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        skip_consent: true,
      }),
    })
    expect(res.status).toBe(400)
  })

  it('registers a public loopback client without a session (MCP client DCR)', async () => {
    const res = await call('/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_name: 'LUM-1044 Test Client',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    clientId = body.client_id as string
    expect(clientId).toBeTruthy()
    expect(body.client_secret).toBeUndefined()
    const row = await mod.prisma.authOauthClient.findUnique({
      where: { clientId },
      select: { applicationType: true, skipConsent: true, requirePKCE: true },
    })
    expect(row?.applicationType).toBe('native')
    expect(row?.skipConsent).not.toBe(true)
    const link = await mod.prisma.authOauthClientResource.findFirst({
      where: { clientId },
    })
    expect(link?.resourceId).toBe(RESOURCE)
  })

  // ── Authorization request ──────────────────────────────────────────────────

  it('sends an anonymous user to /signin with a signed request', async () => {
    const res = await call(authorizeUrl())
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location') ?? '', BASE)
    expect(loc.pathname).toBe('/signin')
    expect(loc.searchParams.get('client_id')).toBe(clientId)
    expect(loc.searchParams.get('sig')).toBeTruthy()
  })

  it.each([
    ['without PKCE', { code_challenge: null, code_challenge_method: null }],
    ['with the plain PKCE method', { code_challenge_method: 'plain' }],
    ['with a challenge but no method', { code_challenge_method: null }],
  ])('rejects an authorization request %s', async (_name, overrides) => {
    const res = await call(authorizeUrl(overrides), {
      headers: { cookie: sessionCookie },
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it.each([
    ['an unregistered redirect_uri', 'http://localhost:6274/other'],
    [
      'the registered loopback URI on another port',
      'http://localhost:9999/oauth/callback',
    ],
    ['a different host', 'https://evil.example.com/oauth/callback'],
  ])('never redirects to %s', async (_name, uri) => {
    const res = await call(authorizeUrl({ redirect_uri: uri }), {
      headers: { cookie: sessionCookie },
    })
    const loc = res.headers.get('location') ?? ''
    expect(loc.startsWith(uri)).toBe(false)
    expect(loc).not.toContain('code=')
  })

  it('asks a signed-in user for consent before issuing a code', async () => {
    const res = await call(authorizeUrl(), {
      headers: { cookie: sessionCookie },
    })
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location') ?? '', BASE)
    expect(loc.pathname).toBe('/oauth/consent')
    expect(loc.searchParams.get('scope')).toBe('mcp offline_access')
  })

  it('consent requires the session', async () => {
    const res = await call(authorizeUrl(), {
      headers: { cookie: sessionCookie },
    })
    const loc = new URL(res.headers.get('location') ?? '', BASE)
    const anon = await call('/oauth2/consent', {
      method: 'POST',
      body: JSON.stringify({ accept: true, oauth_query: loc.search.slice(1) }),
    })
    expect(anon.status).toBe(401)
  })

  // ── Token ──────────────────────────────────────────────────────────────────

  it('rejects the code with a wrong PKCE verifier', async () => {
    const code = await obtainCode()
    const res = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: b64url(randomBytes(32)),
      resource: RESOURCE,
    })
    const body = (await res.json()) as Record<string, unknown>
    // Better Auth answers 401 invalid_request here; what matters is no token.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(body).toMatchObject({
      error_description: 'code verification failed',
    })
    expect(body.access_token).toBeUndefined()
  })

  it('exchanges the code (PKCE) for a resource-bound access token + refresh token', async () => {
    const code = await obtainCode()
    const res = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    accessToken = body.access_token as string
    refreshToken = body.refresh_token as string
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(3600)
    expect(body.scope).toBe('mcp offline_access')
    expect(refreshToken).toBeTruthy()
    const claims = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString()
    ) as Record<string, unknown>
    expect(claims).toMatchObject({
      iss: BASE,
      aud: RESOURCE,
      sub: userId,
      azp: clientId,
    })
  })

  it('a replayed code fails and revokes the refresh token issued from it', async () => {
    const code = await obtainCode()
    const form = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    }
    const first = await token(form)
    expect(first.status).toBe(200)
    const issued = (await first.json()) as { refresh_token: string }
    const replay = await token(form)
    expect(replay.status).toBe(400)
    const refresh = await token({
      grant_type: 'refresh_token',
      refresh_token: issued.refresh_token,
      client_id: clientId,
    })
    expect(refresh.status).toBe(400)
  })

  // ── /api/mcp with the token ────────────────────────────────────────────────

  it('tools/list answers 200 with the token', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      accessToken
    )
    expect(res.status).toBe(200)
    const body = await readMcp(res)
    const names = (body.result as { tools: { name: string }[] }).tools.map(
      t => t.name
    )
    expect(names).toContain('list_my_workspaces')
  })

  it('tools/call runs as the consenting Lumo user', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_my_workspaces', arguments: {} },
      },
      accessToken
    )
    expect(res.status).toBe(200)
    const body = await readMcp(res)
    expect(JSON.stringify(body.result)).toContain(workspaceId)
    const conn = await mod.prisma.mcpConnection.findFirst({
      where: { clientId },
      select: { clerkUserId: true, clientName: true },
    })
    expect(conn).toEqual({
      clerkUserId: userId,
      clientName: 'LUM-1044 Test Client',
    })
  })

  async function mint(payload: Record<string, unknown>): Promise<string> {
    const api = mod.getBetterAuth().api as unknown as {
      signJWT: (i: { body: { payload: Record<string, unknown> } }) => Promise<{
        token: string
      }>
    }
    return (await api.signJWT({ body: { payload } })).token
  }

  const now = () => Math.floor(Date.now() / 1000)

  it.each([
    ['another audience', () => ({ aud: 'https://other.example.com/api' })],
    ['the instance origin as audience', () => ({ aud: BASE })],
    ['an expired token', () => ({ exp: now() - 60 })],
    ['a token without the mcp scope', () => ({ scope: 'offline_access' })],
  ])('/api/mcp rejects %s (signed by the server key)', async (_n, extra) => {
    const forged = await mint({
      sub: userId,
      aud: RESOURCE,
      azp: clientId,
      client_id: clientId,
      scope: 'mcp offline_access',
      iss: BASE,
      iat: now(),
      exp: now() + 600,
      ...extra(),
    })
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 4, method: 'tools/list' },
      forged
    )
    expect(res.status).toBe(401)
  })

  it('/api/mcp accepts a well-formed server-signed token (control for the cases above)', async () => {
    const good = await mint({
      sub: userId,
      aud: RESOURCE,
      azp: clientId,
      client_id: clientId,
      scope: 'mcp offline_access',
      iss: BASE,
      iat: now(),
      exp: now() + 600,
    })
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 5, method: 'tools/list' },
      good
    )
    expect(res.status).toBe(200)
  })

  it('/api/mcp rejects an opaque token issued without a resource', async () => {
    const code = await (async () => {
      const res = await call(authorizeUrl({ resource: null }), {
        headers: { cookie: sessionCookie },
      })
      const location = res.headers.get('location') ?? ''
      const consent = await call('/oauth2/consent', {
        method: 'POST',
        headers: { cookie: sessionCookie, accept: 'application/json' },
        body: JSON.stringify({
          accept: true,
          oauth_query: new URL(location, BASE).search.slice(1),
        }),
      })
      const target = location.startsWith(REDIRECT_URI)
        ? location
        : ((await consent.json()) as { url: string }).url
      return new URL(target).searchParams.get('code') ?? ''
    })()
    const res = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    })
    expect(res.status).toBe(200)
    const opaque = ((await res.json()) as { access_token: string }).access_token
    expect(opaque.split('.')).toHaveLength(1)
    const mcp = await mcpPost(
      { jsonrpc: '2.0', id: 6, method: 'tools/list' },
      opaque
    )
    expect(mcp.status).toBe(401)
  })

  it('/api/mcp rejects a tampered token', async () => {
    const [h, p] = accessToken.split('.')
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 7, method: 'tools/list' },
      `${h}.${p}.${b64url(randomBytes(64))}`
    )
    expect(res.status).toBe(401)
  })

  // ── Refresh ────────────────────────────────────────────────────────────────

  it('refresh rotates the refresh token and detects reuse', async () => {
    const first = await token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource: RESOURCE,
    })
    const body = (await first.json()) as Record<string, string>
    expect(first.status).toBe(200)
    expect(body.refresh_token).toBeTruthy()
    expect(body.refresh_token).not.toBe(refreshToken)
    const ok = await mcpPost(
      { jsonrpc: '2.0', id: 8, method: 'tools/list' },
      body.access_token
    )
    expect(ok.status).toBe(200)

    // Re-using the rotated token fails and revokes the family.
    const reuse = await token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    })
    expect(reuse.status).toBe(400)
    const afterReuse = await token({
      grant_type: 'refresh_token',
      refresh_token: body.refresh_token ?? '',
      client_id: clientId,
    })
    expect(afterReuse.status).toBe(400)
  })

  it('a disabled client loses access', async () => {
    const code = await obtainCode()
    const res = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    })
    const fresh = ((await res.json()) as { access_token: string }).access_token
    await mod.prisma.authOauthClient.update({
      where: { clientId },
      data: { disabled: true },
    })
    const mcp = await mcpPost(
      { jsonrpc: '2.0', id: 9, method: 'tools/list' },
      fresh
    )
    expect(mcp.status).toBe(401)
  })
})
