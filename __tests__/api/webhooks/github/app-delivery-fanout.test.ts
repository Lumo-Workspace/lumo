/**
 * @jest-environment node
 *
 * LUM-924 — several workspaces can share one GitHub App installation (LUM-872)
 * and each confirm the same repository. An App-delivered repository event
 * reaches every one of them, and each is handled against that workspace's own
 * PullRequest row. The real route, install service and handlers run here; only
 * the data layer and outbound side effects are stubbed.
 */
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn(),
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    findWebhooksByRepo: jest.fn(),
    upsertPullRequest: jest.fn(),
    updatePullRequestCiStatus: jest.fn(),
    findTaskByIdentifier: jest.fn(),
    upsertTaskBranch: jest.fn(),
    findWorkspaceSlug: jest.fn(),
  },
}))
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    findAllByInstallationId: jest.fn(),
    findByWorkspace: jest.fn(),
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
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
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
import { githubService } from '@/lib/services/github.service'
import { githubAppInstallationRepository } from '@/lib/repositories'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

const verify = verifyGitHubSignature as jest.Mock
const findWebhooks = githubService.findWebhooksByRepo as jest.Mock
const upsertPr = githubService.upsertPullRequest as jest.Mock
const updateCi = githubService.updatePullRequestCiStatus as jest.Mock
const findRows =
  githubAppInstallationRepository.findAllByInstallationId as jest.Mock
const findPr = pullRequestRepository.findByRepoAndNumber as jest.Mock
const findByBranch = pullRequestRepository.findByHeadBranch as jest.Mock
const runInbound = prCommentMirrorService.runInbound as jest.Mock

const REPO = 'acme-inc/web'

/** Each workspace's own row for PR #7 — what a per-workspace lookup returns. */
const ROWS: Record<
  string,
  { id: string; taskId: string; workspaceId: string }
> = {
  'w-a': { id: 'pr-a', taskId: 'task-a', workspaceId: 'w-a' },
  'w-b': { id: 'pr-b', taskId: 'task-b', workspaceId: 'w-b' },
}

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

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
  // Only the App secret verifies: this is an App delivery.
  verify.mockImplementation((_b, _s, secret) => secret === 'app-secret')
  findWebhooks.mockResolvedValue([])
  findRows.mockResolvedValue([
    { workspaceId: 'w-a', installationId: 555, repositories: [REPO] },
    { workspaceId: 'w-b', installationId: 555, repositories: ['Acme-Inc/Web'] },
  ])
  upsertPr.mockImplementation(async (d: { workspaceId: string }) => ({
    id: `row-${d.workspaceId}`,
  }))
  findPr.mockImplementation(async (ws: string, repo: string, n: number) =>
    repo === REPO && n === 7 ? (ROWS[ws] ?? null) : null
  )
  findByBranch.mockImplementation(async (ws: string) =>
    ROWS[ws] ? { number: 7 } : null
  )
})

describe('LUM-924 App delivery fan-out', () => {
  it('fans an App delivery out to every workspace that confirmed the repository', async () => {
    findRows.mockResolvedValue([
      { workspaceId: 'w-a', installationId: 555, repositories: [REPO] },
      // Shares the installation but never confirmed this repository.
      {
        workspaceId: 'w-x',
        installationId: 555,
        repositories: ['acme-inc/api'],
      },
      {
        workspaceId: 'w-b',
        installationId: 555,
        repositories: ['Acme-Inc/Web'],
      },
      // Confirmed, but its own OAuth repo hook delivers the event separately.
      { workspaceId: 'w-c', installationId: 555, repositories: [REPO] },
    ])
    findWebhooks.mockResolvedValue([
      {
        integration: {
          webhookSecret: 'repo-secret',
          workspaceId: 'w-c',
          id: 'int-c',
        },
      },
    ])
    // The first workspace's write fails — the next one still gets the event.
    upsertPr.mockRejectedValueOnce(new Error('db blip'))

    const res = await POST(
      makeRequest('pull_request', {
        action: 'opened',
        pull_request: {
          number: 7,
          title: 'Add feature',
          html_url: `https://github.com/${REPO}/pull/7`,
          state: 'open',
          merged: false,
          draft: false,
          user: { login: 'octo' },
          head: { ref: 'feature', sha: 'abc' },
          base: { ref: 'main' },
          merged_at: null,
          closed_at: null,
          merge_commit_sha: null,
        },
        repository: { full_name: REPO },
        installation: { id: 555 },
      })
    )

    expect(res.status).toBe(200)
    expect(upsertPr.mock.calls.map(c => c[0].workspaceId)).toEqual([
      'w-a',
      'w-b',
    ])
    // An App delivery has no OAuth integration behind it.
    expect(upsertPr).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w-b',
        integrationId: null,
        number: 7,
      })
    )
  })

  it('drops an App delivery when no workspace confirmed the repository', async () => {
    findRows.mockResolvedValue([
      {
        workspaceId: 'w-x',
        installationId: 555,
        repositories: ['acme-inc/api'],
      },
    ])
    const res = await POST(
      makeRequest('issue_comment', {
        action: 'created',
        issue: { number: 7, pull_request: {} },
        repository: { full_name: REPO },
        installation: { id: 555 },
      })
    )
    expect(res.status).toBe(200)
    expect(findPr).not.toHaveBeenCalled()
    expect(runInbound).not.toHaveBeenCalled()
  })

  it('webhook handlers only touch the delivering workspace pull request row', async () => {
    // A PR comment is mirrored into each workspace's own task, off its own row.
    await POST(
      makeRequest('issue_comment', {
        action: 'created',
        issue: { number: 7, pull_request: {} },
        comment: { id: 1, body: 'lgtm' },
        repository: { full_name: REPO },
        installation: { id: 555 },
      })
    )
    expect(findPr.mock.calls).toEqual([
      ['w-a', REPO, 7],
      ['w-b', REPO, 7],
    ])
    expect(
      runInbound.mock.calls.map(c => ({
        workspaceId: c[0].workspaceId,
        taskId: c[0].taskId,
        pullRequestId: c[0].pullRequestId,
      }))
    ).toEqual([
      { workspaceId: 'w-a', taskId: 'task-a', pullRequestId: 'pr-a' },
      { workspaceId: 'w-b', taskId: 'task-b', pullRequestId: 'pr-b' },
    ])

    // CI status lands on each workspace's own row.
    await POST(
      makeRequest('check_suite', {
        action: 'completed',
        check_suite: {
          head_sha: 'abc',
          head_branch: 'feature',
          conclusion: 'success',
          pull_requests: [{ number: 7 }],
        },
        repository: { full_name: REPO },
        installation: { id: 555 },
      })
    )
    expect(updateCi.mock.calls).toEqual([
      ['w-a', REPO, [7], 'success'],
      ['w-b', REPO, [7], 'success'],
    ])
  })
})
