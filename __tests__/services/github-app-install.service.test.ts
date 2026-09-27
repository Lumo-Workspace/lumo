/**
 * @jest-environment node
 *
 * LUM-741: what the App-level webhook events and the install callback actually
 * do to the GitHubAppInstallation row.
 */
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    upsert: jest.fn(),
    findByWorkspace: jest.fn(),
    findStatusByWorkspace: jest.fn(),
    findByInstallationId: jest.fn(),
    findAllByInstallationId: jest.fn().mockResolvedValue([]),
    updateRepositories: jest.fn(),
    delete: jest.fn(),
    deleteByInstallationId: jest.fn().mockResolvedValue({ count: 1 }),
  },
  // LUM-855: uninstall scrubs the workspace's scan code (real-DB coverage in
  // __tests__/lib/services/github-app-uninstall-scrub.test.ts).
  prSecurityScanRepository: {
    scrubCodeForWorkspace: jest
      .fn()
      .mockResolvedValue({ scans: 0, findings: 0 }),
  },
}))
jest.mock('@/lib/integrations/github', () => ({
  fetchAppInstallation: jest.fn(),
  fetchInstallationRepositories: jest.fn(),
  deleteAppInstallation: jest.fn(),
  createInstallationToken: jest.fn(),
  syncRepoPRs: jest.fn(),
  buildAppUserAuthorizeUrl: jest.fn(),
  exchangeAppUserCode: jest.fn(),
  listUserInstallationIds: jest.fn(),
  listUserInstallationRepositories: jest.fn(),
  revokeAppUserToken: jest.fn(),
  GithubAppUserAuthNotConfiguredError: class extends Error {},
}))

import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  fetchAppInstallation,
  fetchInstallationRepositories,
  deleteAppInstallation,
  createInstallationToken,
  syncRepoPRs,
  buildAppUserAuthorizeUrl,
  exchangeAppUserCode,
  listUserInstallationIds,
  listUserInstallationRepositories,
  revokeAppUserToken,
  GithubAppUserAuthNotConfiguredError,
} from '@/lib/integrations/github'

type MockedRepo = {
  [K in keyof typeof githubAppInstallationRepository]: jest.Mock
}
const repo = githubAppInstallationRepository as unknown as MockedRepo
const REDIRECT = 'https://app.test/api/github/app/callback'

