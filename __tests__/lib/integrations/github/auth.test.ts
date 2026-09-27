/**
 * @jest-environment node
 */
jest.mock('@octokit/auth-app', () => ({
  createAppAuth: jest.fn(),
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))

import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'

const createAppAuthMock = createAppAuth as unknown as jest.Mock
const findByWorkspaceMock =
  githubAppInstallationRepository.findByWorkspace as jest.Mock

function mockAuthReturning(token: string) {
  const authFn = jest.fn().mockResolvedValue({ token })
  createAppAuthMock.mockReturnValue(authFn)
  return authFn
}

const ORIGINAL_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...ORIGINAL_ENV,
    GITHUB_APP_ID: '111',
    GITHUB_APP_PRIVATE_KEY:
      '-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----\\n',
    GITHUB_APP_INSTALLATION_ID: '999',
  }
})
afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('getGithubInstallationToken', () => {
  it('uses the per-workspace installationId when DB has a row', async () => {
    findByWorkspaceMock.mockResolvedValue({
      id: 'gai_1',
      workspaceId: 'ws_1',
      installationId: 42,
    })
    mockAuthReturning('tok_db')

    const token = await getGithubInstallationToken('ws_1')

    expect(token).toBe('tok_db')
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 111, installationId: 42 })
    )
  })

  // LUM-852: the GITHUB_APP_INSTALLATION_ID fallback is gone — see
  // auth.lum852.test.ts for the no-row / no-workspace refusals.
  it('never reads GITHUB_APP_INSTALLATION_ID, even when it is set', async () => {
    findByWorkspaceMock.mockResolvedValue(null)
    mockAuthReturning('tok_env')

    await expect(getGithubInstallationToken('ws_unknown')).rejects.toThrow(
      /ws_unknown/
    )
    expect(createAppAuthMock).not.toHaveBeenCalled()
  })

  it('throws when app id / private key missing', async () => {
    findByWorkspaceMock.mockResolvedValue({
      id: 'gai_1',
      workspaceId: 'ws_1',
      installationId: 42,
    })
    delete process.env.GITHUB_APP_ID
    await expect(getGithubInstallationToken('ws_1')).rejects.toThrow(
      /GITHUB_APP_ID/
    )
  })
})
