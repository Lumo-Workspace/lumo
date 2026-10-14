/** @jest-environment node */
/**
 * LUM-1134 — the reviewed repository's visibility, read from GitHub at review
 * time (Lumo stores none, and a repository can change visibility at any
 * time). Anything but a clear answer is `unknown`, which the learnings scope
 * treats as public (local). Never throws.
 */
const mockGetRepoToken = jest.fn()
const mockRevoke = jest.fn()
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: (...a: unknown[]) => mockGetRepoToken(...a),
  revokeInstallationToken: (...a: unknown[]) => mockRevoke(...a),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { fetchRepoVisibility } from '@/lib/integrations/github/contents'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  mockGetRepoToken.mockReset().mockResolvedValue('ghs_meta')
  mockRevoke.mockReset().mockResolvedValue(true)
  global.fetch = fetchMock as unknown as typeof fetch
})

const json = (body: unknown, status = 200) => ({
  ok: status < 300,
  status,
  json: async () => body,
})
const repo = { workspaceId: 'w1', fullName: 'o/r' }

it('reads `private` from the repository record with a metadata-only token, then revokes it', async () => {
  fetchMock.mockResolvedValueOnce(json({ private: true }))
  await expect(fetchRepoVisibility(repo)).resolves.toBe('private')
  expect(mockGetRepoToken).toHaveBeenCalledWith(
    'w1',
    'o/r',
    REPO_TOKEN_PERMISSIONS.repositoryMetadata
  )
  expect(REPO_TOKEN_PERMISSIONS.repositoryMetadata).toEqual({
    metadata: 'read',
  })
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.github.com/repos/o/r',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer ghs_meta' }),
    })
  )
  expect(mockRevoke).toHaveBeenCalledWith('ghs_meta')
})

it('public only on an explicit `private: false`', async () => {
  fetchMock.mockResolvedValueOnce(json({ private: false }))
  await expect(fetchRepoVisibility(repo)).resolves.toBe('public')
})

it('unknown on a missing field, a non-2xx, a network error or a refused mint', async () => {
  fetchMock.mockResolvedValueOnce(json({}))
  await expect(fetchRepoVisibility(repo)).resolves.toBe('unknown')
  fetchMock.mockResolvedValueOnce(json({ private: true }, 404))
  await expect(fetchRepoVisibility(repo)).resolves.toBe('unknown')
  fetchMock.mockRejectedValueOnce(new Error('socket hang up'))
  await expect(fetchRepoVisibility(repo)).resolves.toBe('unknown')
  mockGetRepoToken.mockRejectedValueOnce(
    Object.assign(new Error('repo_not_confirmed'), { status: 403 })
  )
  await expect(fetchRepoVisibility(repo)).resolves.toBe('unknown')
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
