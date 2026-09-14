/**
 * @jest-environment node
 *
 * LUM-741: GET /api/github/app/setup — the GitHub App installation callback.
 * The installation is bound to the workspace carried in the signed state, and
 * only when the signed-in caller is a member of that workspace: without that
 * check anyone could redirect their own installation onto someone else's
 * workspace and have Lumo clone their repositories.
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

import { GET } from '@/app/api/github/app/setup/route'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserWorkspace = getUserWorkspace as jest.Mock
const install = githubAppInstallService.install as jest.Mock

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
  })

  it('records the installation for the workspace in the signed state', async () => {
    const res = await GET(
      req(`installation_id=42&setup_action=install&state=${state('w1')}`)
    )

    expect(install).toHaveBeenCalledWith({
      workspaceId: 'w1',
      memberId: 'm1',
      installationId: 42,
    })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      `${APP_URL}/workspace/acme/settings/integrations?github_app=installed`
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

  it('surfaces a failed installation read as an explicit error, never a silent success redirect', async () => {
    install.mockRejectedValue(new Error('GitHub 404'))

    const res = await GET(
      req(`installation_id=42&setup_action=install&state=${state('w1')}`)
    )

    expect(res.headers.get('location')).toBe(
      `${APP_URL}/workspace/acme/settings/integrations?github_app_error=install_failed`
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
