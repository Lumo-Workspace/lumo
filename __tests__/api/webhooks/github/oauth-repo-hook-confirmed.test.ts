/**
 * @jest-environment node
 *
 * LUM-884: the legacy OAuth repo hook is bounded by the same confirmed
 * repository list (`GitHubAppInstallation.repositories`) as the App webhook.
 * A delivery that verifies against the integration's own secret is still only
 * handled for a repository the workspace confirmed; a workspace without the
 * App has no list, so its OAuth deliveries are dropped too. Dropped deliveries
 * answer 200 so GitHub does not retry them. The real service runs here; only
 * the installation row is stubbed.
 */
jest.mock('@/lib/services/github.service', () => ({
  githubService: { findWebhooksByRepo: jest.fn() },
}))
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    findByWorkspace: jest.fn(),
    findAllByInstallationId: jest.fn(),
  },
  prSecurityScanRepository: {},
}))
jest.mock('@/app/api/webhooks/github/handlers', () => ({
  handlePullRequest: jest.fn(),
  handlePush: jest.fn(),
  handleCheckSuite: jest.fn(),
  handleStatus: jest.fn(),
  handleIssueComment: jest.fn(),
  handlePullRequestReviewComment: jest.fn(),
}))

import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { githubService } from '@/lib/services/github.service'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  handlePullRequest,
  handleIssueComment,
} from '@/app/api/webhooks/github/handlers'

const verify = verifyGitHubSignature as jest.Mock
const findWebhooks = githubService.findWebhooksByRepo as jest.Mock
const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock
const prHandler = handlePullRequest as jest.Mock
const commentHandler = handleIssueComment as jest.Mock

const prPayload = {
  action: 'opened',
  pull_request: { number: 7 },
  repository: { full_name: 'acme-inc/web' },
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

describe('GitHub webhook — OAuth repo hook bounded by the confirmed list', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
    findWebhooks.mockResolvedValue([
      {
        integration: {
          webhookSecret: 'repo-secret',
          workspaceId: 'w1',
          id: 'int1',
        },
      },
    ])
    // Only the OAuth integration's own secret verifies this request.
    verify.mockImplementation((_body, _sig, secret) => secret === 'repo-secret')
  })

  it('handles an OAuth delivery for a confirmed repository', async () => {
    findByWorkspace.mockResolvedValue({
      workspaceId: 'w1',
      installationId: 555,
      repositories: ['Acme-Inc/Web'],
    })

    const res = await POST(makeRequest('pull_request', prPayload))

    expect(res.status).toBe(200)
    expect(findByWorkspace).toHaveBeenCalledWith('w1')
    expect(prHandler).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'opened' }),
      'w1',
      'int1'
    )
  })

  it('drops an OAuth delivery for a repository the workspace has not confirmed', async () => {
    findByWorkspace.mockResolvedValue({
      workspaceId: 'w1',
      installationId: 555,
      repositories: ['acme-inc/api'],
    })

    const res = await POST(makeRequest('pull_request', prPayload))
    const comment = await POST(
      makeRequest('issue_comment', {
        action: 'created',
        issue: { number: 7, pull_request: {} },
        comment: { id: 1, body: 'hi' },
        repository: { full_name: 'acme-inc/web' },
      })
    )

    // Authentic, so 200 (not 401) — but nothing reaches a handler.
    expect(res.status).toBe(200)
    expect(comment.status).toBe(200)
    expect(prHandler).not.toHaveBeenCalled()
    expect(commentHandler).not.toHaveBeenCalled()
  })

  it('drops an OAuth delivery when the workspace has no App installation', async () => {
    findByWorkspace.mockResolvedValue(null)

    const res = await POST(makeRequest('pull_request', prPayload))

    expect(res.status).toBe(200)
    expect(prHandler).not.toHaveBeenCalled()
  })
})
