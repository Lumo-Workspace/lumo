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
    findAllByInstallationId: jest.fn().mockResolvedValue([]),
    updateRepositories: jest.fn(),
    recordVerification: jest.fn(),
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
// LUM-881: the real listing (app-installations.ts) can be swapped in per test;
// it only needs an installation token.
jest.mock('@/lib/integrations/github/auth', () => ({
  createInstallationToken: jest.fn().mockResolvedValue('inst-token'),
  getGithubAppJwt: jest.fn(),
}))
jest.mock('@/lib/integrations/github', () => ({
  fetchAppInstallation: jest.fn(),
  fetchInstallationRepositories: jest.fn(),
  listInstallationRepositories: jest.fn(),
  deleteAppInstallation: jest.fn(),
  getRepoToken: jest.fn(),
  REPO_TOKEN_PERMISSIONS: jest.requireActual(
    '@/lib/integrations/github/token-permissions'
  ).REPO_TOKEN_PERMISSIONS,
  syncRepoPRs: jest.fn(),
  buildAppUserAuthorizeUrl: jest.fn(),
  exchangeAppUserCode: jest.fn(),
  listUserInstallationIds: jest.fn(),
  listUserInstallationRepositories: jest.fn(),
  fetchAppUserLogin: jest.fn(),
  revokeAppUserToken: jest.fn(),
  GithubAppUserAuthNotConfiguredError: class extends Error {},
}))

