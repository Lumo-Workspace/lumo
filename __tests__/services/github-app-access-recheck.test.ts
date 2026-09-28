/**
 * @jest-environment node
 *
 * LUM-882 — the verifier access recheck: narrowing a workspace's confirmed
 * GitHub repositories to what its verifier can still read, asked with the
 * installation token only.
 */
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    findAllWithVerifier: jest.fn(),
    findAllByInstallationId: jest.fn(),
    findRecheckState: jest.fn(),
    updateRecheckIfUnchanged: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/github', () => ({
  createInstallationToken: jest.fn(),
  checkRepositoryReadAccess: jest.fn(),
  lookupGitHubUser: jest.fn(),
  INSTALLATION_TOKEN_PERMISSIONS: jest.requireActual(
    '@/lib/integrations/github/token-permissions'
  ).INSTALLATION_TOKEN_PERMISSIONS,
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  scrubWorkspaceCode: jest.fn().mockResolvedValue({ scans: 0, findings: 0 }),
}))

import {
  githubAccessRecheckService,
  narrowConfirmed,
} from '@/lib/services/github-access-recheck.service'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  createInstallationToken,
  checkRepositoryReadAccess,
  lookupGitHubUser,
} from '@/lib/integrations/github'
import { scrubWorkspaceCode } from '@/lib/services/github-app-install.service'

type MockedRepo = {
  [K in keyof typeof githubAppInstallationRepository]: jest.Mock
}
const repo = githubAppInstallationRepository as unknown as MockedRepo
const access = checkRepositoryReadAccess as jest.Mock

type Access = 'readable' | 'unreadable' | 'rate_limited' | 'unknown'

/** GitHub's answer per repository name (lower-cased), default readable. */
function answers(map: Record<string, Access>, remaining = 4000) {
  access.mockImplementation(async (_token: string, name: string) => ({
    access: map[name.toLowerCase()] ?? 'readable',
    remaining,
  }))
}

const VERSION = new Date('2026-09-27T00:00:00Z')

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspaceId: 'w1',
    installationId: 42,
    repositories: ['acme/api', 'acme/web', 'acme/payroll'],
    verifierLogin: 'octo',
    verifierGithubId: null,
    verifiedAt: VERSION,
    accessCheckCursor: null,
    ...overrides,
  }
}

/**
 * What the service wrote, in the shape (workspace, removed names, cursor) —
 * `cursor` is `undefined` when the write left it alone.
 */
const applied = jest.fn()

/**
 * A row whose current confirmed list is `current`; writes always land.
 * `verifiedAt` per workspace stands for a re-verification since the read.
 */
function applyLikeTheRow(
  current: string[],
  verifiedAt: Record<string, Date> = {}
) {
  repo.findRecheckState.mockImplementation(async (ws: string) => ({
    repositories: current,
    verifierLogin: 'octo',
    verifiedAt: verifiedAt[ws] ?? VERSION,
    accessRemovedCount: 0,
    updatedAt: VERSION,
  }))
  repo.updateRecheckIfUnchanged.mockImplementation(
    async (
      ws: string,
      _expected: unknown,
      data: { repositories: string[]; accessCheckCursor?: string | null }
    ) => {
      const kept = new Set(data.repositories)
      applied(
        ws,
        current.filter(n => !kept.has(n)),
        'accessCheckCursor' in data ? data.accessCheckCursor : undefined
      )
      return true
    }
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(createInstallationToken as jest.Mock).mockResolvedValue('inst-token')
  // Legacy rows are looked up by login, rows with an id by id.
  ;(lookupGitHubUser as jest.Mock).mockImplementation(
    async (_token: string, who: { id?: number; login?: string }) =>
      who.id !== undefined
        ? { id: who.id, login: 'octo' }
        : { id: 7, login: who.login }
  )
  repo.findAllByInstallationId.mockResolvedValue([])
  applyLikeTheRow(row().repositories as string[])
  answers({})
})

