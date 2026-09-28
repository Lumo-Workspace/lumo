/**
 * LUM-699. `PullRequest.state` is webhook-maintained with no reconciliation, so
 * a missed `pull_request closed` delivery leaves a merged PR stored as `open`
 * — and it then surfaces as a stale PR "awaiting review". These cover the
 * correction and, more importantly, the cases where it must NOT write.
 */

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findStaleOpenByProject: jest.fn(),
    updateState: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn() },
}))

import { reconcileStaleProjectPrs } from '@/lib/services/stale-pr-reconcile.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { getRepoToken } from '@/lib/integrations/github/auth'

const findMany = pullRequestRepository.findStaleOpenByProject as jest.Mock
const update = pullRequestRepository.updateState as jest.Mock
const getToken = getRepoToken as jest.Mock

const candidate = { id: 'pr1', repo: 'o/r', number: 16 }

function githubReplies(body: unknown, ok = true) {
  global.fetch = jest.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch
}

beforeEach(() => {
  jest.clearAllMocks()
  findMany.mockResolvedValue([candidate])
  getToken.mockResolvedValue('tok')
})

describe('reconcileStaleProjectPrs', () => {
  it('corrects a PR that GitHub reports as merged', async () => {
    githubReplies({ state: 'closed', merged_at: '2026-07-20T00:00:00Z' })

    const corrected = await reconcileStaleProjectPrs('p1', 'ws1', 3)

    expect(corrected).toBe(1)
    expect(update).toHaveBeenCalledWith(
      'pr1',
      expect.objectContaining({ state: 'merged' })
    )
  })

  it('reads merged from merged_at, not from GitHub reporting state "closed"', async () => {
    // GitHub returns state:"closed" for merged PRs too. Trusting `state` alone
    // would file every merge under "closed".
    githubReplies({ state: 'closed', merged_at: null })

    await reconcileStaleProjectPrs('p1', 'ws1', 3)

    expect(update).toHaveBeenCalledWith(
      'pr1',
      expect.objectContaining({ state: 'closed' })
    )
  })

  it('writes nothing when GitHub confirms the PR is still open', async () => {
    githubReplies({ state: 'open', merged_at: null })

    expect(await reconcileStaleProjectPrs('p1', 'ws1', 3)).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('writes nothing when the lookup fails — unknown is not "still open"', async () => {
    // A failed read must not be laundered into a confirmed state either way.
    githubReplies({}, false)

    expect(await reconcileStaleProjectPrs('p1', 'ws1', 3)).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('survives a network throw without propagating it to the caller', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch

    await expect(reconcileStaleProjectPrs('p1', 'ws1', 3)).resolves.toBe(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('is a no-op when the workspace has no GitHub App token', async () => {
    getToken.mockRejectedValue(new Error('missing env'))
    githubReplies({ state: 'closed', merged_at: '2026-07-20T00:00:00Z' })

    await expect(reconcileStaleProjectPrs('p1', 'ws1', 3)).resolves.toBe(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('never issues a GitHub read when nothing looks stale', async () => {
    findMany.mockResolvedValue([])
    global.fetch = jest.fn() as unknown as typeof fetch

    expect(await reconcileStaleProjectPrs('p1', 'ws1', 3)).toBe(0)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(getToken).not.toHaveBeenCalled()
  })

  it('only considers open PRs already past the stale threshold, capped', async () => {
    githubReplies({ state: 'open', merged_at: null })
    await reconcileStaleProjectPrs('p1', 'ws1', 3)

    const [projectId, cutoff, take] = findMany.mock.calls[0]
    expect(projectId).toBe('p1')
    expect(cutoff).toBeInstanceOf(Date)
    expect(take).toBe(10)
  })
})
