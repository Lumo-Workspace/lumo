/** @jest-environment node */
/**
 * LUM-828 — the task-detail PR refresh (syncPullRequestStatus) asks for the
 * task's own workspace installation token (LUM-883: one per repository) and logs every failure instead of
 * swallowing it; one failing PR never stops the rest from syncing.
 */
import { syncPullRequestStatus } from '@/lib/services/task-pr-sync.service'
import { getRepoToken } from '@/lib/integrations/github'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { logger } from '@/lib/logger'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'

jest.mock('@/lib/integrations/github', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
  REPO_TOKEN_PERMISSIONS: jest.requireActual(
    '@/lib/integrations/github/token-permissions'
  ).REPO_TOKEN_PERMISSIONS,
}))
// LUM-889: the refresh reads the confirmed list once up front; a/b is on it.
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: {
    findByWorkspace: jest.fn(async () => ({
      installationId: 42,
      repositories: ['a/b'],
    })),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { updateState: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

const pr = (id: string, number: number) => ({
  id,
  number,
  url: `https://github.com/a/b/pull/${number}`,
  state: 'open',
})

const ghMerged = {
  ok: true,
  status: 200,
  json: async () => ({
    state: 'closed',
    merged: true,
    merged_at: '2026-09-23T11:28:49Z',
    closed_at: '2026-09-23T11:28:49Z',
    draft: false,
  }),
}

beforeEach(() => jest.clearAllMocks())

describe('task-detail PR refresh (LUM-828)', () => {
  it('pr refresh uses the task workspace installation token', async () => {
    fetchMock.mockResolvedValue(ghMerged)
    const updates = await syncPullRequestStatus('ws-1', [pr('pr-1', 1071)])
    expect(getRepoToken).toHaveBeenCalledWith('ws-1', 'a/b', {
      pull_requests: 'read',
    })
    expect(updates.get('pr-1')?.state).toBe('merged')
  })

  it('pr refresh logs failures and keeps syncing', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(ghMerged)

    const updates = await syncPullRequestStatus('ws-1', [
      pr('pr-1', 1),
      pr('pr-2', 2),
      pr('pr-3', 3),
    ])

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('a/b#1'),
      expect.objectContaining({ status: 404 })
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('a/b#2'),
      expect.objectContaining({ error: expect.anything() })
    )
    expect([...updates.keys()]).toEqual(['pr-3'])
    expect(pullRequestRepository.updateState).toHaveBeenCalledTimes(1)

    // A token failure is logged too, never swallowed.
    ;(getRepoToken as jest.Mock).mockRejectedValueOnce(
      new Error('no installation')
    )
    const none = await syncPullRequestStatus('ws-1', [pr('pr-1', 1)])
    expect(none.size).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ws-1'),
      expect.objectContaining({ error: expect.anything() })
    )
  })

  it('pr refresh stays fail-soft when the confirmed list cannot be read', async () => {
    ;(
      githubAppInstallationRepository.findByWorkspace as jest.Mock
    ).mockRejectedValueOnce(new Error('db unavailable'))

    const updates = await syncPullRequestStatus('ws-1', [pr('pr-1', 1)])

    // No throw (the task page still loads), no mint, no GitHub read — logged.
    expect(updates.size).toBe(0)
    expect(getRepoToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('confirmed repositories of workspace ws-1'),
      expect.objectContaining({
        error: expect.stringContaining('db unavailable'),
      })
    )
  })
})