describe('recheck narrows to what the verifier can still read', () => {
  it('removes unreadable repositories, keeps readable ones and scrubs only the removed', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    applyLikeTheRow(row().repositories as string[])
    answers({ 'acme/payroll': 'unreadable' })

    const summary = await githubAccessRecheckService.sweep()

    // Asked with the installation token, about the verifier's login.
    expect(createInstallationToken).toHaveBeenCalledWith(42, {
      metadata: 'read',
    })
    expect(access).toHaveBeenCalledWith('inst-token', 'acme/web', 'octo')
    expect(access).toHaveBeenCalledTimes(3)
    expect(applied).toHaveBeenCalledWith('w1', ['acme/payroll'], null)
    expect(scrubWorkspaceCode).toHaveBeenCalledWith('w1', expect.any(String), [
      'acme/payroll',
    ])
    expect(summary).toMatchObject({ workspaces: 1, checked: 3, removed: 1 })
  })

  it('keeps a repository GitHub failed to answer for', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    applyLikeTheRow(row().repositories as string[])
    answers({ 'acme/web': 'unknown' })

    await githubAccessRecheckService.sweep()

    expect(applied).toHaveBeenCalledWith('w1', [], null)
    expect(scrubWorkspaceCode).not.toHaveBeenCalled()
  })

  it('removes nothing from a batch cut by the rate limit and resumes before it', async () => {
    const names = Array.from(
      { length: 12 },
      (_, i) => `acme/r${String(i).padStart(2, '0')}`
    )
    repo.findAllWithVerifier.mockResolvedValue([row({ repositories: names })])
    applyLikeTheRow(names)
    // r03 unreadable in the first (complete) batch; r09 unreadable but its
    // batch hits the limit, so it must not be removed on a partial answer.
    answers({
      'acme/r03': 'unreadable',
      'acme/r09': 'unreadable',
      'acme/r10': 'rate_limited',
    })

    const summary = await githubAccessRecheckService.sweep()

    expect(applied).toHaveBeenCalledWith('w1', ['acme/r03'], 'acme/r07')
    expect(summary).toMatchObject({ checked: 8, removed: 1, paused: 1 })
  })

  it('pauses before the rate-limit reserve and resumes after the cursor next run', async () => {
    const names = Array.from(
      { length: 12 },
      (_, i) => `acme/r${String(i).padStart(2, '0')}`
    )
    repo.findAllWithVerifier.mockResolvedValue([row({ repositories: names })])
    applyLikeTheRow(names)
    answers({}, 900)

    await githubAccessRecheckService.sweep()
    expect(applied).toHaveBeenLastCalledWith('w1', [], 'acme/r07')

    access.mockClear()
    answers({ 'acme/r11': 'unreadable' })
    repo.findAllWithVerifier.mockResolvedValue([
      row({ repositories: names, accessCheckCursor: 'acme/r07' }),
    ])
    await githubAccessRecheckService.sweep()

    expect(access.mock.calls.map(c => c[1])).toEqual([
      'acme/r08',
      'acme/r09',
      'acme/r10',
      'acme/r11',
    ])
    expect(applied).toHaveBeenLastCalledWith('w1', ['acme/r11'], null)
  })

  it('stops at the time budget and keeps the rest for the next run', async () => {
    const names = Array.from(
      { length: 12 },
      (_, i) => `acme/r${String(i).padStart(2, '0')}`
    )
    repo.findAllWithVerifier.mockResolvedValue([row({ repositories: names })])
    applyLikeTheRow(names)
    let t = 0
    const realNow = Date.now
    // The sweep's deadline comes from its clock; the row loop reads Date.now.
    Date.now = () => t
    access.mockImplementation(async () => {
      t = 300_000
      return { access: 'readable', remaining: 4000 }
    })
    try {
      await githubAccessRecheckService.sweep(() => 0)
    } finally {
      Date.now = realNow
    }
    expect(applied).toHaveBeenCalledWith('w1', [], 'acme/r07')
  })

  it('lets the other workspaces of a rate-limited installation wait for the next run', async () => {
    repo.findAllWithVerifier.mockResolvedValue([
      row(),
      row({ workspaceId: 'w2' }),
    ])
    applyLikeTheRow(row().repositories as string[])
    answers({ 'acme/api': 'rate_limited' })

    const summary = await githubAccessRecheckService.sweep()

    expect(applied).toHaveBeenCalledTimes(1)
    expect(summary).toMatchObject({ workspaces: 1, skipped: 1, removed: 0 })
  })

  it('discards the result when an owner re-verified during the run', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    applyLikeTheRow(row().repositories as string[], {
      w1: new Date('2026-09-27T02:00:00Z'),
    })
    answers({ 'acme/payroll': 'unreadable' })

    await githubAccessRecheckService.sweep()

    expect(scrubWorkspaceCode).not.toHaveBeenCalled()
  })
})

