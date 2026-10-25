/**
 * @jest-environment node
 */

jest.mock('@/lib/services/github.service')
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn().mockReturnValue(true),
}))
jest.mock('@/lib/repositories/pull-request.repository')
// LUM-884: the OAuth repo hook is only handled for a confirmed repository.
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: {
    isRepositoryConfirmed: jest.fn().mockResolvedValue(true),
  },
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: {
    runInbound: jest.fn().mockResolvedValue(undefined),
  },
}))

// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

function makeRequest(event: string, body: object) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: { 'x-github-event': event, 'x-hub-signature-256': 'sha256=' },
    body: JSON.stringify(body),
  })
}

describe('GitHub webhook — comment events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(githubService.findWebhooksByRepo as jest.Mock).mockResolvedValue([
      {
        integration: {
          webhookSecret: 'secret',
          workspaceId: 'w1',
          id: 'int1',
        },
      },
    ])
  })

  const taskLinkedPr = { id: 'pr1', taskId: 't1', workspaceId: 'w1' }

  // LUM-1313: the PR ↔ task comment mirror is turned off — a comment on a
  // task-linked PR no longer becomes a task comment.
  it.each([
    [
      'issue_comment',
      {
        action: 'created',
        issue: { number: 1, pull_request: { url: 'x' } },
        comment: { id: 999 },
      },
    ],
    [
      'pull_request_review_comment',
      { action: 'created', pull_request: { number: 1 }, comment: { id: 1000 } },
    ],
    [
      'pull_request_review',
      {
        action: 'submitted',
        pull_request: { number: 1 },
        review: { id: 700, state: 'approved' },
      },
    ],
  ])('does not mirror %s on a task-linked PR', async (event, fields) => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      taskLinkedPr
    )
    const res = await POST(
      makeRequest(event, { ...fields, repository: { full_name: 'foo/bar' } })
    )
    expect(res.status).toBe(200)
    expect(prCommentMirrorService.runInbound).not.toHaveBeenCalled()
  })

  it('skips issue_comment when payload.issue.pull_request is null (real issue)', async () => {
    const body = {
      action: 'created',
      issue: { number: 1, pull_request: null },
      comment: { id: 999 },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('issue_comment', body))
    expect(pullRequestRepository.findByRepoAndNumber).not.toHaveBeenCalled()
  })
})
