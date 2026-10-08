/** @jest-environment node */
/**
 * LUM-1025 — with only DATABASE_URL + Clerk set, every optional-integration
 * entry route answers 404 `integration_not_configured` (never a 500) and
 * touches neither auth nor the database.
 */
const mockRequireAuth = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  getUserWorkspace: jest.fn(),
  requireWorkspaceMember: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({ requireWorkspaceByUrl: jest.fn() }))
jest.mock('@/lib/services/sentry.service', () => ({ sentryService: {} }))
jest.mock('@/lib/services/slack.service', () => ({ slackService: {} }))
jest.mock('@/lib/services/github.service', () => ({ githubService: {} }))
jest.mock('@/lib/services/figma-integration.service', () => ({
  encodeOauthState: jest.fn(),
  figmaIntegrationService: {},
}))
jest.mock('@/lib/services/google-drive-integration.service', () => ({
  encodeOauthState: jest.fn(),
  googleDriveIntegrationService: {},
}))
jest.mock('@/lib/repositories/slack.repository', () => ({
  slackRepository: { findIntegrationByTeamId: jest.fn() },
}))
jest.mock('@/lib/integrations/slack', () => ({ handleCommand: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'

const OPTIONAL_ENV = [
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
]
const SAVED = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  for (const k of OPTIONAL_ENV) delete process.env[k]
})
afterAll(() => {
  process.env = SAVED
})

const req = (path: string, init?: { method?: string; body?: string }) =>
  new NextRequest(`http://localhost:3000${path}?workspaceUrl=acme`, init)

describe('requireIntegrationConfigured', () => {
  it('is null when the integration is configured', () => {
    expect(
      requireIntegrationConfigured('sentry', { ENCRYPTION_KEY: 'k' })
    ).toBeNull()
  })

  it('is a 404 naming the integration when it is not', async () => {
    const res = requireIntegrationConfigured('slack', {})
    expect(res?.status).toBe(404)
    await expect(res?.json()).resolves.toMatchObject({
      error: 'integration_not_configured',
      integration: 'slack',
    })
  })
})

type Handler = (r: NextRequest) => Promise<Response>

const ROUTES: Array<[string, string, () => Promise<Handler>, string?]> = [
  [
    'GET /api/github/oauth',
    'githubAccount',
    async () => (await import('@/app/api/github/oauth/route')).GET,
  ],
  [
    'GET /api/github/callback',
    'githubAccount',
    async () => (await import('@/app/api/github/callback/route')).GET,
  ],
  [
    'GET /api/slack/oauth',
    'slack',
    async () => (await import('@/app/api/slack/oauth/route')).GET,
  ],
  [
    'GET /api/slack/callback',
    'slack',
    async () => (await import('@/app/api/slack/callback/route')).GET,
  ],
  [
    'POST /api/webhooks/slack',
    'slack',
    async () => (await import('@/app/api/webhooks/slack/route')).POST,
    'POST',
  ],
  [
    'GET /api/figma/oauth',
    'figma',
    async () => (await import('@/app/api/figma/oauth/route')).GET,
  ],
  [
    'GET /api/figma/callback',
    'figma',
    async () => (await import('@/app/api/figma/callback/route')).GET,
  ],
  [
    'GET /api/google-drive/oauth',
    'googleDrive',
    async () => (await import('@/app/api/google-drive/oauth/route')).GET,
  ],
  [
    'GET /api/google-drive/callback',
    'googleDrive',
    async () => (await import('@/app/api/google-drive/callback/route')).GET,
  ],
  [
    'POST /api/sentry/integration',
    'sentry',
    async () => (await import('@/app/api/sentry/integration/route')).POST,
    'POST',
  ],
]

describe.each(ROUTES)('%s when not configured', (name, id, load, method) => {
  it('answers 404 integration_not_configured before auth', async () => {
    const handler = await load()
    const path = name.split(' ')[1]!
    const res = await handler(
      req(path, method === 'POST' ? { method, body: '{}' } : undefined)
    )
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: 'integration_not_configured',
      integration: id,
    })
    expect(mockRequireAuth).not.toHaveBeenCalled()
  })
})

describe('GET /api/github/app/install when the App is not configured', () => {
  it('sends the owner back to the card with a not_configured toast, not a 500', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1' })
    const { getUserWorkspace } = jest.requireMock('@/lib/auth') as {
      getUserWorkspace: jest.Mock
    }
    getUserWorkspace.mockResolvedValue({
      workspace: { slug: 'acme' },
      workspaceId: 'w1',
      member: { id: 'm1' },
    })
    // A slug alone is not a configured App (LUM-1025).
    process.env.GITHUB_APP_SLUG = 'uselumo'
    const { GET } = await import('@/app/api/github/app/install/route')
    const res = await GET(req('/api/github/app/install'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain(
      'github_app_error=not_configured'
    )
  })
})
