/** @jest-environment node */
/**
 * LUM-634 — PR webhook sync writes the payload's change-volume fields
 * (additions / deletions / changed_files) into the PullRequest columns on
 * both create-shaped (opened) and update-shaped (synchronize/closed) events,
 * and keeps them null (never a fabricated 0) when the payload lacks them.
 */
import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { githubService } from '@/lib/services/github.service'

jest.mock('@vercel/functions', () => ({ waitUntil: (p: unknown) => p }))
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
    upsertPullRequest: jest.fn().mockResolvedValue({ id: 'pr', taskId: null }),
    upsertTaskBranch: jest.fn(),
    findTaskByIdentifier: jest.fn().mockResolvedValue(null),
    findTaskById: jest.fn().mockResolvedValue(null),
    findWorkspaceSlug: jest.fn(),
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
jest.mock('@/lib/services/outcome/git-outcome-recorder', () => ({
  gitOutcomeRecorder: { onPush: jest.fn() },
}))
jest.mock('@/lib/services/ci-signal.service', () => ({
  ciSignalService: { reconcileCommit: jest.fn() },
}))

const upsertPullRequest = githubService.upsertPullRequest as jest.Mock

const basePr = {
  number: 42,
  title: 'feat: x',
  html_url: 'https://github.com/a/b/pull/42',
  state: 'open',
  merged: false,
  draft: false,
  user: { login: 'octocat' },
  head: { ref: 'feature/no-task' },
  base: { ref: 'main' },
  merged_at: null,
  closed_at: null,
  merge_commit_sha: null,
}

const payload = (over: Record<string, unknown> = {}) => ({
  action: 'opened',
  pull_request: { ...basePr, ...over },
  repository: { full_name: 'a/b' },
})

beforeEach(() => jest.clearAllMocks())

describe('pr webhook change-volume sync (LUM-634)', () => {
  it('pr sync stores change volume columns', async () => {
    // Create-shaped event (opened) — payload carries the three fields,
    // including a legitimate 0 that must be stored as 0, not dropped.
    await handlePullRequest(
      payload({ additions: 120, deletions: 0, changed_files: 5 }),
      'ws1',
      'int1'
    )
    expect(upsertPullRequest).toHaveBeenCalledTimes(1)
    expect(upsertPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'a/b',
        number: 42,
        additions: 120,
        deletions: 0,
        changedFiles: 5,
      })
    )

    // Update-shaped event (synchronize) — same write path on updates.
    await handlePullRequest(
      {
        ...payload({ additions: 7, deletions: 3, changed_files: 2 }),
        action: 'synchronize',
      },
      'ws1',
      'int1'
    )
    expect(upsertPullRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ additions: 7, deletions: 3, changedFiles: 2 })
    )

    // Merge-close event still carries the fields through.
    await handlePullRequest(
      {
        ...payload({
          additions: 9,
          deletions: 1,
          changed_files: 1,
          state: 'closed',
          merged: true,
          merged_at: '2026-07-01T00:00:00Z',
          merge_commit_sha: 'abc',
        }),
        action: 'closed',
      },
      'ws1',
      'int1'
    )
    expect(upsertPullRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'merged',
        additions: 9,
        deletions: 1,
        changedFiles: 1,
      })
    )
  })

  it('keeps change volume null when the payload lacks the fields — never 0', async () => {
    await handlePullRequest(payload(), 'ws1', 'int1')
    expect(upsertPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        additions: null,
        deletions: null,
        changedFiles: null,
      })
    )
    // Explicitly NOT coerced to 0 anywhere in the call.
    const arg = upsertPullRequest.mock.calls[0]![0]
    expect(arg.additions).not.toBe(0)
    expect(arg.deletions).not.toBe(0)
    expect(arg.changedFiles).not.toBe(0)
  })
})
