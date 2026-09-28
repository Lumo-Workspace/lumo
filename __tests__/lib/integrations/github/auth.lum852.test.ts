/**
 * @jest-environment node
 */
/**
 * LUM-852 — the token a sandbox clones with, and the tenant boundary it is
 * minted under.
 */
jest.mock('@octokit/auth-app', () => ({
  createAppAuth: jest.fn(),
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import {
  getRepoToken,
  createRepoScopedToken,
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { logger } from '@/lib/logger'

const createAppAuthMock = createAppAuth as unknown as jest.Mock
const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch
let authFn: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...ORIGINAL_ENV,
    GITHUB_APP_ID: '111',
    // Raw base64 form — appCredentials wraps it; no PEM block in the fixture.
    GITHUB_APP_PRIVATE_KEY: 'abc',
    // Set on purpose: the fallback must not come back just because the env
    // var still exists in some deployment.
    GITHUB_APP_INSTALLATION_ID: '999',
  }
  authFn = jest.fn().mockResolvedValue({ token: 'ghs_scoped' })
  createAppAuthMock.mockReturnValue(authFn)
})
afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

describe('LUM-852 clone token scope', () => {
  it('sandbox clone token is scoped to the one repository with contents read', async () => {
    findByWorkspace.mockResolvedValue({
      installationId: 42,
      repositories: ['acme/widgets'],
    })

    const token = await getRepoCloneToken('ws_1', 'acme/widgets')

    expect(token).toBe('ghs_scoped')
    expect(findByWorkspace).toHaveBeenCalledWith('ws_1')
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 42 })
    )
    // Exactly one repository, exactly one permission — anything wider is
    // the whole installation again.
    expect(authFn).toHaveBeenCalledWith({
      type: 'installation',
      repositoryNames: ['widgets'],
      permissions: { contents: 'read' },
    })
  })

  it('createRepoScopedToken makes the same scoped request for an installation id in hand', async () => {
    await expect(createRepoScopedToken(7, 'acme/widgets')).resolves.toBe(
      'ghs_scoped'
    )
    expect(findByWorkspace).not.toHaveBeenCalled()
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 7 })
    )
    expect(authFn).toHaveBeenCalledWith({
      type: 'installation',
      repositoryNames: ['widgets'],
      permissions: { contents: 'read' },
    })
  })

  it('refuses a repository that is not owner/repo', async () => {
    findByWorkspace.mockResolvedValue({
      installationId: 42,
      repositories: ['widgets'],
    })
    await expect(getRepoCloneToken('ws_1', 'widgets')).rejects.toThrow(
      /owner\/repo/
    )
    expect(authFn).not.toHaveBeenCalled()
  })
})

describe('LUM-852 no cross-tenant fallback', () => {
  it('throws instead of falling back when the workspace has no installation', async () => {
    findByWorkspace.mockResolvedValue(null)

    await expect(
      getRepoToken('ws_other', 'o/r', { pull_requests: 'read' })
    ).rejects.toThrow(/not installed/)
    await expect(getRepoCloneToken('ws_other', 'o/r')).rejects.toThrow(
      /install the Lumo GitHub App/
    )
    // Lumo's own installation (999) is never used to mint anything.
    expect(createAppAuthMock).not.toHaveBeenCalled()
    // No workspace at all is the same refusal, not "use the env id".
    await expect(
      getRepoToken('', 'o/r', { pull_requests: 'read' })
    ).rejects.toThrow(/workspace/i)
    expect(findByWorkspace).toHaveBeenCalledTimes(2)
    expect(createAppAuthMock).not.toHaveBeenCalled()
  })
})

describe('LUM-852 revokeInstallationToken', () => {
  it('DELETEs /installation/token authenticated as the token itself', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 204 })
    global.fetch = fetchMock as never

    await expect(revokeInstallationToken('ghs_scoped')).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/installation/token',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer ghs_scoped',
        }),
      })
    )
  })

  it('treats an already-dead token as revoked and never throws or logs the token', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 401 }) as never
    await expect(revokeInstallationToken('ghs_scoped')).resolves.toBe(true)

    global.fetch = jest.fn().mockResolvedValue({ status: 500 }) as never
    await expect(revokeInstallationToken('ghs_scoped')).resolves.toBe(false)

    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ghs_scoped network down')) as never
    await expect(revokeInstallationToken('ghs_scoped')).resolves.toBe(false)

    const logged = (logger.warn as jest.Mock).mock.calls.flat().join(' ')
    expect(logged).not.toContain('ghs_scoped')
  })
})
