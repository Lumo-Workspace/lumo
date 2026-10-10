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
 *
 * LUM-1064: plugin half of __tests__/lum883-removed-repo.test.ts (split)
 */
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
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
}))
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
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn(),
}))

import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { linkPullRequest } from '@/lib/services/task-pr-link.service'

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
  it('re-linking an existing PR row by prId is refused with 403', async () => {
    ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue(REMOVED_PR)
    await expect(
      linkPullRequest('task_1', { prId: 'pr_payroll' })
    ).rejects.toMatchObject({ status: 403, code: 'repo_not_confirmed' })
    expect(pullRequestRepository.updateTaskId).not.toHaveBeenCalled()
    expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
  })

  it('re-linking by the URL of a PR row we still hold is refused with 403', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      REMOVED_PR
    )
    await expect(
      linkPullRequest('task_1', { url: REMOVED_PR.url })
    ).rejects.toMatchObject({ status: 403 })
    expect(pullRequestRepository.updateTaskId).not.toHaveBeenCalled()
    expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
  })
})
