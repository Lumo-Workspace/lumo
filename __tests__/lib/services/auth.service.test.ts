/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findApiKeyByHashForVerify: jest.fn(),
    touchApiKeyLastUsed: jest.fn(),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn(),
}))

import { miscRepository } from '@/lib/repositories/misc.repository'
import { clerkClient } from '@clerk/nextjs/server'
import { authService } from '@/lib/services/auth.service'

const repo = miscRepository as jest.Mocked<typeof miscRepository>
const mockClerkClient = clerkClient as jest.MockedFunction<typeof clerkClient>
const mockGetUser = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  repo.touchApiKeyLastUsed.mockResolvedValue({} as never)
  mockClerkClient.mockResolvedValue({
    users: { getUser: mockGetUser },
  } as never)
})

function makeApiKey(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'key_def456',
    label: 'Claude Code',
    keyPrefix: 'lum_5ffb06',
    revokedAt: null,
    member: {
      id: 'member_1',
      clerkId: 'user_abc123',
      workspace: { id: 'ws_xyz789', slug: 'lumo', name: 'Lumo' },
    },
    ...overrides,
  }
}

function makeClerkUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    firstName: 'Chao',
    lastName: null,
    primaryEmailAddressId: 'email_1',
    emailAddresses: [{ id: 'email_1', emailAddress: 'chao@example.com' }],
    ...overrides,
  }
}

describe('authService.verifyApiKey', () => {
  it('returns null when the key is not found', async () => {
    repo.findApiKeyByHashForVerify.mockResolvedValue(null)

    const result = await authService.verifyApiKey('lum_missing')
    expect(result).toBeNull()
    expect(repo.touchApiKeyLastUsed).not.toHaveBeenCalled()
  })

  it('returns null when the key is revoked', async () => {
    repo.findApiKeyByHashForVerify.mockResolvedValue(
      makeApiKey({ revokedAt: new Date() }) as never
    )

    const result = await authService.verifyApiKey('lum_revoked')
    expect(result).toBeNull()
    expect(repo.touchApiKeyLastUsed).not.toHaveBeenCalled()
  })

  it('returns the identity payload on success and touches lastUsedAt', async () => {
    repo.findApiKeyByHashForVerify.mockResolvedValue(makeApiKey() as never)
    mockGetUser.mockResolvedValue(makeClerkUser())

    const result = await authService.verifyApiKey('lum_valid_token')

    expect(result).toEqual({
      user: {
        id: 'user_abc123',
        email: 'chao@example.com',
        name: 'Chao',
      },
      workspace: { id: 'ws_xyz789', slug: 'lumo', name: 'Lumo' },
      apiKey: { id: 'key_def456', name: 'Claude Code', prefix: 'lum_5ffb06' },
    })
    expect(repo.touchApiKeyLastUsed).toHaveBeenCalledTimes(1)
  })

  it('falls back to email local part when Clerk has no name', async () => {
    repo.findApiKeyByHashForVerify.mockResolvedValue(makeApiKey() as never)
    mockGetUser.mockResolvedValue(
      makeClerkUser({ firstName: null, lastName: null })
    )

    const result = await authService.verifyApiKey('lum_valid_token')
    expect(result?.user.name).toBe('chao')
  })

  it('prefers primaryEmailAddressId over other addresses', async () => {
    repo.findApiKeyByHashForVerify.mockResolvedValue(makeApiKey() as never)
    mockGetUser.mockResolvedValue(
      makeClerkUser({
        primaryEmailAddressId: 'email_2',
        emailAddresses: [
          { id: 'email_1', emailAddress: 'old@example.com' },
          { id: 'email_2', emailAddress: 'new@example.com' },
        ],
      })
    )

    const result = await authService.verifyApiKey('lum_valid_token')
    expect(result?.user.email).toBe('new@example.com')
  })
})
