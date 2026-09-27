/**
 * @jest-environment node
 *
 * LUM-741: GET /api/github/app/setup — the GitHub App installation callback.
 * The installation is bound to the workspace carried in the signed state, and
 * only when the signed-in caller is a member of that workspace: without that
 * check anyone could redirect their own installation onto someone else's
 * workspace and have Lumo clone their repositories.
 *
 * LUM-875: the installation_id is untrusted too, so setup records nothing — it
 * hands the caller to GitHub to authorize the App, and
 * /api/github/app/callback (app-callback.test.ts) records the installation only
 * once GitHub confirms the caller can access it.
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
  githubAppInstallService: { install: jest.fn(), userAuthorizeUrl: jest.fn() },
}))

import { GET } from '@/app/api/github/app/setup/route'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserWorkspace = getUserWorkspace as jest.Mock
const install = githubAppInstallService.install as jest.Mock
const userAuthorizeUrl = githubAppInstallService.userAuthorizeUrl as jest.Mock

const APP_URL = 'https://app.test'

function state(workspaceId: string, workspaceUrl = 'acme') {
  return encodeURIComponent(
    `enc(${JSON.stringify({ workspaceId, workspaceUrl, memberId: 'm1' })})`
  )
}

function req(query: string) {
  const { NextRequest } = jest.requireActual('next/server')
  return new NextRequest(`${APP_URL}/api/github/app/setup?${query}`)
}

describe('GET /api/github/app/setup', () => {
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
    userAuthorizeUrl.mockImplementation(
      (st: string, redirectUri: string) =>
        `https://github.com/login/oauth/authorize?state=${st}&redirect_uri=${redirectUri}`
    )
  })

  it('records nothing and sends the caller to GitHub to prove access to the installation', async () => {
    const res = await GET(
      req(`installation_id=42&setup_action=install&state=${state('w1')}`)
    )

    expect(install).not.toHaveBeenCalled()
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(
      /^https:\/\/github\.com\/login\/oauth\/authorize/
    )
    const [verifyState, redirectUri] = userAuthorizeUrl.mock.calls[0] as [
      string,
      string,
    ]
    expect(redirectUri).toBe(`${APP_URL}/api/github/app/callback`)
    // The installation id rides in the encrypted state, next to the workspace.
    expect(JSON.parse(/^enc\((.*)\)$/.exec(verifyState)![1]!)).toEqual({
      workspaceId: 'w1',
      workspaceUrl: 'acme',
      memberId: 'm1',
      installationId: 42,
    })
  })

  it('surfaces missing App client credentials instead of installing unverified', async () => {
    userAuthorizeUrl.mockImplementation(() => {
      throw Object.assign(new Error('missing'), {
        code: 'verify_not_configured',
      })
    })

    const res = await GET(
      req(`installation_id=42&setup_action=install&state=${state('w1')}`)
    )

    expect(install).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe(
      `${APP_URL}/workspace/acme/settings/integrations?github_app_error=verify_not_configured`
    )
  })

  it('refuses to bind an installation to a workspace the caller is not a member of', async () => {
    const res = await GET(
      req(`installation_id=42&setup_action=install&state=${state('other-ws')}`)
    )

    expect(res.status).toBe(403)
    expect(install).not.toHaveBeenCalled()
  })

  it('refuses a tampered or missing state instead of guessing a workspace', async () => {
    const tampered = await GET(
      req('installation_id=42&setup_action=install&state=not-encrypted')
    )
    expect(tampered.status).toBe(400)

    const missing = await GET(req('installation_id=42&setup_action=install'))
    expect(missing.status).toBe(400)

    expect(install).not.toHaveBeenCalled()
  })

  it('rejects a missing or non-numeric installation_id', async () => {
    const res = await GET(
      req(`installation_id=abc&setup_action=install&state=${state('w1')}`)
    )

    expect(res.status).toBe(400)
    expect(install).not.toHaveBeenCalled()
  })

  it('records nothing for setup_action=request and says so in the redirect', async () => {
    const res = await GET(
      req(`installation_id=42&setup_action=request&state=${state('w1')}`)
    )

    expect(install).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe(
      `${APP_URL}/workspace/acme/settings/integrations?github_app=requested`
    )
  })

  it('propagates the auth failure response when the caller is signed out', async () => {
    const { NextResponse } = jest.requireActual('next/server')
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await GET(
      req(`installation_id=42&setup_action=install&state=${state('w1')}`)
    )

    expect(res.status).toBe(401)
    expect(install).not.toHaveBeenCalled()
  })
})
