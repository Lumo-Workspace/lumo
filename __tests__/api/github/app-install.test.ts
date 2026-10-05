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
    process.env.GITHUB_APP_SLUG = 'lumo-agent'
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
      'https://github.com/apps/lumo-agent/installations/new'
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
