/**
 * @jest-environment node
 *
 * LUM-927 — the daily access recheck's last gaps: an installation GitHub
 * reports active that never yields a token (alerted, shown on the card), the
 * removal breaker against a mass "404" from misconfigured credentials, and
 * narrowing every row to what its installation contains now.
 */
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    findAllWithVerifier: jest.fn(),
    findAllByInstallationId: jest.fn(),
    findRecheckState: jest.fn(),
    updateRecheckIfUnchanged: jest.fn(),
    markRecheckAttempted: jest.fn(),
    findAllForInstallationNarrowing: jest.fn(),
    updateRepositoriesIfUnchanged: jest.fn(),
    markTokenFailing: jest.fn(),
    clearTokenFailing: jest.fn(),
    findStatusByWorkspace: jest.fn(),
  },
  prSecurityScanRepository: {},
}))
jest.mock('@/lib/integrations/github', () => ({
  createInstallationToken: jest.fn(),
  fetchInstallationRepositories: jest.fn(),
  findAppInstallationStatus: jest.fn(),
  checkRepositoryReadAccess: jest.fn(),
  lookupGitHubUser: jest.fn(),
  INSTALLATION_TOKEN_PERMISSIONS: jest.requireActual(
    '@/lib/integrations/github/token-permissions'
  ).INSTALLATION_TOKEN_PERMISSIONS,
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  ...jest.requireActual('@/lib/services/github-app-install.service'),
  scrubWorkspaceCode: jest.fn().mockResolvedValue({ scans: 0, findings: 0 }),
  scrubAfterNarrowing: jest.fn(),
  removeInstallation: jest.fn(),
}))

import {
  githubAccessRecheckService,
  breakerTripped,
} from '@/lib/services/github-access-recheck.service'
import { TOKEN_FAILING_ALERT_MS } from '@/lib/services/github-access-recheck.config'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  createInstallationToken,
  fetchInstallationRepositories,
  findAppInstallationStatus,
  checkRepositoryReadAccess,
  lookupGitHubUser,
} from '@/lib/integrations/github'
import {
  scrubWorkspaceCode,
  scrubAfterNarrowing,
  removeInstallation,
} from '@/lib/services/github-app-install.service'
import { logger } from '@/lib/logger'

type MockedRepo = {
  [K in keyof typeof githubAppInstallationRepository]: jest.Mock
}
const repo = githubAppInstallationRepository as unknown as MockedRepo
const mint = createInstallationToken as jest.Mock
const live = fetchInstallationRepositories as jest.Mock
const status = findAppInstallationStatus as jest.Mock
const remove = removeInstallation as jest.Mock
const scrub = scrubWorkspaceCode as jest.Mock

const VERSION = new Date('2026-09-27T00:00:00Z')
const NOW = new Date('2026-10-01T00:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000

function row(installationId: number, repositories = ['acme/api']) {
  return {
    workspaceId: `w${installationId}`,
    installationId,
    repositories,
    verifierLogin: 'octo',
    verifierGithubId: 7,
    verifiedAt: VERSION,
    accessCheckCursor: null,
  }
}

/** Installations whose token mint fails; every other one succeeds. */
function failMint(ids: number[]) {
  mint.mockImplementation(async (id: number) => {
    if (ids.includes(id)) throw new Error('Not Found')
    return 'inst-token'
  })
}

function opsAlerts(): string[] {
  return (logger.error as jest.Mock).mock.calls
    .map(call => String(call[0]))
    .filter(line => line.startsWith('[ops-alert]'))
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(logger, 'error').mockImplementation(() => {})
  jest.spyOn(logger, 'info').mockImplementation(() => {})
  failMint([])
  live.mockResolvedValue(['acme/api'])
  ;(lookupGitHubUser as jest.Mock).mockResolvedValue({ id: 7, login: 'octo' })
  ;(checkRepositoryReadAccess as jest.Mock).mockResolvedValue({
    access: 'readable',
    remaining: 4000,
  })
  repo.findAllForInstallationNarrowing.mockResolvedValue([])
  repo.findRecheckState.mockResolvedValue({
    repositories: ['acme/api'],
    verifierLogin: 'octo',
    verifiedAt: VERSION,
    accessRemovedCount: 0,
    updatedAt: VERSION,
  })
  repo.updateRecheckIfUnchanged.mockResolvedValue(true)
  repo.updateRepositoriesIfUnchanged.mockResolvedValue(true)
  remove.mockResolvedValue({ removed: 1, failed: 0 })
})

