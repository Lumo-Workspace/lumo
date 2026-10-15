/**
 * @jest-environment node
 *
 * LUM-1143 — the repository's auto-review filters, end to end through the
 * real webhook handler, the real security plugin listener and the real
 * auto-review service (storage and the worker call mocked): an ignored title
 * keyword is not reviewed; a label / edit that newly matches is.
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

function prPayload(
  action: string,
  over: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) {
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
    repository: { full_name: 'Acme/App', default_branch: 'main' },
    ...extra,
  }
}

async function deliver(
  action: string,
  over: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) {
  await handlePullRequest(prPayload(action, over, extra), 'ws', null)
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

const settings = (over: Record<string, unknown>) =>
  repo.findSettings!.mockResolvedValue([
    {
      workspaceId: 'ws',
      autoReview: true,
      reviewDrafts: false,
      baseBranches: [],
      labels: [],
      ignoreTitleKeywords: [],
      ignoreUsernames: [],
      descriptionKeyword: null,
      pathFilters: [],
      ...over,
    },
  ])

describe('task-less PR filters through the webhook', () => {
  it('a title containing WIP is not auto-reviewed when the repo ignores WIP', async () => {
    settings({ ignoreTitleKeywords: ['wip'] })
    await deliver('opened', { title: 'WIP: probe' })
    await deliver('synchronize', { title: 'WIP: probe' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('an ignored author is never auto-reviewed', async () => {
    settings({ ignoreUsernames: ['renovate[bot]'] })
    await deliver('opened', { user: { login: 'renovate[bot]' } })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('removing WIP from the title (edited) reviews the PR', async () => {
    settings({ ignoreTitleKeywords: ['WIP'] })
    await deliver(
      'edited',
      { title: 'probe' },
      { changes: { title: { from: 'WIP probe' } } }
    )
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith('pr-row', 'PR_EVENT')
  })

  it('with review off, a label opt-in (labeled) reviews; other labels do not', async () => {
    settings({ autoReview: false, labels: ['review-me'] })
    await deliver('opened')
    await deliver(
      'labeled',
      { labels: [{ name: 'docs' }] },
      { label: { name: 'docs' } }
    )
    expect(dispatch).not.toHaveBeenCalled()
    await deliver(
      'labeled',
      { labels: [{ name: 'docs' }, { name: 'review-me' }] },
      { label: { name: 'review-me' } }
    )
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a PR into a non-default base outside the list is skipped', async () => {
    settings({ baseBranches: ['release/.*'] })
    await deliver('opened', { base: { ref: 'develop' } })
    expect(dispatch).not.toHaveBeenCalled()
    await deliver('opened', { base: { ref: 'release/1' } })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a labeled event on a task-linked PR does not scan', async () => {
    gh.findTaskByIdentifier!.mockResolvedValue(TASK)
    gh.upsertPullRequest!.mockResolvedValue({ id: 'pr-row', taskId: 't1' })
    await deliver(
      'labeled',
      { head: { ref: 'lumo/LUM-1133-x', sha: 'abc' }, labels: [{ name: 'a' }] },
      { label: { name: 'a' } }
    )
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('empty base-branch list: existing vs newly connected repository', () => {
  it('an existing (backfilled, all_branches) repository still reviews a PR into a non-default base', async () => {
    settings({ emptyBaseBranchesMeans: 'all_branches' })
    await deliver('opened', { base: { ref: 'feature/stacked' } })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a newly connected repository (no stored row) auto-reviews only PRs into the default branch', async () => {
    repo.findSettings!.mockResolvedValue([])
    await deliver('opened', { base: { ref: 'feature/stacked' } })
    expect(dispatch).not.toHaveBeenCalled()
    await deliver('opened', { base: { ref: 'main' } })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
