/**
 * @jest-environment node
 *
 * LUM-927 — the scan-code scrub of a large workspace against a REAL Postgres
 * (every migration replayed into PGlite). One transaction for the whole
 * workspace could outlast any timeout and fail every day; it now commits in
 * batches, so a failure keeps the batches before it and a rerun finishes.
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

import {
  prSecurityScanRepository,
  SCRUB_BATCH_SIZE,
} from '@/ee/security/repositories/pr-security-scan.repository'

jest.setTimeout(180_000)

const CODE = 'const token = req.query.t; db.exec(`select ${token}`)'
const WORKSPACE = 'ws_large'
/** Enough for three batches, the last one partial. */
const SCANS = SCRUB_BATCH_SIZE * 2 + 50

async function seedLargeWorkspace() {
  const db = harness.prisma!
  await db.workspace.create({
    data: { id: WORKSPACE, name: WORKSPACE, slug: WORKSPACE },
  })
  await db.pullRequest.create({
    data: {
      id: 'pr_large',
      workspaceId: WORKSPACE,
      repo: 'acme/monorepo',
      number: 1,
      title: 'PR 1',
      url: 'https://github.com/acme/monorepo/pull/1',
      state: 'open',
      authorLogin: 'octo',
      headBranch: 'feature',
      baseBranch: 'main',
    },
  })
  const ids = Array.from(
    { length: SCANS },
    (_, i) => `scan_${String(i).padStart(4, '0')}`
  )
  await db.prSecurityScan.createMany({
    data: ids.map(id => ({
      id,
      pullRequestId: 'pr_large',
      workspaceId: WORKSPACE,
      headSha: id,
      trigger: 'PR_EVENT' as const,
      detectorVersion: 'test',
      prSummary: { description: CODE },
      huntAudit: { note: CODE },
      huntJob: { signalSites: [CODE] },
    })),
  })
  await db.prSecurityFinding.createMany({
    data: ids.flatMap(id =>
      [0, 1].map(n => ({
        id: `${id}_f${n}`,
        scanId: id,
        kind: 'VULNERABILITY' as const,
        ruleId: n === 0 ? 'vuln:sql-injection' : 'vuln:xss',
        severity: 'HIGH' as const,
        provenance: 'LLM_JUDGE' as const,
        filePath: 'src/db.ts',
        title: `Issue in ${CODE}`,
        detail: CODE,
        evidence: CODE,
        callChain: [{ from: CODE, to: 'db.exec' }],
        suggestedReason: CODE,
        fingerprint: `${id}_fp${n}`,
      }))
    ),
  })
}

/** Scans (of the workspace) any of whose code-carrying fields still hold code. */
async function scansHoldingCode(): Promise<number> {
  const db = harness.prisma!
  const scans = await db.prSecurityScan.findMany({
    where: { workspaceId: WORKSPACE },
    select: {
      prSummary: true,
      huntAudit: true,
      huntJob: true,
      findings: {
        select: {
          title: true,
          detail: true,
          evidence: true,
          callChain: true,
          suggestedReason: true,
        },
      },
    },
  })
  return scans.filter(scan => JSON.stringify(scan).includes('req.query.t'))
    .length
}

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-927 batched scan code scrub (real Postgres)', () => {
  it('LUM-927 large workspace scrub commits in batches and a rerun finishes after a failed batch', async () => {
    await seedLargeWorkspace()
    expect(await scansHoldingCode()).toBe(SCANS)

    const db = harness.prisma!
    const realTransaction = db.$transaction.bind(db)
    let calls = 0
    let failOn = 2
    const spy = jest.spyOn(db, '$transaction').mockImplementation(((
      ...args: Parameters<typeof realTransaction>
    ) => {
      calls++
      if (calls === failOn) {
        return Promise.reject(
          Object.assign(new Error('Transaction already closed'), {
            code: 'P2028',
          })
        )
      }
      return realTransaction(...args)
    }) as typeof db.$transaction)

    // The second batch fails: the call fails, the first batch stays done.
    await expect(
      prSecurityScanRepository.scrubCodeForWorkspace(WORKSPACE)
    ).rejects.toMatchObject({ code: 'P2028' })
    expect(await scansHoldingCode()).toBe(SCANS - SCRUB_BATCH_SIZE)

    // A rerun (the next daily backstop) finishes the rest, batch by batch.
    calls = 0
    failOn = -1
    const counts =
      await prSecurityScanRepository.scrubCodeForWorkspace(WORKSPACE)
    expect(calls).toBe(3)
    expect(counts).toEqual({ scans: SCANS, findings: SCANS * 2 })
    expect(await scansHoldingCode()).toBe(0)

    // Titles fell back to each finding's own rule id.
    const titles = await db.prSecurityFinding.groupBy({
      by: ['ruleId', 'title'],
      where: { scan: { workspaceId: WORKSPACE } },
    })
    expect(titles).toEqual(
      expect.arrayContaining([
        { ruleId: 'vuln:sql-injection', title: 'vuln:sql-injection' },
        { ruleId: 'vuln:xss', title: 'vuln:xss' },
      ])
    )
    expect(titles).toHaveLength(2)
    spy.mockRestore()
  })
})
