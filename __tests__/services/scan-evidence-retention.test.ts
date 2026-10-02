/**
 * @jest-environment node
 *
 * LUM-911 — scan evidence retention against a REAL Postgres (every migration
 * replayed into PGlite): the sweep's candidate query (status, JSON stages,
 * PR state, zero-retention workspaces) and the counts-keeping scrub are
 * filters and writes a mocked Prisma cannot answer.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
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
// The PR review's GitHub side is never reached here (scanning is off for
// the workspace the sync test uses); stub the ESM-only client it imports.
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))

import {
  scrubScanIfZeroRetention,
  sweepExpiredScanEvidence,
} from '@/lib/services/scan-evidence-retention.service'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import { workspaceService } from '@/lib/services/workspace.service'
import { updateWorkspaceSchema } from '@/lib/validation/schemas'
import {
  isScanEvidenceExpired,
  isScanFinal,
  pullRequestEndedAt,
  redactHuntAuditToCounts,
} from '@/lib/security-scan/evidence-retention'
import { parseHuntCoverage } from '@/lib/security-scan/hunt/coverage'
import { huntOverCapOf } from '@/lib/security-scan/size-caps'

jest.setTimeout(180_000)

const NOW = new Date('2026-10-01T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const CODE = 'const token = req.query.t; db.exec(`select ${token}`)'
const FINAL_STAGES = {
  secrets: 'RAN',
  external: 'RAN',
  judge: 'RAN',
  hunt: 'RAN',
}

const HUNT_AUDIT = {
  candidates: 2,
  rejected: [{ category: 'injection', sink: CODE, reason: CODE }],
  falsifierRejects: 1,
  falsifierRejected: [{ category: 'injection', sink: CODE, reason: CODE }],
  tasks: [
    {
      taskId: 't1',
      objective: CODE,
      category: 'injection',
      candidates: 2,
      tokens: 100,
      elapsedMs: 5,
      stopped: 'done',
      wrapUp: { ran: true },
      stop: { note: CODE },
    },
  ],
  subgraph: { files: 1, symbols: 2, edges: 3, partial: false },
  planned: [
    {
      id: 't1',
      objective: CODE,
      category: 'injection',
      startingPoints: [CODE],
    },
  ],
  diff: { sourceFiles: 3, sites: 2, taskCap: 3, oversized: false },
  plannedReason: CODE,
  plannedBy: 'model',
  overCap: { sourceFiles: 900, capFiles: 400 },
}

let seq = 0

async function seedWorkspace(id: string, scanEvidenceRetentionDays = 7) {
  await harness.prisma!.workspace.create({
    data: { id, name: id, slug: id, scanEvidenceRetentionDays },
  })
}

async function seedPr(
  id: string,
  workspaceId: string,
  pr: { state: string; mergedAt?: Date; closedAt?: Date }
) {
  const number = ++seq
  await harness.prisma!.pullRequest.create({
    data: {
      id,
      workspaceId,
      repo: 'acme/api',
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/api/pull/${number}`,
      state: pr.state,
      mergedAt: pr.mergedAt ?? null,
      closedAt: pr.closedAt ?? null,
      authorLogin: 'octo',
      headBranch: 'feature',
      baseBranch: 'main',
    },
  })
}

/** A scan on `prId` with one finding, every code field holding CODE. */
async function seedScan(
  id: string,
  prId: string,
  workspaceId: string,
  scan: {
    finishedAt: Date
    status?: 'CLEAN' | 'FINDINGS' | 'FAILED' | 'RUNNING'
    stages?: Record<string, string>
    suggestedAt?: Date | null
  }
) {
  await harness.prisma!.prSecurityScan.create({
    data: {
      id,
      pullRequestId: prId,
      workspaceId,
      headSha: `sha${++seq}`,
      trigger: 'PR_EVENT',
      detectorVersion: 'test',
      status: scan.status ?? 'FINDINGS',
      stages: scan.stages ?? FINAL_STAGES,
      partialCauses: ['HUNT_OVERSIZED'],
      startedAt: new Date(scan.finishedAt.getTime() - 60_000),
      finishedAt: scan.finishedAt,
      suggestedAt: scan.suggestedAt === undefined ? NOW : scan.suggestedAt,
      prSummary: { intent: CODE, changes: [CODE] },
      huntAudit: HUNT_AUDIT,
      huntJob: { signalSites: [CODE] },
    },
  })
  await harness.prisma!.prSecurityFinding.create({
    data: {
      id: `${id}_f`,
      scanId: id,
      kind: 'VULNERABILITY',
      ruleId: 'vuln:sql-injection',
      severity: 'HIGH',
      provenance: 'LLM_JUDGE',
      filePath: 'src/db.ts',
      line: 12,
      title: `SQL injection in ${CODE}`,
      detail: CODE,
      evidence: CODE,
      callChain: [{ from: CODE, to: 'db.exec' }],
      suggestedReason: CODE,
      suggestedDisposition: 'FALSE_POSITIVE',
      disposition: 'ACCEPTED_RISK',
      dispositionNote: 'owner ruled',
      cwe: 'CWE-89',
      fingerprint: `${id}_fp`,
    },
  })
}

