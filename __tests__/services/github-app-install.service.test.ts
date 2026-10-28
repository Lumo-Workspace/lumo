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
    deleteForWorkspace: jest.fn().mockResolvedValue({ count: 1 }),
    findRecheckState: jest.fn(),
    renameRepository: jest.fn(),
    findAllForInstallationNarrowing: jest.fn().mockResolvedValue([]),
  },
}))
// LUM-855: uninstall scrubs the workspace's scan code (real-DB coverage in
// __tests__/lib/services/github-app-uninstall-scrub.test.ts).
// LUM-1064: core test, run without the security plugin (the OSS build). The
// scan-code scrub reaches the core only through the plugin retention
// extension point (`retention.scrubRepositoryCode`), so a fake plugin stands
// in there, backed by a local test double named like the scan repository so
// the fail-closed / call-order assertions below read exactly as before. Real
// plugin wiring: __tests__/ee/security/services/*.real-postgres.test.ts.
const mockScrubCodeForWorkspace = jest
  .fn()
  .mockResolvedValue({ scans: 0, findings: 0 })
const prSecurityScanRepository = {
  scrubCodeForWorkspace: mockScrubCodeForWorkspace,
}
jest.mock('@/lib/plugins/installed', () => ({
  INSTALLED_SERVER_PLUGINS: [
    {
      id: 'test-scan-code',
      register(api: import('@/lib/plugins/types').PluginRegistrar) {
        api.retention({
          key: 'testScanCode',
          async scrubRepositoryCode({ workspaceId, repos }) {
            const counts = await mockScrubCodeForWorkspace(workspaceId, repos)
            return { scan: counts.scans, finding: counts.findings }
          },
        })
      },
    },
  ],
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
  listRecentPullRequests: jest.fn(),
  buildAppUserAuthorizeUrl: jest.fn(),
  exchangeAppUserCode: jest.fn(),
  listUserInstallationIds: jest.fn(),
  listUserInstallationRepositories: jest.fn(),
  fetchAppUser: jest.fn(),
  revokeAppUserToken: jest.fn(),
  GithubAppUserAuthNotConfiguredError: class extends Error {},
}))

const mockAudit = jest.fn().mockResolvedValue(true)
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: (...a: unknown[]) => mockAudit(...a),
}))

jest.mock('@/lib/services/github.service', () => ({
  githubService: { backfillPullRequests: jest.fn() },
}))
// LUM-879: every scrub also strips mirrored PR comments (real-DB coverage in
// __tests__/services/github-repository-lifecycle.real-postgres.test.ts).
jest.mock('@/lib/services/pr-comment-code-scrub.service', () => ({
  scrubMirroredCommentCode: jest
    .fn()
    .mockResolvedValue({ comments: 0, jobs: 0 }),
}))