import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import {
  githubAppInstallationRepository,
  prSecurityScanRepository,
} from '@/lib/repositories'
import {
  fetchAppInstallation,
  fetchInstallationRepositories,
  listInstallationRepositories,
  deleteAppInstallation,
  getRepoToken,
  syncRepoPRs,
  buildAppUserAuthorizeUrl,
  exchangeAppUserCode,
  listUserInstallationIds,
  listUserInstallationRepositories,
  fetchAppUserLogin,
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
    ;(getRepoToken as jest.Mock).mockImplementation(
      async (_ws: string, repository: string) => `repo-token:${repository}`
    )
    ;(syncRepoPRs as jest.Mock).mockResolvedValue(undefined)
    ;(exchangeAppUserCode as jest.Mock).mockResolvedValue('user-token')
    ;(listUserInstallationIds as jest.Mock).mockResolvedValue([42])
    ;(listUserInstallationRepositories as jest.Mock).mockResolvedValue([
      'acme-inc/web',
    ])
    ;(fetchAppUserLogin as jest.Mock).mockResolvedValue('octo-admin')
    ;(revokeAppUserToken as jest.Mock).mockResolvedValue(undefined)
  })

  describe('verifier login (LUM-882)', () => {
    it('records the verifier login on bind and on re-verification', async () => {
      await githubAppInstallService.install({
        workspaceId: 'w1',
        memberId: 'm1',
        installationId: 42,
        userCode: 'code',
        redirectUri: REDIRECT,
      })
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ verifierLogin: 'octo-admin' })
      )

      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 42,
        repositories: ['acme-inc/web'],
        verifierLogin: 'someone-else',
      })
      ;(fetchAppUserLogin as jest.Mock).mockResolvedValue('octo-owner')
      await githubAppInstallService.reverify({
        workspaceId: 'w1',
        memberRole: 'OWNER',
        userCode: 'code',
        redirectUri: REDIRECT,
      })
      expect(repo.recordVerification).toHaveBeenCalledWith(
        'w1',
        ['acme-inc/web'],
        'octo-owner'
      )
      // The login is read while the token is live; the token still goes.
      expect(fetchAppUserLogin).toHaveBeenCalledWith('user-token')
      expect(revokeAppUserToken).toHaveBeenCalledTimes(2)
    })

    it('writes nothing when the verifier login cannot be read', async () => {
      ;(fetchAppUserLogin as jest.Mock).mockRejectedValue(new Error('502'))
      await expect(
        githubAppInstallService.install({
          workspaceId: 'w1',
          memberId: 'm1',
          installationId: 42,
          userCode: 'code',
          redirectUri: REDIRECT,
        })
      ).rejects.toThrow('502')
      expect(repo.upsert).not.toHaveBeenCalled()
      expect(revokeAppUserToken).toHaveBeenCalledWith('user-token')
    })
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
        verifierLogin: 'octo-admin',
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
        'repo-token:acme-inc/web',
        'acme-inc/web',
        'w1',
        null
      )
    })

    // LUM-890: no installation-wide token for the backfill — each confirmed
    // repository goes through the same getRepoToken mint as any PR read.
    it('PR backfill mints a pull request read token per confirmed repository', async () => {
      ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
        'acme-inc/payroll',
      ])
      ;(listUserInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
        'acme-inc/payroll',
      ])
      // One repository's mint fails; the other is still backfilled.
      ;(getRepoToken as jest.Mock).mockImplementation(
        async (_ws: string, repository: string) => {
          if (repository === 'acme-inc/web') throw new Error('422')
          return `repo-token:${repository}`
        }
      )

      await githubAppInstallService.install({
        workspaceId: 'w1',
        memberId: 'm1',
        installationId: 42,
        userCode: 'code',
        redirectUri: REDIRECT,
      })

      expect((getRepoToken as jest.Mock).mock.calls).toEqual([
        ['w1', 'acme-inc/web', { pull_requests: 'read' }],
        ['w1', 'acme-inc/payroll', { pull_requests: 'read' }],
      ])
      expect(syncRepoPRs).toHaveBeenCalledTimes(1)
      expect(syncRepoPRs).toHaveBeenCalledWith(
        'repo-token:acme-inc/payroll',
        'acme-inc/payroll',
        'w1',
        null
      )
      // The mint happens after the confirmed list is written.
      expect(repo.upsert.mock.invocationCallOrder[0]).toBeLessThan(
        (getRepoToken as jest.Mock).mock.invocationCallOrder[0] as number
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
      expect(getRepoToken).not.toHaveBeenCalled()
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
      expect(getRepoToken).not.toHaveBeenCalled()
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

    // LUM-881: the App-side listing used to stop at 5 pages and return what it
    // had, so repositories past 500 skipped the comparison above entirely.
    it('refuses to bind an installation whose repository list exceeds the listing cap', async () => {
      const actual = jest.requireActual(
        '@/lib/integrations/github/app-installations'
      )
      ;(fetchInstallationRepositories as jest.Mock).mockImplementation(
        actual.fetchInstallationRepositories
      )
      // Every page is full: 100 repositories per page, forever.
      let pages = 0
      const fetchMock = jest.fn(async (url: string) => {
        pages += 1
        const page = Number(new URL(url).searchParams.get('page'))
        return {
          ok: true,
          json: async () => ({
            repositories: Array.from({ length: 100 }, (_, i) => ({
              full_name: `acme-inc/repo-${page}-${i}`,
            })),
          }),
        }
      })
      const realFetch = global.fetch
      global.fetch = fetchMock as unknown as typeof fetch
      try {
        await expect(
          githubAppInstallService.install({
            workspaceId: 'w1',
            memberId: 'm1',
            installationId: 42,
            userCode: 'code',
            redirectUri: REDIRECT,
          })
        ).rejects.toMatchObject({ code: 'too_many_repositories' })
      } finally {
        global.fetch = realFetch
      }

      // Same cap as the user-side listing: 50 pages × 100, then refuse.
      expect(pages).toBe(50)
      expect(repo.upsert).not.toHaveBeenCalled()
      expect(syncRepoPRs).not.toHaveBeenCalled()
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
    it('updates the known workspace row on created, only narrowing the confirmed list', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        {
          workspaceId: 'w1',
          installationId: 555,
          repositories: ['acme-inc/web', 'acme-inc/old'],
        },
      ])

      await githubAppInstallService.applyInstallationEvent({
        action: 'created',
        installation: {
          id: 555,
          account: { login: 'acme-inc', type: 'Organization' },
        },
        repositories: [
          { full_name: 'Acme-Inc/Web' },
          { full_name: 'acme-inc/new' },
        ],
      })

      // `old` is no longer reachable; `new` was never confirmed (LUM-881).
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
    it('removes repositories without dropping the rest and scrubs their code', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        {
          workspaceId: 'w1',
          installationId: 555,
          repositories: ['acme-inc/web', 'acme-inc/legacy'],
        },
      ])

      await githubAppInstallService.applyInstallationRepositoriesEvent({
        action: 'removed',
        installation: { id: 555 },
        repositories_removed: [{ full_name: 'Acme-Inc/Legacy' }],
      })

      expect(repo.updateRepositories).toHaveBeenCalledWith('w1', [
        'acme-inc/web',
      ])
      expect(
        prSecurityScanRepository.scrubCodeForWorkspace
      ).toHaveBeenCalledWith('w1', ['Acme-Inc/Legacy'])
    })

    // LUM-881: the webhook carries no user, so nobody has shown they can read
    // an added repository. It must not reach the workspace until re-verified.
    it('keeps repositories added after binding pending', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        {
          workspaceId: 'w1',
          installationId: 555,
          repositories: ['acme-inc/web'],
        },
      ])

      await githubAppInstallService.applyInstallationRepositoriesEvent({
        action: 'added',
        installation: { id: 555 },
        repositories_added: [{ full_name: 'acme-inc/payroll' }],
      })
      await githubAppInstallService.applyInstallationEvent({
        action: 'new_permissions_accepted',
        installation: { id: 555 },
        repositories: [
          { full_name: 'acme-inc/web' },
          { full_name: 'acme-inc/payroll' },
        ],
      })

      // Never confirmed, never backfilled.
      expect(repo.updateRepositories).not.toHaveBeenCalled()
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ repositories: ['acme-inc/web'] })
      )
      expect(getRepoToken).not.toHaveBeenCalled()
      expect(syncRepoPRs).not.toHaveBeenCalled()

      // The settings card shows it as pending.
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        createdAt: new Date(),
      })
      ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
        'acme-inc/payroll',
      ])
      expect(
        await githubAppInstallService.getStatus('w1', 'OWNER')
      ).toMatchObject({
        repositories: ['acme-inc/web'],
        pendingRepositories: ['acme-inc/payroll'],
      })
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

      expect(await githubAppInstallService.getStatus('w1', 'OWNER')).toEqual({
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
        verifierLogin: 'octo-admin',
        accessRemovedCount: 2,
        accessRemovedAt: new Date('2026-09-27T04:15:00Z'),
      })

      expect(await githubAppInstallService.getStatus('w1', 'OWNER')).toEqual({
        installed: true,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        pendingRepositories: [],
        accessRecheckEnabled: true,
        accessRemovedCount: 2,
        accessRemovedAt: '2026-09-27T04:15:00.000Z',
      })
    })

    it('reports the access recheck as off when no verifier login is on record', async () => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        repositories: ['acme-inc/web'],
        verifierLogin: null,
        accessRemovedCount: 0,
        accessRemovedAt: null,
      })

      expect(
        await githubAppInstallService.getStatus('w1', 'OWNER')
      ).toMatchObject({
        accessRecheckEnabled: false,
        accessRemovedCount: 0,
        accessRemovedAt: null,
      })
    })

    it('pending repositories are hidden from non-owners', async () => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        createdAt: new Date(),
        verifierLogin: 'octo-admin',
        accessRemovedCount: 0,
        accessRemovedAt: null,
      })
      ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
        'acme-inc/payroll',
      ])

      for (const role of ['MEMBER']) {
        const status = await githubAppInstallService.getStatus('w1', role)
        expect(status).toMatchObject({
          installed: true,
          repositories: ['acme-inc/web'],
        })
        expect(status).not.toHaveProperty('pendingRepositories')
        expect(JSON.stringify(status)).not.toContain('payroll')
      }
      expect(fetchInstallationRepositories).not.toHaveBeenCalled()

      expect(
        await githubAppInstallService.getStatus('w1', 'OWNER')
      ).toMatchObject({ pendingRepositories: ['acme-inc/payroll'] })
    })

    it('reports pending repositories as unknown when GitHub cannot be asked', async () => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        createdAt: new Date(),
      })
      ;(fetchInstallationRepositories as jest.Mock).mockRejectedValue(
        new Error('502')
      )

      expect(
        await githubAppInstallService.getStatus('w1', 'OWNER')
      ).toMatchObject({
        installed: true,
        pendingRepositories: null,
      })
    })
  })

  describe('listRepositories', () => {
    it('lists only confirmed repositories for the picker', async () => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        repositories: ['Acme-Inc/Web', 'acme-inc/gone'],
      })
      ;(listInstallationRepositories as jest.Mock).mockResolvedValue([
        { fullName: 'acme-inc/web', name: 'web', private: true },
        { fullName: 'acme-inc/payroll', name: 'payroll', private: true },
      ])

      expect(await githubAppInstallService.listRepositories('w1')).toEqual([
        { fullName: 'acme-inc/web', name: 'web', private: true },
      ])
    })

    it('returns null when the App is not installed', async () => {
      repo.findStatusByWorkspace.mockResolvedValue(null)
      expect(await githubAppInstallService.listRepositories('w1')).toBeNull()
    })
  })

  describe('reverify', () => {
    const input = {
      workspaceId: 'w1',
      memberRole: 'OWNER',
      userCode: 'code',
      redirectUri: REDIRECT,
    }

    beforeEach(() => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 42,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web', 'acme-inc/legacy'],
        createdAt: new Date(),
      })
      ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
        'acme-inc/legacy',
        'acme-inc/api',
        'acme-inc/payroll',
      ])
      // The owner can read web and api — no longer legacy, never payroll.
      ;(listUserInstallationRepositories as jest.Mock).mockResolvedValue([
        'Acme-Inc/Web',
        'acme-inc/api',
      ])
    })

    it('reverify narrows and widens the confirmed list to what the verifier can read', async () => {
      const result = await githubAppInstallService.reverify(input)

      expect(repo.recordVerification).toHaveBeenCalledWith(
        'w1',
        ['acme-inc/web', 'acme-inc/api'],
        'octo-admin'
      )
      expect(result).toEqual({
        confirmed: 2,
        added: ['acme-inc/api'],
        removed: ['acme-inc/legacy'],
      })
      // Lost access: the workspace keeps none of that repository's code.
      expect(
        prSecurityScanRepository.scrubCodeForWorkspace
      ).toHaveBeenCalledWith('w1', ['acme-inc/legacy'])
      // Newly confirmed: backfilled, and nothing else is.
      expect(syncRepoPRs).toHaveBeenCalledTimes(1)
      expect(syncRepoPRs).toHaveBeenCalledWith(
        'repo-token:acme-inc/api',
        'acme-inc/api',
        'w1',
        null
      )
      // No user credential outlives the check.
      expect(revokeAppUserToken).toHaveBeenCalledWith('user-token')
    })

    it('refuses a non-owner before asking GitHub anything', async () => {
      await expect(
        githubAppInstallService.reverify({ ...input, memberRole: 'MEMBER' })
      ).rejects.toMatchObject({ status: 403, code: 'not_owner' })
      expect(exchangeAppUserCode).not.toHaveBeenCalled()
      expect(repo.recordVerification).not.toHaveBeenCalled()
    })

    it('refuses when the workspace has no installation', async () => {
      repo.findStatusByWorkspace.mockResolvedValue(null)
      await expect(
        githubAppInstallService.reverify(input)
      ).rejects.toMatchObject({ status: 404, code: 'not_installed' })
      expect(exchangeAppUserCode).not.toHaveBeenCalled()
    })

    it('changes nothing when the verifier cannot access the installation at all', async () => {
      ;(listUserInstallationIds as jest.Mock).mockResolvedValue([7])

      await expect(
        githubAppInstallService.reverify(input)
      ).rejects.toMatchObject({ status: 403, code: 'not_authorized' })
      expect(repo.recordVerification).not.toHaveBeenCalled()
      expect(
        prSecurityScanRepository.scrubCodeForWorkspace
      ).not.toHaveBeenCalled()
      expect(revokeAppUserToken).toHaveBeenCalledWith('user-token')
    })

    it('changes nothing when the installation list cannot be read', async () => {
      ;(fetchInstallationRepositories as jest.Mock).mockRejectedValue(
        new Error('502')
      )

      await expect(githubAppInstallService.reverify(input)).rejects.toThrow(
        '502'
      )
      expect(repo.recordVerification).not.toHaveBeenCalled()
      expect(
        prSecurityScanRepository.scrubCodeForWorkspace
      ).not.toHaveBeenCalled()
    })
  })

  describe('startReverify', () => {
    it('returns the installation id for an owner', async () => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 42,
        repositories: [],
      })
      expect(await githubAppInstallService.startReverify('w1', 'OWNER')).toBe(
        42
      )
    })

    it('refuses a non-owner', async () => {
      await expect(
        githubAppInstallService.startReverify('w1', 'MEMBER')
      ).rejects.toMatchObject({ status: 403, code: 'not_owner' })
    })
  })

  describe('resolveWorkspaceForRepository', () => {
    it('returns null for an event with no repository', async () => {
      expect(
        await githubAppInstallService.resolveWorkspaceForRepository(555, null)
      ).toBeNull()
      expect(repo.findAllByInstallationId).not.toHaveBeenCalled()
    })
  })
})
