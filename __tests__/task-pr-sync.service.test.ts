/** @jest-environment node */
/**
 * LUM-828 — the task-detail PR refresh (syncPullRequestStatus) asks for the
 * task's own workspace installation token and logs every failure instead of
 * swallowing it; one failing PR never stops the rest from syncing.
 */
import { syncPullRequestStatus } from '@/lib/services/task-pr-sync.service'
import { getGithubInstallationToken } from '@/lib/integrations/github'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { logger } from '@/lib/logger'

jest.mock('@/lib/integrations/github', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
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
    expect(getGithubInstallationToken).toHaveBeenCalledWith('ws-1')
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
    ;(getGithubInstallationToken as jest.Mock).mockRejectedValueOnce(
      new Error('no installation')
    )
    const none = await syncPullRequestStatus('ws-1', [pr('pr-1', 1)])
    expect(none.size).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ws-1'),
      expect.objectContaining({ error: expect.anything() })
    )
  })
})
