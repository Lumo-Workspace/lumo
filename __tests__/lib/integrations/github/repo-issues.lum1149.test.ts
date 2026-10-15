/** @jest-environment node */
/**
 * LUM-1149 — the issues a PR's description links, read for the linked
 * issue assessment with an issues:read token (inside the production App's
 * permissions), revoked after. A number that is a pull request or does not
 * exist is skipped; any other failure throws (the check is then
 * inconclusive, never not applicable).
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

import { fetchRepoIssues } from '@/lib/integrations/github/contents'
import {
  PRODUCTION_APP_PERMISSIONS,
  REPO_TOKEN_PERMISSIONS,
  isWithinPermissions,
} from '@/lib/integrations/github/token-permissions'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  mockGetRepoToken.mockReset().mockResolvedValue('ghs_issue')
  mockRevoke.mockReset().mockResolvedValue(true)
  global.fetch = fetchMock as unknown as typeof fetch
})

const json = (body: unknown, status = 200) => ({
  ok: status < 300,
  status,
  json: async () => body,
})
const base = { workspaceId: 'w1', fullName: 'acme/app' }

it('reads each issue with an issues:read token, skips pull requests and missing ones, then revokes', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ number: 5, title: 'Dark mode', body: 'x' }))
    .mockResolvedValueOnce(json({ number: 6, title: 'PR', pull_request: {} }))
    .mockResolvedValueOnce(json({}, 404))
  await expect(
    fetchRepoIssues({ ...base, numbers: [5, 6, 7] })
  ).resolves.toEqual([{ number: 5, title: 'Dark mode', body: 'x' }])
  expect(mockGetRepoToken).toHaveBeenCalledWith(
    'w1',
    'acme/app',
    REPO_TOKEN_PERMISSIONS.issueRead
  )
  expect(fetchMock.mock.calls[0]![0]).toBe(
    'https://api.github.com/repos/acme/app/issues/5'
  )
  expect(mockRevoke).toHaveBeenCalledWith('ghs_issue')
})

it('the token set needs no new App permission', () => {
  expect(REPO_TOKEN_PERMISSIONS.issueRead).toEqual({ issues: 'read' })
  expect(
    isWithinPermissions(
      REPO_TOKEN_PERMISSIONS.issueRead,
      PRODUCTION_APP_PERMISSIONS
    )
  ).toBe(true)
})

it('another failure throws (and still revokes); nothing to read mints nothing', async () => {
  fetchMock.mockResolvedValueOnce(json({}, 502))
  await expect(fetchRepoIssues({ ...base, numbers: [5] })).rejects.toThrow(
    /502/
  )
  expect(mockRevoke).toHaveBeenCalled()
  mockGetRepoToken.mockClear()
  await expect(fetchRepoIssues({ ...base, numbers: [] })).resolves.toEqual([])
  expect(mockGetRepoToken).not.toHaveBeenCalled()
})