describe('LUM-927 token that keeps failing on an active installation', () => {
  it('LUM-927 token failing past three days raises an ops alert and the status carries the failure start', async () => {
    const since = new Date(NOW - 4 * DAY)
    repo.findAllWithVerifier.mockResolvedValue([row(42), row(43)])
    failMint([42])
    status.mockResolvedValue('active')
    repo.markTokenFailing.mockResolvedValue(since)

    const summary = await githubAccessRecheckService.sweep(() => NOW)

    // Recorded against the installation, not removed, and alerted on.
    expect(repo.markTokenFailing).toHaveBeenCalledWith(42, new Date(NOW))
    expect(remove).not.toHaveBeenCalled()
    expect(summary.tokenFailing).toBe(1)
    const alerts = opsAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toContain('installation 42')
    expect(alerts[0]).toContain(since.toISOString())
    // The healthy installation's failure run (if any) ends.
    expect(repo.clearTokenFailing).toHaveBeenCalledWith(43)
    expect(repo.clearTokenFailing).not.toHaveBeenCalledWith(42)

    // The settings card gets the start of the run, for every member.
    repo.findStatusByWorkspace.mockResolvedValue({
      installationId: 42,
      accountLogin: 'acme',
      accountType: 'Organization',
      repositories: ['acme/api'],
      createdAt: VERSION,
      verifierLogin: 'octo',
      accessRemovedCount: 0,
      accessRemovedAt: null,
      accessRemovedReason: null,
      tokenFailingSince: since,
    })
    const card = await githubAppInstallService.getStatus('w42', 'MEMBER')
    expect(card).toMatchObject({ tokenFailingSince: since.toISOString() })
  })

  it('stays quiet while the failure run is younger than three days', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row(42), row(43)])
    failMint([42])
    status.mockResolvedValue('active')
    repo.markTokenFailing.mockResolvedValue(new Date(NOW - DAY))

    await githubAccessRecheckService.sweep(() => NOW)

    expect(opsAlerts()).toEqual([])
  })

  it('does not count GitHub not answering as a failure run', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row(42)])
    failMint([42])
    status.mockResolvedValue('unknown')

    const summary = await githubAccessRecheckService.sweep(() => NOW)

    expect(repo.markTokenFailing).not.toHaveBeenCalled()
    expect(summary.tokenFailing).toBe(0)
  })

  it('hides a young failure run from the settings card', async () => {
    repo.findStatusByWorkspace.mockResolvedValue({
      installationId: 42,
      accountLogin: 'acme',
      accountType: 'Organization',
      repositories: [],
      createdAt: VERSION,
      verifierLogin: 'octo',
      accessRemovedCount: 0,
      accessRemovedAt: null,
      accessRemovedReason: null,
      tokenFailingSince: new Date(Date.now() - TOKEN_FAILING_ALERT_MS + DAY),
    })
    const card = await githubAppInstallService.getStatus('w42', 'MEMBER')
    expect(card).toMatchObject({ tokenFailingSince: null })
  })
})

describe('LUM-927 removal breaker', () => {
  it('LUM-927 breaker holds every removal when too many installations are gone', async () => {
    // Another App's credentials: every installation 404s.
    repo.findAllWithVerifier.mockResolvedValue([row(1), row(2), row(3)])
    failMint([1, 2, 3])
    status.mockResolvedValue('gone')

    const summary = await githubAccessRecheckService.sweep(() => NOW)

    expect(remove).not.toHaveBeenCalled()
    expect(scrub).not.toHaveBeenCalled()
    expect(summary.held).toEqual([1, 2, 3])
    expect(summary.uninstalled).toBe(0)
    const alerts = opsAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toContain('breaker')
    expect(alerts[0]).toContain('1, 2, 3')

    // Over the ratio with healthy installations alongside: still held.
    jest.clearAllMocks()
    remove.mockResolvedValue({ removed: 1, failed: 0 })
    repo.findAllWithVerifier.mockResolvedValue(
      [1, 2, 3, 4, 5].map(id => row(id))
    )
    failMint([1, 2])
    const second = await githubAccessRecheckService.sweep(() => NOW)
    expect(remove).not.toHaveBeenCalled()
    expect(second.held).toEqual([1, 2])
  })

  it('LUM-927 one gone installation among healthy ones is still removed', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row(1), row(2), row(3)])
    failMint([2])
    status.mockResolvedValue('gone')

    const summary = await githubAccessRecheckService.sweep(() => NOW)

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(
      2,
      'uninstalled on GitHub (automatic recheck)',
      {
        kind: 'deleted',
        context: { actor: { type: 'SYSTEM' }, source: 'SYSTEM' },
      }
    )
    expect(summary).toMatchObject({ uninstalled: 1, held: [] })
    expect(opsAlerts()).toEqual([])
  })

  it('a lone installation that is gone is held when nothing yielded a token', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row(1)])
    failMint([1])
    status.mockResolvedValue('gone')

    const summary = await githubAccessRecheckService.sweep(() => NOW)

    expect(remove).not.toHaveBeenCalled()
    expect(summary.held).toEqual([1])
  })

  it('removes exactly the installations an operator confirmed after a trip', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row(1), row(2), row(3)])
    failMint([1, 2, 3])
    status.mockResolvedValue('gone')

    const summary = await githubAccessRecheckService.sweep(() => NOW, {
      confirmRemovals: [2],
    })

    expect(remove.mock.calls.map(call => call[0])).toEqual([2])
    expect(summary.held).toEqual([1, 3])
  })

  it('breakerTripped draws the line at two and a fifth', () => {
    expect(breakerTripped(0, 5, 0)).toBe(false)
    expect(breakerTripped(1, 5, 4)).toBe(false)
    expect(breakerTripped(2, 10, 8)).toBe(false)
    expect(breakerTripped(2, 9, 7)).toBe(true)
    expect(breakerTripped(1, 1, 0)).toBe(true)
  })
})

