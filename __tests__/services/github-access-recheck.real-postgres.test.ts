/**
 * @jest-environment node
 *
 * LUM-888 — the access recheck's optimistic write, rotation and re-verification
 * race against a REAL Postgres (every migration replayed into PGlite): the
 * version columns, `updateMany` row counts and `nulls: 'first'` ordering are
 * exactly what a mocked Prisma cannot show. Only GitHub is stubbed.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/integrations/github', () => ({
  createInstallationToken: jest.fn(async (id: number) => `token-${id}`),
  checkRepositoryReadAccess: jest.fn(),
  lookupGitHubUser: jest.fn(async () => ({ id: 7, login: 'octo' })),
  INSTALLATION_TOKEN_PERMISSIONS: jest.requireActual(
    '@/lib/integrations/github/token-permissions'
  ).INSTALLATION_TOKEN_PERMISSIONS,
}))

import { githubAccessRecheckService } from '@/lib/services/github-access-recheck.service'
import {
  githubAppInstallationRepository,
  prSecurityScanRepository,
} from '@/lib/repositories'
import {
  createInstallationToken,
  checkRepositoryReadAccess,
  lookupGitHubUser,
} from '@/lib/integrations/github'

jest.setTimeout(180_000)

const access = checkRepositoryReadAccess as jest.Mock
const REPOS = ['acme/api', 'acme/payroll', 'acme/web']
const VERIFIED = new Date('2026-09-20T00:00:00Z')

function db() {
  return harness.prisma!.gitHubAppInstallation
}

async function seedRow(
  workspaceId: string,
  installationId: number,
  extra: Record<string, unknown> = {}
) {
  await harness.insert('workspaces', {
    id: workspaceId,
    name: workspaceId,
    slug: workspaceId,
  })
  await db().create({
    data: {
      workspaceId,
      installationId,
      repositories: REPOS,
      verifierLogin: 'octo',
      verifierGithubId: 7,
      verifiedAt: VERIFIED,
      ...extra,
    },
  })
}

const CODE = 'const token = req.query.t; db.exec(`select ${token}`)'
let prNumber = 0

/** One PR in `repo` with a scan and a finding holding code. */
async function seedScan(p: string, workspaceId: string, repo: string) {
  await harness.insert('pull_requests', {
    id: `${p}pr`,
    workspaceId,
    repo,
    number: ++prNumber,
  })
  await harness.insert('pr_security_scans', {
    id: `${p}scan`,
    pullRequestId: `${p}pr`,
    workspaceId,
    headSha: 'abc',
    prSummary: JSON.stringify({ description: CODE }),
  })
  await harness.insert('pr_security_findings', {
    id: `${p}finding`,
    scanId: `${p}scan`,
    ruleId: 'vuln:sql-injection',
    title: 'SQL injection',
    detail: 'Query built from request input',
    evidence: CODE,
  })
}

async function evidenceOf(p: string) {
  const [finding] = await harness.query<{ evidence: string }>(
    `select evidence from pr_security_findings where id = $1`,
    [`${p}finding`]
  )
  return finding?.evidence
}

/** A clock whose budget runs out after the first installation of a run. */
function oneInstallationPerRun() {
  const base = Date.now()
  let calls = 0
  return () => (calls++ < 2 ? base : base + 1_000_000_000)
}

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  jest.restoreAllMocks()
  jest.clearAllMocks()
  await harness.query('delete from pr_security_findings')
  await harness.query('delete from pr_security_scans')
  await harness.query('delete from pull_requests')
  await db().deleteMany({})
  await harness.prisma!.workspace.deleteMany({})
})

