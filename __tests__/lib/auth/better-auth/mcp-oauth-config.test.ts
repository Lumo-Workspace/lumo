/**
 * @jest-environment node
 *
 * LUM-1044 — the security policy of the self-hosted MCP authorization server,
 * as pure functions: URLs, registration redirect-URI rules, PKCE, and the
 * token → AuthInfo mapping /api/mcp enforces (audience, expiry, scope).
 */
import {
  ADMIN_API_PATH,
  MCP_OAUTH_SCOPES,
  PLATFORM_ADMIN_SCOPE,
  toAdminTokenIdentity,
  buildProtectedResourceMetadata,
  checkAuthorizationPkce,
  MCP_NATIVE_REDIRECT_SCHEMES,
  checkClientRegistration,
  classifyRedirectUri,
  fromNativeSchemePlaceholder,
  restoreNativeSchemeRedirectUris,
  toNativeSchemePlaceholder,
  resolveMcpOAuthUrls,
  toMcpAuthInfo,
} from '@/lib/auth/better-auth/mcp-oauth-config'

describe('resolveMcpOAuthUrls', () => {
  it('derives issuer (origin), resource (/api/mcp) and auth base from BETTER_AUTH_URL', () => {
    expect(
      resolveMcpOAuthUrls({ BETTER_AUTH_URL: 'https://lumo.example.com/app/' })
    ).toEqual({
      origin: 'https://lumo.example.com',
      issuer: 'https://lumo.example.com',
      resource: 'https://lumo.example.com/api/mcp',
      adminResource: 'https://lumo.example.com/api/admin',
      authBaseUrl: 'https://lumo.example.com/api/auth',
    })
  })

  // LUM-1344 — the platform admin API is a second protected resource.
  it('admin resource is <origin>/api/admin and MCP resource is unchanged', () => {
    const urls = resolveMcpOAuthUrls({
      BETTER_AUTH_URL: 'http://localhost:3000',
    })
    expect(ADMIN_API_PATH).toBe('/api/admin')
    expect(PLATFORM_ADMIN_SCOPE).toBe('platform-admin')
    expect(urls?.adminResource).toBe('http://localhost:3000/api/admin')
    expect(urls?.resource).toBe('http://localhost:3000/api/mcp')
    expect(MCP_OAUTH_SCOPES).toEqual(['mcp', 'offline_access'])
  })

  it('falls back to NEXT_PUBLIC_APP_URL', () => {
    expect(
      resolveMcpOAuthUrls({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
        ?.resource
    ).toBe('http://localhost:3000/api/mcp')
  })

  it('is null without a public URL, or with an unparsable one', () => {
    expect(resolveMcpOAuthUrls({})).toBeNull()
    expect(resolveMcpOAuthUrls({ BETTER_AUTH_URL: 'not a url' })).toBeNull()
  })
})

describe('classifyRedirectUri', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', 'web'],
    ['https://vscode.dev/redirect', 'web'],
    ['http://localhost:6274/oauth/callback', 'native'],
    ['http://127.0.0.1:33418', 'native'],
    ['http://[::1]:8080/cb', 'native'],
    ['cursor://anysphere.cursor-mcp/oauth/callback', 'native-scheme'],
    ['vscode://some.extension/oauth/cb', 'native-scheme'],
    ['vscode-insiders://some.extension/oauth/cb', 'native-scheme'],
    ['CURSOR://anysphere.cursor-mcp/oauth/callback', 'native-scheme'],
  ])('accepts %s as %s', (uri, kind) => {
    expect(classifyRedirectUri(uri)).toBe(kind)
  })

  it.each([
    'http://evil.example.com/cb', // plain http, not loopback
    'http://localhost.evil.com/cb', // looks like loopback, is not
    'https://localhost:8443/cb', // https on loopback
    'windsurf://codeium.windsurf/cb', // custom scheme not on the allowlist
    'myapp://callback', // custom scheme not on the allowlist
    'com.example.app:/callback', // private-use scheme not on the allowlist
    'cursor:/no-authority', // allowlisted scheme without a host
    'cursor:opaque', // allowlisted scheme, opaque form
    'cursor://anysphere.cursor-mcp/cb#frag', // fragment
    'cursor://user@anysphere.cursor-mcp/cb', // user info
    'ai.uselumo.mcp-native-redirect:/637572736f72', // Lumo's own placeholder
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'https://app.example.com/cb#frag',
    'https://user:pw@app.example.com/cb',
    'not a url',
  ])('rejects %s', uri => {
    expect(classifyRedirectUri(uri)).toBeNull()
  })
})

