/**
 * @jest-environment node
 *
 * LUM-741: GET /api/github/app/install starts the App installation. It is a
 * full-page navigation from the settings card, so every outcome must land the
 * owner somewhere usable — a missing GITHUB_APP_SLUG is a deployment problem
 * and comes back as a toast on the card, never as a bare JSON error page.
 */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  getUserWorkspace: jest.fn(),
}))
jest.mock('@/lib/crypto', () => ({
  encrypt: (s: string) => `enc(${s})`,
}))

import { GET } from '@/app/api/github/app/install/route'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

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

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserWorkspace = getUserWorkspace as jest.Mock
const APP_URL = 'https://app.test'

function req(query = 'workspaceUrl=acme') {
  const { NextRequest } = jest.requireActual('next/server')
  return new NextRequest(`${APP_URL}/api/github/app/install?${query}`)
}

describe('GET /api/github/app/install', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = APP_URL
    process.env.GITHUB_APP_SLUG = 'uselumo'
    mockRequireAuth.mockResolvedValue({ userId: 'clerk_1' })
    mockGetUserWorkspace.mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm1' },
      workspace: { slug: 'acme' },
    })
  })

  it('redirects to the App install page carrying an encrypted workspace state', async () => {
    const res = await GET(req())

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin + location.pathname).toBe(
      'https://github.com/apps/uselumo/installations/new'
    )
    const encrypted = /^enc\((.*)\)$/.exec(
      location.searchParams.get('state') ?? ''
    )
    expect(encrypted?.[1]).toBeDefined()
    const state = JSON.parse(encrypted![1]!)
    expect(state).toEqual({
      memberId: 'm1',
      workspaceId: 'w1',
      workspaceUrl: 'acme',
      purpose: 'github-app',
      // LUM-991: issued-at, so the state expires.
      iat: expect.any(Number),
    })
  })

  it('sends the owner back to the card with a toast when GITHUB_APP_SLUG is unset', async () => {
    delete process.env.GITHUB_APP_SLUG

    const res = await GET(req())

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      `${APP_URL}/workspace/acme/settings/integrations?github_app_error=not_configured`
    )
  })

  it('refuses a caller who is not a member of that workspace', async () => {
    mockGetUserWorkspace.mockResolvedValue({
      workspaceId: 'w2',
      member: { id: 'm9' },
      workspace: { slug: 'other' },
    })

    const res = await GET(req())

    expect(res.status).toBe(403)
  })

  it('requires workspaceUrl', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(400)
  })
})
