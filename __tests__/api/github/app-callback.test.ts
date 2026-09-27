/**
 * @jest-environment node
 *
 * LUM-875: GET /api/github/app/callback — the second leg of the GitHub App
 * install. GitHub returns here after the caller authorized the App; the
 * installation id from the signed state is recorded only when the service
 * confirms (via the caller's App user token) that they can access it.
 */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  getUserWorkspace: jest.fn(),
}))
jest.mock('@/lib/crypto', () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => {
    const m = /^enc\((.*)\)$/.exec(s)
    if (!m) throw new Error('Malformed encrypted value')
    return m[1]
  },
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: { install: jest.fn() },
}))

import { GET } from '@/app/api/github/app/callback/route'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserWorkspace = getUserWorkspace as jest.Mock
const install = githubAppInstallService.install as jest.Mock

const APP_URL = 'https://app.test'
const SETTINGS = `${APP_URL}/workspace/acme/settings/integrations`

function state(
  workspaceId: string,
  installationId: unknown = 42,
  workspaceUrl = 'acme'
) {
  return encodeURIComponent(
    `enc(${JSON.stringify({ workspaceId, workspaceUrl, memberId: 'm1', installationId })})`
  )
}

function req(query: string) {
  const { NextRequest } = jest.requireActual('next/server')
  return new NextRequest(`${APP_URL}/api/github/app/callback?${query}`)
}

describe('GET /api/github/app/callback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = APP_URL
    mockRequireAuth.mockResolvedValue({ userId: 'clerk_1' })
    mockGetUserWorkspace.mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm1' },
      workspace: { slug: 'acme' },
    })
    install.mockResolvedValue({ installationId: 42 })
  })

  it('records an installation the caller can access on GitHub', async () => {
    const res = await GET(req(`code=abc&state=${state('w1')}`))

    expect(install).toHaveBeenCalledWith({
      workspaceId: 'w1',
      memberId: 'm1',
      installationId: 42,
      userCode: 'abc',
      redirectUri: `${APP_URL}/api/github/app/callback`,
    })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`${SETTINGS}?github_app=installed`)
  })

  it('redirects with not_authorized when GitHub does not list the installation for the caller', async () => {
    install.mockRejectedValue(
      Object.assign(new Error('cannot access'), {
        status: 403,
        code: 'not_authorized',
      })
    )

    const res = await GET(req(`code=abc&state=${state('w1', 999)}`))

    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=not_authorized`
    )
  })

  it('redirects with verify_not_configured when the App client credentials are missing', async () => {
    install.mockRejectedValue(
      Object.assign(new Error('missing'), {
        status: 503,
        code: 'verify_not_configured',
      })
    )

    const res = await GET(req(`code=abc&state=${state('w1')}`))

    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=verify_not_configured`
    )
  })

  it('surfaces any other failure as install_failed, never a silent success', async () => {
    install.mockRejectedValue(new Error('GitHub 502'))

    const res = await GET(req(`code=abc&state=${state('w1')}`))

    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=install_failed`
    )
  })

  it('records nothing when the caller declined to authorize the App', async () => {
    const res = await GET(req(`error=access_denied&state=${state('w1')}`))

    expect(install).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=not_authorized`
    )
  })

  it('builds the redirect from the member workspace slug, not from the state', async () => {
    const res = await GET(
      req(`code=abc&state=${state('w1', 42, 'evil.example.com%2F..')}`)
    )

    expect(res.headers.get('location')).toBe(`${SETTINGS}?github_app=installed`)
  })

  it('refuses a caller who is not a member of the state workspace', async () => {
    const res = await GET(req(`code=abc&state=${state('other-ws')}`))

    expect(res.status).toBe(403)
    expect(install).not.toHaveBeenCalled()
  })

  it('refuses a tampered state or one without a valid installation id', async () => {
    const tampered = await GET(req('code=abc&state=not-encrypted'))
    expect(tampered.status).toBe(400)

    const noId = await GET(req(`code=abc&state=${state('w1', 'abc')}`))
    expect(noId.status).toBe(400)

    expect(install).not.toHaveBeenCalled()
  })

  it('propagates the auth failure response when the caller is signed out', async () => {
    const { NextResponse } = jest.requireActual('next/server')
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await GET(req(`code=abc&state=${state('w1')}`))

    expect(res.status).toBe(401)
    expect(install).not.toHaveBeenCalled()
  })
})