import {
  githubAppInstallService,
  removeInstallation,
} from '@/lib/services/github-app-install.service'
import { SYSTEM_AUDIT_CONTEXT } from '@/lib/services/audit.service'
import { githubService } from '@/lib/services/github.service'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  fetchAppInstallation,
  fetchInstallationRepositories,
  listInstallationRepositories,
  deleteAppInstallation,
  getRepoToken,
  listRecentPullRequests,
  buildAppUserAuthorizeUrl,
  exchangeAppUserCode,
  listUserInstallationIds,
  listUserInstallationRepositories,
  fetchAppUser,
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
    repo.deleteForWorkspace.mockResolvedValue({ count: 1 })
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
    ;(listRecentPullRequests as jest.Mock).mockResolvedValue([])
    ;(exchangeAppUserCode as jest.Mock).mockResolvedValue('user-token')
    ;(listUserInstallationIds as jest.Mock).mockResolvedValue([42])
    ;(listUserInstallationRepositories as jest.Mock).mockResolvedValue([
      'acme-inc/web',
    ])
    ;(fetchAppUser as jest.Mock).mockResolvedValue({
      login: 'octo-admin',
      id: 101,
    })
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
        expect.objectContaining({
          verifier: { login: 'octo-admin', githubId: 101 },
        })
      )

      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 42,
        repositories: ['acme-inc/web'],
        verifierLogin: 'someone-else',
      })
      ;(fetchAppUser as jest.Mock).mockResolvedValue({
        login: 'octo-owner',
        id: 202,
      })
      await githubAppInstallService.reverify({
        workspaceId: 'w1',
        memberRole: 'OWNER',
        userCode: 'code',
        redirectUri: REDIRECT,
      })
      expect(repo.recordVerification).toHaveBeenCalledWith(
        'w1',
        ['acme-inc/web'],
        { login: 'octo-owner', githubId: 202 }
      )
      // The login is read while the token is live; the token still goes.
      expect(fetchAppUser).toHaveBeenCalledWith('user-token')
      expect(revokeAppUserToken).toHaveBeenCalledTimes(2)
    })

    it('writes nothing when the verifier login cannot be read', async () => {
      ;(fetchAppUser as jest.Mock).mockRejectedValue(new Error('502'))
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
        verifier: { login: 'octo-admin', githubId: 101 },
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

      expect(listRecentPullRequests).toHaveBeenCalledWith(
        'repo-token:acme-inc/web',
        'acme-inc/web'
      )
      // LUM-929: linking goes through the ambiguity-checked github service.
      expect(githubService.backfillPullRequests).toHaveBeenCalledWith(
        'w1',
        'acme-inc/web',
        []
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
      expect(listRecentPullRequests).toHaveBeenCalledTimes(1)
      expect(listRecentPullRequests).toHaveBeenCalledWith(
        'repo-token:acme-inc/payroll',
        'acme-inc/payroll'
      )
      // The mint happens after the confirmed list is written.
      expect(repo.upsert.mock.invocationCallOrder[0]).toBeLessThan(
        (getRepoToken as jest.Mock).mock.invocationCallOrder[0] as number
      )
    })

    it('still records the installation when the backfill fails', async () => {
      ;(listRecentPullRequests as jest.Mock).mockRejectedValue(
        new Error('rate limited')
      )

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
      expect(listRecentPullRequests).not.toHaveBeenCalled()
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
      expect(listRecentPullRequests).not.toHaveBeenCalled()
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
      expect(listRecentPullRequests).not.toHaveBeenCalled()
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
      expect(listRecentPullRequests).toHaveBeenCalledTimes(2)
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
      expect(listRecentPullRequests).not.toHaveBeenCalled()
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

    it.each(['created', 'unsuspend', 'new_permissions_accepted'])(
      'LUM-895 installation event narrowing scrubs the dropped repositories first on %s',
      async action => {
        repo.findAllByInstallationId.mockResolvedValue([
          {
            workspaceId: 'w1',
            installationId: 555,
            repositories: ['acme-inc/web', 'acme-inc/old'],
          },
        ])
        const scrub =
          prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock
        const event = {
          action,
          installation: { id: 555 },
          repositories: [{ full_name: 'acme-inc/web' }],
        }

        scrub.mockRejectedValueOnce(new Error('db down'))
        await expect(
          githubAppInstallService.applyInstallationEvent(event)
        ).rejects.toThrow('1 workspace(s) failed')
        expect(repo.upsert).not.toHaveBeenCalled()

        scrub.mockClear()
        await githubAppInstallService.applyInstallationEvent(event)
        expect(scrub).toHaveBeenCalledWith('w1', ['acme-inc/old'])
        expect(scrub.mock.invocationCallOrder[0]).toBeLessThan(
          repo.upsert.mock.invocationCallOrder[0]!
        )
        expect(repo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ repositories: ['acme-inc/web'] })
        )
      }
    )

    it('scrubs nothing when the event narrows nothing', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        { workspaceId: 'w1', installationId: 555, repositories: ['a/b'] },
      ])
      await githubAppInstallService.applyInstallationEvent({
        action: 'unsuspend',
        installation: { id: 555 },
      })
      expect(
        prSecurityScanRepository.scrubCodeForWorkspace
      ).not.toHaveBeenCalled()
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ repositories: ['a/b'] })
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
      repo.findAllByInstallationId.mockResolvedValue([
        { workspaceId: 'w1', installationId: 555, repositories: [] },
      ])
      await githubAppInstallService.applyInstallationEvent({
        action,
        installation: { id: 555 },
      })

      expect(repo.deleteForWorkspace).toHaveBeenCalledWith('w1', 555)
      expect(repo.upsert).not.toHaveBeenCalled()
    })

    it('webhook audit: deleted and suspend record a WEBHOOK SYSTEM event per unbound workspace', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        { workspaceId: 'w1', installationId: 555, repositories: [] },
        { workspaceId: 'w2', installationId: 555, repositories: [] },
      ])
      mockAudit.mockClear()
      await githubAppInstallService.applyInstallationEvent({
        action: 'deleted',
        installation: { id: 555 },
      })
      await githubAppInstallService.applyInstallationEvent({
        action: 'suspend',
        installation: { id: 555 },
      })
      expect(
        mockAudit.mock.calls.map(c => [c[0].workspaceId, c[0].action])
      ).toEqual([
        ['w1', 'github_app.uninstalled'],
        ['w2', 'github_app.uninstalled'],
        ['w1', 'github_app.suspended'],
        ['w2', 'github_app.suspended'],
      ])
      expect(mockAudit.mock.calls[0]![0]).toEqual({
        workspaceId: 'w1',
        action: 'github_app.uninstalled',
        target: { type: 'integration', id: 'github' },
        metadata: { installationId: 555, reason: 'uninstalled on GitHub' },
        context: { actor: { type: 'SYSTEM' }, source: 'WEBHOOK' },
      })
    })

    it('webhook audit: a workspace whose unbind fails is not recorded as uninstalled', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        { workspaceId: 'w1', installationId: 555, repositories: [] },
      ])
      ;(
        prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock
      ).mockRejectedValueOnce(new Error('db down'))
      mockAudit.mockClear()
      await expect(
        githubAppInstallService.applyInstallationEvent({
          action: 'deleted',
          installation: { id: 555 },
        })
      ).rejects.toThrow('1 workspace(s) failed')
      expect(mockAudit).not.toHaveBeenCalled()
    })

    it('webhook audit: the access recheck path records a SYSTEM-source event', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        { workspaceId: 'w9', installationId: 556, repositories: [] },
      ])
      mockAudit.mockClear()
      await removeInstallation(556, 'suspended on GitHub (automatic recheck)', {
        kind: 'suspend',
        context: SYSTEM_AUDIT_CONTEXT,
      })
      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'w9',
          action: 'github_app.suspended',
          context: { actor: { type: 'SYSTEM' }, source: 'SYSTEM' },
        })
      )
    })

    it('ignores a payload with no installation id', async () => {
      await githubAppInstallService.applyInstallationEvent({
        action: 'created',
      })

      expect(repo.deleteForWorkspace).not.toHaveBeenCalled()
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
      // Both spellings: the stored one (what scans carry) and the payload's.
      expect(
        prSecurityScanRepository.scrubCodeForWorkspace
      ).toHaveBeenCalledWith('w1', ['acme-inc/legacy', 'Acme-Inc/Legacy'])
    })

    it('LUM-895 installation_repositories removal scrubs before narrowing', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        {
          workspaceId: 'w1',
          installationId: 555,
          repositories: ['acme-inc/web', 'acme-inc/legacy'],
        },
      ])
      const scrub = prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock
      const event = {
        action: 'removed',
        installation: { id: 555 },
        repositories_removed: [{ full_name: 'acme-inc/legacy' }],
      }

      // A scrub that throws leaves the list as it was: the daily recheck
      // still sees the repository (and finds it unreadable) and retries.
      scrub.mockRejectedValueOnce(new Error('db down'))
      await expect(
        githubAppInstallService.applyInstallationRepositoriesEvent(event)
      ).rejects.toThrow('1 workspace(s) failed')
      expect(repo.updateRepositories).not.toHaveBeenCalled()

      // Succeeding: scrub, narrow, then scrub again for anything in between.
      scrub.mockClear()
      await githubAppInstallService.applyInstallationRepositoriesEvent(event)
      expect(repo.updateRepositories).toHaveBeenCalledWith('w1', [
        'acme-inc/web',
      ])
      expect(scrub).toHaveBeenCalledTimes(2)
      expect(scrub.mock.invocationCallOrder[0]).toBeLessThan(
        repo.updateRepositories.mock.invocationCallOrder[0]!
      )
      expect(scrub.mock.invocationCallOrder[1]).toBeGreaterThan(
        repo.updateRepositories.mock.invocationCallOrder[0]!
      )
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
      expect(listRecentPullRequests).not.toHaveBeenCalled()

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
      expect(repo.deleteForWorkspace).not.toHaveBeenCalled()
    })

    it('deletes the installation on GitHub and locally', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })

      await githubAppInstallService.uninstall('w1', 'OWNER')

      expect(deleteAppInstallation).toHaveBeenCalledWith(555)
      expect(repo.deleteForWorkspace).toHaveBeenCalledWith('w1')
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
      expect(repo.deleteForWorkspace).toHaveBeenCalledWith('w1')
      expect(repo.deleteForWorkspace).not.toHaveBeenCalledWith('w2')
    })

    it('still drops the local row when GitHub refuses the delete', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })
      ;(deleteAppInstallation as jest.Mock).mockRejectedValue(new Error('403'))

      await githubAppInstallService.uninstall('w1', 'OWNER')

      expect(repo.deleteForWorkspace).toHaveBeenCalledWith('w1')
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
        accessRemovedReason: 'access_lost',
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
        accessRemovedReason: 'access_lost',
        tokenFailingSince: null,
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
        { login: 'octo-admin', githubId: 101 }
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
      expect(listRecentPullRequests).toHaveBeenCalledTimes(1)
      expect(listRecentPullRequests).toHaveBeenCalledWith(
        'repo-token:acme-inc/api',
        'acme-inc/api'
      )
      // No user credential outlives the check.
      expect(revokeAppUserToken).toHaveBeenCalledWith('user-token')
    })

    it('LUM-888 reverify scrubs before narrowing, so a failed scrub changes nothing', async () => {
      const scrub = prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock
      scrub.mockRejectedValueOnce(new Error('db down'))

      await expect(githubAppInstallService.reverify(input)).rejects.toThrow(
        'db down'
      )
      // The list still names the repository, so a retry scrubs it.
      expect(repo.recordVerification).not.toHaveBeenCalled()
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

  describe('resolveWorkspacesForRepository', () => {
    it('returns no workspace for an event with no repository', async () => {
      expect(
        await githubAppInstallService.resolveWorkspacesForRepository(555, null)
      ).toEqual([])
      expect(repo.findAllByInstallationId).not.toHaveBeenCalled()
    })

    // LUM-924
    it('returns every workspace that confirmed the repository, in installation order', async () => {
      repo.findAllByInstallationId.mockResolvedValue([
        { workspaceId: 'w-first', repositories: ['Acme/Web'] },
        { workspaceId: 'w-other', repositories: ['acme/api'] },
        { workspaceId: 'w-second', repositories: ['acme/web'] },
      ])
      expect(
        await githubAppInstallService.resolveWorkspacesForRepository(
          555,
          'acme/WEB'
        )
      ).toEqual(['w-first', 'w-second'])
    })
  })
})

