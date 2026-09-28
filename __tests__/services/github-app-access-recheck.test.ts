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
    applyAccessRecheck: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/github', () => ({
  createInstallationToken: jest.fn(),
  checkRepositoryReadAccess: jest.fn(),
  checkUserExists: jest.fn(),
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  scrubWorkspaceCode: jest.fn().mockResolvedValue({ scans: 0, findings: 0 }),
}))

import { githubAccessRecheckService } from '@/lib/services/github-access-recheck.service'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  createInstallationToken,
  checkRepositoryReadAccess,
  checkUserExists,
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

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspaceId: 'w1',
    installationId: 42,
    repositories: ['acme/api', 'acme/web', 'acme/payroll'],
    verifierLogin: 'octo',
    accessCheckCursor: null,
    ...overrides,
  }
}

/** The repository applies removals against the current row, like the DB does. */
function applyLikeTheRow(current: string[]) {
  repo.applyAccessRecheck.mockImplementation(
    async (_ws: string, _login: string, removed: string[]) => {
      const drop = new Set(removed.map(n => n.toLowerCase()))
      return { removed: current.filter(n => drop.has(n.toLowerCase())) }
    }
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(createInstallationToken as jest.Mock).mockResolvedValue('inst-token')
  ;(checkUserExists as jest.Mock).mockResolvedValue(true)
  repo.findAllByInstallationId.mockResolvedValue([])
  answers({})
})

describe('recheck narrows to what the verifier can still read', () => {
  it('removes unreadable repositories, keeps readable ones and scrubs only the removed', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    applyLikeTheRow(row().repositories as string[])
    answers({ 'acme/payroll': 'unreadable' })

    const summary = await githubAccessRecheckService.sweep()

    // Asked with the installation token, about the verifier's login.
    expect(createInstallationToken).toHaveBeenCalledWith(42)
    expect(access).toHaveBeenCalledWith('inst-token', 'acme/web', 'octo')
    expect(access).toHaveBeenCalledTimes(3)
    expect(repo.applyAccessRecheck).toHaveBeenCalledWith(
      'w1',
      'octo',
      ['acme/payroll'],
      null
    )
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

    expect(repo.applyAccessRecheck).toHaveBeenCalledWith('w1', 'octo', [], null)
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

    expect(repo.applyAccessRecheck).toHaveBeenCalledWith(
      'w1',
      'octo',
      ['acme/r03'],
      'acme/r07'
    )
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
    expect(repo.applyAccessRecheck).toHaveBeenLastCalledWith(
      'w1',
      'octo',
      [],
      'acme/r07'
    )

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
    expect(repo.applyAccessRecheck).toHaveBeenLastCalledWith(
      'w1',
      'octo',
      ['acme/r11'],
      null
    )
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
    expect(repo.applyAccessRecheck).toHaveBeenCalledWith(
      'w1',
      'octo',
      [],
      'acme/r07'
    )
  })

  it('lets the other workspaces of a rate-limited installation wait for the next run', async () => {
    repo.findAllWithVerifier.mockResolvedValue([
      row(),
      row({ workspaceId: 'w2' }),
    ])
    applyLikeTheRow(row().repositories as string[])
    answers({ 'acme/api': 'rate_limited' })

    const summary = await githubAccessRecheckService.sweep()

    expect(repo.applyAccessRecheck).toHaveBeenCalledTimes(1)
    expect(summary).toMatchObject({ workspaces: 1, skipped: 1, removed: 0 })
  })

  it('discards the result when an owner re-verified during the run', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    repo.applyAccessRecheck.mockResolvedValue(null)
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

    expect(repo.applyAccessRecheck).toHaveBeenCalledWith(
      'w1',
      'octo',
      ['acme/api', 'acme/payroll', 'acme/web'],
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
    ;(checkUserExists as jest.Mock).mockResolvedValue(false)

    await githubAccessRecheckService.sweep()

    expect(access).not.toHaveBeenCalled()
    expect(repo.applyAccessRecheck).toHaveBeenCalledWith(
      'w1',
      'octo',
      ['acme/api', 'acme/web', 'acme/payroll'],
      null
    )
    expect(scrubWorkspaceCode).toHaveBeenCalledTimes(1)
  })

  it('changes nothing when GitHub cannot say whether the verifier exists', async () => {
    repo.findAllWithVerifier.mockResolvedValue([row()])
    ;(checkUserExists as jest.Mock).mockResolvedValue(null)

    await githubAccessRecheckService.sweep()

    expect(repo.applyAccessRecheck).not.toHaveBeenCalled()
    expect(scrubWorkspaceCode).not.toHaveBeenCalled()
  })

  it('skips installations with no verifier login on record', async () => {
    // The sweep only reads rows with a login; a stray one without is skipped.
    repo.findAllWithVerifier.mockResolvedValue([row({ verifierLogin: null })])

    const summary = await githubAccessRecheckService.sweep()

    expect(access).not.toHaveBeenCalled()
    expect(repo.applyAccessRecheck).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ workspaces: 0, skipped: 1 })
  })

  it('leaves a legacy row alone on a targeted recheck', async () => {
    repo.findAllByInstallationId.mockResolvedValue([
      row({ verifierLogin: null }),
    ])
    answers({ 'acme/web': 'unreadable' })

    await githubAccessRecheckService.recheckRepository(42, 'acme/web')

    expect(access).not.toHaveBeenCalled()
    expect(repo.applyAccessRecheck).not.toHaveBeenCalled()
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
    expect(repo.applyAccessRecheck).toHaveBeenCalledWith(
      'w1',
      'octo',
      ['Acme/Web'],
      undefined
    )
    expect(result).toEqual({ removed: 2 })
  })
})