describe('verifier gone empties the list and legacy rows are skipped', () => {
  it('removes every repository when the verifier can read none of them', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    applyLikeTheRow(row().repositories as string[])
    answers({
      'acme/api': 'unreadable',
      'acme/web': 'unreadable',
      'acme/payroll': 'unreadable',
    })

    await githubAccessRecheckService.sweep()

    expect(applied).toHaveBeenCalledWith(
      'w1',
      ['acme/api', 'acme/web', 'acme/payroll'],
      null
    )
    expect(scrubWorkspaceCode).toHaveBeenCalledWith('w1', expect.any(String), [
      'acme/api',
      'acme/web',
      'acme/payroll',
    ])
  })

  it('empties the list in one step when the verifier account no longer exists', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    applyLikeTheRow(row().repositories as string[])
    ;(lookupGitHubUser as jest.Mock).mockResolvedValue('gone')

    await githubAccessRecheckService.sweep()

    expect(access).not.toHaveBeenCalled()
    expect(applied).toHaveBeenCalledWith(
      'w1',
      ['acme/api', 'acme/web', 'acme/payroll'],
      null
    )
    expect(scrubWorkspaceCode).toHaveBeenCalledTimes(1)
  })

  it('changes nothing when GitHub cannot say whether the verifier exists', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    ;(lookupGitHubUser as jest.Mock).mockResolvedValue(null)

    await githubAccessRecheckService.sweep()

    expect(applied).not.toHaveBeenCalled()
    expect(scrubWorkspaceCode).not.toHaveBeenCalled()
  })

  it('skips installations with no verifier login on record', async () => {
    // The sweep only reads rows with a login; a stray one without is skipped.
    repo.findAllWithVerifier.mockResolvedValue([row({ verifierLogin: null })])

    const summary = await githubAccessRecheckService.sweep()

    expect(access).not.toHaveBeenCalled()
    expect(applied).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ workspaces: 0, skipped: 1 })
  })

  it('leaves a legacy row alone on a targeted recheck', async () => {
    repo.findAllByInstallationId.mockResolvedValue([
      row({ verifierLogin: null }),
    ])
    answers({ 'acme/web': 'unreadable' })

    await githubAccessRecheckService.recheckRepository(42, 'acme/web')

    expect(access).not.toHaveBeenCalled()
    expect(applied).not.toHaveBeenCalled()
  })
})

describe('targeted repository recheck', () => {
  it('rechecks one repository in every workspace bound to the installation', async () => {
    repo.findAllByInstallationId.mockResolvedValue([
      row(),
      row({ workspaceId: 'w2', verifierLogin: 'other' }),
      row({ workspaceId: 'w3', repositories: ['acme/api'] }),
    ])
    applyLikeTheRow(['Acme/Web'])
    answers({ 'acme/web': 'unreadable' })

    const result = await githubAccessRecheckService.recheckRepository(
      42,
      'Acme/Web'
    )

    expect(access).toHaveBeenCalledWith('inst-token', 'Acme/Web', 'octo')
    expect(access).toHaveBeenCalledWith('inst-token', 'Acme/Web', 'other')
    expect(access).toHaveBeenCalledTimes(2)
    // A targeted recheck never moves a running sweep's cursor.
    expect(applied).toHaveBeenCalledWith('w1', ['Acme/Web'], undefined)
    expect(result).toEqual({ removed: 2 })
  })
})

