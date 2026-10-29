/**
 * @jest-environment node
 */
/**
 * LUM-883 — a repository that left the confirmed list (owner re-verify,
 * LUM-882 access recheck) keeps its PullRequest rows; the code scrub does not
 * delete them. Those rows must stop being a way back in: no re-link, no
 * background sync or reconcile, no comment mirror call to GitHub for them.
 *
 * `acme/payroll` was confirmed once and has since been removed; `acme/web`
 * is still confirmed. The real token layer runs.
 */
// LUM-1064: plugin cases live in __tests__/ee/security/lum883-removed-repo.test.ts.
// The re-link cases also pin the security scan dispatch and moved there
// verbatim; the `(core, no plugin)` twins below keep their core facts here.
jest.mock('@octokit/auth-app', () => ({
  createAppAuth: jest.fn(),
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findWithProject: jest.fn(),
    findForComment: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findByRepoAndNumber: jest.fn(),
    findByTaskId: jest.fn(),
    countTaskLinkedWorkspaces: jest.fn().mockResolvedValue(1),
    findStaleOpenByProject: jest.fn(),
    updateTaskId: jest.fn(),
    updateState: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    upsertPullRequest: jest.fn(),
    findIntegrationByUserAndWorkspace: jest.fn(),
    findIntegrationByLogin: jest.fn(),
  },
}))
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/repositories/member.repository')
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')
jest.mock('@/lib/integrations/github/pr-comment-client')
jest.mock('@/lib/utils/buildTaskUrl', () => ({
  buildTaskUrl: jest.fn().mockReturnValue('https://app.lumo.dev/t/LUM-1'),
}))
jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn(),
}))

import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { linkPullRequest } from '@/lib/services/task-pr-link.service'
import { syncPullRequestStatus } from '@/lib/services/task-pr-sync.service'
import { reconcileStaleProjectPrs } from '@/lib/services/stale-pr-reconcile.service'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock
const createAppAuthMock = createAppAuth as unknown as jest.Mock
const ORIGINAL_FETCH = global.fetch
const ORIGINAL_ENV = process.env
let fetchMock: jest.Mock
let authFn: jest.Mock

const REMOVED_PR = {
  id: 'pr_payroll',
  workspaceId: 'ws_1',
  repo: 'acme/payroll',
  number: 7,
  url: 'https://github.com/acme/payroll/pull/7',
  state: 'open',
  taskId: null,
  task: null,
}

function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map(c => String(c[0]))
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...ORIGINAL_ENV,
    GITHUB_APP_ID: '111',
    GITHUB_APP_PRIVATE_KEY: 'abc',
  }
  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      state: 'closed',
      merged: true,
      merged_at: '2026-09-01T00:00:00Z',
      closed_at: '2026-09-01T00:00:00Z',
      draft: false,
    }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
  authFn = jest.fn().mockResolvedValue({ token: 'ghs_repo' })
  createAppAuthMock.mockReturnValue(authFn)
  // acme/payroll was removed from the confirmed list on re-verify.
  findByWorkspace.mockResolvedValue({
    id: 'gai_1',
    workspaceId: 'ws_1',
    installationId: 42,
    repositories: ['acme/web'],
  })
  ;(taskRepository.findWithProject as jest.Mock).mockResolvedValue({
    id: 'task_1',
    project: { workspaceId: 'ws_1' },
  })
})
afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  process.env = ORIGINAL_ENV
})

describe('LUM-883 a removed repository cannot be re-linked', () => {
  it('re-linking an existing PR row by prId is refused with 403 (core, no plugin)', async () => {
    ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue(REMOVED_PR)
    await expect(
      linkPullRequest('task_1', { prId: 'pr_payroll' })
    ).rejects.toMatchObject({ status: 403, code: 'repo_not_confirmed' })
    expect(pullRequestRepository.updateTaskId).not.toHaveBeenCalled()
  })

  it('re-linking by the URL of a PR row we still hold is refused with 403 (core, no plugin)', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      REMOVED_PR
    )
    await expect(
      linkPullRequest('task_1', { url: REMOVED_PR.url })
    ).rejects.toMatchObject({ status: 403 })
    expect(pullRequestRepository.updateTaskId).not.toHaveBeenCalled()
  })
})

describe('LUM-883 a removed repository is not read in the background', () => {
  it('PR status sync skips the removed repository and still syncs the confirmed one', async () => {
    const updates = await syncPullRequestStatus('ws_1', [
      REMOVED_PR,
      {
        id: 'pr_web',
        number: 3,
        url: 'https://github.com/acme/web/pull/3',
        state: 'open',
      },
    ])

    expect(fetchedUrls()).toEqual([
      'https://api.github.com/repos/acme/web/pulls/3',
    ])
    expect(updates.has('pr_payroll')).toBe(false)
    expect(updates.has('pr_web')).toBe(true)
    expect(pullRequestRepository.updateState).not.toHaveBeenCalledWith(
      'pr_payroll',
      expect.anything()
    )
    // Only ever a token for acme/web.
    for (const call of authFn.mock.calls) {
      expect(call[0].repositoryNames).toEqual(['web'])
    }
  })

  it('stale PR reconcile leaves the removed repository rows alone', async () => {
    ;(
      pullRequestRepository.findStaleOpenByProject as jest.Mock
    ).mockResolvedValue([
      { id: 'pr_payroll', repo: 'acme/payroll', number: 7 },
      { id: 'pr_web', repo: 'acme/web', number: 3 },
    ])

    const corrected = await reconcileStaleProjectPrs('proj_1', 'ws_1', 7)

    expect(corrected).toBe(1)
    expect(fetchedUrls()).toEqual([
      'https://api.github.com/repos/acme/web/pulls/3',
    ])
    expect(pullRequestRepository.updateState).toHaveBeenCalledTimes(1)
    expect(pullRequestRepository.updateState).toHaveBeenCalledWith(
      'pr_web',
      expect.anything()
    )
  })

  it('the comment mirror refuses to push to the removed repository', async () => {
    ;(prCommentSyncJobRepository.findDueByTask as jest.Mock).mockResolvedValue(
      []
    )
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 'task_1',
      body: '<p>edited</p>',
      type: 'USER',
      authorActorId: 'a1',
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'ISSUE',
        externalId: '999',
        outboundActor: 'BOT_APP',
      }
    )
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(
      REMOVED_PR
    )

    await expect(
      prCommentMirrorService.runOutbound('c1', 'UPDATE')
    ).rejects.toMatchObject({ status: 403, code: 'repo_not_confirmed' })
    expect(authFn).not.toHaveBeenCalled()
    expect(prCommentClient.updateIssueComment).not.toHaveBeenCalled()
  })
})
