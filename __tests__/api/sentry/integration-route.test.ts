/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => ({ userId: 'user1' })),
  requireWorkspaceMember: jest.fn(async () => ({
    id: 'mem1',
    role: 'OWNER',
  })),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireWorkspaceByUrl: jest.fn(async () => ({ workspaceId: 'ws1' })),
}))
jest.mock('@/lib/services/sentry.service', () => ({
  sentryService: {
    getIntegrationStatus: jest.fn(),
    connectIntegration: jest.fn(),
    disconnectIntegration: jest.fn(),
  },
}))

import { GET, POST, DELETE } from '@/app/api/sentry/integration/route'
import { sentryService } from '@/lib/services/sentry.service'

// LUM-1025: these routes 404 unless their integration is configured on the
// deployment — give every optional integration placeholder env (unset only).
for (const name of [
  'ENCRYPTION_KEY',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_WEBHOOK_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'FIGMA_OAUTH_CLIENT_ID',
  'FIGMA_OAUTH_CLIENT_SECRET',
  'FIGMA_OAUTH_REDIRECT_URI',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_DRIVE_OAUTH_REDIRECT_URI',
]) {
  if (!process.env[name])
    process.env[name] =
      name === 'ENCRYPTION_KEY' ? '0'.repeat(64) : 'placeholder'
}

function req(url: string, body?: unknown, method = 'GET'): NextRequest {
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  return new NextRequest(url, { method })
}

describe('GET /api/sentry/integration', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns status from service', async () => {
    ;(sentryService.getIntegrationStatus as jest.Mock).mockResolvedValue({
      connected: true,
      orgSlug: 'acme',
    })
    const res = await GET(
      req('http://x/api/sentry/integration?workspaceUrl=acme')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ connected: true, orgSlug: 'acme' })
  })
})

describe('POST /api/sentry/integration', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects invalid payload with 400', async () => {
    const res = await POST(
      req(
        'http://x/api/sentry/integration?workspaceUrl=acme',
        { orgSlug: 'INVALID_UPPER', clientSecret: 'short' },
        'POST'
      )
    )
    expect(res.status).toBe(400)
  })

  it('calls connectIntegration on valid payload', async () => {
    ;(sentryService.connectIntegration as jest.Mock).mockResolvedValue({
      id: 'int1',
    })
    const res = await POST(
      req(
        'http://x/api/sentry/integration?workspaceUrl=acme',
        { orgSlug: 'acme-inc', clientSecret: 'secret-value-long' },
        'POST'
      )
    )
    expect(res.status).toBe(200)
    expect(sentryService.connectIntegration).toHaveBeenCalled()
  })

  it('returns 403 when service throws 403', async () => {
    ;(sentryService.connectIntegration as jest.Mock).mockRejectedValue(
      Object.assign(new Error('owner only'), { status: 403 })
    )
    const res = await POST(
      req(
        'http://x/api/sentry/integration?workspaceUrl=acme',
        { orgSlug: 'acme', clientSecret: 'secret-value-long' },
        'POST'
      )
    )
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/sentry/integration', () => {
  beforeEach(() => jest.clearAllMocks())

  it('calls disconnect and returns 200', async () => {
    const res = await DELETE(
      req(
        'http://x/api/sentry/integration?workspaceUrl=acme',
        undefined,
        'DELETE'
      )
    )
    expect(res.status).toBe(200)
    expect(sentryService.disconnectIntegration).toHaveBeenCalledWith(
      'ws1',
      'OWNER',
      expect.objectContaining({
        actor: expect.objectContaining({ clerkId: 'user1', memberId: 'mem1' }),
        source: 'WEB',
      })
    )
  })
})