describe('recheck writes against the current row', () => {
  it('retries once when the row changed under it, then discards', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    repo.findRecheckState.mockResolvedValue({
      repositories: ['acme/api', 'acme/web', 'acme/payroll'],
      verifierLogin: 'octo',
      verifiedAt: VERSION,
      accessRemovedCount: 0,
      updatedAt: VERSION,
    })
    repo.updateRecheckIfUnchanged.mockResolvedValue(false)
    answers({ 'acme/payroll': 'unreadable' })

    await githubAccessRecheckService.sweep()

    expect(repo.findRecheckState).toHaveBeenCalledTimes(2)
    expect(repo.updateRecheckIfUnchanged).toHaveBeenCalledTimes(2)
    // LUM-888 — the code went before the (lost) write, and only once: the
    // retry does not scrub the same repository again.
    expect(scrubWorkspaceCode).toHaveBeenCalledTimes(1)
  })

  it('writes against the re-read version and adds to the removal count', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    const reread = new Date('2026-09-27T01:00:00Z')
    repo.findRecheckState.mockResolvedValue({
      repositories: ['acme/web', 'acme/payroll'],
      verifierLogin: 'octo',
      verifiedAt: VERSION,
      accessRemovedCount: 2,
      updatedAt: reread,
    })
    repo.updateRecheckIfUnchanged.mockResolvedValue(true)
    answers({ 'acme/payroll': 'unreadable' })

    await githubAccessRecheckService.sweep()

    const [ws, expected, data] = repo.updateRecheckIfUnchanged.mock.calls[0]
    expect(ws).toBe('w1')
    expect(expected).toEqual({ verifiedAt: VERSION, updatedAt: reread })
    expect(data.repositories).toEqual(['acme/web'])
    expect(data.accessRemovedCount).toBe(3)
    expect(data.accessRemovedAt).toBeInstanceOf(Date)
    expect(data.accessRemovedReason).toBe('access_lost')
    expect(data.accessCheckedAt).toBeInstanceOf(Date)
    expect(scrubWorkspaceCode).toHaveBeenCalledWith('w1', expect.any(String), [
      'acme/payroll',
    ])
  })
})

describe('LUM-888 scrub before narrowing, isolated failures', () => {
  it('LUM-888 scrub failure keeps the repository and the sweep moves on', async () => {
    repo.findAllWithVerifier.mockResolvedValue([
      row(),
      row({ workspaceId: 'w2', installationId: 43 }),
    ])
    applyLikeTheRow(row().repositories as string[])
    answers({ 'acme/payroll': 'unreadable' })
    ;(scrubWorkspaceCode as jest.Mock).mockRejectedValueOnce(
      new Error('db down')
    )

    const summary = await githubAccessRecheckService.sweep()

    // w1: the scrub threw before anything was written, so payroll is still
    // on its confirmed list and the next run asks, and scrubs, again.
    const writtenFor = repo.updateRecheckIfUnchanged.mock.calls.map(c => c[0])
    expect(writtenFor).not.toContain('w1')
    // w2, on the next installation, was still rechecked and narrowed.
    expect(createInstallationToken).toHaveBeenCalledWith(43, expect.anything())
    expect(applied).toHaveBeenCalledWith('w2', ['acme/payroll'], null)
    expect(scrubWorkspaceCode).toHaveBeenLastCalledWith(
      'w2',
      expect.any(String),
      ['acme/payroll']
    )
    expect(summary).toMatchObject({ workspaces: 1, failed: 1, removed: 1 })
  })

  it('a GitHub call that throws for one installation does not stop the next', async () => {
    repo.findAllWithVerifier.mockResolvedValue([
      row(),
      row({ workspaceId: 'w2', installationId: 43 }),
    ])
    applyLikeTheRow(row().repositories as string[])
    ;(lookupGitHubUser as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ id: 7, login: 'octo' })

    const summary = await githubAccessRecheckService.sweep()

    expect(applied).toHaveBeenCalledWith('w2', [], null)
    expect(summary).toMatchObject({ workspaces: 1, failed: 1 })
  })
})

