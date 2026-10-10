/**
 * @jest-environment node
 *
 * LUM-888 — the access recheck's optimistic write, rotation and re-verification
 * race against a REAL Postgres (every migration replayed into PGlite): the
 * version columns, `updateMany` row counts and `nulls: 'first'` ordering are
 * exactly what a mocked Prisma cannot show. Only GitHub is stubbed.
 *
 * LUM-1064: plugin half of __tests__/services/github-access-recheck.real-postgres.test.ts (split)
 */
import { createPgliteHarness } from '../../../../scripts/test-support/pglite-harness'

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
import { githubAppInstallationRepository } from '@/lib/repositories'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { checkRepositoryReadAccess } from '@/lib/integrations/github'

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
  await harness.prisma!.workspace.create({
    data: { id: workspaceId, name: workspaceId, slug: workspaceId },
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
  const number = ++prNumber
  await harness.prisma!.pullRequest.create({
    data: {
      id: `${p}pr`,
      workspaceId,
      repo,
      number,
      title: `PR ${number}`,
      url: `https://github.com/${repo}/pull/${number}`,
      state: 'open',
      authorLogin: 'octo',
      headBranch: 'feature',
      baseBranch: 'main',
    },
  })
  await harness.prisma!.prSecurityScan.create({
    data: {
      id: `${p}scan`,
      pullRequestId: `${p}pr`,
      workspaceId,
      headSha: 'abc',
      trigger: 'PR_EVENT',
      detectorVersion: 'test',
      prSummary: { description: CODE },
    },
  })
  await harness.prisma!.prSecurityFinding.create({
    data: {
      id: `${p}finding`,
      scanId: `${p}scan`,
      kind: 'VULNERABILITY',
      ruleId: 'vuln:sql-injection',
      severity: 'HIGH',
      provenance: 'LLM_JUDGE',
      filePath: 'src/db.ts',
      title: 'SQL injection',
      detail: 'Query built from request input',
      evidence: CODE,
      fingerprint: `${p}fp`,
    },
  })
}

async function evidenceOf(p: string) {
  const finding = await harness.prisma!.prSecurityFinding.findUnique({
    where: { id: `${p}finding` },
    select: { evidence: true },
  })
  return finding?.evidence
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
  await harness.prisma!.prSecurityFinding.deleteMany({})
  await harness.prisma!.prSecurityScan.deleteMany({})
  await harness.prisma!.pullRequest.deleteMany({})
  await db().deleteMany({})
  await harness.prisma!.workspace.deleteMany({})
})

describe('access recheck on a real Postgres', () => {
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
