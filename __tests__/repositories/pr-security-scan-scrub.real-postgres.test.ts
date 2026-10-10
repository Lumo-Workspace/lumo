/**
 * @jest-environment node
 *
 * LUM-896 — the scan-code scrub against a REAL Postgres (every migration
 * replayed into PGlite): whether a repository filter matches regardless of
 * case is the database's answer, which a mocked Prisma cannot give. Covers
 * the per-repository scrub and the recheck that follows a scan write.
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

import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { scrubScanIfRepositoryUnconfirmed } from '@/lib/services/scan-code-retention.service'

jest.setTimeout(180_000)

const CODE = 'const token = req.query.t; db.exec(`select ${token}`)'
let prNumber = 0

async function seedWorkspace(workspaceId: string, repositories?: string[]) {
  await harness.prisma!.workspace.create({
    data: { id: workspaceId, name: workspaceId, slug: workspaceId },
  })
  if (repositories) {
    await harness.prisma!.gitHubAppInstallation.create({
      data: { workspaceId, installationId: ++prNumber, repositories },
    })
  }
}

/** One PR in `repo` with a scan and a finding, all holding code. */
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
      huntAudit: { note: CODE },
      huntJob: { signalSites: [CODE] },
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
      title: `SQL injection in ${CODE}`,
      detail: CODE,
      evidence: CODE,
      callChain: [{ from: CODE, to: 'db.exec' }],
      suggestedReason: CODE,
      fingerprint: `${p}fp`,
    },
  })
}

/** Whether any code-carrying field of the scan or its finding still holds code. */
async function holdsCode(p: string) {
  const scan = await harness.prisma!.prSecurityScan.findUniqueOrThrow({
    where: { id: `${p}scan` },
    select: { prSummary: true, huntAudit: true, huntJob: true },
  })
  const finding = await harness.prisma!.prSecurityFinding.findUniqueOrThrow({
    where: { id: `${p}finding` },
    select: {
      title: true,
      detail: true,
      evidence: true,
      callChain: true,
      suggestedReason: true,
    },
  })
  return JSON.stringify({ scan, finding }).includes('req.query.t')
}

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.prisma!.prSecurityFinding.deleteMany({})
  await harness.prisma!.prSecurityScan.deleteMany({})
  await harness.prisma!.pullRequest.deleteMany({})
  await harness.prisma!.gitHubAppInstallation.deleteMany({})
  await harness.prisma!.workspace.deleteMany({})
})

describe('LUM-896 scan code scrub (real Postgres)', () => {
  it('LUM-896 scrub matches repository names case-insensitively', async () => {
    await seedWorkspace('ws_case')
    await seedWorkspace('ws_other')
    // The PR row was stored as GitHub spelled it then; the list spells it
    // differently now.
    await seedScan('renamed_', 'ws_case', 'acme/payroll')
    await seedScan('upper_', 'ws_case', 'ACME/Payroll')
    // `_` is a literal in a repository name, not a wildcard.
    await seedScan('under_', 'ws_case', 'acme/my_app')
    await seedScan('lookalike_', 'ws_case', 'acme/myXapp')
    await seedScan('kept_', 'ws_case', 'acme/api')
    // Another workspace's PR in the same repository is not this one's to scrub.
    await seedScan('foreign_', 'ws_other', 'acme/payroll')

    const counts = await prSecurityScanRepository.scrubCodeForWorkspace(
      'ws_case',
      ['Acme/Payroll', 'ACME/MY_APP']
    )

    expect(counts).toEqual({ scans: 3, findings: 3 })
    expect(await holdsCode('renamed_')).toBe(false)
    expect(await holdsCode('upper_')).toBe(false)
    expect(await holdsCode('under_')).toBe(false)
    expect(await holdsCode('lookalike_')).toBe(true)
    expect(await holdsCode('kept_')).toBe(true)
    expect(await holdsCode('foreign_')).toBe(true)
    // A scrubbed finding still has a title to list.
    const finding = await harness.prisma!.prSecurityFinding.findUniqueOrThrow({
      where: { id: 'renamed_finding' },
      select: { title: true },
    })
    expect(finding.title).toBe('vuln:sql-injection')

    // An empty list scrubs nothing (it never means "the whole workspace").
    expect(
      await prSecurityScanRepository.scrubCodeForWorkspace('ws_case', [])
    ).toEqual({ scans: 0, findings: 0 })
    expect(await holdsCode('kept_')).toBe(true)
  })

  it('LUM-896 a scan written after its repository left the list loses its code', async () => {
    // payroll left the list after its scan got a token; web is still on it,
    // spelled differently from the PR row.
    await seedWorkspace('ws_narrowed', ['Acme/Web'])
    await seedScan('late_', 'ws_narrowed', 'acme/payroll')
    await seedScan('web_', 'ws_narrowed', 'acme/web')
    // The App was uninstalled while this scan ran.
    await seedWorkspace('ws_gone')
    await seedScan('orphan_', 'ws_gone', 'acme/api')

    expect(await scrubScanIfRepositoryUnconfirmed('late_scan')).toBe(true)
    expect(await scrubScanIfRepositoryUnconfirmed('web_scan')).toBe(false)
    expect(await scrubScanIfRepositoryUnconfirmed('orphan_scan')).toBe(true)
    expect(await scrubScanIfRepositoryUnconfirmed('no_such_scan')).toBe(false)

    expect(await holdsCode('late_')).toBe(false)
    expect(await holdsCode('orphan_')).toBe(false)
    expect(await holdsCode('web_')).toBe(true)
    // The rows themselves stay: history and dispositions still gate DONE.
    expect(await harness.prisma!.prSecurityFinding.count()).toBe(3)
  })
})
