/**
 * @jest-environment node
 *
 * MCP under AUTH_PROVIDER=better-auth (LUM-1027 → LUM-1044).
 *
 * Without a public URL (BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL) there is no
 * stable issuer or token audience: /api/mcp and its /.well-known/ documents
 * answer 501 saying what to set (not a 401 that would send MCP clients into a
 * login loop). With one, the instance is its own authorization server:
 * /api/mcp challenges with 401 + resource_metadata, the metadata documents
 * are served, and tokens are checked by the Better Auth server — never Clerk.
 * (Full OAuth flow on a real database: __tests__/integration/better-auth.mcp-oauth.test.ts.)
 */
const mockVerifyClerkToken = jest.fn()
const mockClerkAuth = jest.fn()
jest.mock('@clerk/mcp-tools/server', () => ({
  verifyClerkToken: (...a: unknown[]) => mockVerifyClerkToken(...a),
}))
const mockClerkMetadata = jest.fn()
jest.mock(
  '@clerk/mcp-tools/next',
  () => ({
    authServerMetadataHandlerClerk: () => mockClerkMetadata,
    protectedResourceHandlerClerk: () => mockClerkMetadata,
    metadataCorsOptionsRequestHandler: () => async () =>
      new Response(null, { status: 204 }),
  }),
  { virtual: true }
)
jest.mock('@clerk/nextjs/server', () => ({
  auth: (...a: unknown[]) => mockClerkAuth(...a),
}))

// The Better Auth server: only the two server-side endpoints MCP uses.
const mockVerifyEndpoint = jest.fn()
const mockServerConfig = jest.fn()
jest.mock('@/lib/auth/better-auth/server', () => ({
  getBetterAuth: () => ({
    api: {
      lumoVerifyMcpAccessToken: (...a: unknown[]) => mockVerifyEndpoint(...a),
      getOAuthServerConfig: (...a: unknown[]) => mockServerConfig(...a),
    },
  }),
}))

import { GET, POST } from '@/app/api/mcp/route'
import { GET as asMetadata } from '@/app/.well-known/oauth-authorization-server/route'
import { GET as prMetadata } from '@/app/.well-known/oauth-protected-resource/route'
import {
  MCP_OAUTH_UNSUPPORTED_MESSAGE,
  isMcpOAuthSupported,
  verifyMcpAccessToken,
} from '@/lib/auth/mcp'

const ENV_KEYS = ['AUTH_PROVIDER', 'BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL']
const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
beforeEach(() => {
  jest.clearAllMocks()
  process.env.AUTH_PROVIDER = 'better-auth'
  delete process.env.BETTER_AUTH_URL
  delete process.env.NEXT_PUBLIC_APP_URL
})
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const mcpRequest = (method: string, bearer?: string) =>
  new Request('https://lumo.example.com/api/mcp', {
    method,
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(method === 'POST'
      ? {
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }
      : {}),
  })

describe('MCP with Better Auth and no public URL', () => {
  it.each([
    ['POST', POST],
    ['GET', GET],
  ])(
    '%s /api/mcp answers 501 naming BETTER_AUTH_URL, with CORS',
    async (m, fn) => {
      const res = await fn(mcpRequest(m, 'some-token'))
      expect(res.status).toBe(501)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      await expect(res.json()).resolves.toEqual({
        error: 'not_implemented',
        error_description: MCP_OAUTH_UNSUPPORTED_MESSAGE,
      })
      expect(MCP_OAUTH_UNSUPPORTED_MESSAGE).toContain('BETTER_AUTH_URL')
      expect(mockClerkAuth).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['oauth-authorization-server', asMetadata],
    ['oauth-protected-resource', prMetadata],
  ])('/.well-known/%s answers 501', async (_name, handler) => {
    const res = await handler(
      new Request('https://lumo.example.com/.well-known/x')
    )
    expect(res.status).toBe(501)
    expect(mockClerkMetadata).not.toHaveBeenCalled()
  })

  it('verifyMcpAccessToken never verifies a token', async () => {
    expect(isMcpOAuthSupported()).toBe(false)
    await expect(verifyMcpAccessToken('t')).resolves.toBeUndefined()
    expect(mockVerifyEndpoint).not.toHaveBeenCalled()
    expect(mockVerifyClerkToken).not.toHaveBeenCalled()
  })
})

describe('MCP with Better Auth and BETTER_AUTH_URL', () => {
  const RESOURCE = 'https://lumo.example.com/api/mcp'
  beforeEach(() => {
    process.env.BETTER_AUTH_URL = 'https://lumo.example.com/'
  })

  it('an anonymous /api/mcp request is a 401 with WWW-Authenticate resource_metadata', async () => {
    const res = await POST(mcpRequest('POST'))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(
      /^Bearer .*resource_metadata="https:\/\/lumo\.example\.com\/\.well-known\/oauth-protected-resource"/
    )
    expect(res.headers.get('access-control-expose-headers')).toContain(
      'www-authenticate'
    )
    expect(mockVerifyEndpoint).not.toHaveBeenCalled()
  })

  it('a token the server rejects is a 401', async () => {
    mockVerifyEndpoint.mockResolvedValue({ payload: null, clientName: null })
    const res = await POST(mcpRequest('POST', 'bad-token'))
    expect(res.status).toBe(401)
    expect(mockVerifyEndpoint).toHaveBeenCalledWith({
      body: { token: 'bad-token' },
    })
    expect(mockVerifyClerkToken).not.toHaveBeenCalled()
  })

  it('a verification error fails closed as a 401, not a 500', async () => {
    mockVerifyEndpoint.mockRejectedValue(new Error('db down'))
    await expect(verifyMcpAccessToken('tok')).resolves.toBeUndefined()
    const res = await POST(mcpRequest('POST', 'tok'))
    expect(res.status).toBe(401)
  })

  it('maps an accepted token to the AuthInfo shape the MCP server reads', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600
    mockVerifyEndpoint.mockResolvedValue({
      payload: {
        active: true,
        sub: 'user_1',
        aud: RESOURCE,
        client_id: 'client_1',
        scope: 'mcp offline_access',
        exp,
      },
      clientName: 'Inspector',
    })
    await expect(verifyMcpAccessToken('tok')).resolves.toEqual({
      token: 'tok',
      clientId: 'client_1',
      clientName: 'Inspector',
      scopes: ['mcp', 'offline_access'],
      expiresAt: exp,
      resource: new URL(RESOURCE),
      userId: 'user_1',
      extra: { userId: 'user_1' },
    })
  })

  it('serves the protected-resource metadata for /api/mcp (RFC 9728)', async () => {
    const res = await prMetadata(
      new Request(
        'https://lumo.example.com/.well-known/oauth-protected-resource'
      )
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    await expect(res.json()).resolves.toMatchObject({
      resource: RESOURCE,
      authorization_servers: ['https://lumo.example.com'],
    })
    expect(mockClerkMetadata).not.toHaveBeenCalled()
  })

  it('serves the authorization-server metadata from the OAuth provider (RFC 8414)', async () => {
    mockServerConfig.mockResolvedValue({ issuer: 'https://lumo.example.com' })
    const res = await asMetadata(
      new Request(
        'https://lumo.example.com/.well-known/oauth-authorization-server'
      )
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    await expect(res.json()).resolves.toEqual({
      issuer: 'https://lumo.example.com',
    })
    expect(mockClerkMetadata).not.toHaveBeenCalled()
  })
})