describe('access recheck on a real Postgres', () => {
  it('LUM-888 same-login re-verification discards the in-flight recheck', async () => {
    await seedRow('ws_race', 1, {
      accessRemovedCount: 5,
      accessCheckCursor: 'acme/api',
    })
    // Mid-run, the same GitHub login re-verifies and confirms every
    // repository (payroll included) — the result computed before that must
    // not be applied to the list they just confirmed.
    let reverified = false
    access.mockImplementation(async (_t: string, name: string) => {
      if (!reverified) {
        reverified = true
        await githubAppInstallationRepository.recordVerification(
          'ws_race',
          REPOS,
          { login: 'octo', githubId: 7 }
        )
      }
      return {
        access: name === 'acme/payroll' ? 'unreadable' : 'readable',
        remaining: 4000,
      }
    })

    const summary = await githubAccessRecheckService.sweep()

    expect(access).toHaveBeenCalled()
    expect(summary.removed).toBe(0)
    const after = await db().findUniqueOrThrow({
      where: { workspaceId: 'ws_race' },
    })
    // Exactly what the re-verification wrote: the full list, the removal
    // notice cleared, no resume point. LUM-895 — only the rotation stamp is
    // the recheck's: every row the sweep reaches takes its turn.
    expect(after.repositories).toEqual(REPOS)
    expect(after.accessRemovedCount).toBe(0)
    expect(after.accessRemovedAt).toBeNull()
    expect(after.accessCheckCursor).toBeNull()
    expect(after.accessCheckedAt).not.toBeNull()
    expect(after.verifierLogin).toBe('octo')
    expect(after.verifiedAt!.getTime()).toBeGreaterThan(VERIFIED.getTime())
  })

  it('the optimistic write lands only on the version it was computed from', async () => {
    await seedRow('ws_lock', 2)
    const state =
      await githubAppInstallationRepository.findRecheckState('ws_lock')
    const version = {
      verifiedAt: state!.verifiedAt!,
      updatedAt: state!.updatedAt,
    }

    // A webhook narrowing bumps updatedAt: the stale write is refused.
    await githubAppInstallationRepository.updateRepositories('ws_lock', [
      'acme/api',
      'acme/web',
    ])
    expect(
      await githubAppInstallationRepository.updateRecheckIfUnchanged(
        'ws_lock',
        version,
        { repositories: [] }
      )
    ).toBe(false)

    // Re-read: the fresh version writes, exactly once.
    const fresh =
      await githubAppInstallationRepository.findRecheckState('ws_lock')
    const freshVersion = {
      verifiedAt: fresh!.verifiedAt!,
      updatedAt: fresh!.updatedAt,
    }
    expect(
      await githubAppInstallationRepository.updateRecheckIfUnchanged(
        'ws_lock',
        freshVersion,
        { repositories: ['acme/web'] }
      )
    ).toBe(true)
    expect(
      await githubAppInstallationRepository.updateRecheckIfUnchanged(
        'ws_lock',
        freshVersion,
        { repositories: [] }
      )
    ).toBe(false)
    const after = await db().findUniqueOrThrow({
      where: { workspaceId: 'ws_lock' },
    })
    expect(after.repositories).toEqual(['acme/web'])
  })

  it('LUM-888 least recently rechecked installation goes first', async () => {
    await seedRow('ws_recent', 10, {
      accessCheckedAt: new Date('2026-09-27T00:00:00Z'),
    })
    await seedRow('ws_old', 11, {
      accessCheckedAt: new Date('2026-09-01T00:00:00Z'),
    })
    await seedRow('ws_never', 12)
    access.mockResolvedValue({ access: 'readable', remaining: 4000 })

    // A clock whose budget runs out after the first installation of every
    // run — the worst case, one installation per day.
    const oneInstallationPerRun = () => {
      const base = Date.now()
      let calls = 0
      return () => (calls++ < 2 ? base : base + 1_000_000_000)
    }
    const ran: number[] = []
    for (let day = 0; day < 3; day++) {
      ;(createInstallationToken as jest.Mock).mockClear()
      const summary = await githubAccessRecheckService.sweep(
        oneInstallationPerRun()
      )
      expect(summary).toMatchObject({ workspaces: 1, skipped: 2 })
      ran.push(
        ...(createInstallationToken as jest.Mock).mock.calls.map(c => c[0])
      )
    }

    // Never checked first, then the longest-waiting; nobody starves.
    expect(ran).toEqual([12, 11, 10])
    const stamps = await db().findMany({
      select: { workspaceId: true, accessCheckedAt: true },
    })
    for (const row of stamps) {
      expect(row.accessCheckedAt!.getTime()).toBeGreaterThan(
        new Date('2026-09-27T00:00:00Z').getTime()
      )
    }
  })

  it('LUM-895 a row whose recheck keeps failing is stamped and rotates to the back', async () => {
    // ws_scrub: never checked, and its scrub throws every day.
    // ws_lookup: GitHub never answers who its verifier is.
    // ws_ok: checked most recently, nothing wrong with it.
    await seedRow('ws_scrub', 20)
    await seedRow('ws_lookup', 21, {
      verifierGithubId: 8,
      accessCheckedAt: new Date('2026-09-01T00:00:00Z'),
    })
    await seedRow('ws_ok', 22, {
      accessCheckedAt: new Date('2026-09-10T00:00:00Z'),
    })
    access.mockResolvedValue({ access: 'unreadable', remaining: 4000 })
    ;(lookupGitHubUser as jest.Mock).mockImplementation(
      async (_t: string, who: { id?: number }) =>
        who.id === 8 ? null : { id: 7, login: 'octo' }
    )
    const scrub = prSecurityScanRepository.scrubCodeForWorkspace
    jest
      .spyOn(prSecurityScanRepository, 'scrubCodeForWorkspace')
      .mockImplementation(async (ws, repos) => {
        if (ws === 'ws_scrub') throw new Error('scrub keeps failing')
        return scrub.call(prSecurityScanRepository, ws, repos)
      })

    const ran: number[] = []
    for (let day = 0; day < 4; day++) {
      ;(createInstallationToken as jest.Mock).mockClear()
      await githubAccessRecheckService.sweep(oneInstallationPerRun())
      ran.push(
        ...(createInstallationToken as jest.Mock).mock.calls.map(c => c[0])
      )
    }

    // Before LUM-895 the failing rows kept no stamp and went first every
    // day; now each takes one turn, and ws_ok gets its own.
    expect(ran).toEqual([20, 21, 22, 20])
    const rows = await db().findMany({
      select: { workspaceId: true, repositories: true, accessCheckedAt: true },
    })
    const by = Object.fromEntries(rows.map(r => [r.workspaceId, r]))
    // The failures wrote no result: their lists are untouched.
    expect(by.ws_scrub!.repositories).toEqual(REPOS)
    expect(by.ws_lookup!.repositories).toEqual(REPOS)
    expect(by.ws_ok!.repositories).toEqual([])
    for (const row of rows) {
      expect(row.accessCheckedAt!.getTime()).toBeGreaterThan(
        new Date('2026-09-27T00:00:00Z').getTime()
      )
    }
  })

  it('LUM-895 re-verification after the scrub keeps the list and the scrub stands', async () => {
    await seedRow('ws_late', 30)
    await seedScan('late_', 'ws_late', 'acme/payroll')
    await seedScan('kept_', 'ws_late', 'acme/api')
    access.mockImplementation(async (_t: string, name: string) => ({
      access: name === 'acme/payroll' ? 'unreadable' : 'readable',
      remaining: 4000,
    }))
    // The owner re-verifies right after the recheck scrubbed payroll and
    // before it writes the narrowed list — confirming payroll again.
    const scrub = prSecurityScanRepository.scrubCodeForWorkspace
    let reverified = false
    jest
      .spyOn(prSecurityScanRepository, 'scrubCodeForWorkspace')
      .mockImplementation(async (ws, repos) => {
        const counts = await scrub.call(prSecurityScanRepository, ws, repos)
        if (!reverified) {
          reverified = true
          await githubAppInstallationRepository.recordVerification(
            'ws_late',
            REPOS,
            { login: 'octo', githubId: 7 }
          )
        }
        return counts
      })

    const summary = await githubAccessRecheckService.sweep()

    expect(reverified).toBe(true)
    expect(summary.removed).toBe(0)
    const after = await db().findUniqueOrThrow({
      where: { workspaceId: 'ws_late' },
    })
    // The re-verification wins the list: payroll stays confirmed, no
    // removal notice for a repository that is still there.
    expect(after.repositories).toEqual(REPOS)
    expect(after.accessRemovedCount).toBe(0)
    expect(after.accessRemovedReason).toBeNull()
    expect(after.verifiedAt!.getTime()).toBeGreaterThan(VERIFIED.getTime())
    // Its old scan evidence is gone and stays gone (the safe side: new
    // scans bring fresh evidence); other repositories are untouched.
    expect(await evidenceOf('late_')).toBe('')
    expect(await evidenceOf('kept_')).toBe(CODE)
  })
})