describe('LUM-888 verifier followed by GitHub user id', () => {
  it('LUM-888 renamed verifier is followed by id', async () => {
    // Renamed: asked by id, answered under the new login.
    repo.findAllWithVerifier.mockResolvedValue([row({ verifierGithubId: 7 })])
    applyLikeTheRow(row().repositories as string[])
    ;(lookupGitHubUser as jest.Mock).mockResolvedValue({
      id: 7,
      login: 'octo-renamed',
    })

    const renamed = await githubAccessRecheckService.sweep()

    expect(lookupGitHubUser).toHaveBeenCalledWith('inst-token', { id: 7 })
    expect(lookupGitHubUser).not.toHaveBeenCalledWith('inst-token', {
      login: 'octo',
    })
    const logins = new Set(access.mock.calls.map(c => c[2]))
    expect([...logins]).toEqual(['octo-renamed'])
    const data = repo.updateRecheckIfUnchanged.mock.calls[0][2]
    expect(data).toMatchObject({
      repositories: ['acme/api', 'acme/web', 'acme/payroll'],
      verifierLogin: 'octo-renamed',
      verifierGithubId: 7,
    })
    expect(data.accessRemovedCount).toBeUndefined()
    expect(renamed.removed).toBe(0)
    expect(scrubWorkspaceCode).not.toHaveBeenCalled()

    // Deleted: every repository goes, and the notice names the reason.
    jest.clearAllMocks()
    ;(createInstallationToken as jest.Mock).mockResolvedValue('inst-token')
    ;(lookupGitHubUser as jest.Mock).mockResolvedValue('gone')
    applyLikeTheRow(row().repositories as string[])

    await githubAccessRecheckService.sweep()

    expect(access).not.toHaveBeenCalled()
    const gone = repo.updateRecheckIfUnchanged.mock.calls[0][2]
    expect(gone).toMatchObject({
      repositories: [],
      accessRemovedCount: 3,
      accessRemovedReason: 'account_gone',
    })
    expect(scrubWorkspaceCode).toHaveBeenCalledWith('w1', expect.any(String), [
      'acme/api',
      'acme/web',
      'acme/payroll',
    ])

    // The settings-card wording for this reason: GitHubAccessNotices.test.tsx.
  })

  it('records the id the first time a legacy row is looked up by login', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    applyLikeTheRow(row().repositories as string[])

    await githubAccessRecheckService.sweep()

    expect(lookupGitHubUser).toHaveBeenCalledWith('inst-token', {
      login: 'octo',
    })
    expect(repo.updateRecheckIfUnchanged.mock.calls[0][2]).toMatchObject({
      verifierLogin: 'octo',
      verifierGithubId: 7,
    })
  })

  it('a targeted recheck asks about the renamed login, not the stored one', async () => {
    repo.findAllByInstallationId.mockResolvedValue([
      row({ verifierGithubId: 7 }),
    ])
    applyLikeTheRow(['acme/web'])
    ;(lookupGitHubUser as jest.Mock).mockResolvedValue({
      id: 7,
      login: 'octo-renamed',
    })
    answers({ 'acme/web': 'unreadable' })

    await githubAccessRecheckService.recheckRepository(42, 'acme/web')

    expect(access).toHaveBeenCalledWith(
      'inst-token',
      'acme/web',
      'octo-renamed'
    )
    expect(applied).toHaveBeenCalledWith('w1', ['acme/web'], undefined)
  })
})

describe('narrowConfirmed', () => {
  it('splits case-insensitively and keeps the stored spelling', () => {
    expect(
      narrowConfirmed(['Acme/Web', 'acme/api'], ['acme/web', 'acme/gone'])
    ).toEqual({ kept: ['acme/api'], gone: ['Acme/Web'] })
  })
})