describe('checkClientRegistration', () => {
  it('infers application_type native for loopback-only clients (MCP Inspector, Claude Code)', () => {
    const r = checkClientRegistration({
      redirect_uris: ['http://localhost:6274/oauth/callback'],
      token_endpoint_auth_method: 'none',
      client_name: 'MCP Inspector',
    })
    expect(r).toEqual({
      ok: true,
      body: expect.objectContaining({
        application_type: 'native',
        client_name: 'MCP Inspector',
      }),
    })
  })

  it('infers web for https clients', () => {
    const r = checkClientRegistration({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    })
    expect(r.ok && r.body.application_type).toBe('web')
  })

  it.each([
    ['no body', null],
    ['no redirect_uris', { client_name: 'x' }],
    ['empty redirect_uris', { redirect_uris: [] }],
    ['a disallowed scheme', { redirect_uris: ['myapp://x/cb'] }],
    ['a non-string uri', { redirect_uris: [42] }],
    [
      'an allowed app scheme next to a disallowed one',
      { redirect_uris: ['cursor://a.b/cb', 'myapp://x/cb'] },
    ],
    [
      'an app scheme with application_type web',
      { redirect_uris: ['cursor://a.b/cb'], application_type: 'web' },
    ],
    [
      'a contradicting application_type',
      {
        redirect_uris: ['http://localhost:1/cb'],
        application_type: 'web',
      },
    ],
    [
      'the client_credentials grant',
      {
        redirect_uris: ['http://localhost:1/cb'],
        grant_types: ['authorization_code', 'client_credentials'],
      },
    ],
    [
      'the implicit grant',
      { redirect_uris: ['http://localhost:1/cb'], grant_types: ['implicit'] },
    ],
  ])('rejects %s', (_name, body) => {
    const r = checkClientRegistration(body)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.description.length).toBeGreaterThan(0)
  })

  it('reports redirect problems as invalid_redirect_uri, the rest as invalid_client_metadata (RFC 7591)', () => {
    expect(
      checkClientRegistration({ redirect_uris: ['myapp://x/cb'] })
    ).toMatchObject({
      error: 'invalid_redirect_uri',
    })
    expect(
      checkClientRegistration({
        redirect_uris: ['http://localhost:1/cb'],
        grant_types: ['client_credentials'],
      })
    ).toMatchObject({ error: 'invalid_client_metadata' })
  })
})

