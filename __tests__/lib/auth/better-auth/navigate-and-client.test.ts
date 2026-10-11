// LUM-1027 — small Better Auth client helpers.
const mockCreateAuthClient = jest.fn((opts: unknown) => ({ opts }))
jest.mock('better-auth/react', () => ({
  createAuthClient: (opts: unknown) => mockCreateAuthClient(opts),
}))

import { hardNavigate } from '@/lib/auth/better-auth/navigate'
import { getAuthClient } from '@/lib/auth/better-auth/auth-client'

describe('hardNavigate', () => {
  it('does a full navigation via location.assign', () => {
    const assign = jest.fn()
    hardNavigate('/workspace', { assign })
    expect(assign).toHaveBeenCalledWith('/workspace')
  })
})

describe('getAuthClient', () => {
  it('creates one same-origin client on /api/auth, lazily', () => {
    expect(mockCreateAuthClient).not.toHaveBeenCalled()
    const a = getAuthClient()
    const b = getAuthClient()
    expect(a).toBe(b)
    expect(mockCreateAuthClient).toHaveBeenCalledTimes(1)
    expect(mockCreateAuthClient).toHaveBeenCalledWith({
      basePath: '/api/auth',
      // LUM-1044: carries the signed OAuth request on sign-in / consent POSTs.
      plugins: [
        expect.objectContaining({ id: 'oauth-provider-client' }),
        // LUM-1082: email one-time-code sign-in.
        expect.objectContaining({ id: 'email-otp' }),
      ],
    })
  })
})
