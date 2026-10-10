/**
 * @jest-environment node
 *
 * LUM-902 — the daily backstop sweep against a REAL Postgres (every migration
 * replayed into PGlite): "holds code" is a JSON-null / relation filter and
 * the repository match is case-insensitive, neither of which a mocked Prisma
 * can answer.
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

import { sweepUnconfirmedScanCode } from '@/lib/services/scan-code-retention.service'

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
  // a: confirmed `Acme/API` (stored PR spelling `acme/api`), plus a repo
  //    that left the list.
  await seedWorkspace('ws_a', ['Acme/API'])
  await seedScan('a_kept_', 'ws_a', 'acme/api')
  await seedScan('a_gone_', 'ws_a', 'acme/payroll')
  // b: no App at all — nothing of it is confirmed.
  await seedWorkspace('ws_b')
  await seedScan('b_', 'ws_b', 'acme/web')
  // c: confirms `acme/payroll` — another workspace's list never counts.
  await seedWorkspace('ws_c', ['acme/payroll'])
  await seedScan('c_', 'ws_c', 'acme/payroll')
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-902 sweepUnconfirmedScanCode', () => {
  it('backstop sweep scrubs only scans outside the confirmed list', async () => {
    const summary = await sweepUnconfirmedScanCode()

    expect(await holdsCode('a_gone_')).toBe(false)
    expect(await holdsCode('b_')).toBe(false)
    expect(await holdsCode('a_kept_')).toBe(true)
    expect(await holdsCode('c_')).toBe(true)
    expect(summary).toEqual({ workspaces: 2, repositories: 2, failed: 0 })

    // Rows survive the scrub, and a second run finds nothing left to do.
    expect(
      await harness.prisma!.prSecurityFinding.count({
        where: { id: { in: ['a_gone_finding', 'b_finding'] } },
      })
    ).toBe(2)
    await expect(sweepUnconfirmedScanCode()).resolves.toEqual({
      workspaces: 0,
      repositories: 0,
      failed: 0,
    })
  })
})
