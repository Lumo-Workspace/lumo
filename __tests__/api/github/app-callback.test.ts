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
  githubAppInstallService: { install: jest.fn(), reverify: jest.fn() },
}))

import { GET } from '@/app/api/github/app/callback/route'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserWorkspace = getUserWorkspace as jest.Mock
const install = githubAppInstallService.install as jest.Mock
const reverify = githubAppInstallService.reverify as jest.Mock

const APP_URL = 'https://app.test'
const SETTINGS = `${APP_URL}/workspace/acme/settings/integrations`

function state(
  workspaceId: string,
  installationId: unknown = 42,
  workspaceUrl = 'acme'
) {
  return encodeURIComponent(
    `enc(${JSON.stringify({ workspaceId, workspaceUrl, memberId: 'm1', installationId, iat: Date.now() })})`
  )
}

function reverifyState(workspaceId = 'w1') {
  return encodeURIComponent(
    `enc(${JSON.stringify({ workspaceId, workspaceUrl: 'acme', memberId: 'm1', installationId: 42, mode: 'reverify', iat: Date.now() })})`
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
      member: { id: 'm1', role: 'OWNER' },
      workspace: { slug: 'acme' },
    })
    install.mockResolvedValue({ installationId: 42 })
    reverify.mockResolvedValue({ confirmed: 1, added: [], removed: [] })
  })

  it('records an installation the caller can access on GitHub', async () => {
    const res = await GET(req(`code=abc&state=${state('w1')}`))

    expect(install).toHaveBeenCalledWith({
      workspaceId: 'w1',
      memberId: 'm1',
      installationId: 42,
      userCode: 'abc',
      redirectUri: `${APP_URL}/api/github/app/callback`,
      // LUM-907: the signed-in member, from a browser session.
      audit: expect.objectContaining({
        actor: { type: 'MEMBER', clerkId: 'clerk_1', memberId: 'm1' },
        source: 'WEB',
      }),
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

  // LUM-880
  it('redirects a caller without access to every repository with repo_access_incomplete', async () => {
    install.mockRejectedValue(
      Object.assign(new Error('cannot read 1 of 2 repositories'), {
        status: 403,
        code: 'repo_access_incomplete',
      })
    )

    const res = await GET(req(`code=abc&state=${state('w1')}`))

    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=repo_access_incomplete`
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

  // LUM-881: the same authorization re-checks an existing installation.
  it('re-verifies instead of installing when the state says so', async () => {
    const res = await GET(req(`code=abc&state=${reverifyState()}`))

    expect(reverify).toHaveBeenCalledWith({
      workspaceId: 'w1',
      memberRole: 'OWNER',
      userCode: 'abc',
      redirectUri: `${APP_URL}/api/github/app/callback`,
      audit: expect.objectContaining({ source: 'WEB' }),
    })
    expect(install).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app=reverified`
    )
  })

  it('reports a failed re-verification by its code', async () => {
    reverify.mockRejectedValueOnce(
      Object.assign(new Error('owner only'), { status: 403, code: 'not_owner' })
    )
    const refused = await GET(req(`code=abc&state=${reverifyState()}`))
    expect(refused.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=not_owner`
    )

    reverify.mockRejectedValueOnce(new Error('502'))
    const failed = await GET(req(`code=abc&state=${reverifyState()}`))
    expect(failed.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=reverify_failed`
    )
  })

  it('names an over-cap installation instead of a generic failure', async () => {
    install.mockRejectedValueOnce(
      Object.assign(new Error('too many'), { code: 'too_many_repositories' })
    )
    const res = await GET(req(`code=abc&state=${state('w1')}`))
    expect(res.headers.get('location')).toBe(
      `${SETTINGS}?github_app_error=too_many_repositories`
    )
  })
})
