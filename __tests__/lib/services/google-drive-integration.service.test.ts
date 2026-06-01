import { GoogleNeedsReauthError } from '@/lib/integrations/google-drive/client'

// lib/crypto needs an ENCRYPTION_KEY; jest setup already provides a test key in
// other crypto-dependent suites (figma). If not present, set one here.
// Must run before the service (and lib/crypto) is imported below.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = '0'.repeat(64)
}

const mockClient = {
  getMetadata: jest.fn(),
  exportMarkdown: jest.fn(),
}
const mockCreateClient = jest.fn((_arg: unknown) => mockClient)
jest.mock('@/lib/integrations/google-drive/client', () => {
  const actual = jest.requireActual('@/lib/integrations/google-drive/client')
  return {
    ...actual,
    createGoogleDriveClient: (arg: unknown) => mockCreateClient(arg),
  }
})

const mockFindByMember = jest.fn()
const mockMarkNeedsReauth = jest.fn()
const mockUpdateTokens = jest.fn()
jest.mock('@/lib/repositories/google-drive-integration.repository', () => ({
  googleDriveIntegrationRepository: {
    findByMember: (workspaceId: string, memberId: string) =>
      mockFindByMember(workspaceId, memberId),
    markNeedsReauth: (id: string) => mockMarkNeedsReauth(id),
    updateTokens: (id: string, next: unknown) => mockUpdateTokens(id, next),
  },
}))

// Imported after jest.mock so the mocks are wired in.

import {
  encodeOauthState,
  decodeOauthState,
  getClientForMember,
} from '@/lib/services/google-drive-integration.service'
import { encrypt } from '@/lib/crypto'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('google-drive oauth state', () => {
  it('round-trips a valid payload', () => {
    const token = encodeOauthState({
      workspaceId: 'ws1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    expect(decodeOauthState(token)).toEqual({
      workspaceId: 'ws1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
  })

  it('rejects a garbage state', () => {
    expect(decodeOauthState('not-a-real-token')).toBeNull()
  })
})

describe('getClientForMember', () => {
  const row = {
    id: 'gdi_1',
    needsReauth: false,
    accessToken: encrypt('access'),
    refreshToken: encrypt('refresh'),
    expiresAt: new Date(Date.now() + 3600_000),
  }

  it('marks needsReauth and rethrows when a call hits a hard 401', async () => {
    mockFindByMember.mockResolvedValue(row)
    mockMarkNeedsReauth.mockResolvedValue(undefined)
    const reauthError = new GoogleNeedsReauthError()
    mockClient.getMetadata.mockRejectedValue(reauthError)

    const client = await getClientForMember('ws1', 'm1')

    await expect(client.getMetadata('file1')).rejects.toBe(reauthError)
    expect(mockMarkNeedsReauth).toHaveBeenCalledWith('gdi_1')
  })

  it('returns results on the happy path without marking needsReauth', async () => {
    mockFindByMember.mockResolvedValue(row)
    mockClient.getMetadata.mockResolvedValue({
      id: 'file1',
      name: 'Doc',
      mimeType: 'application/vnd.google-apps.document',
    })

    const client = await getClientForMember('ws1', 'm1')
    const meta = await client.getMetadata('file1')

    expect(meta).toEqual({
      id: 'file1',
      name: 'Doc',
      mimeType: 'application/vnd.google-apps.document',
    })
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled()
  })

  it('rethrows non-reauth errors without marking needsReauth', async () => {
    mockFindByMember.mockResolvedValue(row)
    const other = Object.assign(new Error('boom'), { status: 500 })
    mockClient.exportMarkdown.mockRejectedValue(other)

    const client = await getClientForMember('ws1', 'm1')

    await expect(client.exportMarkdown('file1')).rejects.toBe(other)
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled()
  })
})
