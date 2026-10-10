/**
 * @jest-environment node
 *
 * LUM-837 — Lumo runs static analysis only, never the customer's tests or
 * build (the CodeRabbit model): the two PR trigger paths — the real
 * handlePullRequest (webhook) and the real linkPullRequest (manual link) —
 * dispatch the static security scan (gitleaks / semgrep / osv-scanner) and
 * nothing else. Typecheck / test verdicts come from the customer's own CI via
 * check_suite / status (ci-signal.service). Formerly also covered the
 * LUM-746 managed-CI dispatch, retired here.
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
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => waitUntil(p),
}))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue('scan'),
  shouldScanOnPrEvent: jest.requireActual(
    '@/ee/security/services/pr-security-scan-dispatch'
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

import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { linkPullRequest } from '@/lib/services/task-pr-link.service'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

const scan = dispatchPrSecurityScan as jest.Mock
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
      head: { ref: 'lumo/LUM-837-x', sha: SHA },
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

test('pr webhook and manual pr link dispatch only the static security scan', async () => {
  // Webhook: a push to a task-linked open PR registers exactly one detached
  // job — the static scan. No sandbox CI run of the customer's code.
  await handlePullRequest(prPayload('synchronize'), 'ws', 'int1')
  expect(scan).toHaveBeenCalledWith('pr-row-1', 'PR_EVENT')
  expect(waitUntil).toHaveBeenCalledTimes(1)
  expect(waitUntil).toHaveBeenCalledWith(scan.mock.results[0]!.value)

  // Manual link: the same — one scan of the linked PR, nothing else.
  jest.clearAllMocks()
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
  await linkPullRequest('t1', { prId: 'pr-row-2' })
  expect(scan).toHaveBeenCalledWith('pr-row-2', 'PR_LINK')
  expect(waitUntil).toHaveBeenCalledTimes(1)
})

test('an unlinked PR event dispatches nothing', async () => {
  findTask.mockResolvedValue(null)
  await handlePullRequest(prPayload('synchronize'), 'ws', 'int1')
  expect(scan).not.toHaveBeenCalled()
  expect(waitUntil).not.toHaveBeenCalled()
})