async function holdsCode(scanId: string) {
  const scan = await harness.prisma!.prSecurityScan.findUniqueOrThrow({
    where: { id: scanId },
    include: { findings: true },
  })
  return JSON.stringify(scan).includes('req.query.t')
}

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-911 scan evidence retention', () => {
  it('scan evidence retention scrubs merged and closed PRs after the window', async () => {
    await seedWorkspace('w1')
    await seedPr('w1_merged', 'w1', { state: 'merged', mergedAt: ago(8 * DAY) })
    await seedScan('w1_merged_s', 'w1_merged', 'w1', {
      finishedAt: ago(9 * DAY),
    })
    await seedPr('w1_closed', 'w1', { state: 'closed', closedAt: ago(8 * DAY) })
    await seedScan('w1_closed_s', 'w1_closed', 'w1', {
      finishedAt: ago(9 * DAY),
    })
    await seedPr('w1_young', 'w1', { state: 'merged', mergedAt: ago(6 * DAY) })
    await seedScan('w1_young_s', 'w1_young', 'w1', { finishedAt: ago(7 * DAY) })
    await seedPr('w1_open', 'w1', { state: 'open' })
    await seedScan('w1_open_s', 'w1_open', 'w1', { finishedAt: ago(9 * DAY) })
    // Merged long ago, but its newest scan still has a hunt pending: neither
    // scan of the PR is scrubbed until that hunt ends.
    await seedPr('w1_pending', 'w1', {
      state: 'merged',
      mergedAt: ago(8 * DAY),
    })
    await seedScan('w1_pending_old', 'w1_pending', 'w1', {
      finishedAt: ago(9 * DAY),
    })
    await seedScan('w1_pending_new', 'w1_pending', 'w1', {
      finishedAt: ago(8 * DAY),
      stages: { ...FINAL_STAGES, hunt: 'PENDING' },
    })

    await sweepExpiredScanEvidence(NOW)

    expect(await holdsCode('w1_merged_s')).toBe(false)
    expect(await holdsCode('w1_closed_s')).toBe(false)
    expect(await holdsCode('w1_young_s')).toBe(true)
    expect(await holdsCode('w1_open_s')).toBe(true)
    expect(await holdsCode('w1_pending_old')).toBe(true)
    expect(await holdsCode('w1_pending_new')).toBe(true)

    // Reopened: the scrubbed scan stays scrubbed, a new push's scan is new.
    await harness.prisma!.pullRequest.update({
      where: { id: 'w1_merged' },
      data: { state: 'open', mergedAt: null },
    })
    await seedScan('w1_merged_s2', 'w1_merged', 'w1', { finishedAt: NOW })
    await sweepExpiredScanEvidence(new Date(NOW.getTime() + DAY))
    expect(await holdsCode('w1_merged_s')).toBe(false)
    expect(await holdsCode('w1_merged_s2')).toBe(true)
    const old = await harness.prisma!.prSecurityScan.findUniqueOrThrow({
      where: { id: 'w1_merged_s' },
    })
    expect(old.codeScrubbedAt).not.toBeNull()
  })

  it('scan evidence retention scrubs open PR scans past the hard cap', async () => {
    await seedWorkspace('w2')
    await seedPr('w2_open', 'w2', { state: 'open' })
    await seedScan('w2_old', 'w2_open', 'w2', { finishedAt: ago(31 * DAY) })
    await seedScan('w2_new', 'w2_open', 'w2', { finishedAt: ago(29 * DAY) })
    // The longest tier is never cut short by the cap.
    await seedWorkspace('w2_long', 30)
    await seedPr('w2_long_open', 'w2_long', { state: 'open' })
    await seedScan('w2_long_s', 'w2_long_open', 'w2_long', {
      finishedAt: ago(31 * DAY),
    })

    await sweepExpiredScanEvidence(NOW)

    expect(await holdsCode('w2_old')).toBe(false)
    expect(await holdsCode('w2_new')).toBe(true)
    expect(await holdsCode('w2_long_s')).toBe(false)
  })

  it('scan evidence retention zero mode scrubs once the scan is final', async () => {
    await seedWorkspace('w3', 0)
    await seedPr('w3_open', 'w3', { state: 'open' })
    await seedScan('w3_final', 'w3_open', 'w3', { finishedAt: NOW })
    await seedScan('w3_hunting', 'w3_open', 'w3', {
      finishedAt: NOW,
      stages: { ...FINAL_STAGES, hunt: 'PENDING' },
    })
    // The falsifier pass has not stamped it: the review still holds comments.
    await seedScan('w3_unsuggested', 'w3_open', 'w3', {
      finishedAt: NOW,
      suggestedAt: null,
    })

    expect(await scrubScanIfZeroRetention('w3_final')).toBe(true)
    expect(await holdsCode('w3_final')).toBe(false)
    expect(await scrubScanIfZeroRetention('w3_hunting')).toBe(false)
    expect(await holdsCode('w3_hunting')).toBe(true)
    expect(await scrubScanIfZeroRetention('w3_unsuggested')).toBe(false)
    expect(await holdsCode('w3_unsuggested')).toBe(true)

    // Wired after the PR review sync: a scanning-off workspace returns
    // before GitHub, and the scrub still follows.
    await harness.prisma!.workspace.update({
      where: { id: 'w3' },
      data: { securityScanEnabled: false },
    })
    await seedScan('w3_synced', 'w3_open', 'w3', { finishedAt: NOW })
    await securityPrReviewService.sync('w3_synced')
    expect(await holdsCode('w3_synced')).toBe(false)

    // A 7-day workspace's fresh scan is not touched by the hook.
    await seedWorkspace('w3_default')
    await seedPr('w3_default_open', 'w3_default', { state: 'open' })
    await seedScan('w3_default_s', 'w3_default_open', 'w3_default', {
      finishedAt: NOW,
    })
    expect(await scrubScanIfZeroRetention('w3_default_s')).toBe(false)
    expect(await holdsCode('w3_default_s')).toBe(true)

    // The sweep is the backstop: past its grace the stragglers go, a hunt
    // still pending does not.
    await sweepExpiredScanEvidence(new Date(NOW.getTime() + 20 * 60 * 1000))
    expect(await holdsCode('w3_unsuggested')).toBe(false)
    expect(await holdsCode('w3_hunting')).toBe(true)
    expect(await holdsCode('w3_default_s')).toBe(true)
  })

  it('scan evidence retention follows the workspace setting and only owners change it', async () => {
    for (const ok of [0, 7, 14, 30]) {
      expect(
        updateWorkspaceSchema.safeParse({ scanEvidenceRetentionDays: ok })
          .success
      ).toBe(true)
    }
    for (const bad of [1, 3, 60, null, '7']) {
      expect(
        updateWorkspaceSchema.safeParse({ scanEvidenceRetentionDays: bad })
          .success
      ).toBe(false)
    }

    await seedWorkspace('w4')
    await expect(
      workspaceService.updateWorkspace('w4', 'MEMBER', 'w4', {
        scanEvidenceRetentionDays: 0,
      })
    ).rejects.toMatchObject({ status: 403 })
    await workspaceService.updateWorkspace('w4', 'OWNER', 'w4', {
      scanEvidenceRetentionDays: 14,
    })
    const stored = await harness.prisma!.workspace.findUniqueOrThrow({
      where: { id: 'w4' },
    })
    expect(stored.scanEvidenceRetentionDays).toBe(14)

    await seedPr('w4_merged', 'w4', {
      state: 'merged',
      mergedAt: ago(10 * DAY),
    })
    await seedScan('w4_s', 'w4_merged', 'w4', { finishedAt: ago(11 * DAY) })
    await sweepExpiredScanEvidence(NOW)
    expect(await holdsCode('w4_s')).toBe(true)

    await workspaceService.updateWorkspace('w4', 'OWNER', 'w4', {
      scanEvidenceRetentionDays: 7,
    })
    await sweepExpiredScanEvidence(NOW)
    expect(await holdsCode('w4_s')).toBe(false)
  })

  it('scan evidence scrub keeps non-code fields and skips legacy scans', async () => {
    await seedWorkspace('w5')
    await seedPr('w5_merged', 'w5', { state: 'merged', mergedAt: ago(8 * DAY) })
    await seedScan('w5_s', 'w5_merged', 'w5', { finishedAt: ago(9 * DAY) })
    await seedScan('w5_legacy', 'w5_merged', 'w5', { finishedAt: ago(9 * DAY) })
    await harness.prisma!.prSecurityScan.update({
      where: { id: 'w5_legacy' },
      data: { retentionTracked: false },
    })

    await sweepExpiredScanEvidence(NOW)

    expect(await holdsCode('w5_legacy')).toBe(true)
    expect(await holdsCode('w5_s')).toBe(false)
    const scan = await harness.prisma!.prSecurityScan.findUniqueOrThrow({
      where: { id: 'w5_s' },
      include: { findings: true },
    })
    expect(scan.status).toBe('FINDINGS')
    expect(scan.stages).toEqual(FINAL_STAGES)
    expect(scan.partialCauses).toEqual(['HUNT_OVERSIZED'])
    expect(scan.prSummary).toBeNull()
    expect(scan.huntJob).toBeNull()
    expect(scan.findings[0]).toMatchObject({
      ruleId: 'vuln:sql-injection',
      kind: 'VULNERABILITY',
      severity: 'HIGH',
      filePath: 'src/db.ts',
      line: 12,
      fingerprint: 'w5_s_fp',
      cwe: 'CWE-89',
      disposition: 'ACCEPTED_RISK',
      dispositionNote: 'owner ruled',
      suggestedDisposition: 'FALSE_POSITIVE',
      title: 'vuln:sql-injection',
      detail: '',
      evidence: '',
      callChain: null,
      suggestedReason: null,
    })
    // The hunt counts the UI reads survive.
    const coverage = parseHuntCoverage(scan.huntAudit)
    expect(coverage).toMatchObject({ total: 1, done: 1 })
    expect(
      huntOverCapOf({
        stages: { hunt: 'SKIPPED' },
        partialCauses: ['HUNT_OVERSIZED'],
        huntAudit: scan.huntAudit,
      })
    ).toEqual({ sourceFiles: 900, capFiles: 400 })
    expect(scan.huntAudit).toMatchObject({
      candidates: 2,
      falsifierRejects: 1,
      rejected: [{ category: 'injection' }],
      diff: { sourceFiles: 3, sites: 2, taskCap: 3, oversized: false },
    })

    // Pre-LUM-911 rows are added untracked; new rows default to tracked.
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20261001040000_lum911_scan_evidence_retention/migration.sql'
      ),
      'utf8'
    )
    expect(sql).toMatch(
      /ADD COLUMN "retentionTracked" BOOLEAN NOT NULL DEFAULT false;/
    )
    expect(sql).toMatch(/ALTER COLUMN "retentionTracked" SET DEFAULT true;/)
  })
})

