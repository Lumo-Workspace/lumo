import {
  handleCheckSuite,
  handleStatus,
} from '@/app/api/webhooks/github/handlers'
import { ciSignalService } from '@/lib/services/ci-signal.service'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { fetchPullNumbersForCommit } from '@/lib/integrations/github/checks'

jest.mock('@vercel/functions', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/services/ci-signal.service', () => ({
  ciSignalService: { reconcileCommit: jest.fn() },
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    updatePullRequestCiStatus: jest.fn(),
    findTaskByIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findByRepoAndNumber: jest.fn(),
    findByHeadBranch: jest.fn(),
  },
}))
// handleStatus lazily imports this for the LUM-623 SHA→PR fallback; mock it so
// the octokit-barrel-loading real module never enters the jest graph.
jest.mock('@/lib/integrations/github/checks', () => ({
  fetchPullNumbersForCommit: jest.fn(),
}))
// Unrelated collaborators of handlers.ts that transitively load the octokit
// barrel — mocked so the module graph loads under jest.
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))

const reconcileCommit = ciSignalService.reconcileCommit as jest.Mock
const findByRepoAndNumber =
  pullRequestRepository.findByRepoAndNumber as jest.Mock
const findByHeadBranch = pullRequestRepository.findByHeadBranch as jest.Mock
const findTaskByIdentifier = githubService.findTaskByIdentifier as jest.Mock
const fetchPullNumbers = fetchPullNumbersForCommit as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('webhook CI handlers (LUM-616)', () => {
  it('webhook handlers invoke reconcileCommit with the commit head sha', async () => {
    // check_suite — task linked via PR number
    findByRepoAndNumber.mockResolvedValue({ taskId: 't1' })
    await handleCheckSuite(
      {
        action: 'completed',
        check_suite: {
          head_sha: 'abc123',
          head_branch: 'lumo/LUM-1-x',
          conclusion: 'success',
          pull_requests: [{ number: 5 }],
        },
        repository: { full_name: 'a/b' },
      },
      'ws'
    )
    expect(reconcileCommit).toHaveBeenCalledWith({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'abc123',
      taskId: 't1',
      prNumber: 5,
    })

    // status — task linked via branch parse, PR via head branch
    findTaskByIdentifier.mockResolvedValue({ id: 't2' })
    findByHeadBranch.mockResolvedValue({ number: 7 })
    await handleStatus(
      {
        sha: 'def456',
        state: 'success',
        branches: [{ name: 'lumo/LUM-2-y' }],
        repository: { full_name: 'a/b' },
      },
      'ws'
    )
    expect(findTaskByIdentifier).toHaveBeenCalledWith('LUM', 2, 'ws', 'a/b')
    // Head branch is present, so the SHA→PR fallback is not consulted.
    expect(fetchPullNumbers).not.toHaveBeenCalled()
    expect(reconcileCommit).toHaveBeenCalledWith({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'def456',
      taskId: 't2',
      prNumber: 7,
    })
  })

  it('handleStatus resolves task and PR by commit SHA when the head branch is gone', async () => {
    // A squash-merge deletes the PR head branch, so a commit-status arriving
    // after the merge carries an empty `branches` — branch-based resolution
    // finds nothing. LUM-623: fall back to resolving the PR by the commit SHA
    // (still works post-merge), so the CI signal reconciles instead of dropping.
    fetchPullNumbers.mockResolvedValue([42])
    findByRepoAndNumber.mockResolvedValue({ taskId: 'tSha', number: 42 })

    await handleStatus(
      {
        sha: 'deadbeef',
        state: 'success',
        branches: [],
        repository: { full_name: 'a/b' },
      },
      'ws'
    )

    expect(fetchPullNumbers).toHaveBeenCalledWith({
      workspaceId: 'ws',
      fullName: 'a/b',
      sha: 'deadbeef',
    })
    expect(reconcileCommit).toHaveBeenCalledWith({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'deadbeef',
      taskId: 'tSha',
      prNumber: 42,
    })
  })

  it('handleStatus SHA fallback failure is swallowed and never throws', async () => {
    // The fallback is best-effort. A GitHub error must never break ingestion:
    // handleStatus resolves, and the commit reconciles with null linkage (which
    // reconcileCommit itself no-ops on) rather than rejecting the webhook.
    fetchPullNumbers.mockRejectedValue(new Error('GitHub 500'))

    await expect(
      handleStatus(
        {
          sha: 'x',
          state: 'success',
          branches: [],
          repository: { full_name: 'a/b' },
        },
        'ws'
      )
    ).resolves.toBeUndefined()

    expect(reconcileCommit).toHaveBeenCalledWith({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'x',
      taskId: null,
      prNumber: null,
    })
  })

  it('check_suite that is not completed does not reconcile', async () => {
    await handleCheckSuite(
      {
        action: 'requested',
        check_suite: {
          head_sha: 'abc',
          head_branch: 'lumo/LUM-1-x',
          conclusion: null,
          pull_requests: [],
        },
        repository: { full_name: 'a/b' },
      },
      'ws'
    )
    expect(reconcileCommit).not.toHaveBeenCalled()
  })
})