describe('LUM-902 — scrub before anything is dropped', () => {
  const scrub = prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock
  const order: string[] = []

  beforeEach(() => {
    jest.clearAllMocks()
    order.length = 0
    scrub.mockImplementation(async (ws: string, repos?: string[]) => {
      order.push(`scrub:${ws}:${repos ? repos.join(',') : 'all'}`)
      return { scans: 1, findings: 1 }
    })
    repo.upsert.mockImplementation(async (data: { workspaceId: string }) => {
      order.push(`upsert:${data.workspaceId}`)
      return { workspaceId: data.workspaceId, installationId: 77 }
    })
    repo.deleteForWorkspace.mockImplementation(async (ws: string) => {
      order.push(`delete:${ws}`)
      return { count: 1 }
    })
    repo.findAllByInstallationId.mockResolvedValue([])
    ;(fetchAppInstallation as jest.Mock).mockResolvedValue({
      accountLogin: 'acme-inc',
      accountType: 'Organization',
    })
    ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
      'acme-inc/web',
    ])
    ;(getRepoToken as jest.Mock).mockResolvedValue('repo-token')
    ;(listRecentPullRequests as jest.Mock).mockResolvedValue([])
    ;(exchangeAppUserCode as jest.Mock).mockResolvedValue('user-token')
    ;(listUserInstallationIds as jest.Mock).mockResolvedValue([77])
    ;(listUserInstallationRepositories as jest.Mock).mockResolvedValue([
      'acme-inc/web',
    ])
    ;(fetchAppUser as jest.Mock).mockResolvedValue({ login: 'octo', id: 1 })
    ;(revokeAppUserToken as jest.Mock).mockResolvedValue(undefined)
  })

  const install = () =>
    githubAppInstallService.install({
      workspaceId: 'w1',
      memberId: 'm1',
      installationId: 77,
      userCode: 'code',
      redirectUri: REDIRECT,
    })

  it('reinstall scrubs repositories dropped from the confirmed list before writing', async () => {
    // Bound to another installation; `Acme-Inc/Web` survives (case-insensitive).
    repo.findByWorkspace.mockResolvedValue({
      id: 'i1',
      workspaceId: 'w1',
      installationId: 55,
      repositories: ['Acme-Inc/Web', 'other-org/api'],
    })

    await install()

    expect(order).toEqual([
      'scrub:w1:other-org/api',
      'upsert:w1',
      'scrub:w1:other-org/api',
    ])

    // A scrub that throws writes nothing: the old list stays in place.
    jest.clearAllMocks()
    order.length = 0
    scrub.mockRejectedValueOnce(new Error('P2028'))
    await expect(install()).rejects.toThrow('P2028')
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it('first install on an unbound workspace scrubs nothing', async () => {
    repo.findByWorkspace.mockResolvedValue(null)
    await install()
    expect(order).toEqual(['upsert:w1'])
  })

  it('removal scrubs before deleting and survives a failing workspace', async () => {
    repo.findAllByInstallationId.mockResolvedValue([
      { workspaceId: 'w1', installationId: 77, repositories: [] },
      { workspaceId: 'w2', installationId: 77, repositories: [] },
      { workspaceId: 'w3', installationId: 77, repositories: [] },
    ])
    scrub.mockImplementation(async (ws: string) => {
      if (ws === 'w2') throw new Error('P2028')
      order.push(`scrub:${ws}`)
      return { scans: 1, findings: 1 }
    })

    // deleted webhook: w2's scrub throws, its row stays, w3 still runs, and
    // the delivery still fails as a whole.
    await expect(
      githubAppInstallService.applyInstallationEvent({
        action: 'deleted',
        installation: { id: 77 },
      })
    ).rejects.toThrow('1 workspace(s) failed')
    expect(order).toEqual([
      'scrub:w1',
      'delete:w1',
      'scrub:w1',
      'scrub:w3',
      'delete:w3',
      'scrub:w3',
    ])
    expect(repo.deleteForWorkspace).toHaveBeenCalledWith('w1', 77)
    expect(repo.deleteForWorkspace).not.toHaveBeenCalledWith('w2', 77)

    // suspend now cleans up the same way.
    order.length = 0
    scrub.mockImplementation(async (ws: string) => {
      order.push(`scrub:${ws}`)
      return { scans: 1, findings: 1 }
    })
    repo.findAllByInstallationId.mockResolvedValue([
      { workspaceId: 'w2', installationId: 77, repositories: [] },
    ])
    await githubAppInstallService.applyInstallationEvent({
      action: 'suspend',
      installation: { id: 77 },
    })
    expect(order).toEqual(['scrub:w2', 'delete:w2', 'scrub:w2'])

    // uninstall: a failing scrub keeps the row and the App on GitHub.
    jest.clearAllMocks()
    repo.findByWorkspace.mockResolvedValue({
      id: 'i1',
      workspaceId: 'w1',
      installationId: 77,
      repositories: [],
    })
    repo.findAllByInstallationId.mockResolvedValue([
      { workspaceId: 'w1', installationId: 77, repositories: [] },
    ])
    scrub.mockRejectedValueOnce(new Error('P2028'))
    await expect(
      githubAppInstallService.uninstall('w1', 'OWNER')
    ).rejects.toThrow('P2028')
    expect(repo.deleteForWorkspace).not.toHaveBeenCalled()
    expect(deleteAppInstallation).not.toHaveBeenCalled()

    // installation_repositories: one workspace failing does not stop the next.
    scrub.mockReset()
    scrub.mockImplementation(async (ws: string) => {
      if (ws === 'w1') throw new Error('P2028')
      return { scans: 1, findings: 1 }
    })
    repo.findAllByInstallationId.mockResolvedValue([
      { workspaceId: 'w1', installationId: 77, repositories: ['acme-inc/a'] },
      { workspaceId: 'w2', installationId: 77, repositories: ['acme-inc/a'] },
    ])
    await expect(
      githubAppInstallService.applyInstallationRepositoriesEvent({
        action: 'removed',
        installation: { id: 77 },
        repositories_removed: [{ full_name: 'acme-inc/a' }],
      })
    ).rejects.toThrow('1 workspace(s) failed')
    expect(repo.updateRepositories).toHaveBeenCalledTimes(1)
    expect(repo.updateRepositories).toHaveBeenCalledWith('w2', [])
  })
})

