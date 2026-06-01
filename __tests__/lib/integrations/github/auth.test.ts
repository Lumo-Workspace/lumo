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

  it('falls back to env installationId when workspace has no DB row', async () => {
    findByWorkspaceMock.mockResolvedValue(null)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockAuthReturning('tok_env')

    const token = await getGithubInstallationToken('ws_unknown')

    expect(token).toBe('tok_env')
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 999 })
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ws_unknown'))
    warn.mockRestore()
  })

  it('uses env installationId when called without workspaceId', async () => {
    mockAuthReturning('tok_env')

    const token = await getGithubInstallationToken()

    expect(token).toBe('tok_env')
    expect(findByWorkspaceMock).not.toHaveBeenCalled()
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 999 })
    )
  })

  it('throws when no DB row and no env installation id', async () => {
    findByWorkspaceMock.mockResolvedValue(null)
    delete process.env.GITHUB_APP_INSTALLATION_ID

    await expect(getGithubInstallationToken('ws_1')).rejects.toThrow(
      /installation/i
    )
  })

  it('throws when env installation id is not a valid number', async () => {
    findByWorkspaceMock.mockResolvedValue(null)
    process.env.GITHUB_APP_INSTALLATION_ID = 'not-a-number'

    await expect(getGithubInstallationToken('ws_1')).rejects.toThrow(
      /not a valid installation id/i
    )
  })

  it('throws when app id / private key missing', async () => {
    findByWorkspaceMock.mockResolvedValue(null)
    delete process.env.GITHUB_APP_ID
    await expect(getGithubInstallationToken('ws_1')).rejects.toThrow(
      /GITHUB_APP_ID/
    )
  })
})
