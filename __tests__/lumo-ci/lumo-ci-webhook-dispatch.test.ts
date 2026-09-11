/**
 * @jest-environment node
 *
 * LUM-746 — both trigger paths of the Lumo-managed CI: the real
 * handlePullRequest (webhook, head sha from the payload) and the real
 * linkPullRequest (manual link, no sha), each with `dispatchLumoCi` mocked.
 */
const waitUntil = jest.fn((p: Promise<unknown>) => p)
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => waitUntil(p),
}))
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
  shouldScanOnPrEvent: jest.requireActual(
    '@/lib/services/pr-security-scan-dispatch'
  ).shouldScanOnPrEvent,
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    upsertPullRequest: jest.fn(),
    upsertTaskBranch: jest.fn(),
    findTaskByIdentifier: jest.fn(),
    findWorkspaceSlug: jest.fn().mockResolvedValue('lumo'),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findByRepoAndNumber: jest.fn(),
    findByHeadBranch: jest.fn(),
    updateTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn() },
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByRepo: jest.fn(),
    upsertPullRequest: jest.fn(),
  },
}))
jest.mock('@/lib/crypto', () => ({ decrypt: (s: string) => s }))
jest.mock('@/lib/integrations/github/fetch-pull-request', () => ({
  fetchPullRequest: jest.fn(),
  parsePrUrl: jest.fn(),
  toPrState: jest.fn(),
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
  sendDMNotification: jest.fn(),
}))
jest.mock('@/lib/actor', () => ({
  getActorClerkId: jest.fn(),
  getHumanActorId: jest.fn(),
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
jest.mock('@/lib/services/outcome/git-outcome-recorder', () => ({
  gitOutcomeRecorder: {
    recordGitRejections: jest.fn(),
    recordRevertsFromPush: jest.fn(),
  },
}))
jest.mock('@/lib/services/ci-signal.service', () => ({
  ciSignalService: { reconcileCommit: jest.fn() },
}))

jest.mock('@/lib/services/lumo-ci-dispatch', () => ({
  dispatchLumoCi: jest.fn().mockResolvedValue(undefined),
}))

import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { linkPullRequest } from '@/lib/services/task-pr-link.service'
import { dispatchLumoCi } from '@/lib/services/lumo-ci-dispatch'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

const dispatch = dispatchLumoCi as jest.Mock
const upsertPr = githubService.upsertPullRequest as jest.Mock
const findTask = githubService.findTaskByIdentifier as jest.Mock
const SHA = 'f'.repeat(40)

const TASK = {
  id: 't1',
  number: 746,
  title: 'x',
  status: 'IN_PROGRESS',
  projectId: 'p1',
  assigneeActorId: null,
  team: { identifier: 'LUM' },
  project: { name: 'Lumo', ownerId: null, workspaceId: 'ws' },
}
function prPayload(action: string) {
  return {
    action,
    pull_request: {
      number: 9,
      title: 'feat',
      html_url: 'https://github.com/o/r/pull/9',
      state: 'open',
      merged: false,
      draft: false,
      user: { login: 'u' },
      head: { ref: 'lumo/LUM-746-x', sha: SHA },
      base: { ref: 'main' },
      merged_at: null,
      closed_at: null,
      merge_commit_sha: null,
    },
    repository: { full_name: 'o/r' },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  findTask.mockResolvedValue(TASK)
  upsertPr.mockResolvedValue({ id: 'pr-row-1' })
})

test('webhook synchronize/opened dispatch with the payload head sha; close never does', async () => {
  await handlePullRequest(prPayload('synchronize'), 'ws', 'int1')
  expect(dispatch).toHaveBeenCalledWith('pr-row-1', 'PR_EVENT', SHA)
  expect(waitUntil).toHaveBeenCalled()

  dispatch.mockClear()
  await handlePullRequest(prPayload('opened'), 'ws', 'int1')
  expect(dispatch).toHaveBeenCalledWith('pr-row-1', 'PR_EVENT', SHA)

  dispatch.mockClear()
  await handlePullRequest(
    {
      ...prPayload('closed'),
      pull_request: { ...prPayload('closed').pull_request, merged: true },
    },
    'ws',
    'int1'
  )
  expect(dispatch).not.toHaveBeenCalled()
})

test('a payload without head.sha still dispatches (the request path fetches the head)', async () => {
  const payload = prPayload('synchronize')
  payload.pull_request.head = {
    ref: 'lumo/LUM-746-x',
  } as typeof payload.pull_request.head
  await handlePullRequest(payload, 'ws', 'int1')
  expect(dispatch).toHaveBeenCalledWith('pr-row-1', 'PR_EVENT', undefined)
})

test('an unlinked PR event does not dispatch', async () => {
  findTask.mockResolvedValue(null)
  await handlePullRequest(prPayload('synchronize'), 'ws', 'int1')
  expect(dispatch).not.toHaveBeenCalled()
})

test('manual link dispatches PR_LINK without a sha, registered with waitUntil', async () => {
  ;(taskRepository.findWithProject as jest.Mock).mockResolvedValue({
    id: 't1',
    project: { workspaceId: 'ws' },
  })
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue({
    id: 'pr-row-2',
    workspaceId: 'ws',
    taskId: null,
    task: null,
  })
  ;(pullRequestRepository.updateTaskId as jest.Mock).mockResolvedValue({
    id: 'pr-row-2',
    taskId: 't1',
  })
  const before = waitUntil.mock.calls.length
  await linkPullRequest('t1', { prId: 'pr-row-2' })
  expect(dispatch).toHaveBeenCalledWith('pr-row-2', 'PR_LINK')
  expect(waitUntil.mock.calls.length).toBeGreaterThan(before)
})
