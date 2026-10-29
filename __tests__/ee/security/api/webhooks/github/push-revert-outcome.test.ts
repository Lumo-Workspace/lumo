/**
 * @jest-environment node
 *
 * LUM-607 — the `push` webhook feeds the post-hoc outcome well. The load-bearing
 * wiring fact: revert detection must fire on a DEFAULT-BRANCH push even though
 * `main` maps to no task — i.e. it runs BEFORE the handler's `if (!task) return`
 * (reverts land on main, not on a `lumo/LUM-N` branch). This test pins that the
 * recorder is actually invoked on that path, not merely importable.
 *
 * LUM-1064: plugin half of __tests__/api/webhooks/github/push-revert-outcome.test.ts (split)
 */
jest.mock('@/lib/services/outcome/git-outcome-recorder', () => ({
  gitOutcomeRecorder: {
    recordRevertsFromPush: jest
      .fn()
      .mockResolvedValue({ signals: [], inserted: 0, skipped: 0 }),
  },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
// Stub the github integration barrel — its real auth module eager-imports an
// ESM-only octokit package jest can't transform (same workaround the other
// github webhook tests use). `main` is not a task branch, so parseBranchIdentifier
// returns null and findTaskForBranch short-circuits to no task.
jest.mock('@/lib/integrations/github', () => ({
  parseBranchIdentifier: jest.fn(() => null),
  splitIdentifier: jest.fn(() => null),
  verifyGitHubSignature: jest.fn(() => true),
}))
// pr-comment-mirror.service transitively eager-imports the same ESM octokit
// chain; stub it (unused on this path).
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))
jest.mock('@/lib/services/github.service')
jest.mock('@/lib/repositories/pull-request.repository')
// LUM-738 — the baseline service reaches github/contents → auth (octokit ESM).
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: {
    requestFromPush: jest.fn().mockResolvedValue('requested'),
  },
}))

import { handlePush } from '@/app/api/webhooks/github/handlers'
import { securityBaselineService } from '@/ee/security/services/security-baseline.service'

const REVERT = 'aee920c669b44aa3875327574304067e353bf219'

describe('LUM-738 baseline lifecycle — default-branch push', () => {
  beforeEach(() => jest.clearAllMocks())

  it('requests a fresh security baseline for the new default-branch head (detached, before the task lookup)', async () => {
    await handlePush(
      {
        ref: 'refs/heads/main',
        deleted: false,
        head_commit: { id: REVERT, message: 'feat: x', author: { name: 'x' } },
        commits: [{ id: REVERT, message: 'feat: x' }],
        repository: { full_name: 'foo/bar', default_branch: 'main' },
      },
      'w1'
    )
    expect(securityBaselineService.requestFromPush).toHaveBeenCalledWith({
      // LUM-1318: the provider-neutral push event carries its platform.
      provider: 'github',
      workspaceId: 'w1',
      repo: 'foo/bar',
      sha: REVERT,
    })
  })

  it('does not touch the baseline on a feature-branch push, a tag, or a deletion', async () => {
    await handlePush(
      {
        ref: 'refs/heads/lumo/LUM-1-x',
        deleted: false,
        head_commit: { id: REVERT, message: 'feat: x', author: { name: 'x' } },
        repository: { full_name: 'foo/bar', default_branch: 'main' },
      },
      'w1'
    )
    await handlePush(
      {
        ref: 'refs/tags/v1',
        deleted: false,
        head_commit: { id: REVERT, message: 'feat: x', author: { name: 'x' } },
        repository: { full_name: 'foo/bar', default_branch: 'main' },
      },
      'w1'
    )
    await handlePush(
      {
        ref: 'refs/heads/main',
        deleted: true,
        head_commit: null,
        repository: { full_name: 'foo/bar', default_branch: 'main' },
      },
      'w1'
    )
    expect(securityBaselineService.requestFromPush).not.toHaveBeenCalled()
  })

  it('a baseline failure never breaks webhook ingestion', async () => {
    ;(
      securityBaselineService.requestFromPush as jest.Mock
    ).mockRejectedValueOnce(new Error('boom'))
    await expect(
      handlePush(
        {
          ref: 'refs/heads/main',
          deleted: false,
          head_commit: {
            id: REVERT,
            message: 'feat: x',
            author: { name: 'x' },
          },
          repository: { full_name: 'foo/bar', default_branch: 'main' },
        },
        'w1'
      )
    ).resolves.toBeUndefined()
  })
})
