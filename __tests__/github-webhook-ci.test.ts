import {
  handleCheckSuite,
  handleStatus,
} from '@/app/api/webhooks/github/handlers'
import { ciSignalService } from '@/lib/services/ci-signal.service'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

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
  pullRequestRepository: { findByRepoAndNumber: jest.fn() },
}))
// Unrelated collaborators of handlers.ts that transitively load the octokit
// barrel — mocked so the module graph loads under jest.
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))

const reconcileCommit = ciSignalService.reconcileCommit as jest.Mock
const findByRepoAndNumber =
  pullRequestRepository.findByRepoAndNumber as jest.Mock
const findTaskByIdentifier = githubService.findTaskByIdentifier as jest.Mock

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
    })

    // status — task linked via branch parse
    findTaskByIdentifier.mockResolvedValue({ id: 't2' })
    await handleStatus(
      {
        sha: 'def456',
        state: 'success',
        branches: [{ name: 'lumo/LUM-2-y' }],
        repository: { full_name: 'a/b' },
      },
      'ws'
    )
    expect(findTaskByIdentifier).toHaveBeenCalledWith('LUM', 2, 'ws')
    expect(reconcileCommit).toHaveBeenCalledWith({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'def456',
      taskId: 't2',
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
