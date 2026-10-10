/** @jest-environment node */
/**
 * LUM-828 — the pull_request webhook derives PR state from the payload for
 * every action. It used to derive it from the action alone, so an 'edited'
 * event on an already-merged PR (a post-merge title edit) wrote state=open
 * and left the row self-contradictory (open + mergedAt).
 */
import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { githubService } from '@/lib/services/github.service'
import { stampLineageInBackground } from '@/lib/services/lineage-outcome.service'
import { enqueueFaithfulnessJudgeOnMerge } from '@/lib/services/claim-faithfulness-trigger'
import { enqueueCrossingRejudgeOnPrClose } from '@/lib/services/boundary-crossing-rejudge-trigger'
import { sendChannelNotification } from '@/lib/integrations/slack'

jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/actor', () => ({
  getActorClerkId: jest.fn(),
  getHumanActorId: jest.fn(),
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
  sendDMNotification: jest.fn(),
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    upsertPullRequest: jest.fn().mockResolvedValue({ id: 'pr-row-1' }),
    upsertTaskBranch: jest.fn(),
    findTaskByIdentifier: jest.fn(),
    resolvePullRequestTask: jest.fn(async (task: unknown) => task),
    findWorkspaceSlug: jest.fn().mockResolvedValue('lumo'),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findByRepoAndNumber: jest.fn(),
    findByHeadBranch: jest.fn(),
  },
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  stampLineageInBackground: jest.fn(),
}))
jest.mock('@/lib/services/claim-faithfulness-trigger', () => ({
  enqueueFaithfulnessJudgeOnMerge: jest.fn(),
}))
jest.mock('@/lib/services/boundary-crossing-rejudge-trigger', () => ({
  enqueueCrossingRejudgeOnPrClose: jest.fn(),
}))
jest.mock('@/lib/services/outcome/git-outcome-recorder', () => ({
  gitOutcomeRecorder: { onPush: jest.fn() },
}))
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

const upsertPullRequest = githubService.upsertPullRequest as jest.Mock
const findTaskByIdentifier = githubService.findTaskByIdentifier as jest.Mock

const task = {
  id: 'task-1',
  number: 821,
  title: 'x',
  status: 'IN_REVIEW',
  projectId: 'p1',
  assigneeActorId: null,
  project: { name: 'Lumo', ownerId: null, workspaceId: 'ws-1' },
  team: { identifier: 'LUM' },
}

const mergedPr = {
  number: 1071,
  title: 'fix: renamed after merge',
  html_url: 'https://github.com/a/b/pull/1071',
  state: 'closed',
  merged: true,
  draft: false,
  user: { login: 'octocat' },
  head: { ref: 'lumo/LUM-821-x', sha: 'abc' },
  base: { ref: 'main' },
  merged_at: '2026-09-23T11:28:49Z',
  closed_at: '2026-09-23T11:28:49Z',
  merge_commit_sha: 'def',
}

const payload = (action: string, over: Record<string, unknown> = {}) => ({
  action,
  pull_request: { ...mergedPr, ...over },
  repository: { full_name: 'a/b' },
})

const storedState = () => upsertPullRequest.mock.calls[0][0].state

beforeEach(() => {
  jest.clearAllMocks()
  findTaskByIdentifier.mockResolvedValue(task)
})

describe('pr webhook state derivation (LUM-828)', () => {
  it('edited webhook on a merged PR keeps state merged', async () => {
    await handlePullRequest(payload('edited'), 'ws-1', null)
    expect(storedState()).toBe('merged')

    upsertPullRequest.mockClear()
    await handlePullRequest(
      payload('synchronize', { merged: false, merged_at: null }),
      'ws-1',
      null
    )
    expect(storedState()).toBe('closed')

    upsertPullRequest.mockClear()
    await handlePullRequest(
      payload('edited', {
        state: 'open',
        merged: false,
        merged_at: null,
        closed_at: null,
      }),
      'ws-1',
      null
    )
    expect(storedState()).toBe('open')

    upsertPullRequest.mockClear()
    await handlePullRequest(payload('closed'), 'ws-1', null)
    expect(storedState()).toBe('merged')
  })

  it('edited after merge does not refire merge side effects', async () => {
    await handlePullRequest(payload('edited'), 'ws-1', null)
    expect(stampLineageInBackground).not.toHaveBeenCalled()
    expect(enqueueFaithfulnessJudgeOnMerge).not.toHaveBeenCalled()
    expect(enqueueCrossingRejudgeOnPrClose).not.toHaveBeenCalled()
    expect(sendChannelNotification).not.toHaveBeenCalled()

    // The real close still fires every one of them.
    await handlePullRequest(payload('closed'), 'ws-1', null)
    expect(stampLineageInBackground).toHaveBeenCalledTimes(1)
    expect(enqueueFaithfulnessJudgeOnMerge).toHaveBeenCalledWith(
      'merged',
      'task-1'
    )
    expect(enqueueCrossingRejudgeOnPrClose).toHaveBeenCalledWith(
      'merged',
      'task-1'
    )
    expect(sendChannelNotification).toHaveBeenCalledWith(
      'ws-1',
      'pr_merged',
      expect.anything(),
      'p1'
    )
  })
})
