/**
 * @jest-environment node
 *
 * LUM-741: repository events can now arrive over the App-level webhook as well
 * as the OAuth repo hook. The App delivery carries no per-repo secret and no
 * GitHubWebhook row, so it is verified against GITHUB_APP_WEBHOOK_SECRET and
 * attributed through installation.id — while the repo-hook path keeps
 * precedence and its existing behaviour untouched.
 */
jest.mock('@/lib/services/github.service', () => ({
  githubService: { findWebhooksByRepo: jest.fn() },
}))
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn(),
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: {
    applyInstallationEvent: jest.fn(),
    applyInstallationRepositoriesEvent: jest.fn(),
    resolveWorkspaceByInstallation: jest.fn(),
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
}))

import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { githubService } from '@/lib/services/github.service'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { handlePullRequest } from '@/app/api/webhooks/github/handlers'

const verify = verifyGitHubSignature as jest.Mock
const findWebhooks = githubService.findWebhooksByRepo as jest.Mock
const resolveWorkspace =
  githubAppInstallService.resolveWorkspaceByInstallation as jest.Mock
const prHandler = handlePullRequest as jest.Mock

const prPayload = {
  action: 'opened',
  pull_request: { number: 7 },
  repository: { full_name: 'acme-inc/web' },
  installation: { id: 555 },
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

describe('GitHub webhook — repository events delivered by the App', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
    findWebhooks.mockResolvedValue([])
    resolveWorkspace.mockResolvedValue('w1')
  })

  it('accepts a pull_request the App delivered and attributes it by installation id', async () => {
    // No repo hook matches; only the App secret verifies.
    verify.mockImplementation((_body, _sig, secret) => secret === 'app-secret')

    const res = await POST(makeRequest('pull_request', prPayload))

    expect(res.status).toBe(200)
    expect(resolveWorkspace).toHaveBeenCalledWith(555)
    // integrationId is null: an App delivery has no OAuth integration behind it
    // (PullRequest.integrationId is nullable for exactly this case).
    expect(prHandler).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'opened' }),
      'w1',
      null
    )
  })

  it('keeps repo-hook delivery first when its secret matches', async () => {
    findWebhooks.mockResolvedValue([
      {
        integration: {
          webhookSecret: 'repo-secret',
          workspaceId: 'w-oauth',
          id: 'int1',
        },
      },
    ])
    verify.mockImplementation(
      (_body, _sig, secret) =>
        secret === 'repo-secret' || secret === 'app-secret'
    )

    const res = await POST(makeRequest('pull_request', prPayload))

    expect(res.status).toBe(200)
    expect(prHandler).toHaveBeenCalledWith(expect.anything(), 'w-oauth', 'int1')
    expect(resolveWorkspace).not.toHaveBeenCalled()
  })

  it('drops the App copy when the same repo still has a live repo hook for that workspace', async () => {
    // Both hooks deliver the same event. Processing both races the inbound
    // dedup (read-then-write) and can double-post a mirrored comment.
    findWebhooks.mockResolvedValue([
      {
        integration: {
          webhookSecret: 'repo-secret',
          workspaceId: 'w1',
          id: 'int1',
        },
      },
    ])
    // This request carries the App signature, so the repo secret does not match
    // it — but the repo hook will deliver its own copy separately.
    verify.mockImplementation((_body, _sig, secret) => secret === 'app-secret')

    const res = await POST(makeRequest('pull_request', prPayload))

    expect(res.status).toBe(200)
    expect(prHandler).not.toHaveBeenCalled()
  })

  it('accepts but ignores an App delivery from an installation it cannot place', async () => {
    verify.mockImplementation((_body, _sig, secret) => secret === 'app-secret')
    resolveWorkspace.mockResolvedValue(null)

    const res = await POST(makeRequest('pull_request', prPayload))

    // Authentic delivery, just not ours to route — a 401 would make GitHub retry.
    expect(res.status).toBe(200)
    expect(prHandler).not.toHaveBeenCalled()
  })

  it('rejects a delivery that matches neither a repo secret nor the App secret', async () => {
    verify.mockReturnValue(false)

    const res = await POST(makeRequest('pull_request', prPayload))

    expect(res.status).toBe(401)
    expect(prHandler).not.toHaveBeenCalled()
  })

  it('rejects an unverifiable payload even when it carries no repository', async () => {
    // Previously a repository-less payload short-circuited to 200 before any
    // signature check; now the two deliveries share one authentication gate.
    verify.mockReturnValue(false)

    const res = await POST(makeRequest('pull_request', { action: 'opened' }))

    expect(res.status).toBe(401)
    expect(prHandler).not.toHaveBeenCalled()
  })

  it('accepts a verified App delivery that names no installation (e.g. ping)', async () => {
    verify.mockImplementation((_body, _sig, secret) => secret === 'app-secret')

    const res = await POST(makeRequest('ping', { zen: 'Anything added...' }))

    expect(res.status).toBe(200)
    expect(resolveWorkspace).not.toHaveBeenCalled()
  })
})
