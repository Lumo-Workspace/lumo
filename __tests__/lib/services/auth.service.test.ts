/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findApiKeyByHashForVerify: jest.fn(),
    touchApiKeyLastUsed: jest.fn(),
  },
}))

jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn(),
}))

import { miscRepository } from '@/lib/repositories/misc.repository'
import { getUserDirectory } from '@/lib/auth/users'
import { authService } from '@/lib/services/auth.service'

const repo = miscRepository as jest.Mocked<typeof miscRepository>
const mockGetUserDirectory = getUserDirectory as jest.Mock
const mockGetUser = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  repo.touchApiKeyLastUsed.mockResolvedValue({} as never)
  mockGetUserDirectory.mockResolvedValue({ getUser: mockGetUser })
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

  it('returns the minimal identity on success and touches lastUsedAt', async () => {
    repo.findApiKeyByHashForVerify.mockResolvedValue(makeApiKey() as never)

    const result = await authService.verifyApiKey('lum_valid_token')

    expect(result).toEqual({
      user: { id: 'user_abc123' },
      workspace: { id: 'ws_xyz789', slug: 'lumo', name: 'Lumo' },
      apiKey: {
        id: 'key_def456',
        name: 'Claude Code',
        prefix: 'lum_5ffb06',
        scope: null,
      },
    })
    expect(repo.touchApiKeyLastUsed).toHaveBeenCalledTimes(1)
  })

  it('surfaces a non-null scope (e.g. security:ingest) on the returned apiKey', async () => {
    repo.findApiKeyByHashForVerify.mockResolvedValue(
      makeApiKey({ scope: 'security:ingest' }) as never
    )

    const result = await authService.verifyApiKey('lum_valid_token')

    expect(result?.apiKey.scope).toBe('security:ingest')
  })

  it('does NOT call the user directory (verifyApiKey is DB-only)', async () => {
    repo.findApiKeyByHashForVerify.mockResolvedValue(makeApiKey() as never)

    await authService.verifyApiKey('lum_valid_token')

    expect(mockGetUserDirectory).not.toHaveBeenCalled()
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})

describe('authService.fetchUserProfile', () => {
  it('returns email + name from Clerk', async () => {
    mockGetUser.mockResolvedValue(makeClerkUser())

    const result = await authService.fetchUserProfile('user_abc123')

    expect(result).toEqual({ email: 'chao@example.com', name: 'Chao' })
    expect(mockGetUser).toHaveBeenCalledWith('user_abc123')
  })

  it('falls back to email local part when Clerk has no name', async () => {
    mockGetUser.mockResolvedValue(
      makeClerkUser({ firstName: null, lastName: null })
    )

    const result = await authService.fetchUserProfile('user_abc123')
    expect(result.name).toBe('chao')
  })

  it('prefers primaryEmailAddressId over other addresses', async () => {
    mockGetUser.mockResolvedValue(
      makeClerkUser({
        primaryEmailAddressId: 'email_2',
        emailAddresses: [
          { id: 'email_1', emailAddress: 'old@example.com' },
          { id: 'email_2', emailAddress: 'new@example.com' },
        ],
      })
    )

    const result = await authService.fetchUserProfile('user_abc123')
    expect(result.email).toBe('new@example.com')
  })

  it('returns empty email when Clerk has no addresses', async () => {
    mockGetUser.mockResolvedValue(
      makeClerkUser({ emailAddresses: [], primaryEmailAddressId: null })
    )

    const result = await authService.fetchUserProfile('user_abc123')
    expect(result.email).toBe('')
  })
})