describe('LUM-911 evidence-retention helpers', () => {
  const pr = {
    state: 'merged',
    mergedAt: ago(8 * DAY),
    closedAt: null,
    updatedAt: NOW,
  }
  const scan = {
    status: 'FINDINGS',
    stages: FINAL_STAGES,
    startedAt: ago(9 * DAY),
    finishedAt: ago(9 * DAY),
  }

  it('isScanFinal needs a terminal status and no pending layer', () => {
    expect(isScanFinal(scan)).toBe(true)
    expect(isScanFinal({ ...scan, status: 'RUNNING' })).toBe(false)
    expect(isScanFinal({ ...scan, stages: { hunt: 'PENDING' } })).toBe(false)
    expect(isScanFinal({ ...scan, stages: null })).toBe(true)
  })

  it('pullRequestEndedAt is null while open and falls back to updatedAt', () => {
    expect(pullRequestEndedAt({ ...pr, state: 'open' })).toBeNull()
    expect(pullRequestEndedAt(pr)).toEqual(pr.mergedAt)
    expect(
      pullRequestEndedAt({ ...pr, state: 'closed', mergedAt: null })
    ).toEqual(NOW)
  })

  it('isScanEvidenceExpired treats an unknown tier as the default', () => {
    const input = { scan, pullRequest: pr, allScansFinal: true, now: NOW }
    expect(isScanEvidenceExpired({ ...input, retentionDays: 5 })).toBe(true)
    expect(isScanEvidenceExpired({ ...input, retentionDays: 14 })).toBe(false)
  })

  it('redactHuntAuditToCounts drops code and keeps list lengths', () => {
    const out = redactHuntAuditToCounts(HUNT_AUDIT)
    expect(JSON.stringify(out)).not.toContain('req.query.t')
    expect(out).toMatchObject({
      planned: [{ category: 'injection' }],
      tasks: [{ taskId: 't1', category: 'injection', stopped: 'done' }],
    })
    expect(redactHuntAuditToCounts(null)).toBeNull()
    expect(redactHuntAuditToCounts({ error: CODE })).toEqual({
      error: 'redacted',
    })
  })
})
