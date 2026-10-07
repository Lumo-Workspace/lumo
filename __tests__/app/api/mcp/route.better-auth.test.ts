/**
 * @jest-environment node
 *
 * LUM-1027 — MCP under AUTH_PROVIDER=better-auth. Better Auth 1.7.7 ships no
 * OAuth authorization server in core, so /api/mcp and its /.well-known/
 * discovery documents answer 501 with an explanation (not a 401 that would
 * send MCP clients into an endless login loop). Clerk is never consulted.
 */
const mockVerifyClerkToken = jest.fn()
const mockClerkAuth = jest.fn()
jest.mock(
  '@clerk/mcp-tools/server',
  () => ({ verifyClerkToken: (...a: unknown[]) => mockVerifyClerkToken(...a) }),
  { virtual: true }
)
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

import { GET, POST } from '@/app/api/mcp/route'
import { GET as asMetadata } from '@/app/.well-known/oauth-authorization-server/route'
import { GET as prMetadata } from '@/app/.well-known/oauth-protected-resource/route'
import {
  MCP_OAUTH_UNSUPPORTED_MESSAGE,
  verifyMcpAccessToken,
} from '@/lib/auth/mcp'

const saved = process.env.AUTH_PROVIDER
beforeAll(() => {
  process.env.AUTH_PROVIDER = 'better-auth'
})
afterAll(() => {
  if (saved === undefined) delete process.env.AUTH_PROVIDER
  else process.env.AUTH_PROVIDER = saved
})

const mcpRequest = (method: string) =>
  new Request('http://localhost/api/mcp', {
    method,
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer some-token',
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })

describe('MCP with Better Auth', () => {
  it.each([
    ['POST', POST],
    ['GET', GET],
  ])('%s /api/mcp answers 501 with an explanation and CORS', async (m, fn) => {
    const res = await fn(mcpRequest(m))
    expect(res.status).toBe(501)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    await expect(res.json()).resolves.toEqual({
      error: 'not_implemented',
      error_description: MCP_OAUTH_UNSUPPORTED_MESSAGE,
    })
    expect(mockClerkAuth).not.toHaveBeenCalled()
  })

  it.each([
    ['oauth-authorization-server', asMetadata],
    ['oauth-protected-resource', prMetadata],
  ])('/.well-known/%s answers 501', async (_name, handler) => {
    const res = await handler(new Request('http://localhost/.well-known/x'))
    expect(res.status).toBe(501)
    expect(mockClerkMetadata).not.toHaveBeenCalled()
  })

  it('verifyMcpAccessToken never verifies a token', async () => {
    await expect(verifyMcpAccessToken('t')).resolves.toBeUndefined()
    expect(mockVerifyClerkToken).not.toHaveBeenCalled()
  })
})
