/**
 * @jest-environment node
 *
 * LUM-881: GET /api/github/app/reverify — starts re-checking the workspace's
 * GitHub App installation. It records nothing; it sends a workspace owner to
 * GitHub to authorize the App with a state that tells the callback
 * (app-callback.test.ts) to re-verify rather than install.
 */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  getUserWorkspace: jest.fn(),
}))
jest.mock('@/lib/crypto', () => ({
  encrypt: (s: string) => `enc(${s})`,
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: {
    startReverify: jest.fn(),
    userAuthorizeUrl: jest.fn(),
  },
}))

import { GET } from '@/app/api/github/app/reverify/route'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserWorkspace = getUserWorkspace as jest.Mock
const startReverify = githubAppInstallService.startReverify as jest.Mock
const userAuthorizeUrl = githubAppInstallService.userAuthorizeUrl as jest.Mock

const APP_URL = 'https://app.test'
const SETTINGS = `${APP_URL}/workspace/acme/settings/integrations`

function req(query: string) {
  const { NextRequest } = jest.requireActual('next/server')
  return new NextRequest(`${APP_URL}/api/github/app/reverify?${query}`)
}

describe('GET /api/github/app/reverify', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = APP_URL
    mockRequireAuth.mockResolvedValue({ userId: 'clerk_1' })
    mockGetUserWorkspace.mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm1', role: 'OWNER' },
      workspace: { slug: 'acme' },
    })
    startReverify.mockResolvedValue(42)
    userAuthorizeUrl.mockReturnValue('https://github.com/login/oauth/authorize')
  })

  it('sends an owner to GitHub with a reverify state for the bound installation', async () => {
    const res = await GET(req('workspaceUrl=acme'))

    expect(startReverify).toHaveBeenCalledWith('w1', 'OWNER')
    const [state, redirectUri] = userAuthorizeUrl.mock.calls[0] as [
      string,
      string,
    ]
    expect(JSON.parse(/^enc\((.*)\)$/.exec(state)![1]!)).toEqual({
      workspaceId: 'w1',
      workspaceUrl: 'acme',
      memberId: 'm1',
      installationId: 42,
      mode: 'reverify',
    })
    expect(redirectUri).toBe(`${APP_URL}/api/github/app/callback`)
    expect(res.headers.get('location')).toBe(
      'https://github.com/login/oauth/authorize'
    )
  })

  it('redirects a non-owner back to the card with not_owner', async () => {
    startReverify.mockRejectedValue(
      Object.assign(new Error('owner only'), { status: 403, code: 'not_owner' })
    )

    const res = await GET(req('workspaceUrl=acme'))

    expect(userAuthorizeUrl).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=not_owner`
    )
  })

  it('redirects with reverify_failed when there is nothing to re-verify', async () => {
    startReverify.mockRejectedValue(
      Object.assign(new Error('not installed'), {
        status: 404,
        code: 'not_installed',
      })
    )

    const res = await GET(req('workspaceUrl=acme'))

    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=reverify_failed`
    )
  })

  it('refuses a caller outside the named workspace', async () => {
    const res = await GET(req('workspaceUrl=other'))

    expect(res.status).toBe(403)
    expect(startReverify).not.toHaveBeenCalled()
  })
})
