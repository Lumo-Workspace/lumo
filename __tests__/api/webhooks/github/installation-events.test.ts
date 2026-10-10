/**
 * @jest-environment node
 *
 * LUM-741: `installation` / `installation_repositories` arrive on the App-level
 * webhook, not the repo hook OAuth creates. Their payload carries no
 * `repository.full_name`, so the receiver can neither resolve a workspace that
 * way nor pick a per-repo secret: they are verified against
 * GITHUB_APP_WEBHOOK_SECRET and attributed by `installation.id`.
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
  },
}))
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { githubService } from '@/lib/services/github.service'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'

const verify = verifyGitHubSignature as jest.Mock
const applyInstallation =
  githubAppInstallService.applyInstallationEvent as jest.Mock
const applyRepos =
  githubAppInstallService.applyInstallationRepositoriesEvent as jest.Mock

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

const installationPayload = {
  action: 'created',
  installation: {
    id: 555,
    account: { login: 'acme-inc', type: 'Organization' },
  },
  repositories: [{ full_name: 'acme-inc/web' }],
}

describe('GitHub webhook — App installation events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
    verify.mockReturnValue(true)
  })

  it('verifies an installation event against the App webhook secret, not a repo secret', async () => {
    const res = await POST(makeRequest('installation', installationPayload))

    expect(res.status).toBe(200)
    expect(verify).toHaveBeenCalledWith(
      expect.any(String),
      'sha256=deadbeef',
      'app-secret'
    )
    expect(githubService.findWebhooksByRepo).not.toHaveBeenCalled()
    expect(applyInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        installation: expect.objectContaining({ id: 555 }),
      })
    )
  })

  it('routes installation_repositories to the repository-scope handler', async () => {
    const payload = {
      action: 'added',
      installation: { id: 555 },
      repositories_added: [{ full_name: 'acme-inc/api' }],
      repositories_removed: [],
    }

    const res = await POST(makeRequest('installation_repositories', payload))

    expect(res.status).toBe(200)
    expect(applyRepos).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'added' })
    )
  })

  it('returns 401 and writes nothing when the App signature does not verify', async () => {
    verify.mockReturnValue(false)

    const res = await POST(makeRequest('installation', installationPayload))

    expect(res.status).toBe(401)
    expect(applyInstallation).not.toHaveBeenCalled()
  })

  it('returns 401 when no App webhook secret is configured', async () => {
    delete process.env.GITHUB_APP_WEBHOOK_SECRET

    const res = await POST(makeRequest('installation', installationPayload))

    expect(res.status).toBe(401)
    expect(verify).not.toHaveBeenCalled()
    expect(applyInstallation).not.toHaveBeenCalled()
  })

  it('does not fall through to the repo-hook path when the payload has no repository', async () => {
    await POST(makeRequest('installation', installationPayload))

    expect(githubService.findWebhooksByRepo).not.toHaveBeenCalled()
  })
})
