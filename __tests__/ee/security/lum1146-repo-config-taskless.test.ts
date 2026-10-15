/**
 * @jest-environment node
 *
 * LUM-1146 — `.lumo.yaml` on the PR's BASE commit drives the auto-review
 * filters, end to end through the real webhook handler, the real security
 * plugin listener, the real auto-review service and the real config loader
 * (storage, GitHub file reads and the worker call mocked). The PR's own copy
 * is never read for the decision; an invalid file falls back to the Lumo
 * settings.
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

jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: jest.fn(),
}))

import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { readRepoFile } from '@/lib/integrations/github/contents'
import { clearRepoConfigCache } from '@/ee/security/services/repo-config.service'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { githubService } from '@/lib/services/github.service'

const dispatch = dispatchPrSecurityScan as jest.Mock
const repo = repoReviewSettingRepository as unknown as Record<string, jest.Mock>
const gh = githubService as unknown as Record<string, jest.Mock>

const BASE_SHA = 'b'.repeat(40)
const HEAD_SHA = 'c'.repeat(40)
const read = readRepoFile as jest.Mock

/** `.lumo.yaml` per commit (missing = no file). */
function lumoYaml(byRef: Record<string, string | Error>) {
  read.mockImplementation(async (o: { path: string; ref?: string }) => {
    if (o.path !== '.lumo.yaml') return null
    const v = byRef[o.ref ?? '']
    if (v instanceof Error) throw v
    return v ?? null
  })
}

const IGNORE_WIP = [
  'version: 1',
  'reviews:',
  '  auto_review:',
  '    ignore_title_keywords: [WIP]',
  '',
].join('\n')

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
      head: { ref: 'probe/no-task', sha: HEAD_SHA },
      base: { ref: 'main', sha: BASE_SHA },
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
  clearRepoConfigCache()
  lumoYaml({})
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

describe('LUM-1146 .lumo.yaml drives the task-less auto-review decision', () => {
  it('ignore_title_keywords: [WIP] on the base branch skips a WIP PR', async () => {
    lumoYaml({ [BASE_SHA]: IGNORE_WIP })
    await deliver('opened', { title: 'WIP: probe' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws',
        fullName: 'Acme/App',
        path: '.lumo.yaml',
        ref: BASE_SHA,
      })
    )
    // The same base commit is not read twice (cache per repo + base sha).
    await deliver('synchronize', { title: 'WIP: probe' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
    // Without the keyword the PR is reviewed.
    await deliver('synchronize', { title: 'probe' })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('the file wins over the stored setting', async () => {
    settings({ autoReview: false })
    lumoYaml({
      [BASE_SHA]: 'reviews:\n  auto_review:\n    enabled: true\n',
    })
    await deliver('opened')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("the PR's own copy cannot exempt the PR (only the base commit is read)", async () => {
    lumoYaml({ [HEAD_SHA]: IGNORE_WIP })
    await deliver('opened', { title: 'WIP: probe' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    const refs = read.mock.calls.map(c => (c[0] as { ref?: string }).ref)
    expect(refs).toEqual([BASE_SHA])
  })

  it('an invalid file falls back to the stored settings', async () => {
    settings({ ignoreTitleKeywords: ['draft'] })
    lumoYaml({
      [BASE_SHA]: 'reviews:\n  auto_review:\n    ignore_title_keywords: WIP\n',
    })
    await deliver('opened', { title: 'WIP: probe' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    await deliver('opened', { title: 'draft: probe' })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('an unreadable file falls back to the stored settings and is retried', async () => {
    lumoYaml({ [BASE_SHA]: new Error('GitHub API error 502') })
    await deliver('opened', { title: 'WIP: probe' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    lumoYaml({ [BASE_SHA]: IGNORE_WIP })
    await deliver('synchronize', { title: 'WIP: probe' })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a task-linked PR is scanned whatever the file says', async () => {
    lumoYaml({ [BASE_SHA]: IGNORE_WIP })
    gh.findTaskByIdentifier!.mockResolvedValue(TASK)
    gh.upsertPullRequest!.mockResolvedValue({ id: 'pr-row', taskId: 't1' })
    await deliver('opened', {
      title: 'WIP: probe',
      head: { ref: 'lumo/LUM-1146-x', sha: HEAD_SHA },
    })
    expect(dispatch).toHaveBeenCalledWith('pr-row', 'PR_EVENT')
  })
})