describe('githubAppInstallService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    repo.deleteByInstallationId.mockResolvedValue({ count: 1 })
    repo.findAllByInstallationId.mockResolvedValue([])
    ;(fetchAppInstallation as jest.Mock).mockResolvedValue({
      accountLogin: 'acme-inc',
      accountType: 'Organization',
    })
    ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
      'acme-inc/web',
    ])
    repo.upsert.mockResolvedValue({ workspaceId: 'w1', installationId: 42 })
    ;(createInstallationToken as jest.Mock).mockResolvedValue('inst-token')
    ;(syncRepoPRs as jest.Mock).mockResolvedValue(undefined)
    ;(exchangeAppUserCode as jest.Mock).mockResolvedValue('user-token')
    ;(listUserInstallationIds as jest.Mock).mockResolvedValue([42])
    ;(listUserInstallationRepositories as jest.Mock).mockResolvedValue([
      'acme-inc/web',
    ])
    ;(revokeAppUserToken as jest.Mock).mockResolvedValue(undefined)
  })

  describe('install', () => {
    it('stores the installation with the account and repositories read from GitHub', async () => {
      await githubAppInstallService.install({
        workspaceId: 'w1',
        memberId: 'm1',
        installationId: 42,
        userCode: 'code',
        redirectUri: REDIRECT,
      })

      expect(repo.upsert).toHaveBeenCalledWith({
        workspaceId: 'w1',
        installationId: 42,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        installedBy: 'm1',
      })
    })

    it('backfills the pull requests each reachable repository already has', async () => {
      await githubAppInstallService.install({
        workspaceId: 'w1',
        memberId: 'm1',
        installationId: 42,
        userCode: 'code',
        redirectUri: REDIRECT,
      })

      expect(syncRepoPRs).toHaveBeenCalledWith(
        'inst-token',
        'acme-inc/web',
        'w1',
        null
      )
    })

    it('still records the installation when the backfill fails', async () => {
      ;(syncRepoPRs as jest.Mock).mockRejectedValue(new Error('rate limited'))

      await expect(
        githubAppInstallService.install({
          workspaceId: 'w1',
          memberId: 'm1',
          installationId: 42,
          userCode: 'code',
          redirectUri: REDIRECT,
        })
      ).resolves.toBeDefined()
      expect(repo.upsert).toHaveBeenCalled()
    })

    it('checks the caller access with their App user token before reading anything as the App', async () => {
      await githubAppInstallService.install({
        workspaceId: 'w1',
        memberId: 'm1',
        installationId: 42,
        userCode: 'code',
        redirectUri: REDIRECT,
      })

      expect(exchangeAppUserCode).toHaveBeenCalledWith('code', REDIRECT)
      expect(listUserInstallationIds).toHaveBeenCalledWith('user-token')
      expect(revokeAppUserToken).toHaveBeenCalledWith('user-token')
    })

    // LUM-875: installation_id on the setup URL is attacker-controlled.
    it('refuses an installation the caller cannot access on GitHub and writes nothing', async () => {
      ;(listUserInstallationIds as jest.Mock).mockResolvedValue([7, 8])

      await expect(
        githubAppInstallService.install({
          workspaceId: 'w1',
          memberId: 'm1',
          installationId: 42,
          userCode: 'code',
          redirectUri: REDIRECT,
        })
      ).rejects.toMatchObject({ status: 403, code: 'not_authorized' })

      expect(fetchAppInstallation).not.toHaveBeenCalled()
      expect(fetchInstallationRepositories).not.toHaveBeenCalled()
      expect(repo.upsert).not.toHaveBeenCalled()
      expect(createInstallationToken).not.toHaveBeenCalled()
      expect(syncRepoPRs).not.toHaveBeenCalled()
      // The user token is still revoked on the refusal path.
      expect(revokeAppUserToken).toHaveBeenCalledWith('user-token')
    })

    it('fails closed when the caller access cannot be verified', async () => {
      const attempt = () =>
        githubAppInstallService.install({
          workspaceId: 'w1',
          memberId: 'm1',
          installationId: 42,
          userCode: 'code',
          redirectUri: REDIRECT,
        })

      // App client credentials missing on this deployment.
      ;(exchangeAppUserCode as jest.Mock).mockRejectedValueOnce(
        new (GithubAppUserAuthNotConfiguredError as unknown as new () => Error)()
      )
      await expect(attempt()).rejects.toMatchObject({
        status: 503,
        code: 'verify_not_configured',
      })

      // Bad / expired / replayed code.
      ;(exchangeAppUserCode as jest.Mock).mockRejectedValueOnce(
        new Error('bad_verification_code')
      )
      await expect(attempt()).rejects.toThrow('bad_verification_code')

      // GitHub error while listing — never treated as an empty allow-list.
      ;(listUserInstallationIds as jest.Mock).mockRejectedValueOnce(
        new Error('GitHub listUserInstallations failed 502')
      )
      await expect(attempt()).rejects.toThrow('502')

      expect(fetchAppInstallation).not.toHaveBeenCalled()
      expect(repo.upsert).not.toHaveBeenCalled()
      expect(syncRepoPRs).not.toHaveBeenCalled()
    })

    // LUM-880: GitHub lists an installation for a user who can read any one
    // of its repositories; binding it would show them the rest.
    it('refuses a caller who cannot read every repository of the installation and writes nothing', async () => {
      ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
        'acme-inc/payroll',
      ])
      ;(listUserInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
      ])

      await expect(
        githubAppInstallService.install({
          workspaceId: 'w1',
          memberId: 'm1',
          installationId: 42,
          userCode: 'code',
          redirectUri: REDIRECT,
        })
      ).rejects.toMatchObject({ status: 403, code: 'repo_access_incomplete' })

      expect(listUserInstallationRepositories).toHaveBeenCalledWith(
        'user-token',
        42
      )
      expect(repo.upsert).not.toHaveBeenCalled()
      expect(createInstallationToken).not.toHaveBeenCalled()
      expect(syncRepoPRs).not.toHaveBeenCalled()
      expect(revokeAppUserToken).toHaveBeenCalledWith('user-token')
    })

    it('binds when the caller can read every repository of the installation', async () => {
      ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
        'acme-inc/payroll',
      ])
      // Admin view: every repository, in another order and casing.
      ;(listUserInstallationRepositories as jest.Mock).mockResolvedValue([
        'Acme-Inc/Payroll',
        'acme-inc/web',
        'acme-inc/other',
      ])

      await githubAppInstallService.install({
        workspaceId: 'w1',
        memberId: 'm1',
        installationId: 42,
        userCode: 'code',
        redirectUri: REDIRECT,
      })

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          repositories: ['acme-inc/web', 'acme-inc/payroll'],
        })
      )
      expect(syncRepoPRs).toHaveBeenCalledTimes(2)
    })

    it('writes nothing when the caller repository list cannot be read', async () => {
      ;(listUserInstallationRepositories as jest.Mock).mockRejectedValue(
        new Error('GitHub listUserInstallationRepositories failed 502')
      )

      await expect(
        githubAppInstallService.install({
          workspaceId: 'w1',
          memberId: 'm1',
          installationId: 42,
          userCode: 'code',
          redirectUri: REDIRECT,
        })
      ).rejects.toThrow('502')
      expect(fetchAppInstallation).not.toHaveBeenCalled()
      expect(repo.upsert).not.toHaveBeenCalled()
      expect(revokeAppUserToken).toHaveBeenCalledWith('user-token')
    })

    it('writes nothing when GitHub rejects the installation read', async () => {
      ;(fetchAppInstallation as jest.Mock).mockRejectedValue(new Error('404'))

      await expect(
        githubAppInstallService.install({
          workspaceId: 'w1',
          memberId: 'm1',
          installationId: 42,
          userCode: 'code',
          redirectUri: REDIRECT,
        })
      ).rejects.toThrow('404')
      expect(repo.upsert).not.toHaveBeenCalled()
    })
  })

  describe('userAuthorizeUrl', () => {
    it('returns the App authorize URL for the state', () => {
      ;(buildAppUserAuthorizeUrl as jest.Mock).mockReturnValue(
        'https://github.com/login/oauth/authorize?x'
      )
      expect(githubAppInstallService.userAuthorizeUrl('st', REDIRECT)).toBe(
        'https://github.com/login/oauth/authorize?x'
      )
      expect(buildAppUserAuthorizeUrl).toHaveBeenCalledWith('st', REDIRECT)
    })

    it('reports missing App client credentials as verify_not_configured', () => {
      ;(buildAppUserAuthorizeUrl as jest.Mock).mockImplementation(() => {
        throw new (GithubAppUserAuthNotConfiguredError as unknown as new () => Error)()
      })
      expect(() =>
        githubAppInstallService.userAuthorizeUrl('st', REDIRECT)
      ).toThrow(
        expect.objectContaining({ status: 503, code: 'verify_not_configured' })
      )
    })
  })

  describe('applyInstallationEvent', () => {
    it('updates the known workspace row on created', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        {
          workspaceId: 'w1',
          installationId: 555,
          repositories: ['acme-inc/old'],
        },
      ])

      await githubAppInstallService.applyInstallationEvent({
        action: 'created',
        installation: {
          id: 555,
          account: { login: 'acme-inc', type: 'Organization' },
        },
        repositories: [{ full_name: 'acme-inc/web' }],
      })

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'w1',
          installationId: 555,
          accountLogin: 'acme-inc',
          repositories: ['acme-inc/web'],
        })
      )
    })

    it('updates every workspace bound to a shared installation', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        { workspaceId: 'w1', installationId: 555, repositories: [] },
        { workspaceId: 'w2', installationId: 555, repositories: [] },
      ])

      await githubAppInstallService.applyInstallationEvent({
        action: 'unsuspend',
        installation: { id: 555 },
      })

      expect(repo.upsert.mock.calls.map(c => c[0].workspaceId)).toEqual([
        'w1',
        'w2',
      ])
    })

    it('ignores an installation it has never seen instead of guessing a workspace', async () => {
      repo.findAllByInstallationId.mockResolvedValue([])

      await githubAppInstallService.applyInstallationEvent({
        action: 'created',
        installation: { id: 999 },
      })

      expect(repo.upsert).not.toHaveBeenCalled()
    })

    it.each(['deleted', 'suspend'])('removes the row on %s', async action => {
      await githubAppInstallService.applyInstallationEvent({
        action,
        installation: { id: 555 },
      })

      expect(repo.deleteByInstallationId).toHaveBeenCalledWith(555)
      expect(repo.upsert).not.toHaveBeenCalled()
    })

    it('ignores a payload with no installation id', async () => {
      await githubAppInstallService.applyInstallationEvent({
        action: 'created',
      })

      expect(repo.deleteByInstallationId).not.toHaveBeenCalled()
      expect(repo.upsert).not.toHaveBeenCalled()
    })
  })

  describe('applyInstallationRepositoriesEvent', () => {
    it('adds and removes repositories without dropping the rest', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        {
          workspaceId: 'w1',
          installationId: 555,
          repositories: ['acme-inc/web', 'acme-inc/legacy'],
        },
      ])

      await githubAppInstallService.applyInstallationRepositoriesEvent({
        action: 'added',
        installation: { id: 555 },
        repositories_added: [{ full_name: 'acme-inc/api' }],
        repositories_removed: [{ full_name: 'acme-inc/legacy' }],
      })

      expect(repo.updateRepositories).toHaveBeenCalledWith('w1', [
        'acme-inc/web',
        'acme-inc/api',
      ])
      // Only the newly reachable repository is backfilled.
      expect(syncRepoPRs).toHaveBeenCalledTimes(1)
      expect(syncRepoPRs).toHaveBeenCalledWith(
        'inst-token',
        'acme-inc/api',
        'w1',
        null
      )
    })

    it('does nothing for an unknown installation', async () => {
      repo.findAllByInstallationId.mockResolvedValue([])

      await githubAppInstallService.applyInstallationRepositoriesEvent({
        action: 'added',
        installation: { id: 999 },
        repositories_added: [{ full_name: 'x/y' }],
      })

      expect(repo.updateRepositories).not.toHaveBeenCalled()
    })
  })

  describe('uninstall', () => {
    it('refuses a non-owner and touches nothing', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })

      await expect(
        githubAppInstallService.uninstall('w1', 'MEMBER')
      ).rejects.toMatchObject({ status: 403 })
      expect(deleteAppInstallation).not.toHaveBeenCalled()
      expect(repo.delete).not.toHaveBeenCalled()
    })

    it('deletes the installation on GitHub and locally', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })

      await githubAppInstallService.uninstall('w1', 'OWNER')

      expect(deleteAppInstallation).toHaveBeenCalledWith(555)
      expect(repo.delete).toHaveBeenCalledWith('w1')
    })

    // LUM-875: an installation shared by several workspaces (LUM-872) must not
    // be removed on GitHub from under the others.
    it('keeps the GitHub installation when another workspace still shares it', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })
      repo.findAllByInstallationId.mockResolvedValue([
        { workspaceId: 'w1', installationId: 555, repositories: [] },
        { workspaceId: 'w2', installationId: 555, repositories: [] },
      ])

      await githubAppInstallService.uninstall('w1', 'OWNER')

      expect(deleteAppInstallation).not.toHaveBeenCalled()
      expect(repo.delete).toHaveBeenCalledWith('w1')
      expect(repo.delete).not.toHaveBeenCalledWith('w2')
    })

    it('still drops the local row when GitHub refuses the delete', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })
      ;(deleteAppInstallation as jest.Mock).mockRejectedValue(new Error('403'))

      await githubAppInstallService.uninstall('w1', 'OWNER')

      expect(repo.delete).toHaveBeenCalledWith('w1')
    })
  })

  describe('getStatus', () => {
    it('reports not installed when the workspace has no row', async () => {
      repo.findStatusByWorkspace.mockResolvedValue(null)

      expect(await githubAppInstallService.getStatus('w1')).toEqual({
        installed: false,
      })
    })

    it('reports the account and repository scope when installed', async () => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        createdAt: new Date(),
      })

      expect(await githubAppInstallService.getStatus('w1')).toEqual({
        installed: true,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
      })
    })
  })
})
