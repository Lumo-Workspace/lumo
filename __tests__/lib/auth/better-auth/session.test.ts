/**
 * @jest-environment node
 */
// LUM-1027 — Better Auth server session: id from the validated session,
// the full user re-read from the database.
const mockGetSession = jest.fn()
jest.mock('@/lib/auth/better-auth/server', () => ({
  getBetterAuth: () => ({ api: { getSession: mockGetSession } }),
}))
const requestHeaders = new Headers({ cookie: 'better-auth.session_token=t' })
jest.mock('next/headers', () => ({ headers: async () => requestHeaders }))
const mockFindById = jest.fn()
jest.mock('@/lib/repositories/auth-user.repository', () => ({
  authUserRepository: { findById: (id: string) => mockFindById(id) },
}))

import {
  getCurrentUser,
  getCurrentUserId,
} from '@/lib/auth/better-auth/session'

beforeEach(() => jest.resetAllMocks())

describe('Better Auth session', () => {
  it('getCurrentUserId validates the request cookies', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'u1' } })
    await expect(getCurrentUserId()).resolves.toBe('u1')
    expect(mockGetSession).toHaveBeenCalledWith({ headers: requestHeaders })
    mockGetSession.mockResolvedValueOnce(null)
    await expect(getCurrentUserId()).resolves.toBeNull()
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
