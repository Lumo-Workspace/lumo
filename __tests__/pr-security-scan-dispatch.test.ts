/**
 * @jest-environment node
 *
 * LUM-732 — both trigger paths hand off to the scan worker. The webhook path
 * is exercised through the real handlePullRequest with its collaborators
 * mocked; the link path through the real linkPullRequest.
 */
const waitUntil = jest.fn((p: Promise<unknown>) => p)
// LUM-883: linking checks the workspace's confirmed repository list.
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: {
    findByWorkspace: jest
      .fn()
      .mockResolvedValue({ installationId: 1, repositories: ['acme/app'] }),
  },
}))
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
    resolvePullRequestTask: jest.fn(async (task: unknown) => task),
    isRepoConfirmedElsewhere: jest.fn().mockResolvedValue(false),
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

import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { linkPullRequest } from '@/lib/services/task-pr-link.service'
import {
  dispatchPrSecurityScan,
  shouldScanOnPrEvent,
} from '@/lib/services/pr-security-scan-dispatch'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

const dispatch = dispatchPrSecurityScan as jest.Mock
const upsertPr = githubService.upsertPullRequest as jest.Mock
const findTask = githubService.findTaskByIdentifier as jest.Mock

const TASK = {
  id: 't1',
  number: 732,
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
      head: { ref: 'lumo/LUM-732-x' },
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

test('dispatches from webhook synchronize and from linkPullRequest', async () => {
  await handlePullRequest(prPayload('synchronize'), 'ws', 'int1')
  expect(dispatch).toHaveBeenCalledWith('pr-row-1', 'PR_EVENT')
  expect(waitUntil).toHaveBeenCalled()

  dispatch.mockClear()
  await handlePullRequest(prPayload('opened'), 'ws', 'int1')
  expect(dispatch).toHaveBeenCalledWith('pr-row-1', 'PR_EVENT')

  // A close/merge event never scans (the diff is final and already scanned).
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

  // Manual link: the linked PR row's id is dispatched with PR_LINK.
  ;(taskRepository.findWithProject as jest.Mock).mockResolvedValue({
    id: 't1',
    project: { workspaceId: 'ws' },
  })
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue({
    id: 'pr-row-2',
    workspaceId: 'ws',
    repo: 'acme/app',
    taskId: null,
    task: null,
  })
  ;(pullRequestRepository.updateTaskId as jest.Mock).mockResolvedValue({
    id: 'pr-row-2',
    taskId: 't1',
  })
  const waitUntilCallsBeforeLink = waitUntil.mock.calls.length
  await linkPullRequest('t1', { prId: 'pr-row-2' })
  expect(dispatch).toHaveBeenCalledWith('pr-row-2', 'PR_LINK')
  // LUM-732 review: the link path must also register its dispatch with
  // waitUntil (not a bare `void`) — a dropped promise there reads as "clean"
  // at the DONE gate.
  expect(waitUntil.mock.calls.length).toBeGreaterThan(waitUntilCallsBeforeLink)

  expect(shouldScanOnPrEvent('synchronize', 'open')).toBe(true)
  expect(shouldScanOnPrEvent('edited', 'open')).toBe(false)
  expect(shouldScanOnPrEvent('synchronize', 'closed')).toBe(false)
})

test('an unlinked PR event does not dispatch', async () => {
  findTask.mockResolvedValue(null)
  await handlePullRequest(prPayload('synchronize'), 'ws', 'int1')
  expect(dispatch).not.toHaveBeenCalled()
})
