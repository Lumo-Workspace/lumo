/**
 * @jest-environment node
 */
// LUM-1027 — /api/auth/[...all] serves Better Auth, with or without
// AUTH_PROVIDER set (Clerk was removed, LUM-1077).
const mockHandler = jest.fn(async () => new Response('ba', { status: 200 }))
jest.mock('@/lib/auth/better-auth/server', () => ({
  getBetterAuth: () => ({ handler: mockHandler }),
}))

import { GET, POST } from '@/app/api/auth/[...all]/route'

const saved = process.env.AUTH_PROVIDER
afterEach(() => {
  if (saved === undefined) delete process.env.AUTH_PROVIDER
  else process.env.AUTH_PROVIDER = saved
  mockHandler.mockClear()
})

describe('/api/auth/[...all]', () => {
  it('hands requests to Better Auth when AUTH_PROVIDER is unset', async () => {
    delete process.env.AUTH_PROVIDER
    const res = await GET(new Request('http://localhost/api/auth/get-session'))
    expect(res.status).toBe(200)
    expect(mockHandler).toHaveBeenCalledTimes(1)
  })

  it('hands GET and POST to the Better Auth handler under better-auth', async () => {
    process.env.AUTH_PROVIDER = 'better-auth'
    const get = new Request('http://localhost/api/auth/get-session')
    const post = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      body: '{}',
    })
    expect((await GET(get)).status).toBe(200)
    expect((await POST(post)).status).toBe(200)
    expect(mockHandler).toHaveBeenNthCalledWith(1, get)
    expect(mockHandler).toHaveBeenNthCalledWith(2, post)
  })
})
