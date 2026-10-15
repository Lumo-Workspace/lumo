/**
 * @jest-environment node
 *
 * LUM-1131 — `pull_request_review_comment` reaches the plugins as
 * `github.reviewComment` for any PR row Lumo holds (task-linked or not);
 * the task-linked mirror keeps running as before.
 */
jest.mock('@/lib/services/github.service')
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn(),
}))
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: {
    isRepositoryConfirmed: jest.fn().mockResolvedValue(true),
    resolveWorkspacesForRepository: jest.fn().mockResolvedValue(['w1']),
  },
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))
jest.mock('@/lib/plugins/events', () => ({ emitCoreEvent: jest.fn() }))
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { githubService } from '@/lib/services/github.service'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { emitCoreEvent } from '@/lib/plugins/events'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

const verify = verifyGitHubSignature as jest.Mock
const emit = emitCoreEvent as jest.Mock

function makeRequest(event: string, body: object) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: { 'x-github-event': event, 'x-hub-signature-256': 'sha256=' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
  ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue({
    id: 'pr1',
    taskId: null,
    workspaceId: 'w1',
  })
  ;(githubService.findWebhooksByRepo as jest.Mock).mockResolvedValue([
    {
      integration: {
        webhookSecret: 'repo-secret',
        workspaceId: 'w1',
        id: 'i1',
      },
    },
  ])
})

const payload = {
  action: 'created',
  pull_request: { number: 9 },
  repository: { full_name: 'acme/app' },
  installation: { id: 42 },
  comment: {
    id: 555,
    body: 'This is intentional because the script only runs locally.',
    in_reply_to_id: 101,
    user: { login: 'alice', type: 'User' },
    author_association: 'COLLABORATOR',
    // LUM-1154: where a question on a code line points.
    path: 'scripts/run.ts',
    original_line: 12,
    line: null,
    diff_hunk: '@@ -1,3 +1,4 @@',
  },
}

beforeEach(() => {
  verify.mockReturnValue(true)
  ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue({
    id: 'pr1',
    taskId: null,
    workspaceId: 'w1',
    repo: 'acme/app',
    number: 9,
  })
})

describe('pull_request_review_comment', () => {
  it('emits github.reviewComment for a PR with no task, and does not mirror it', async () => {
    const res = await POST(makeRequest('pull_request_review_comment', payload))
    expect(res.status).toBe(200)
    expect(emit).toHaveBeenCalledWith('github.reviewComment', {
      workspaceId: 'w1',
      pullRequestId: 'pr1',
      taskId: null,
      repo: 'acme/app',
      prNumber: 9,
      action: 'created',
      comment: {
        id: 555,
        body: 'This is intentional because the script only runs locally.',
        inReplyToId: 101,
        user: { login: 'alice', type: 'User' },
        authorAssociation: 'COLLABORATOR',
        path: 'scripts/run.ts',
        line: 12,
        diffHunk: '@@ -1,3 +1,4 @@',
      },
    })
    expect(prCommentMirrorService.runInbound).not.toHaveBeenCalled()
  })

  it('a task-linked PR is emitted and mirrored as before', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
        repo: 'acme/app',
        number: 9,
      }
    )
    await POST(makeRequest('pull_request_review_comment', payload))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(prCommentMirrorService.runInbound).toHaveBeenCalledTimes(1)
  })

  it('a top-level comment carries inReplyToId null; a malformed one is not emitted', async () => {
    await POST(
      makeRequest('pull_request_review_comment', {
        ...payload,
        comment: {
          ...payload.comment,
          in_reply_to_id: undefined,
          author_association: undefined,
        },
      })
    )
    expect(emit.mock.calls[0][1].comment).toMatchObject({
      inReplyToId: null,
      authorAssociation: null,
    })
    emit.mockClear()
    await POST(
      makeRequest('pull_request_review_comment', {
        ...payload,
        comment: { body: 'x' },
      })
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('an unknown PR emits nothing', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      null
    )
    await POST(makeRequest('pull_request_review_comment', payload))
    expect(emit).not.toHaveBeenCalled()
  })
})
