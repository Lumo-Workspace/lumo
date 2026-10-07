/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

// LUM-1027 — proxy.ts under AUTH_PROVIDER=better-auth: the real proxy and
// the real Better Auth middleware wrapper; only the session lookup (the
// Better Auth server instance) is stubbed. No CLERK_* variable is set.

const mockGetSession = jest.fn()
jest.mock('@/lib/auth/better-auth/server', () => ({
  getBetterAuth: () => ({ api: { getSession: mockGetSession } }),
}))

import proxy from '@/proxy'

type ProxyFn = (req: NextRequest) => Promise<Response>
const run = (req: NextRequest) => (proxy as unknown as ProxyFn)(req)

const page = (path: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  })

function sessionFor(userId: string | null, setCookie?: string) {
  const headers = new Headers()
  if (setCookie) headers.append('set-cookie', setCookie)
  return { headers, response: userId ? { user: { id: userId } } : null }
}

const savedProvider = process.env.AUTH_PROVIDER
beforeAll(() => {
  process.env.AUTH_PROVIDER = 'better-auth'
  for (const k of Object.keys(process.env)) {
    if (k.includes('CLERK')) delete process.env[k]
  }
})
afterAll(() => {
  if (savedProvider === undefined) delete process.env.AUTH_PROVIDER
  else process.env.AUTH_PROVIDER = savedProvider
})
beforeEach(() => mockGetSession.mockReset())

describe('proxy.ts with Better Auth', () => {
  it('redirects an anonymous protected page to /signin with redirect_url', async () => {
    mockGetSession.mockResolvedValue(sessionFor(null))
    const res = await run(page('/workspace/acme/my-tasks?view=board'))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/signin')
    expect(location.searchParams.get('redirect_url')).toBe(
      '/workspace/acme/my-tasks?view=board'
    )
  })

  it('lets a signed-in user through to a protected page', async () => {
    mockGetSession.mockResolvedValue(sessionFor('ba_user_1'))
    const res = await run(page('/workspace'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(mockGetSession).toHaveBeenCalledWith(
      expect.objectContaining({ returnHeaders: true })
    )
  })

  it('sends a signed-in user away from /signin and / to /workspace', async () => {
    mockGetSession.mockResolvedValue(sessionFor('ba_user_1'))
    for (const path of ['/signin', '/']) {
      const res = await run(page(path))
      expect(res.status).toBe(307)
      expect(new URL(res.headers.get('location')!).pathname).toBe('/workspace')
    }
  })

  it('leaves public pages and /api to the routes when anonymous', async () => {
    mockGetSession.mockResolvedValue(sessionFor(null))
    for (const path of ['/', '/signin', '/security', '/api/tasks']) {
      const res = await run(page(path))
      expect(res.headers.get('x-middleware-next')).toBe('1')
    }
  })

  it('forwards Set-Cookie from the session lookup (cookie-cache refresh)', async () => {
    mockGetSession.mockResolvedValue(
      sessionFor('ba_user_1', 'better-auth.session_data=abc; Path=/; HttpOnly')
    )
    const res = await run(page('/workspace'))
    expect(res.headers.get('set-cookie')).toContain(
      'better-auth.session_data=abc'
    )
  })

  it('looks the session up once per request', async () => {
    mockGetSession.mockResolvedValue(sessionFor(null))
    await run(page('/workspace'))
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })
})
