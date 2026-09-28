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

jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: { requestFromPush: jest.fn() },
}))
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

  it('routes issue_comment to prCommentMirrorService.runInbound when PR is linked to a task', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
      }
    )
    const body = {
      action: 'created',
      issue: { number: 1, pull_request: { url: 'x' } },
      comment: { id: 999 },
      repository: { full_name: 'foo/bar' },
    }
    const res = await POST(makeRequest('issue_comment', body))
    expect(res.status).toBe(200)
    expect(prCommentMirrorService.runInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'issue_comment',
        action: 'created',
        taskId: 't1',
      })
    )
  })

  it('skips issue_comment when payload.issue.pull_request is null (real issue)', async () => {
    const body = {
      action: 'created',
      issue: { number: 1, pull_request: null },
      comment: { id: 999 },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('issue_comment', body))
    expect(prCommentMirrorService.runInbound).not.toHaveBeenCalled()
  })

  it('routes pull_request_review_comment to runInbound', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
      }
    )
    const body = {
      action: 'created',
      pull_request: { number: 1 },
      comment: { id: 1000 },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('pull_request_review_comment', body))
    expect(prCommentMirrorService.runInbound).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pull_request_review_comment' })
    )
  })

  it('routes pull_request_review to runInbound', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
      }
    )
    const body = {
      action: 'submitted',
      pull_request: { number: 1 },
      review: { id: 700, state: 'approved' },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('pull_request_review', body))
    expect(prCommentMirrorService.runInbound).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pull_request_review' })
    )
  })

  it('no-ops when PR has no taskId', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: null,
        workspaceId: 'w1',
      }
    )
    const body = {
      action: 'created',
      issue: { number: 1, pull_request: { url: 'x' } },
      comment: { id: 999 },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('issue_comment', body))
    expect(prCommentMirrorService.runInbound).not.toHaveBeenCalled()
  })
})
