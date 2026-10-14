/**
 * @jest-environment node
 *
 * LUM-1129 — a workspace whose legacy OAuth repo hook is live on a repository
 * must still get every repo event that hook does NOT subscribe to from the
 * App delivery. The hook's event list (`OAUTH_REPO_HOOK_EVENTS`) never
 * included `issue_comment` or `pull_request_review_comment`, so skipping the
 * App copy for them dropped `@uselumo pause` (PR #1451), thread-reply
 * learnings and the comment mirror for hooked workspaces. Events the hook
 * does deliver keep the App-copy skip (the inbound comment dedup races two
 * copies).
 */
jest.mock('@/lib/services/github.service', () => ({
  githubService: { findWebhooksByRepo: jest.fn() },
}))
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn(),
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: {
    isRepositoryConfirmed: jest.fn().mockResolvedValue(true),
    resolveWorkspacesForRepository: jest.fn().mockResolvedValue(['w1']),
  },
}))
jest.mock('@/app/api/webhooks/github/handlers', () => ({
  handlePullRequest: jest.fn(),
  handlePush: jest.fn(),
  handleCheckSuite: jest.fn(),
  handleStatus: jest.fn(),
  handleIssueComment: jest.fn(),
  handlePullRequestReview: jest.fn(),
  handlePullRequestReviewComment: jest.fn(),
  handlePullRequestReviewThread: jest.fn(),
}))

import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { githubService } from '@/lib/services/github.service'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import { OAUTH_REPO_HOOK_EVENTS } from '@/lib/integrations/github/webhooks'
import {
  handleIssueComment,
  handlePullRequest,
  handlePullRequestReviewComment,
} from '@/app/api/webhooks/github/handlers'

const verify = verifyGitHubSignature as jest.Mock
const findWebhooks = githubService.findWebhooksByRepo as jest.Mock

const payload = {
  action: 'created',
  issue: { number: 9, pull_request: { url: 'x' } },
  pull_request: { number: 9 },
  comment: { id: 555, body: '@uselumo pause' },
  repository: { full_name: 'acme/app' },
  installation: { id: 42 },
}

function makeRequest(event: string) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: { 'x-github-event': event, 'x-hub-signature-256': 'sha256=' },
    body: JSON.stringify(payload),
  })
}

function hookedWorkspace() {
  findWebhooks.mockResolvedValue([
    {
      integration: { webhookSecret: 'repo-secret', workspaceId: 'w1', id: 'i1' },
    },
  ])
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
  // Only the App secret verifies: this request is the App's copy.
  verify.mockImplementation(
    (_b: string, _s: string, secret: string) => secret === 'app-secret'
  )
})

describe('App delivery for a workspace with a legacy OAuth repo hook', () => {
  it('the OAuth hook does not subscribe to the comment events', () => {
    expect(OAUTH_REPO_HOOK_EVENTS).not.toContain('issue_comment')
    expect(OAUTH_REPO_HOOK_EVENTS).not.toContain('pull_request_review_comment')
  })

  it('dispatches an App-delivered issue_comment (e.g. @uselumo pause)', async () => {
    hookedWorkspace()
    const res = await POST(makeRequest('issue_comment'))
    expect(res.status).toBe(200)
    expect(handleIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment: payload.comment }),
      'w1',
      null
    )
  })

  it('dispatches an App-delivered pull_request_review_comment', async () => {
    hookedWorkspace()
    const res = await POST(makeRequest('pull_request_review_comment'))
    expect(res.status).toBe(200)
    expect(handlePullRequestReviewComment).toHaveBeenCalledWith(
      expect.anything(),
      'w1',
      null
    )
  })

  it('still skips the App copy of pull_request, which the hook delivers itself', async () => {
    hookedWorkspace()
    const res = await POST(makeRequest('pull_request'))
    expect(res.status).toBe(200)
    expect(handlePullRequest).not.toHaveBeenCalled()
  })

  it('an unhooked workspace gets every App-delivered event, as before', async () => {
    findWebhooks.mockResolvedValue([])
    await POST(makeRequest('pull_request'))
    await POST(makeRequest('issue_comment'))
    expect(handlePullRequest).toHaveBeenCalledWith(expect.anything(), 'w1', null)
    expect(handleIssueComment).toHaveBeenCalledWith(expect.anything(), 'w1', null)
  })
})
