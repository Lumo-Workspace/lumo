/**
 * @jest-environment node
 *
 * LUM-925 — team identifiers are only unique inside a workspace, so two
 * workspaces that confirmed the same repository (LUM-924 hands each of them the
 * event) can both own a `LUM-123`. A `lumo/LUM-123-x` branch cannot be placed
 * then, and neither task may be linked by branch name — linking the wrong one
 * would scan, notify and mirror its comments onto someone else's PR.
 *
 * The real route, handlers, github service and install service run here; only
 * the data layer and outbound side effects are stubbed.
 */
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn(),
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findWebhooksByRepo: jest.fn(),
    upsertPullRequest: jest.fn(),
    updatePullRequestCiStatus: jest.fn(),
    findTaskByIdentifier: jest.fn(),
    findOtherWorkspaceIdsWithTask: jest.fn(),
    upsertTaskBranch: jest.fn(),
    findWorkspaceSlug: jest.fn(),
  },
}))
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    findAllByInstallationId: jest.fn(),
    findByWorkspace: jest.fn(),
  },
  prSecurityScanRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findByRepoAndNumber: jest.fn().mockResolvedValue(null),
    findByHeadBranch: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))
jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: { requestFromPush: jest.fn() },
}))
jest.mock('@/lib/services/outcome/git-outcome-recorder', () => ({
  gitOutcomeRecorder: {
    recordRevertsFromPush: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn(),
  shouldScanOnPrEvent: jest.fn().mockReturnValue(true),
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
jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn().mockResolvedValue(null),
  getActorClerkId: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
  sendDMNotification: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import { githubRepository } from '@/lib/repositories/github.repository'
import { githubAppInstallationRepository } from '@/lib/repositories'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { sendChannelNotification } from '@/lib/integrations/slack'

const verify = verifyGitHubSignature as jest.Mock
const repo = githubRepository as unknown as Record<string, jest.Mock>
const findRows =
  githubAppInstallationRepository.findAllByInstallationId as jest.Mock
const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock
const dispatchScan = dispatchPrSecurityScan as jest.Mock
const notify = sendChannelNotification as jest.Mock

const REPO = 'acme-inc/web'
const BRANCH = 'lumo/LUM-123-x'

/** Installation rows: w-a and w-b confirmed the repository, w-x did not. */
const INSTALLATIONS = [
  { workspaceId: 'w-a', installationId: 555, repositories: [REPO] },
  { workspaceId: 'w-b', installationId: 555, repositories: ['Acme-Inc/Web'] },
  { workspaceId: 'w-x', installationId: 777, repositories: ['acme-inc/api'] },
]

function makeTask(workspaceId: string) {
  return {
    id: `task-${workspaceId}`,
    number: 123,
    title: `LUM-123 in ${workspaceId}`,
    status: 'IN_PROGRESS',
    projectId: `proj-${workspaceId}`,
    assigneeActorId: null,
    project: { name: 'Web', ownerId: null, workspaceId },
    team: { identifier: 'LUM' },
  }
}

/** Which workspaces own a `LUM-123`. */
let owners: string[] = []

function makeRequest(event: string, body: object) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: {
      'x-github-event': event,
      'x-hub-signature-256': 'sha256=deadbeef',
    },
    body: JSON.stringify(body),
  })
}

function prOpened() {
  return makeRequest('pull_request', {
    action: 'opened',
    pull_request: {
      number: 7,
      title: 'Add feature',
      html_url: `https://github.com/${REPO}/pull/7`,
      state: 'open',
      merged: false,
      draft: false,
      user: { login: 'octo' },
      head: { ref: BRANCH, sha: 'abc' },
      base: { ref: 'main' },
      merged_at: null,
      closed_at: null,
      merge_commit_sha: null,
    },
    repository: { full_name: REPO },
    installation: { id: 555 },
  })
}

function linkedTaskIds() {
  return repo.upsertPullRequest!.mock.calls.map(c => [
    c[0].workspaceId,
    c[0].taskId,
  ])
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
  verify.mockImplementation((_b, _s, secret) => secret === 'app-secret')
  repo.findWebhooksByRepo!.mockResolvedValue([])
  repo.findWorkspaceSlug!.mockResolvedValue({ slug: 'ws' })
  repo.upsertPullRequest!.mockImplementation(
    async (d: { workspaceId: string }) => ({ id: `row-${d.workspaceId}` })
  )
  findRows.mockImplementation(async (id: number) =>
    INSTALLATIONS.filter(r => r.installationId === id)
  )
  findByWorkspace.mockImplementation(
    async (ws: string) => INSTALLATIONS.find(r => r.workspaceId === ws) ?? null
  )
  repo.findTaskByIdentifier!.mockImplementation(
    async (team: string, n: number, ws: string) =>
      team === 'LUM' && n === 123 && owners.includes(ws) ? makeTask(ws) : null
  )
  repo.findOtherWorkspaceIdsWithTask!.mockImplementation(
    async (team: string, n: number, exclude: string) =>
      team === 'LUM' && n === 123 ? owners.filter(w => w !== exclude) : []
  )
})

describe('LUM-925 shared repository branch placement', () => {
  it('LUM-925 ambiguous branch links no workspace task', async () => {
    owners = ['w-a', 'w-b']

    const res = await POST(prOpened())

    expect(res.status).toBe(200)
    // Both workspaces still record the PR, but neither row names a task.
    expect(linkedTaskIds()).toEqual([
      ['w-a', null],
      ['w-b', null],
    ])
    expect(repo.upsertTaskBranch).not.toHaveBeenCalled()
    expect(dispatchScan).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('LUM-925 unique branch match still links its task', async () => {
    // w-x owns a LUM-123 too, but never confirmed this repository — it does
    // not make the branch ambiguous.
    owners = ['w-a', 'w-x']

    await POST(prOpened())

    expect(linkedTaskIds()).toEqual([
      ['w-a', 'task-w-a'],
      ['w-b', null],
    ])
    expect(repo.upsertTaskBranch).toHaveBeenCalledTimes(1)
    expect(repo.upsertTaskBranch).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-w-a', branchName: BRANCH })
    )
    expect(dispatchScan).toHaveBeenCalledWith('row-w-a', 'PR_EVENT')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]![0]).toBe('w-a')
  })

  it('LUM-925 push on an ambiguous branch attributes no task', async () => {
    owners = ['w-a', 'w-b']

    await POST(
      makeRequest('push', {
        ref: `refs/heads/${BRANCH}`,
        deleted: false,
        head_commit: {
          id: 'abc',
          message: 'wip',
          author: { name: 'Octo' },
        },
        commits: [],
        repository: { full_name: REPO, default_branch: 'main' },
        installation: { id: 555 },
      })
    )
    expect(repo.upsertTaskBranch).not.toHaveBeenCalled()
  })
})
