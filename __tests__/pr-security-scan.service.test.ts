/**
 * @jest-environment node
 *
 * LUM-732 — scan service. Repositories and GitHub/LLM callers are mocked; the
 * secret scanner and diff parser are REAL so the fingerprint math is exercised.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
}))
jest.mock('@/lib/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByPrAndSha: jest.fn(),
    create: jest.fn(),
    restart: jest.fn(),
    claimPending: jest.fn(),
    finalize: jest.fn(),
    createFindings: jest.fn(),
    persistResult: jest.fn(),
    countExternalFindings: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
    findLatestByPullRequestIds: jest.fn(),
    findFindingWithScope: jest.fn(),
    updateDisposition: jest.fn(),
    mergeStages: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findLastSarifIngestAt: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
// LUM-739: this suite pins the hunt OFF (see beforeEach); the trigger/handoff
// behaviour has its own suite in pr-security-scan.service.hunt-trigger.test.ts.
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
// LUM-738 — the lazy baseline request made when stage A queues the managed run.
jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue('present') },
}))
// LUM-735 Task 2 — the PR write-back is fired best-effort from run().
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

import {
  prSecurityScanService,
  STALE_RUNNING_MS,
  stagesOf,
  isCompleteScan,
} from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { startSecurityManagedScan } from '@/lib/services/security-managed-scan-start'
import { securityBaselineService } from '@/lib/services/security-baseline.service'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import { waitUntil } from '@vercel/functions'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/security-judge-client'
import { secretFingerprint } from '@/lib/security-scan/redact'
import { SECURITY_DIFF_MAX_CHARS } from '@/lib/security-scan'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const prRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const judgeSecurity = judge.judgeSecurity as jest.Mock
const startManaged = startSecurityManagedScan as jest.Mock
const syncReview = securityPrReviewService.sync as jest.Mock
const waitUntilMock = waitUntil as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}
const KEY = 'AKIAABCDEFGHIJKLMNOP'
const SECRET_DIFF = [
  '--- a/src/cfg.ts',
  '+++ b/src/cfg.ts',
  '@@ -1,0 +1,1 @@',
  `+const k = "${KEY}"`,
].join('\n')
const CLEAN_DIFF = [
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,0 +1,1 @@',
  '+const x = 1',
].join('\n')

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_SECURITY_HUNT = 'off'
  prRepo.findById.mockResolvedValue(PR as never)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' })
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  judgeSecurity.mockResolvedValue({ findings: [] })
  syncReview.mockResolvedValue({ posted: true, inline: 0, skipped: 0 })
  waitUntilMock.mockClear()
  ;(projectRepository.findLastSarifIngestAt as jest.Mock).mockResolvedValue(
    undefined
  )
})

// The stale-RUNNING test freezes Date.now with a spy; restore it so a later
// test never runs against a pinned clock.
afterEach(() => jest.restoreAllMocks())

test('dedupes on (pullRequestId, headSha) and inherits dispositions by fingerprint', async () => {
  // First run on sha-1: a fresh scan with one HIGH secret finding.
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  const first = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(first).toEqual({
    deduped: false,
    scanId: 's1',
    status: 'FINDINGS',
    findings: 1,
  })
  expect(repo.persistResult).toHaveBeenCalledWith(
    's1',
    [
      expect.objectContaining({
        scanId: 's1',
        ruleId: 'secret:aws-access-key-id',
        severity: 'HIGH',
        provenance: 'DETERMINISTIC',
        disposition: null,
      }),
    ],
    expect.objectContaining({ status: 'FINDINGS' })
  )
  expect(repo.persistResult.mock.calls[0]![1][0]!.evidence).not.toContain(KEY)

  // Second request for the SAME sha: no new scan, no diff fetched (the head
  // sha lookup is the dedup key and still runs).
  repo.findByPrAndSha.mockResolvedValue({
    id: 's1',
    status: 'FINDINGS',
    startedAt: new Date(),
  })
  const again = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(again).toEqual({ deduped: true, scanId: 's1' })
  expect(repo.create).toHaveBeenCalledTimes(1)
  expect(fetchPrDiff).toHaveBeenCalledTimes(1)

  // A new push (sha-2) with the same secret: the human's earlier FALSE_POSITIVE
  // is carried over by fingerprint.
  fetchPrHeadSha.mockResolvedValue('sha-2')
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's2' })
  const fp = secretFingerprint('secret:aws-access-key-id', KEY)
  const when = new Date('2026-09-01T00:00:00Z')
  repo.findDispositionedByPullRequest.mockResolvedValue([
    {
      id: 'f-old',
      fingerprint: fp,
      disposition: 'FALSE_POSITIVE',
      dispositionNote: 'doc key',
      dispositionedById: 'm1',
      dispositionedAt: when,
    },
  ])
  const third = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(third).toMatchObject({
    deduped: false,
    scanId: 's2',
    status: 'FINDINGS',
  })
  expect(repo.persistResult).toHaveBeenLastCalledWith(
    's2',
    [
      expect.objectContaining({
        scanId: 's2',
        fingerprint: fp,
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'doc key',
        dispositionedById: 'm1',
        dispositionedAt: when,
        inheritedFromFindingId: 'f-old',
      }),
    ],
    expect.objectContaining({ status: 'FINDINGS' })
  )
})

test('a concurrent duplicate create is treated as deduped, not an error', async () => {
  // Two triggers (PR_EVENT webhook + PR_LINK) race on the same (pr, sha): both
  // see findByPrAndSha() -> null, both call create(), and the loser hits the
  // unique constraint. That should read as a dedup, not a thrown error.
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  repo.findByPrAndSha.mockResolvedValueOnce(null).mockResolvedValueOnce({
    id: 's-race',
    status: 'RUNNING',
    startedAt: new Date(),
  })
  repo.create.mockRejectedValueOnce(
    Object.assign(new Error('Unique constraint'), { code: 'P2002' })
  )

  const result = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_LINK',
  })

  expect(result).toEqual({ deduped: true, scanId: 's-race' })
  expect(fetchPrDiff).not.toHaveBeenCalled()
  expect(repo.finalize).not.toHaveBeenCalled()
})

test('a create collision whose winner is a SARIF-push PENDING row is claimed, not deduped', async () => {
  // LUM-735 review: the P2002 race can also land on a row the ingest worker
  // created ahead of any webhook (status PENDING). That must go through the
  // same claim/restart/dedupe three-way rule as the plain `existing` branch,
  // not always read as `{ deduped: true }`.
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  repo.findByPrAndSha.mockResolvedValueOnce(null).mockResolvedValueOnce({
    id: 's-push',
    status: 'PENDING',
    startedAt: new Date(),
  })
  repo.create.mockRejectedValueOnce(
    Object.assign(new Error('Unique constraint'), { code: 'P2002' })
  )

  const result = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })

  expect(result).toMatchObject({ deduped: false, scanId: 's-push' })
  expect(repo.claimPending).toHaveBeenCalledWith('s-push')
  expect(repo.restart).not.toHaveBeenCalled()
  expect(repo.persistResult).toHaveBeenCalledWith(
    's-push',
    expect.anything(),
    expect.anything()
  )
})

test('judge failure finalizes the scan with judgeStatus UNAVAILABLE, never CLEAN', async () => {
  judgeSecurity.mockRejectedValue(new Error('gateway down'))

  // Deterministic pass found a secret: status is FINDINGS with the judge marked
  // unavailable — the outage never hides the deterministic result.
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  const withSecret = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(withSecret).toMatchObject({ status: 'FINDINGS', findings: 1 })
  // A judge outage is still a SUCCESS path: rows + status land together in the
  // one transactional write, with UNAVAILABLE stamped on it.
  expect(repo.persistResult).toHaveBeenLastCalledWith(
    's1',
    [expect.objectContaining({ provenance: 'DETERMINISTIC' })],
    expect.objectContaining({ status: 'FINDINGS', judgeStatus: 'UNAVAILABLE' })
  )

  // No deterministic hit: the scan finalizes with UNAVAILABLE stamped so the
  // panel can say "LLM review did not complete" — it is not FAILED and the
  // judgeStatus is never RAN.
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  repo.create.mockResolvedValue({ id: 's3' })
  const clean = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(clean).toMatchObject({ scanId: 's3', status: 'CLEAN', findings: 0 })
  const calls = repo.persistResult.mock.calls
  const last = calls[calls.length - 1]!
  expect(last[0]).toBe('s3')
  expect(last[1]).toEqual([])
  expect(last[2]).toMatchObject({ status: 'CLEAN', judgeStatus: 'UNAVAILABLE' })
  expect(last[2].judgeStatus).not.toBe('RAN')
})

test('a GitHub failure marks the scan FAILED and a FAILED scan is restarted on the next request', async () => {
  fetchPrDiff.mockRejectedValue(
    Object.assign(new Error('GitHub API error 502'), { status: 502 })
  )
  const r = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_LINK',
  })
  expect(r).toMatchObject({ status: 'FAILED' })
  expect(repo.finalize).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      status: 'FAILED',
      error: expect.stringContaining('502'),
    })
  )

  repo.findByPrAndSha.mockResolvedValue({
    id: 's1',
    status: 'FAILED',
    startedAt: new Date(),
  })
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_LINK' })
  expect(repo.restart).toHaveBeenCalledWith('s1')
  expect(repo.create).toHaveBeenCalledTimes(1)
})

test('a scan wedged in RUNNING past the stale window is restarted, a fresh one is not', async () => {
  // LUM-732 review I6: the worker can die mid-scan (deploy, OOM, 300s cap) and
  // leave the row RUNNING forever. Every later push to the same sha then
  // deduped onto that corpse, so the PR was never scanned again — a permanent
  // "Scanning" badge and a DONE gate with nothing to say.
  const now = new Date('2026-09-03T12:00:00Z').getTime()
  jest.spyOn(Date, 'now').mockReturnValue(now)
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)

  // 1 minute old: still plausibly alive — leave it alone.
  repo.findByPrAndSha.mockResolvedValue({
    id: 's-live',
    status: 'RUNNING',
    startedAt: new Date(now - 60 * 1000),
  })
  expect(
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
  ).toEqual({ deduped: true, scanId: 's-live' })
  expect(repo.restart).not.toHaveBeenCalled()
  expect(fetchPrDiff).not.toHaveBeenCalled()

  // 11 minutes old: past STALE_RUNNING_MS — restart and actually scan.
  repo.findByPrAndSha.mockResolvedValue({
    id: 's-stuck',
    status: 'RUNNING',
    startedAt: new Date(now - STALE_RUNNING_MS - 60 * 1000),
  })
  const r = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(repo.restart).toHaveBeenCalledWith('s-stuck')
  expect(r).toMatchObject({
    deduped: false,
    scanId: 's-stuck',
    status: 'CLEAN',
  })
  expect(repo.persistResult).toHaveBeenCalledWith(
    's-stuck',
    [],
    expect.objectContaining({ status: 'CLEAN' })
  )
  // A PENDING row (LUM-735: created by a CI SARIF push ahead of any webhook)
  // is claimed in place regardless of age — it is not a wedged worker, it is
  // waiting for stage A to run at all.
  repo.findByPrAndSha.mockResolvedValue({
    id: 's-queued',
    status: 'PENDING',
    startedAt: new Date(now - STALE_RUNNING_MS - 1),
  })
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(repo.claimPending).toHaveBeenCalledWith('s-queued')
  expect(repo.restart).not.toHaveBeenCalledWith('s-queued')
  // Never a second row for the same (pr, sha): claimed in-place.
  expect(repo.create).not.toHaveBeenCalled()
})

test('LLM findings are advisory, redacted when credential-shaped, and sorted after deterministic ones', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  judgeSecurity.mockResolvedValue({
    findings: [
      {
        kind: 'hardcoded_credential',
        severity: 'HIGH',
        filePath: 'src/a.ts',
        line: 1,
        title: 'Hardcoded token',
        detail: 'd',
        evidence: 'const t = "Zx9Qw3Lp7Vb2Nm5Rt8Ky"',
      },
      {
        kind: 'sql_injection',
        severity: 'HIGH',
        filePath: 'src/a.ts',
        line: null,
        title: 'Unparameterised query',
        detail: 'd',
        evidence: 'db.query(`SELECT ${id}`)',
      },
    ],
  })
  const r = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(r).toMatchObject({ status: 'FINDINGS', findings: 2 })
  const rows = repo.persistResult.mock.calls[0]![1]
  expect(rows[0]).toMatchObject({
    kind: 'SECRET',
    ruleId: 'secret:llm-hardcoded-credential',
    provenance: 'LLM_JUDGE',
  })
  expect(rows[0]!.evidence).not.toContain('Zx9Qw3Lp7Vb2Nm5Rt8Ky')
  expect(rows[1]).toMatchObject({
    kind: 'VULNERABILITY',
    ruleId: 'vuln:sql_injection',
    provenance: 'LLM_JUDGE',
    line: null,
  })
})

test('every LLM-authored field is redacted, not just evidence', async () => {
  // LUM-732 review C1: the judge echoes the offending line back to us, and it
  // does so in whichever field it feels like — a title that quotes the key, a
  // detail that spells it out, a filePath the model hallucinated a token into.
  // Redacting `evidence` alone persisted the raw secret in the other three.
  const SLACK = 'xoxb-1234567890-ABCDEFGHIJKLMNOP'
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  judgeSecurity.mockResolvedValue({
    findings: [
      {
        kind: 'hardcoded_credential',
        severity: 'HIGH',
        filePath: `src/${SLACK}.ts`,
        line: 1,
        title: `Hardcoded AWS key ${KEY}`,
        detail: `The added line assigns ${KEY} to a constant.`,
        evidence: `const k = "${KEY}"`,
      },
    ],
  })
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  const row = repo.persistResult.mock.calls[0]![1][0]!
  expect(row.title).not.toContain(KEY)
  expect(row.detail).not.toContain(KEY)
  expect(row.evidence).not.toContain(KEY)
  expect(row.filePath).not.toContain(SLACK)
  // Redacted, not blanked: the human still has to be able to read the finding.
  expect(row.title).toContain('Hardcoded AWS key')
  expect(row.detail).toContain('assigns')
  expect(row.filePath).toContain('src/')
})

test('getForTask returns the latest scan per PR and the blocking count', async () => {
  prRepo.findManyForSecurityByTaskId.mockResolvedValue([
    { id: 'pr1', number: 7, title: 'x', url: 'u', state: 'open' },
    { id: 'pr2', number: 6, title: 'y', url: 'v', state: 'merged' },
  ])
  const base = {
    pullRequestId: 'pr1',
    taskId: 't1',
    workspaceId: 'w1',
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    truncated: false,
    detectorVersion: 'v',
    error: null,
    finishedAt: null,
  }
  const finding = (over: object) => ({
    id: 'f',
    scanId: 's',
    kind: 'SECRET',
    ruleId: 'secret:x',
    severity: 'HIGH',
    provenance: 'DETERMINISTIC',
    filePath: 'a',
    line: 1,
    title: 't',
    detail: 'd',
    evidence: 'e',
    fingerprint: 'fp',
    externalRef: null,
    disposition: null,
    dispositionNote: null,
    dispositionedById: null,
    dispositionedAt: null,
    inheritedFromFindingId: null,
    createdAt: new Date(0),
    ...over,
  })
  repo.findLatestByPullRequestIds.mockResolvedValue([
    {
      ...base,
      id: 'new',
      headSha: 'b',
      status: 'FINDINGS',
      startedAt: new Date(2000),
      findings: [
        finding({ id: 'f1' }),
        finding({ id: 'f2', provenance: 'LLM_JUDGE' }),
        finding({ id: 'f3', disposition: 'FALSE_POSITIVE' }),
      ],
    },
    {
      ...base,
      id: 'old',
      headSha: 'a',
      status: 'CLEAN',
      startedAt: new Date(1000),
      findings: [],
    },
  ] as never)
  const view = await prSecurityScanService.getForTask('t1')
  expect(view.prs.map(p => p.pr.id)).toEqual(['pr1', 'pr2'])
  expect(view.prs[0]!.latest?.id).toBe('new')
  expect(view.prs[1]!.latest).toBeNull()
  expect(view.blocking.count).toBe(1)
  expect(view.prs[0]!.latest?.findings.map(f => f.id)).toEqual([
    'f1',
    'f3',
    'f2',
  ])
})

describe('LUM-735 SARIF push — stage A side', () => {
  const lastIngest = projectRepository.findLastSarifIngestAt as jest.Mock
  const countExternal = repo.countExternalFindings as jest.Mock
  const ORIGINAL_LUMO_MANAGED_SCAN = process.env.LUMO_MANAGED_SCAN

  beforeEach(() => {
    startManaged.mockResolvedValue('run_1')
    delete process.env.LUMO_MANAGED_SCAN
  })

  afterEach(() => {
    if (ORIGINAL_LUMO_MANAGED_SCAN === undefined) {
      delete process.env.LUMO_MANAGED_SCAN
    } else {
      process.env.LUMO_MANAGED_SCAN = ORIGINAL_LUMO_MANAGED_SCAN
    }
  })

  test('a repo that never pushed SARIF → stages.external=NOT_CONFIGURED, CLEAN by findings', async () => {
    process.env.LUMO_MANAGED_SCAN = 'off'
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    lastIngest.mockResolvedValue(null)
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ status: 'CLEAN', findings: 0 })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        partial: false,
        stages: {
          secrets: 'RAN',
          external: 'NOT_CONFIGURED',
          judge: 'RAN',
        },
      })
    )
    expect(lastIngest).toHaveBeenCalledWith('w1', 'o/r')
    expect(startManaged).not.toHaveBeenCalled()
  })

  test('a repo that pushed before but not for this sha → PENDING', async () => {
    process.env.LUMO_MANAGED_SCAN = 'off'
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    lastIngest.mockResolvedValue(new Date('2026-09-01T00:00:00Z'))
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({ external: 'PENDING' }),
      })
    )
    expect(startManaged).not.toHaveBeenCalled()
  })

  test('managed scan on, no external rows yet → starts the workflow with the scan row and PENDING', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(0)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(startManaged).toHaveBeenCalledWith({
      scanId: 's1',
      pr: { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 },
      headSha: 'sha-1',
    })
    expect(lastIngest).not.toHaveBeenCalled()
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({ external: 'PENDING' }),
      })
    )
  })

  test('LUM-738 supplyChain surface — queuing the managed run stamps supplyChain PENDING beside external and requests the baseline lazily', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(0)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({
          external: 'PENDING',
          supplyChain: 'PENDING',
        }),
      })
    )
    expect(securityBaselineService.ensure).toHaveBeenCalledWith({
      workspaceId: 'w1',
      repo: 'o/r',
    })
  })

  test('LUM-738 baseline — a run that could not be queued fails both layers and requests no baseline', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(0)
    startManaged.mockResolvedValue(null)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({
          external: 'FAILED',
          supplyChain: 'FAILED',
        }),
      })
    )
    expect(securityBaselineService.ensure).not.toHaveBeenCalled()
  })

  test('LUM-738 supplyChain surface — rows already landed / managed scan off: no supplyChain key is claimed', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(2)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    const stages = (
      repo.persistResult.mock.calls[0]![2] as {
        stages: Record<string, unknown>
      }
    ).stages
    expect(stages).not.toHaveProperty('supplyChain')
    expect(securityBaselineService.ensure).not.toHaveBeenCalled()
  })

  test('managed scan on, external rows already there → RAN and no new scan', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(2)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(startManaged).not.toHaveBeenCalled()
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({ external: 'RAN' }),
      })
    )
  })

  test('managed scan start failing → external=FAILED, the scan still completes', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(0)
    startManaged.mockResolvedValue(null)
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ status: 'CLEAN' })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({ external: 'FAILED' }),
      })
    )
  })

  test('SARIF already ingested for this sha → RAN and status FINDINGS even with no A1/judge rows', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(2)
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ status: 'FINDINGS' })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        status: 'FINDINGS',
        stages: expect.objectContaining({ external: 'RAN' }),
      })
    )
  })

  test('a PENDING row created by the SARIF push is claimed, not deduped or restarted', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    repo.findByPrAndSha.mockResolvedValue({
      id: 's-push',
      status: 'PENDING',
      startedAt: new Date(),
    })
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ deduped: false, scanId: 's-push' })
    expect(repo.claimPending).toHaveBeenCalledWith('s-push')
    expect(repo.restart).not.toHaveBeenCalled()
    expect(repo.create).not.toHaveBeenCalled()
  })

  test('lastSarifIngestAt lookup failure → external FAILED, scan still finalizes', async () => {
    process.env.LUMO_MANAGED_SCAN = 'off'
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    lastIngest.mockRejectedValue(new Error('db down'))
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ status: 'CLEAN' })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({ external: 'FAILED' }),
      })
    )
  })

  test('empty diff → secrets RAN, external still resolved, judge SKIPPED', async () => {
    process.env.LUMO_MANAGED_SCAN = 'off'
    fetchPrDiff.mockResolvedValue('')
    lastIngest.mockResolvedValue(null)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: {
          secrets: 'RAN',
          external: 'NOT_CONFIGURED',
          judge: 'SKIPPED',
        },
      })
    )
  })
})

describe('LUM-735 stages — judge outage, finalize-with-stages, view helpers', () => {
  afterEach(() => {
    delete process.env.LUMO_MANAGED_SCAN
  })

  test('judge UNAVAILABLE is mirrored as stages.judge=FAILED', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    judgeSecurity.mockRejectedValue(new Error('gateway down'))
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        judgeStatus: 'UNAVAILABLE',
        stages: expect.objectContaining({ judge: 'FAILED' }),
      })
    )
  })

  test('a scan that throws after stages were collected finalizes FAILED with those stages', async () => {
    process.env.LUMO_MANAGED_SCAN = 'off'
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    repo.findDispositionedByPullRequest.mockRejectedValue(new Error('db down'))
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ status: 'FAILED' })
    expect(repo.finalize).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'FAILED',
        stages: expect.objectContaining({
          secrets: 'RAN',
          external: 'NOT_CONFIGURED',
        }),
        partial: false,
      })
    )
  })

  test('getForTask exposes stages, partial, complete and externalLate on the view', async () => {
    prRepo.findManyForSecurityByTaskId.mockResolvedValue([
      { id: 'pr1', number: 7, title: 't', url: 'u', state: 'open' },
    ] as never)
    repo.findLatestByPullRequestIds.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
        headSha: 'sha-1',
        status: 'CLEAN',
        trigger: 'PR_EVENT',
        judgeStatus: 'RAN',
        truncated: false,
        stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
        partial: false,
        detectorVersion: 'x',
        error: null,
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        finishedAt: null,
        findings: [
          {
            id: 'f1',
            scanId: 's1',
            kind: 'VULNERABILITY',
            ruleId: 'ext:semgrep-oss:js.sqli',
            severity: 'HIGH',
            provenance: 'EXTERNAL_TOOL',
            filePath: 'src/a.ts',
            line: 1,
            title: 't',
            detail: 'd',
            evidence: '',
            fingerprint: 'fp',
            externalRef: 'https://github.com/o/r/security/code-scanning/7',
            disposition: null,
            dispositionNote: null,
            dispositionedById: null,
            dispositionedAt: null,
            inheritedFromFindingId: null,
            createdAt: new Date(),
          },
        ],
      },
    ] as never)
    const out = await prSecurityScanService.getForTask('t1')
    expect(out.prs[0]!.latest).toMatchObject({
      stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
      partial: false,
      complete: false,
      externalLate: true,
    })
    expect(out.prs[0]!.latest!.findings[0]).toMatchObject({
      externalRef: 'https://github.com/o/r/security/code-scanning/7',
      blocking: false,
    })
  })

  test('getForTask: externalLate is false when a PENDING scan just started', async () => {
    prRepo.findManyForSecurityByTaskId.mockResolvedValue([
      { id: 'pr1', number: 7, title: 't', url: 'u', state: 'open' },
    ] as never)
    repo.findLatestByPullRequestIds.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
        headSha: 'sha-1',
        status: 'CLEAN',
        trigger: 'PR_EVENT',
        judgeStatus: 'RAN',
        truncated: false,
        stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
        partial: false,
        detectorVersion: 'x',
        error: null,
        startedAt: new Date(),
        finishedAt: null,
        findings: [],
      },
    ] as never)
    const out = await prSecurityScanService.getForTask('t1')
    expect(out.prs[0]!.latest).toMatchObject({ externalLate: false })
  })

  test('getForTask never renders a FAILED scan as complete, even with empty stages', async () => {
    prRepo.findManyForSecurityByTaskId.mockResolvedValue([
      { id: 'pr1', number: 7, title: 't', url: 'u', state: 'open' },
    ] as never)
    repo.findLatestByPullRequestIds.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
        headSha: 'sha-1',
        status: 'FAILED',
        trigger: 'PR_EVENT',
        judgeStatus: null,
        truncated: false,
        stages: {},
        partial: false,
        detectorVersion: 'x',
        error: 'boom',
        startedAt: new Date('2026-09-09T00:00:00Z'),
        finishedAt: null,
        findings: [],
      },
    ] as never)
    const out = await prSecurityScanService.getForTask('t1')
    expect(out.prs[0]!.latest).toMatchObject({ complete: false })
  })

  test('getForTask: complete is false when partial=true even though every stage RAN', async () => {
    prRepo.findManyForSecurityByTaskId.mockResolvedValue([
      { id: 'pr1', number: 7, title: 't', url: 'u', state: 'open' },
    ] as never)
    repo.findLatestByPullRequestIds.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
        headSha: 'sha-1',
        status: 'CLEAN',
        trigger: 'PR_EVENT',
        judgeStatus: 'RAN',
        truncated: false,
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        partial: true,
        detectorVersion: 'x',
        error: null,
        startedAt: new Date('2026-09-09T00:00:00Z'),
        finishedAt: null,
        findings: [],
      },
    ] as never)
    const out = await prSecurityScanService.getForTask('t1')
    expect(out.prs[0]!.latest).toMatchObject({
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
      partial: true,
      complete: false,
    })
  })

  test('getForTask: complete is true when partial=false and every stage RAN', async () => {
    prRepo.findManyForSecurityByTaskId.mockResolvedValue([
      { id: 'pr1', number: 7, title: 't', url: 'u', state: 'open' },
    ] as never)
    repo.findLatestByPullRequestIds.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
        headSha: 'sha-1',
        status: 'CLEAN',
        trigger: 'PR_EVENT',
        judgeStatus: 'RAN',
        truncated: false,
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        partial: false,
        detectorVersion: 'x',
        error: null,
        startedAt: new Date('2026-09-09T00:00:00Z'),
        finishedAt: null,
        findings: [],
      },
    ] as never)
    const out = await prSecurityScanService.getForTask('t1')
    expect(out.prs[0]!.latest).toMatchObject({
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
      partial: false,
      complete: true,
    })
  })

  test('a diff over SECURITY_DIFF_MAX_CHARS marks the judge truncated and the scan partial', async () => {
    const bigDiff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +1,1 @@',
      `+const x = "${'x'.repeat(SECURITY_DIFF_MAX_CHARS + 10)}"`,
    ].join('\n')
    fetchPrDiff.mockResolvedValue(bigDiff)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      expect.anything(),
      expect.objectContaining({ truncated: true, partial: true })
    )
  })

  test('stagesOf derives a legacy view from judgeStatus when stages is null', () => {
    expect(stagesOf({ stages: null, judgeStatus: 'RAN' })).toEqual({
      secrets: 'RAN',
      judge: 'RAN',
    })
    expect(stagesOf({ stages: null, judgeStatus: 'UNAVAILABLE' })).toEqual({
      secrets: 'RAN',
      judge: 'FAILED',
    })
    expect(stagesOf({ stages: null, judgeStatus: null })).toEqual({
      secrets: 'RAN',
    })
    expect(
      stagesOf({
        stages: { secrets: 'RAN', external: 'RAN' },
        judgeStatus: 'RAN',
      })
    ).toEqual({ secrets: 'RAN', external: 'RAN' })
  })

  test('isCompleteScan is false for any FAILED / NOT_CONFIGURED / PARTIAL layer', () => {
    expect(isCompleteScan({ secrets: 'RAN', judge: 'SKIPPED' })).toBe(true)
    expect(isCompleteScan({ secrets: 'RAN', external: 'NOT_CONFIGURED' })).toBe(
      false
    )
    expect(isCompleteScan({ secrets: 'RAN', judge: 'FAILED' })).toBe(false)
    expect(isCompleteScan({ secrets: 'RAN', external: 'PARTIAL' })).toBe(false)
    expect(isCompleteScan({ secrets: 'RAN', external: 'PENDING' })).toBe(false)
    expect(isCompleteScan({})).toBe(true)
  })
})

// ── LUM-735 Task 2: PR write-back is fired from stage A ─────────────────────

test('a finished scan whose external rows are already in hands the PR write-back to waitUntil', async () => {
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  // external rows present → stage A starts no managed run, so nobody else is
  // going to post: stage A owns this summary.
  repo.countExternalFindings.mockResolvedValue(2)
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(syncReview).toHaveBeenCalledWith('s1')
  expect(waitUntilMock).toHaveBeenCalledWith(syncReview.mock.results[0]!.value)
})

test('a scan that just started a managed run does NOT post — the workflow will', async () => {
  // Otherwise every managed scan puts two summaries on the PR: stage A's
  // (external still PENDING, no external findings) and, a minute later, the
  // workflow's. The marker upsert dedupes across syncs, not against one that
  // has not happened yet.
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  repo.countExternalFindings.mockResolvedValue(0)
  startManaged.mockResolvedValue('run_1')
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(startManaged).toHaveBeenCalled()
  expect(syncReview).not.toHaveBeenCalled()
})

test('a blocking secret finding is posted right away even when a managed run was started', async () => {
  // A DONE-blocking DETERMINISTIC HIGH must reach the PR even if the queued
  // managed run never executes; the marker dedupe keeps the later sync cheap.
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  repo.countExternalFindings.mockResolvedValue(0)
  startManaged.mockResolvedValue('run_1')
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(startManaged).toHaveBeenCalled()
  expect(syncReview).toHaveBeenCalledWith('s1')
})

test('a managed run that could not be queued leaves the write-back to stage A', async () => {
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  repo.countExternalFindings.mockResolvedValue(0)
  startManaged.mockResolvedValue(null)
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(syncReview).toHaveBeenCalledWith('s1')
})

test('with the managed scan off, stage A posts the summary itself', async () => {
  const previous = process.env.LUMO_MANAGED_SCAN
  process.env.LUMO_MANAGED_SCAN = 'off'
  try {
    fetchPrDiff.mockResolvedValue(SECRET_DIFF)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(startManaged).not.toHaveBeenCalled()
    expect(syncReview).toHaveBeenCalledWith('s1')
  } finally {
    if (previous === undefined) delete process.env.LUMO_MANAGED_SCAN
    else process.env.LUMO_MANAGED_SCAN = previous
  }
})

test('a FAILED scan still hands the PR write-back to waitUntil (P9)', async () => {
  fetchPrDiff.mockRejectedValue(new Error('GitHub API error 502'))
  const r = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_LINK',
  })
  expect(r).toMatchObject({ status: 'FAILED' })
  expect(syncReview).toHaveBeenCalledWith('s1')
  expect(waitUntilMock).toHaveBeenCalledWith(syncReview.mock.results[0]!.value)
})
