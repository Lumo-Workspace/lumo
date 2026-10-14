/**
 * @jest-environment node
 *
 * LUM-1133 — every open PR of a repository the workspace confirmed gets the
 * automatic review, not only task-linked ones. Exercised end to end through
 * the real webhook handler, the real security plugin listener and the real
 * auto-review service; only storage and the worker call are mocked.
 */
const pending: Promise<unknown>[] = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    pending.push(p)
    return p
  },
}))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
  shouldScanOnPrEvent: jest.requireActual(
    '@/ee/security/services/pr-security-scan-dispatch'
  ).shouldScanOnPrEvent,
}))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: {
    findConfirmingWorkspaces: jest.fn(),
    findSettings: jest.fn(),
    isLinkedElsewhere: jest.fn(),
  },
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    upsertPullRequest: jest.fn(),
    upsertTaskBranch: jest.fn(),
    findTaskByIdentifier: jest.fn(),
    resolvePullRequestTask: jest.fn(async (task: unknown) => task),
    findWorkspaceSlug: jest.fn().mockResolvedValue('lumo'),
  },
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
jest.mock('@/lib/services/boundary-crossing-rejudge-trigger', () => ({
  enqueueCrossingRejudgeOnPrClose: jest.fn(),
}))
jest.mock('@/lib/services/notification.service', () => ({
  shouldNotifySlackEvent: jest.fn().mockResolvedValue(false),
}))

import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { githubService } from '@/lib/services/github.service'

const dispatch = dispatchPrSecurityScan as jest.Mock
const repo = repoReviewSettingRepository as unknown as Record<string, jest.Mock>
const gh = githubService as unknown as Record<string, jest.Mock>

const TASK = {
  id: 't1',
  number: 1133,
  title: 'x',
  status: 'IN_PROGRESS',
  projectId: 'p1',
  assigneeActorId: null,
  team: { identifier: 'LUM' },
  project: { name: 'Lumo', ownerId: null, workspaceId: 'ws' },
}

function prPayload(action: string, over: Record<string, unknown> = {}) {
  return {
    action,
    pull_request: {
      number: 1451,
      title: 'probe',
      html_url: 'https://github.com/acme/app/pull/1451',
      state: 'open',
      merged: false,
      draft: false,
      user: { login: 'u' },
      head: { ref: 'probe/no-task', sha: 'abc' },
      base: { ref: 'main' },
      merged_at: null,
      closed_at: null,
      merge_commit_sha: null,
      ...over,
    },
    repository: { full_name: 'Acme/App' },
  }
}

async function deliver(action: string, over: Record<string, unknown> = {}) {
  await handlePullRequest(prPayload(action, over), 'ws', null)
  // The listener's work runs under waitUntil; settle it like the runtime.
  while (pending.length > 0) await Promise.all(pending.splice(0))
}

beforeEach(() => {
  jest.clearAllMocks()
  pending.length = 0
  gh.findTaskByIdentifier!.mockResolvedValue(null)
  gh.upsertPullRequest!.mockResolvedValue({ id: 'pr-row', taskId: null })
  repo.findConfirmingWorkspaces!.mockResolvedValue([
    { workspaceId: 'ws', confirmedAt: new Date('2026-01-01') },
  ])
  repo.findSettings!.mockResolvedValue([])
  repo.isLinkedElsewhere!.mockResolvedValue(false)
})

describe('a PR without a task (default settings)', () => {
  it.each(['opened', 'synchronize', 'ready_for_review', 'reopened'])(
    '%s dispatches exactly one scan',
    async action => {
      await deliver(action)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledWith('pr-row', 'PR_EVENT')
      // Looked up case-insensitively.
      expect(repo.findConfirmingWorkspaces).toHaveBeenCalledWith('acme/app')
      expect(repo.findSettings).toHaveBeenCalledWith(['ws'], 'acme/app')
    }
  )

  it('task-only side effects stay task-only', async () => {
    await deliver('opened')
    expect(gh.upsertTaskBranch).not.toHaveBeenCalled()
    expect(gh.findWorkspaceSlug).not.toHaveBeenCalled()
  })

  it('stores the draft flag on ready_for_review / converted_to_draft', async () => {
    await deliver('converted_to_draft', { draft: true })
    expect(gh.upsertPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ isDraft: true, number: 1451 })
    )
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('a draft is not dispatched; marked ready, it is', async () => {
    await deliver('opened', { draft: true })
    await deliver('synchronize', { draft: true })
    expect(dispatch).not.toHaveBeenCalled()
    await deliver('ready_for_review', { draft: false })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a draft is dispatched when the repository opted drafts in', async () => {
    repo.findSettings!.mockResolvedValue([
      { workspaceId: 'ws', autoReview: true, reviewDrafts: true },
    ])
    await deliver('synchronize', { draft: true })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a repository turned off is not dispatched', async () => {
    repo.findSettings!.mockResolvedValue([
      { workspaceId: 'ws', autoReview: false, reviewDrafts: false },
    ])
    await deliver('synchronize')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('a repository the workspace has not confirmed is not dispatched', async () => {
    repo.findConfirmingWorkspaces!.mockResolvedValue([
      { workspaceId: 'other', confirmedAt: new Date('2026-01-01') },
    ])
    await deliver('synchronize')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('a repository another workspace confirmed earlier is reviewed there, not here', async () => {
    repo.findConfirmingWorkspaces!.mockResolvedValue([
      { workspaceId: 'ws', confirmedAt: new Date('2026-03-01') },
      { workspaceId: 'first', confirmedAt: new Date('2026-01-01') },
    ])
    await deliver('synchronize')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('a PR another workspace has linked to its task is reviewed there', async () => {
    repo.findConfirmingWorkspaces!.mockResolvedValue([
      { workspaceId: 'ws', confirmedAt: new Date('2026-01-01') },
      { workspaceId: 'later', confirmedAt: new Date('2026-03-01') },
    ])
    repo.isLinkedElsewhere!.mockResolvedValue(true)
    await deliver('synchronize')
    expect(repo.isLinkedElsewhere).toHaveBeenCalledWith('ws', 'acme/app', 1451)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('closed / edited never dispatch', async () => {
    await deliver('edited')
    await deliver('closed', { state: 'closed' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('a storage failure is logged, never thrown into the webhook', async () => {
    repo.findConfirmingWorkspaces!.mockRejectedValue(new Error('db down'))
    await expect(deliver('synchronize')).resolves.toBeUndefined()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('a task-linked PR (unchanged)', () => {
  beforeEach(() => {
    gh.findTaskByIdentifier!.mockResolvedValue(TASK)
    gh.upsertPullRequest!.mockResolvedValue({ id: 'pr-row', taskId: 't1' })
  })

  it('dispatches on synchronize without consulting the repository settings', async () => {
    repo.findSettings!.mockResolvedValue([
      { workspaceId: 'ws', autoReview: false, reviewDrafts: false },
    ])
    await deliver('synchronize', {
      draft: true,
      head: { ref: 'lumo/LUM-1133-x', sha: 'abc' },
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith('pr-row', 'PR_EVENT')
    expect(repo.findConfirmingWorkspaces).not.toHaveBeenCalled()
    expect(gh.upsertTaskBranch).toHaveBeenCalled()
  })
})
