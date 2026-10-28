import { getCachedUser, _clearCache } from '@/lib/auth/user-profiles'

const mockGetUser = jest.fn()
jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: async () => ({ getUser: mockGetUser }),
}))

describe('getCachedUser', () => {
  beforeEach(() => {
    _clearCache()
    mockGetUser.mockReset()
  })

  it('returns name and email from the directory user', async () => {
    mockGetUser.mockResolvedValue({
      firstName: 'Vincent',
      lastName: 'Mou',
      username: 'vincentmou',
      primaryEmailAddress: { emailAddress: 'vincent@example.com' },
    })

    const result = await getCachedUser('user_123')
    expect(result).toEqual({
      name: 'Vincent Mou',
      email: 'vincent@example.com',
    })
  })

  it('falls back to username when firstName is missing', async () => {
    mockGetUser.mockResolvedValue({
      firstName: null,
      lastName: null,
      username: 'vincentmou',
      primaryEmailAddress: { emailAddress: 'vincent@example.com' },
    })

    const result = await getCachedUser('user_456')
    expect(result).toEqual({
      name: 'vincentmou',
      email: 'vincent@example.com',
    })
  })

  it('caches results — second call does not hit the directory', async () => {
    mockGetUser.mockResolvedValue({
      firstName: 'Vincent',
      lastName: 'Mou',
      username: 'vincentmou',
      primaryEmailAddress: { emailAddress: 'vincent@example.com' },
    })

    await getCachedUser('user_789')
    await getCachedUser('user_789')
    expect(mockGetUser).toHaveBeenCalledTimes(1)
  })

  it('falls back to "Unknown" name and empty email on API error', async () => {
    mockGetUser.mockRejectedValue(new Error('directory down'))
    const result = await getCachedUser('user_err')
    expect(result).toEqual({ name: 'Unknown', email: '' })
  })
})