describe('app-scheme redirect URIs (LUM-1073, ruling Q7)', () => {
  const CURSOR = 'cursor://anysphere.cursor-mcp/oauth/callback'

  it('the allowlist is a fixed constant: cursor, vscode, vscode-insiders', () => {
    expect([...MCP_NATIVE_REDIRECT_SCHEMES]).toEqual([
      'cursor',
      'vscode',
      'vscode-insiders',
    ])
    expect(Object.isFrozen(MCP_NATIVE_REDIRECT_SCHEMES)).toBe(true)
  })

  it('registers Cursor’s real DCR request (app scheme + https + loopback) as native, with placeholders for Better Auth', () => {
    const r = checkClientRegistration({
      client_name: 'Cursor',
      redirect_uris: [
        CURSOR,
        'https://www.cursor.com/agents/mcp/oauth/callback',
        'http://localhost:8787/callback',
      ],
      token_endpoint_auth_method: 'none',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.body.application_type).toBe('native')
    const sent = r.body.redirect_uris as string[]
    expect(sent[0]).toMatch(/^ai\.uselumo\.mcp-native-redirect:\/[0-9a-f]+$/)
    expect(sent.slice(1)).toEqual([
      'https://www.cursor.com/agents/mcp/oauth/callback',
      'http://localhost:8787/callback',
    ])
    expect(restoreNativeSchemeRedirectUris(sent)).toEqual([
      CURSOR,
      'https://www.cursor.com/agents/mcp/oauth/callback',
      'http://localhost:8787/callback',
    ])
  })

  it('placeholders are reverse-domain, authority-free URIs (what Better Auth accepts) and round-trip exactly', () => {
    const p = toNativeSchemePlaceholder(CURSOR)
    const url = new URL(p)
    expect(url.host).toBe('')
    expect(url.protocol).toBe('ai.uselumo.mcp-native-redirect:')
    expect(fromNativeSchemePlaceholder(p)).toBe(CURSOR)
  })

  it('never decodes a placeholder to a URI outside the allowlist', () => {
    expect(
      fromNativeSchemePlaceholder(toNativeSchemePlaceholder('myapp://x/cb'))
    ).toBeNull()
    expect(
      fromNativeSchemePlaceholder('ai.uselumo.mcp-native-redirect:/zz')
    ).toBeNull()
    expect(
      fromNativeSchemePlaceholder('ai.uselumo.mcp-native-redirect:/ff')
    ).toBeNull()
    expect(fromNativeSchemePlaceholder('https://a.example.com/cb')).toBeNull()
    expect(
      restoreNativeSchemeRedirectUris(['http://localhost:1/cb'])
    ).toBeNull()
    expect(restoreNativeSchemeRedirectUris(undefined)).toBeNull()
  })
})

describe('checkAuthorizationPkce', () => {
  it('passes an S256 challenge', () => {
    expect(
      checkAuthorizationPkce({
        code_challenge: 'abc',
        code_challenge_method: 'S256',
      })
    ).toBeNull()
  })

  it.each([
    ['no challenge', {}],
    [
      'an empty challenge',
      { code_challenge: '', code_challenge_method: 'S256' },
    ],
    ['no method', { code_challenge: 'abc' }],
    [
      'the plain method',
      { code_challenge: 'abc', code_challenge_method: 'plain' },
    ],
    ['no query at all', undefined],
    ['a pushed request_uri without a challenge', { request_uri: 'urn:x' }],
  ])('rejects %s', (_n, q) => {
    expect(checkAuthorizationPkce(q)).toEqual(expect.any(String))
  })
})

describe('toMcpAuthInfo', () => {
  const RESOURCE = 'https://lumo.example.com/api/mcp'
  const NOW = 1_800_000_000
  const good = {
    active: true,
    sub: 'user_1',
    aud: RESOURCE,
    client_id: 'client_1',
    scope: 'mcp offline_access',
    exp: NOW + 60,
  }
  const opts = { resource: RESOURCE, nowSeconds: NOW }

  it('maps an active, resource-bound token to the MCP AuthInfo shape', () => {
    expect(
      toMcpAuthInfo('tok', good, { ...opts, clientName: 'Inspector' })
    ).toEqual({
      token: 'tok',
      clientId: 'client_1',
      clientName: 'Inspector',
      scopes: ['mcp', 'offline_access'],
      expiresAt: NOW + 60,
      resource: new URL(RESOURCE),
      userId: 'user_1',
      extra: { userId: 'user_1' },
    })
  })

  it('accepts the resource inside an audience array and azp as the client', () => {
    const info = toMcpAuthInfo(
      'tok',
      {
        ...good,
        client_id: undefined,
        azp: 'client_2',
        aud: [RESOURCE, 'https://lumo.example.com/api/auth/oauth2/userinfo'],
      },
      opts
    )
    expect(info?.clientId).toBe('client_2')
  })

  it.each([
    ['a null payload', null],
    ['an inactive token', { ...good, active: false }],
    [
      'a token for another audience',
      { ...good, aud: 'https://other.example.com/api/mcp' },
    ],
    [
      'a token for the bare origin',
      { ...good, aud: 'https://lumo.example.com' },
    ],
    ['a token without an audience (opaque)', { ...good, aud: undefined }],
    ['an expired token', { ...good, exp: NOW - 1 }],
    ['a token expiring right now', { ...good, exp: NOW }],
    ['a token without exp', { ...good, exp: undefined }],
    ['a token without the mcp scope', { ...good, scope: 'offline_access' }],
    ['a token without a user', { ...good, sub: undefined }],
    ['a token without a client', { ...good, client_id: undefined }],
  ])('rejects %s', (_n, payload) => {
    expect(toMcpAuthInfo('tok', payload, opts)).toBeUndefined()
  })
})

describe('buildProtectedResourceMetadata', () => {
  const urls = resolveMcpOAuthUrls({
    BETTER_AUTH_URL: 'https://lumo.example.com',
  })!
  const md = buildProtectedResourceMetadata(urls)

  it('names the MCP resource and this instance as its authorization server (RFC 9728 §2)', () => {
    expect(md).toMatchObject({
      resource: 'https://lumo.example.com/api/mcp',
      authorization_servers: ['https://lumo.example.com'],
      scopes_supported: [...MCP_OAUTH_SCOPES],
      bearer_methods_supported: ['header'],
    })
  })

  it('keeps the Clerk-mode fields that apply to this server', () => {
    // Field set of Clerk's MCP tools' generateProtectedResourceMetadata
    // (the provider before LUM-1077), minus the entries that
    // describe Clerk's own services (introspection endpoint, jwks_uri,
    // service_documentation).
    const clerkApplicable = [
      'resource',
      'authorization_servers',
      'token_types_supported',
      'authorization_data_types_supported',
      'authorization_data_locations_supported',
      'key_challenges_supported',
    ]
    expect(Object.keys(md)).toEqual(expect.arrayContaining(clerkApplicable))
    expect(md.key_challenges_supported).toEqual([
      {
        challenge_type: 'urn:ietf:params:oauth:pkce:code_challenge',
        challenge_algs: ['S256'],
      },
    ])
  })
})

// LUM-1344 — access-token payload → platform admin identity.
describe('toAdminTokenIdentity', () => {
  const ADMIN = 'https://lumo.example.com/api/admin'
  const MCP = 'https://lumo.example.com/api/mcp'
  const now = 1_000_000
  const base = {
    active: true,
    sub: 'user-1',
    client_id: 'console',
    aud: ADMIN,
    scope: 'platform-admin',
    exp: now + 60,
  }
  const check = (payload: Record<string, unknown> | null) =>
    toAdminTokenIdentity(payload, { resource: ADMIN, nowSeconds: now })

  it('returns { userId, clientId } for an admin-audience platform-admin token', () => {
    expect(check(base)).toEqual({ userId: 'user-1', clientId: 'console' })
    expect(check({ ...base, client_id: undefined, azp: 'console' })).toEqual({
      userId: 'user-1',
      clientId: 'console',
    })
    expect(check({ ...base, aud: [MCP, ADMIN] })).toEqual({
      userId: 'user-1',
      clientId: 'console',
    })
  })

  it.each([
    ['a null payload', null],
    ['an inactive token', { ...base, active: false }],
    [
      'an MCP token (aud /api/mcp, scope mcp)',
      { ...base, aud: MCP, scope: 'mcp' },
    ],
    [
      'the admin audience without the scope',
      { ...base, scope: 'mcp offline_access' },
    ],
    ['the scope without the admin audience', { ...base, aud: MCP }],
    ['no audience', { ...base, aud: undefined }],
    ['an expired token', { ...base, exp: now }],
    ['no subject', { ...base, sub: '' }],
    ['no client', { ...base, client_id: undefined }],
  ])('rejects %s', (_label, payload) => {
    expect(check(payload as Record<string, unknown> | null)).toBeUndefined()
  })
})