describe('LUM-927 narrowing to the installation', () => {
  it('LUM-927 verifier-less row narrows to the installation live list after scrubbing', async () => {
    repo.findAllWithVerifier.mockResolvedValue([])
    repo.findAllForInstallationNarrowing.mockResolvedValue([
      {
        workspaceId: 'legacy',
        installationId: 9,
        repositories: ['Acme/API', 'acme/gone', 'acme/web'],
        updatedAt: VERSION,
      },
    ])
    live.mockResolvedValue(['acme/api', 'acme/web'])
    const order: string[] = []
    scrub.mockImplementation(async () => {
      order.push('scrub')
      return { scans: 1, findings: 1 }
    })
    repo.updateRepositoriesIfUnchanged.mockImplementation(async () => {
      order.push('write')
      return true
    })

    const summary = await githubAccessRecheckService.sweep(() => NOW)

    expect(scrub).toHaveBeenCalledWith(
      'legacy',
      expect.stringContaining('no longer in the installation'),
      ['acme/gone']
    )
    expect(repo.updateRepositoriesIfUnchanged).toHaveBeenCalledWith(
      'legacy',
      VERSION,
      ['Acme/API', 'acme/web']
    )
    expect(order).toEqual(['scrub', 'write'])
    expect(scrubAfterNarrowing).toHaveBeenCalledWith(
      'legacy',
      expect.any(String),
      ['acme/gone']
    )
    expect(summary.narrowed).toBe(1)

    // GitHub's list unreadable: the row is left as it is.
    jest.clearAllMocks()
    live.mockRejectedValue(new Error('502'))
    status.mockResolvedValue('unknown')
    await githubAccessRecheckService.sweep(() => NOW)
    expect(scrub).not.toHaveBeenCalled()
    expect(repo.updateRepositoriesIfUnchanged).not.toHaveBeenCalled()
  })

  it('narrows a verifier row too, with the version read after the recheck', async () => {
    repo.findAllWithVerifier.mockResolvedValue([
      row(5, ['acme/api', 'acme/pub']),
    ])
    const after = new Date(NOW)
    repo.findAllForInstallationNarrowing.mockResolvedValue([
      {
        workspaceId: 'w5',
        installationId: 5,
        repositories: ['acme/api', 'acme/pub'],
        updatedAt: after,
      },
    ])
    live.mockResolvedValue(['acme/api'])

    await githubAccessRecheckService.sweep(() => NOW)

    expect(repo.updateRepositoriesIfUnchanged).toHaveBeenCalledWith(
      'w5',
      after,
      ['acme/api']
    )
  })

  it('a lost write race scrubs nothing more and narrows nothing', async () => {
    repo.findAllWithVerifier.mockResolvedValue([])
    repo.findAllForInstallationNarrowing.mockResolvedValue([
      {
        workspaceId: 'legacy',
        installationId: 9,
        repositories: ['acme/api', 'acme/gone'],
        updatedAt: VERSION,
      },
    ])
    repo.updateRepositoriesIfUnchanged.mockResolvedValue(false)

    const summary = await githubAccessRecheckService.sweep(() => NOW)

    expect(scrubAfterNarrowing).not.toHaveBeenCalled()
    expect(summary.narrowed).toBe(0)
  })

  it('an installation already found failing is not asked for its list', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row(42)])
    repo.findAllForInstallationNarrowing.mockResolvedValue([
      {
        workspaceId: 'w42',
        installationId: 42,
        repositories: ['acme/api'],
        updatedAt: VERSION,
      },
    ])
    failMint([42])
    status.mockResolvedValue('unknown')

    await githubAccessRecheckService.sweep(() => NOW)

    expect(live).not.toHaveBeenCalled()
  })
})
