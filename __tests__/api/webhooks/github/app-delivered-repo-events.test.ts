/**
 * @jest-environment node
 *
 * LUM-741: repository events can now arrive over the App-level webhook as well
 * as the OAuth repo hook. The App delivery carries no per-repo secret and no
 * GitHubWebhook row, so it is verified against GITHUB_APP_WEBHOOK_SECRET and
 * attributed through installation.id — while the repo-hook path keeps
 * precedence and its existing behaviour untouched.
 *
 * LUM-881: the installation alone no longer places a delivery — the event's
 * repository must be one the workspace confirmed. The real service runs here;
 * only the installation rows are stubbed.
 */
jest.mock('@/lib/services/github.service', () => ({
  githubService: { findWebhooksByRepo: jest.fn() },
}))
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    findAllByInstallationId: jest.fn(),
    findByWorkspace: jest.fn(),
  },
  prSecurityScanRepository: {},
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
import { githubAppInstallationRepository } from '@/lib/repositories'
import { handlePullRequest } from '@/app/api/webhooks/github/handlers'

const verify = verifyGitHubSignature as jest.Mock
const findWebhooks = githubService.findWebhooksByRepo as jest.Mock
const findRows =
  githubAppInstallationRepository.findAllByInstallationId as jest.Mock
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
    findRows.mockResolvedValue([
      {
        workspaceId: 'w1',
        installationId: 555,
        repositories: ['acme-inc/web'],
      },
    ])
  })

  it('accepts a pull_request the App delivered and attributes it by installation id', async () => {
    // No repo hook matches; only the App secret verifies.
    verify.mockImplementation((_body, _sig, secret) => secret === 'app-secret')

    const res = await POST(makeRequest('pull_request', prPayload))

    expect(res.status).toBe(200)
    expect(findRows).toHaveBeenCalledWith(555)
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

    // LUM-884: the repo hook is only handled for a confirmed repository.
    ;(
      githubAppInstallationRepository.findByWorkspace as jest.Mock
    ).mockResolvedValue({
      workspaceId: 'w-oauth',
      installationId: 777,
      repositories: ['acme-inc/web'],
    })

    const res = await POST(makeRequest('pull_request', prPayload))

    expect(res.status).toBe(200)
    expect(prHandler).toHaveBeenCalledWith(expect.anything(), 'w-oauth', 'int1')
    expect(findRows).not.toHaveBeenCalled()
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
    findRows.mockResolvedValue([])

    const res = await POST(makeRequest('pull_request', prPayload))

    // Authentic delivery, just not ours to route — a 401 would make GitHub retry.
    expect(res.status).toBe(200)
    expect(prHandler).not.toHaveBeenCalled()
  })

  // LUM-881: a repository added to the installation after binding has not
  // been vouched for by anyone who can read it.
  it('drops an App delivery for a repository the workspace has not confirmed', async () => {
    verify.mockImplementation((_body, _sig, secret) => secret === 'app-secret')

    const res = await POST(
      makeRequest('pull_request', {
        ...prPayload,
        repository: { full_name: 'acme-inc/payroll' },
      })
    )

    expect(res.status).toBe(200)
    expect(findRows).toHaveBeenCalledWith(555)
    expect(prHandler).not.toHaveBeenCalled()
  })

  it('routes a shared installation delivery to the workspace that confirmed the repository', async () => {
    verify.mockImplementation((_body, _sig, secret) => secret === 'app-secret')
    findRows.mockResolvedValue([
      {
        workspaceId: 'w1',
        installationId: 555,
        repositories: ['acme-inc/api'],
      },
      {
        workspaceId: 'w2',
        installationId: 555,
        repositories: ['Acme-Inc/Web'],
      },
    ])

    await POST(makeRequest('pull_request', prPayload))

    expect(prHandler).toHaveBeenCalledWith(expect.anything(), 'w2', null)
  })

  it('drops an App delivery that names no repository', async () => {
    verify.mockImplementation((_body, _sig, secret) => secret === 'app-secret')
    // JSON.stringify drops the undefined key.
    const noRepo = { ...prPayload, repository: undefined }

    const res = await POST(makeRequest('pull_request', noRepo))

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
    expect(findRows).not.toHaveBeenCalled()
  })
})
