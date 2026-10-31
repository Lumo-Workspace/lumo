/**
 * @jest-environment node
 *
 * LUM-1344 — `requirePlatformAdmin`: the guard every /api/admin/* route calls.
 * Only a bearer OAuth access token issued for <origin>/api/admin with the
 * `platform-admin` scope authenticates (401 otherwise — MCP tokens, `lum_`
 * CLI keys, no header); the user behind it must be a non-banned
 * `role = 'admin'` (403 otherwise). The Better Auth verify endpoint and the
 * user repository are mocked; the real token → identity mapping runs.
 */
const mockVerifyAdmin = jest.fn()
const mockVerifyMcp = jest.fn()
jest.mock('@/lib/auth/better-auth/server', () => ({
  getBetterAuth: () => ({
    api: {
      lumoVerifyAdminAccessToken: (...a: unknown[]) => mockVerifyAdmin(...a),
      lumoVerifyMcpAccessToken: (...a: unknown[]) => mockVerifyMcp(...a),
    },
  }),
}))

const mockFindAccess = jest.fn()
jest.mock('@/lib/repositories/auth-user.repository', () => ({
  authUserRepository: {
    findPlatformAccessById: (...a: unknown[]) => mockFindAccess(...a),
  },
}))

const mockVerifyApiKey = jest.fn()
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: (...a: unknown[]) => mockVerifyApiKey(...a) },
}))

import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { verifyMcpAccessToken } from '@/lib/auth/better-auth/mcp'

const ORIGIN = 'http://localhost:3000'
const ADMIN_AUD = `${ORIGIN}/api/admin`
const MCP_AUD = `${ORIGIN}/api/mcp`

const ADMIN_USER = {
  id: 'user-1',
  email: 'admin@example.test',
  role: 'admin',
  banned: false,
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    sub: 'user-1',
    client_id: 'console',
    aud: ADMIN_AUD,
    scope: 'platform-admin',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  }
}

const req = (authorization?: string) =>
  new Request(`${ORIGIN}/api/admin/waitlist`, {
    headers: authorization ? { authorization } : {},
  })

const savedEnv = { ...process.env }
beforeEach(() => {
  jest.resetAllMocks()
  process.env = { ...savedEnv, BETTER_AUTH_URL: ORIGIN }
  mockVerifyAdmin.mockResolvedValue({ payload: payload() })
  mockFindAccess.mockResolvedValue(ADMIN_USER)
})
afterAll(() => {
  process.env = savedEnv
})

async function expectStatus(result: unknown, status: number, error: string) {
  expect(result).toBeInstanceOf(NextResponse)
  const res = result as NextResponse
  expect(res.status).toBe(status)
  await expect(res.json()).resolves.toEqual({ error })
  return res
}

describe('requirePlatformAdmin', () => {
  it('401 without an Authorization header', async () => {
    const res = await expectStatus(
      await requirePlatformAdmin(req()),
      401,
      'Unauthorized'
    )
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/)
    expect(mockVerifyAdmin).not.toHaveBeenCalled()
  })

  it('401 for a non-Bearer Authorization header (no session/basic fallback)', async () => {
    await expectStatus(
      await requirePlatformAdmin(req('Basic dXNlcjpwYXNz')),
      401,
      'Unauthorized'
    )
    expect(mockVerifyAdmin).not.toHaveBeenCalled()
  })

  it('401 for a session cookie without a bearer token', async () => {
    const r = new Request(`${ORIGIN}/api/admin/waitlist`, {
      headers: { cookie: 'better-auth.session_token=abc' },
    })
    await expectStatus(await requirePlatformAdmin(r), 401, 'Unauthorized')
  })

  it('401 for an MCP-audience token even when the user is an admin', async () => {
    mockVerifyAdmin.mockResolvedValue({
      payload: payload({ aud: MCP_AUD, scope: 'mcp offline_access' }),
    })
    const res = await expectStatus(
      await requirePlatformAdmin(req('Bearer mcp-token')),
      401,
      'Unauthorized'
    )
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/)
    expect(mockFindAccess).not.toHaveBeenCalled()
  })

  it('401 for an admin-audience token without the platform-admin scope', async () => {
    mockVerifyAdmin.mockResolvedValue({ payload: payload({ scope: 'mcp' }) })
    await expectStatus(
      await requirePlatformAdmin(req('Bearer t')),
      401,
      'Unauthorized'
    )
  })

  it('401 for a lum_ CLI API key', async () => {
    mockVerifyApiKey.mockResolvedValue({ apiKey: { scope: null } })
    await expectStatus(
      await requirePlatformAdmin(req(`Bearer lum_${'a'.repeat(64)}`)),
      401,
      'Unauthorized'
    )
    expect(mockVerifyApiKey).not.toHaveBeenCalled()
    expect(mockVerifyAdmin).not.toHaveBeenCalled()
  })

  it('401 (fail closed) when token verification throws', async () => {
    mockVerifyAdmin.mockRejectedValue(new Error('db down'))
    await expectStatus(
      await requirePlatformAdmin(req('Bearer t')),
      401,
      'Unauthorized'
    )
  })

  it('403 when the token user no longer exists', async () => {
    mockFindAccess.mockResolvedValue(null)
    await expectStatus(
      await requirePlatformAdmin(req('Bearer t')),
      403,
      'Forbidden'
    )
  })

  it("403 for a valid admin-audience token whose user role is 'user'", async () => {
    mockFindAccess.mockResolvedValue({ ...ADMIN_USER, role: 'user' })
    await expectStatus(
      await requirePlatformAdmin(req('Bearer t')),
      403,
      'Forbidden'
    )
  })

  it('403 for a user with no role', async () => {
    mockFindAccess.mockResolvedValue({ ...ADMIN_USER, role: null })
    await expectStatus(
      await requirePlatformAdmin(req('Bearer t')),
      403,
      'Forbidden'
    )
  })

  it('403 for a banned admin', async () => {
    mockFindAccess.mockResolvedValue({ ...ADMIN_USER, banned: true })
    await expectStatus(
      await requirePlatformAdmin(req('Bearer t')),
      403,
      'Forbidden'
    )
  })

  it('returns { userId, email } for a valid token of an admin', async () => {
    const result = await requirePlatformAdmin(req('bearer admin-token'))
    expect(result).toEqual({ userId: 'user-1', email: 'admin@example.test' })
    expect(mockVerifyAdmin).toHaveBeenCalledWith({
      body: { token: 'admin-token' },
    })
    expect(mockFindAccess).toHaveBeenCalledWith('user-1')
  })
})

describe('the MCP verifier rejects admin tokens', () => {
  it('verifyMcpAccessToken returns undefined for an admin-audience token', async () => {
    mockVerifyMcp.mockResolvedValue({ payload: payload(), clientName: null })
    await expect(verifyMcpAccessToken('admin-token')).resolves.toBeUndefined()
  })
})
