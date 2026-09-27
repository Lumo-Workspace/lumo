/**
 * @jest-environment node
 *
 * LUM-882 — what starts a verifier access recheck: the daily cron (CRON_SECRET
 * gated, registered in vercel.json) and the App webhook's `repository` event
 * (privatized / transferred).
 */
jest.mock('@/lib/services/github-access-recheck.service', () => {
  const actual = jest.requireActual(
    '@/lib/services/github-access-recheck.service'
  )
  return {
    githubAccessRecheckService: {
      sweep: jest.fn(),
      recheckRepository: jest.fn(),
      applyRepositoryEvent: jest.fn(function (this: unknown, payload: unknown) {
        return actual.githubAccessRecheckService.applyRepositoryEvent.call(
          this,
          payload
        )
      }),
    },
  }
})
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
    resolveWorkspaceForRepository: jest.fn(),
  },
  scrubWorkspaceCode: jest.fn(),
}))
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))
jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: { requestFromPush: jest.fn() },
}))

import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { GET as cronGET } from '@/app/api/cron/recheck-github-access/route'
import { POST as webhookPOST } from '@/app/api/webhooks/github/route'
import { githubAccessRecheckService } from '@/lib/services/github-access-recheck.service'
import { githubService } from '@/lib/services/github.service'
import { verifyGitHubSignature } from '@/lib/integrations/github'

const sweep = githubAccessRecheckService.sweep as jest.Mock
const recheckRepository =
  githubAccessRecheckService.recheckRepository as jest.Mock
const verify = verifyGitHubSignature as jest.Mock

function cronRequest(auth?: string) {
  return new NextRequest('http://localhost/api/cron/recheck-github-access', {
    headers: auth ? { authorization: auth } : {},
  })
}

function webhook(event: string, body: object) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: {
      'x-github-event': event,
      'x-hub-signature-256': 'sha256=deadbeef',
    },
    body: JSON.stringify(body),
  })
}

describe('access recheck triggers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
    verify.mockReturnValue(true)
    sweep.mockResolvedValue({ workspaces: 1, checked: 3, removed: 1 })
    recheckRepository.mockResolvedValue({ removed: 0 })
  })

  it('registers the cron in vercel.json once a day', () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')
    ) as { crons: { path: string; schedule: string }[] }
    const entry = config.crons.find(
      c => c.path === '/api/cron/recheck-github-access'
    )
    expect(entry).toBeDefined()
    // minute hour * * * — one fixed time a day.
    expect(entry?.schedule).toMatch(/^\d+ \d+ \* \* \*$/)
  })

  it('runs the sweep for a cron call carrying CRON_SECRET', async () => {
    const res = await cronGET(cronRequest('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(sweep).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual({ workspaces: 1, checked: 3, removed: 1 })
  })

  it('refuses the cron without the secret and runs nothing', async () => {
    expect((await cronGET(cronRequest())).status).toBe(401)
    expect((await cronGET(cronRequest('Bearer nope'))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await cronGET(cronRequest('Bearer undefined'))).status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('rechecks a privatized repository from the App webhook', async () => {
    const res = await webhookPOST(
      webhook('repository', {
        action: 'privatized',
        installation: { id: 42 },
        repository: { full_name: 'acme/web', name: 'web' },
      })
    )
    expect(res.status).toBe(200)
    expect(verify).toHaveBeenCalledWith(
      expect.any(String),
      'sha256=deadbeef',
      'app-secret'
    )
    // App event: never routed through the OAuth repo-hook lookup.
    expect(githubService.findWebhooksByRepo).not.toHaveBeenCalled()
    expect(recheckRepository).toHaveBeenCalledWith(42, 'acme/web')
  })

  it('rechecks both the new and the old name of a transferred repository', async () => {
    await webhookPOST(
      webhook('repository', {
        action: 'transferred',
        installation: { id: 42 },
        repository: { full_name: 'elsewhere/web', name: 'web' },
        changes: { owner: { from: { organization: { login: 'acme' } } } },
      })
    )
    expect(recheckRepository).toHaveBeenCalledWith(42, 'elsewhere/web')
    expect(recheckRepository).toHaveBeenCalledWith(42, 'acme/web')
  })

  it('ignores other repository actions', async () => {
    await webhookPOST(
      webhook('repository', {
        action: 'edited',
        installation: { id: 42 },
        repository: { full_name: 'acme/web', name: 'web' },
      })
    )
    expect(recheckRepository).not.toHaveBeenCalled()
  })

  it('rejects an unsigned repository event', async () => {
    verify.mockReturnValue(false)
    const res = await webhookPOST(
      webhook('repository', {
        action: 'privatized',
        installation: { id: 42 },
        repository: { full_name: 'acme/web', name: 'web' },
      })
    )
    expect(res.status).toBe(401)
    expect(recheckRepository).not.toHaveBeenCalled()
  })
})
