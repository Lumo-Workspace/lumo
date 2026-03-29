import { getClerkUser, _clearCache } from '@/lib/agent/clerk-cache'

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: {
      getUser: jest.fn(),
    },
  }),
}))

import { clerkClient } from '@clerk/nextjs/server'

describe('getClerkUser', () => {
  let mockGetUser: jest.Mock

  beforeEach(async () => {
    _clearCache()
    const client = await (clerkClient as unknown as jest.Mock)()
    mockGetUser = client.users.getUser as jest.Mock
    mockGetUser.mockReset()
  })

  it('returns name and email from Clerk user', async () => {
    mockGetUser.mockResolvedValue({
      firstName: 'Vincent',
      lastName: 'Mou',
      username: 'vincentmou',
      primaryEmailAddress: { emailAddress: 'vincent@example.com' },
    })

    const result = await getClerkUser('clerk_123')
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

    const result = await getClerkUser('clerk_456')
    expect(result).toEqual({
      name: 'vincentmou',
      email: 'vincent@example.com',
    })
  })

  it('caches results — second call does not hit Clerk API', async () => {
    mockGetUser.mockResolvedValue({
      firstName: 'Vincent',
      lastName: 'Mou',
      username: 'vincentmou',
      primaryEmailAddress: { emailAddress: 'vincent@example.com' },
    })

    await getClerkUser('clerk_789')
    await getClerkUser('clerk_789')
    expect(mockGetUser).toHaveBeenCalledTimes(1)
  })

  it('falls back to "Unknown" name and empty email on API error', async () => {
    mockGetUser.mockRejectedValue(new Error('Clerk down'))
    const result = await getClerkUser('clerk_err')
    expect(result).toEqual({ name: 'Unknown', email: '' })
  })
})