describe('LUM-879 repository rename and removal', () => {
  const STAMP = new Date('2026-10-01T00:00:00Z')

  beforeEach(() => {
    jest.clearAllMocks()
    // Earlier blocks leave failing implementations behind.
    ;(prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock).mockReset()
    ;(
      prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock
    ).mockResolvedValue({ scans: 0, findings: 0 })
    repo.updateRepositories.mockReset()
    repo.findAllByInstallationId.mockResolvedValue([
      { workspaceId: 'w1', installationId: 77, repositories: ['Acme/Web'] },
    ])
  })

  it('renameRepository rewrites the list in the stored spelling with the canonical new name', async () => {
    repo.findRecheckState.mockResolvedValue({
      repositories: ['Acme/Web', 'acme/api'],
      updatedAt: STAMP,
    })
    repo.renameRepository.mockResolvedValue({ pullRequests: 2, skipped: 0 })
    await githubAppInstallService.renameRepository(
      77,
      'acme/web',
      'Acme/Web-App'
    )
    expect(repo.renameRepository).toHaveBeenCalledWith('w1', {
      expectedUpdatedAt: STAMP,
      repositories: ['Acme/Web-App', 'acme/api'],
      // LUM-1330: the old name is remembered for clones that still use it.
      repositoryAliases: { 'acme/web': 'Acme/Web-App' },
      from: 'Acme/Web',
      to: 'Acme/Web-App',
    })
  })

  it('LUM-1330 renameRepository keeps earlier aliases and points them at the new name', async () => {
    repo.findRecheckState.mockResolvedValue({
      repositories: ['acme/web'],
      repositoryAliases: { 'acme/site': 'acme/web', 'acme/x': 'acme/y' },
      updatedAt: STAMP,
    })
    repo.renameRepository.mockResolvedValue({ pullRequests: 0, skipped: 0 })
    await githubAppInstallService.renameRepository(77, 'acme/web', 'acme/www')
    expect(repo.renameRepository).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        repositoryAliases: {
          'acme/site': 'acme/www',
          'acme/x': 'acme/y',
          'acme/web': 'acme/www',
        },
      })
    )
  })

  it('renameRepository leaves a workspace that never confirmed the old name alone', async () => {
    repo.findRecheckState.mockResolvedValue({
      repositories: ['acme/api'],
      updatedAt: STAMP,
    })
    await githubAppInstallService.renameRepository(77, 'acme/web', 'acme/www')
    expect(repo.renameRepository).not.toHaveBeenCalled()
  })

  it('renameRepository retries a lost write race once, then fails the event', async () => {
    repo.findRecheckState.mockResolvedValue({
      repositories: ['Acme/Web'],
      updatedAt: STAMP,
    })
    repo.renameRepository.mockResolvedValue(null)
    await expect(
      githubAppInstallService.renameRepository(77, 'acme/web', 'acme/www')
    ).rejects.toThrow('1 workspace(s) failed')
    expect(repo.renameRepository).toHaveBeenCalledTimes(2)
  })

  it('removeRepository without an installation narrows every workspace that confirmed it', async () => {
    repo.findAllForInstallationNarrowing.mockResolvedValue([
      { workspaceId: 'w1', installationId: 77, repositories: ['Acme/Lib'] },
      { workspaceId: 'w2', installationId: 78, repositories: ['other/x'] },
      {
        workspaceId: 'w3',
        installationId: 77,
        repositories: ['acme/lib', 'a/b'],
      },
    ])
    await githubAppInstallService.removeRepository(
      ['acme/lib'],
      'repository transferred to another owner on GitHub'
    )
    expect(repo.findAllByInstallationId).not.toHaveBeenCalled()
    expect(repo.updateRepositories).toHaveBeenCalledTimes(2)
    expect(repo.updateRepositories).toHaveBeenCalledWith('w1', [])
    expect(repo.updateRepositories).toHaveBeenCalledWith('w3', ['a/b'])
    // Scrubbed under both spellings, before and after the write.
    expect(prSecurityScanRepository.scrubCodeForWorkspace).toHaveBeenCalledWith(
      'w1',
      ['Acme/Lib', 'acme/lib']
    )
  })

  it('removeRepository with an installation only looks at its workspaces', async () => {
    await githubAppInstallService.removeRepository(
      ['acme/web'],
      'repository deleted on GitHub',
      77
    )
    expect(repo.findAllByInstallationId).toHaveBeenCalledWith(77)
    expect(repo.findAllForInstallationNarrowing).not.toHaveBeenCalled()
    expect(repo.updateRepositories).toHaveBeenCalledWith('w1', [])
  })
})
