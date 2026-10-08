/**
 * @jest-environment node
 */
// LUM-1027 — Better Auth server session: id from the validated session,
// the full user re-read from the database.
const mockGetSession = jest.fn()
const mockGetBetterAuth = jest.fn()
jest.mock('@/lib/auth/better-auth/server', () => ({
  getBetterAuth: () => mockGetBetterAuth(),
}))
const requestHeaders = new Headers({ cookie: 'better-auth.session_token=t' })
const mockHeaders = jest.fn()
jest.mock('next/headers', () => ({ headers: () => mockHeaders() }))
const mockFindById = jest.fn()
jest.mock('@/lib/repositories/auth-user.repository', () => ({
  authUserRepository: { findById: (id: string) => mockFindById(id) },
}))

import {
  getCurrentUser,
  getCurrentUserId,
} from '@/lib/auth/better-auth/session'

beforeEach(() => {
  jest.resetAllMocks()
  mockHeaders.mockResolvedValue(requestHeaders)
  mockGetBetterAuth.mockReturnValue({ api: { getSession: mockGetSession } })
})

describe('Better Auth session', () => {
  it('getCurrentUserId validates the request cookies', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'u1' } })
    await expect(getCurrentUserId()).resolves.toBe('u1')
    expect(mockGetSession).toHaveBeenCalledWith({ headers: requestHeaders })
    mockGetSession.mockResolvedValueOnce(null)
    await expect(getCurrentUserId()).resolves.toBeNull()
  })

  it('reads the request headers before building the instance, so a prerender bails out without BETTER_AUTH_SECRET (LUM-1043)', async () => {
    const bailout = new Error('Dynamic server usage: headers')
    mockHeaders.mockRejectedValueOnce(bailout)
    await expect(getCurrentUserId()).rejects.toBe(bailout)
    expect(mockGetBetterAuth).not.toHaveBeenCalled()
  })

  it('getCurrentUser reads the fresh row (e.g. just-verified email)', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockFindById.mockResolvedValueOnce({
      id: 'u1',
      name: 'Ada Lovelace',
      email: 'ada@x.io',
      emailVerified: true,
      image: null,
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    const user = await getCurrentUser()
    expect(user?.emailAddresses[0]?.verification?.status).toBe('verified')
    mockFindById.mockResolvedValueOnce(null)
    await expect(getCurrentUser()).resolves.toBeNull()
    mockGetSession.mockResolvedValueOnce(null)
    await expect(getCurrentUser()).resolves.toBeNull()
  })
})
