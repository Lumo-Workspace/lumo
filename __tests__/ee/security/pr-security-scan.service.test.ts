/**
 * @jest-environment node
 *
 * LUM-732 — scan service. Repositories and GitHub/LLM callers are mocked; the
 * secret scanner and diff parser are REAL so the fingerprint math is exercised.
 */
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  // LUM-1152: the description, read for `@<app> ignore` (only with a slug).
  fetchPrBody: jest.fn(),
  fetchReviewChangedPaths: jest.fn(),
  // LUM-785: stage A's graph rules read touched files; null = not found.
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/ee/security/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
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
    // LUM-740: the read model diffs against the previous scan's open rows.
    findPreviousOpenFingerprints: jest.fn().mockResolvedValue([]),
    findFindingWithScope: jest.fn(),
    updateDisposition: jest.fn(),
    mergeStages: jest.fn(),
    setManagedRunId: jest.fn(),
  },
}))
// LUM-740: the workspace policy read behind every "blocking" decision;
// null = the 732 default these expectations were written against.
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    // LUM-775: the default-branch baseline behind the merged-PR queue exit.
  },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    // LUM-1137: the workspace's pause-after (default 5).
    findReviewAutoPauseAfter: jest.fn().mockResolvedValue(5),
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))

jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
// LUM-745: supersede / hourly cap run before start().
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
  },
}))
// LUM-739: this suite pins the hunt OFF (see beforeEach); the trigger/handoff
// behaviour has its own suite in pr-security-scan.service.hunt-trigger.test.ts.
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
// LUM-738 — the lazy baseline request made when stage A queues the managed run.
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue('present') },
}))
// LUM-735 Task 2 — the PR write-back is fired best-effort from run().
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/ee/security/services/scan-code-retention.service', () => ({
  scrubScanIfRepositoryUnconfirmed: jest.fn(),
}))

import {
  prSecurityScanService,
  STALE_RUNNING_MS,
  stagesOf,
  isCompleteScan,
} from '@/ee/security/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { startSecurityManagedScan } from '@/ee/security/services/security-managed-scan-start'
import { securityManagedScanOpsService } from '@/ee/security/services/security-managed-scan-ops.service'
import { securityBaselineService } from '@/ee/security/services/security-baseline.service'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import { waitUntil } from '@/lib/runtime/wait-until'
import { scrubScanIfRepositoryUnconfirmed } from '@/ee/security/services/scan-code-retention.service'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/ee/security/llm/security-judge-client'
import { secretFingerprint } from '@/lib/security-scan/redact'
import {
  SECURITY_DIFF_MAX_CHARS,
  JUDGE_TIMEOUT_CEILING_MS,
  JUDGE_DIFF_BUDGET_TIERS,
} from '@/ee/security/security-scan'

/** 最高档的字符预算——越过它才谈得上截断（LUM-811）。 */
const JUDGE_DIFF_TOP_TIER_CHARS =
  JUDGE_DIFF_BUDGET_TIERS[JUDGE_DIFF_BUDGET_TIERS.length - 1]!.chars

/**
 * 一份真的越过最高档的 diff（LUM-811）。选档量改成 diff 长度之后，刚过 60k
 * 的 diff 会落进 120k 档、整份审完——要触发截断，fixture 必须越过 180k。
 * 铺成很多正常长度的行而不是一行超长：扫描器逐行跑正则，一条 18 万字符的行
 * 会把这个测试从半秒拖到一分钟。
 */
function overTopTierDiff(): string {
  const line = (i: number): string =>
    `const pad${i} = ${i} // ${'y'.repeat(24)}`
  const n = Math.ceil(JUDGE_DIFF_TOP_TIER_CHARS / (line(0).length + 2)) + 200
  const added = Array.from({ length: n }, (_, i) => line(i))
  return [
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    `@@ -0,0 +1,${added.length} @@`,
    ...added.map(l => `+${l}`),
  ].join('\n')
}

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
const supersede = securityManagedScanOpsService.supersedeOlderRuns as jest.Mock
const capCheck = securityManagedScanOpsService.enforceHourlyCap as jest.Mock
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

// LUM-988: these tests pin the VM keep-alive for the HUNT; with the agentic
// verifier on, stage A keeps it alive whenever the AI review is on (covered
// in pr-security-scan.service.lum988-verifier.test.ts).
beforeAll(() => {
  process.env.LUMO_REVIEW_VERIFIER = 'off'
})
afterAll(() => {
  delete process.env.LUMO_REVIEW_VERIFIER
})

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
  supersede.mockResolvedValue({
    superseded: 0,
    cancelled: 0,
    sandboxesStopped: 0,
  })
  capCheck.mockResolvedValue({ capped: false })
  repo.setManagedRunId.mockResolvedValue(undefined)
  waitUntilMock.mockClear()
  ;(
    securityColumnsRepository.findLastSarifIngestAt as jest.Mock
  ).mockResolvedValue(undefined)
})

// The stale-RUNNING test freezes Date.now with a spy; restore it so a later
// test never runs against a pinned clock.
afterEach(() => jest.restoreAllMocks())

test('LUM-896 write path rechecks the confirmed list after stage A persists its result', async () => {
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  const recheck = scrubScanIfRepositoryUnconfirmed as jest.Mock
  expect(recheck).toHaveBeenCalledWith('s1')
  expect(recheck.mock.invocationCallOrder[0]!).toBeGreaterThan(
    repo.persistResult.mock.invocationCallOrder[0]!
  )
})

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
      suggestedDisposition: null,
      suggestedReason: null,
      suggestionOutcome: null,
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
  expect(repo.restart).toHaveBeenCalledWith('s1', false, expect.any(Date))
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
  expect(repo.restart).toHaveBeenCalledWith('s-stuck', false, expect.any(Date))
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
    {
      id: 'pr1',
      number: 7,
      title: 'x',
      url: 'u',
      state: 'open',
      workspaceId: 'ws1',
      repo: 'o/r',
      headSha: null,
      mergedAt: null,
    },
    // A merged PR with no scan at all reads nothing — no baseline needed.
    {
      id: 'pr2',
      number: 6,
      title: 'y',
      url: 'v',
      state: 'merged',
      workspaceId: 'ws1',
      repo: 'o/r',
      headSha: null,
      mergedAt: null,
    },
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
  expect(view.prs[0]!.latest?.findings.every(f => f.queueExit === null)).toBe(
    true
  )
})

test('LUM-775 getForTask: a merged PR row carries its queue exit, is not blocking and is left out of the counts', async () => {
  const baselineRead =
    securityColumnsRepository.findSecurityBaseline as jest.Mock
  baselineRead.mockResolvedValue({
    sha: 'main',
    at: '2026-09-10T11:00:00Z',
    requestedAt: '2026-09-10T10:30:00Z',
    fingerprints: ['fp-still-there'],
    partial: false,
    tools: ['gitleaks', 'semgrep', 'osv-scanner'],
  })
  prRepo.findManyForSecurityByTaskId.mockResolvedValue([
    {
      id: 'pr1',
      number: 7,
      title: 'x',
      url: 'u',
      state: 'merged',
      workspaceId: 'ws1',
      repo: 'o/r',
      headSha: null,
      mergedAt: new Date('2026-09-10T10:00:00Z'),
    },
  ])
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
    persisting: false,
    suggestedDisposition: null,
    createdAt: new Date(0),
    ...over,
  })
  repo.findLatestByPullRequestIds.mockResolvedValue([
    {
      pullRequestId: 'pr1',
      taskId: 't1',
      workspaceId: 'w1',
      trigger: 'PR_EVENT',
      judgeStatus: 'RAN',
      truncated: false,
      detectorVersion: 'v',
      error: null,
      finishedAt: null,
      id: 's',
      headSha: 'b',
      status: 'FINDINGS',
      startedAt: new Date(2000),
      findings: [
        finding({ id: 'stays' }),
        finding({
          id: 'gone',
          kind: 'DEPENDENCY',
          ruleId: 'ext:osv-scanner:GHSA-1',
          provenance: 'EXTERNAL_TOOL',
          severity: 'MEDIUM',
          fingerprint: 'fp-gone',
          suggestedDisposition: 'FALSE_POSITIVE',
        }),
        finding({
          id: 'fixture',
          severity: 'LOW',
          filePath: '__tests__/x.test.ts',
        }),
      ],
    },
  ] as never)
  const view = await prSecurityScanService.getForTask('t1')
  const byId = new Map(
    view.prs[0]!.latest!.findings.map(f => [f.id, f] as const)
  )
  expect(byId.get('stays')).toMatchObject({ queueExit: null, blocking: true })
  expect(byId.get('gone')).toMatchObject({
    queueExit: 'RESOLVED_ON_MAIN',
    blocking: false,
  })
  expect(byId.get('fixture')).toMatchObject({
    queueExit: 'MERGED_UNREVIEWED',
    blocking: false,
  })
  expect(view.blocking.count).toBe(1)
  expect(view.suggested.count).toBe(0)
  expect(baselineRead).toHaveBeenCalledWith('w1', 'o/r')
})

describe('LUM-735 SARIF push — stage A side', () => {
  const lastIngest =
    securityColumnsRepository.findLastSarifIngestAt as jest.Mock
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
        partialCauses: [],
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

  test('LUM-740: the early PR sync on a blocking finding honours the workspace policy', async () => {
    // Default policy: a deterministic HIGH key blocks DONE → stage A syncs
    // the PR itself even though the managed run will sync later.
    fetchPrDiff.mockResolvedValue(SECRET_DIFF)
    countExternal.mockResolvedValue(0)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(waitUntilMock).toHaveBeenCalledTimes(1)

    // A workspace whose policy blocks nothing: nothing is urgent, the
    // managed run's own sync is the one summary.
    waitUntilMock.mockClear()
    syncReview.mockClear()
    ;(
      securityColumnsRepository.findSecurityPolicy as jest.Mock
    ).mockResolvedValueOnce({
      block: [],
    })
    repo.findByPrAndSha.mockResolvedValue(null)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(waitUntilMock).not.toHaveBeenCalled()
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
      // LUM-758: a clean diff triggers no hunt, so this run's VM is its own
      // and it stops it in the usual `finally`.
      huntWanted: false,
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

  test('LUM-745: supersede → cap → start → record the run id, in that order', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(0)
    const order: string[] = []
    supersede.mockImplementation(async () => {
      order.push('supersede')
      return { superseded: 1, cancelled: 1, sandboxesStopped: 1 }
    })
    capCheck.mockImplementation(async () => {
      order.push('cap')
      return { capped: false }
    })
    startManaged.mockImplementation(async () => {
      order.push('start')
      return 'run_1'
    })
    repo.setManagedRunId.mockImplementation(async () => {
      order.push('record')
    })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(order).toEqual(['supersede', 'cap', 'start', 'record'])
    expect(supersede).toHaveBeenCalledWith({
      pullRequestId: 'pr1',
      exceptScanId: 's1',
      newHeadSha: 'sha-1',
    })
    expect(capCheck).toHaveBeenCalledWith({ workspaceId: 'w1' })
    expect(repo.setManagedRunId).toHaveBeenCalledWith('s1', 'run_1')
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
  })

  test('LUM-745: hourly cap hit → no start, both layers FAILED, the prefixed reason lands in error, no baseline request', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(0)
    capCheck.mockResolvedValue({
      capped: true,
      reason:
        'external: rate-limited: 20 managed scans started in the last hour (cap 20)',
    })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(supersede).toHaveBeenCalled()
    expect(startManaged).not.toHaveBeenCalled()
    expect(repo.setManagedRunId).not.toHaveBeenCalled()
    expect(securityBaselineService.ensure).not.toHaveBeenCalled()
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({
          external: 'FAILED',
          supplyChain: 'FAILED',
        }),
        error:
          'external: rate-limited: 20 managed scans started in the last hour (cap 20)',
      })
    )
    // Nobody else will sync for a run that never started.
    expect(waitUntilMock).toHaveBeenCalled()
  })

  test('LUM-745: a failed managedRunId write is logged, the run stays PENDING and the scan does not fail', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    countExternal.mockResolvedValue(0)
    startManaged.mockResolvedValue('run_1')
    repo.setManagedRunId.mockRejectedValue(new Error('P1001'))
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ status: 'CLEAN' })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({ external: 'PENDING' }),
      })
    )
    expect(securityBaselineService.ensure).toHaveBeenCalled()
  })

  test('LUM-745: with the managed scan off nothing is superseded or counted', async () => {
    process.env.LUMO_MANAGED_SCAN = 'off'
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    lastIngest.mockResolvedValue(null)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(supersede).not.toHaveBeenCalled()
    expect(capCheck).not.toHaveBeenCalled()
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
        partialCauses: [],
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
      coverage: 'UNFINISHED',
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
      coverage: 'CHECKED',
      complete: true,
    })
  })

  // LUM-832 — like an industry-standard size cap, a diff over the AI review's top tier
  // is not reviewed at all (it used to be reviewed on a trimmed prefix): no
  // model call, and the scan records the cause the customer notice reads.
  test('a diff over the AI review cap is not reviewed at all and the scan says why', async () => {
    const bigDiff = overTopTierDiff()
    fetchPrDiff.mockResolvedValue(bigDiff)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(judgeSecurity).not.toHaveBeenCalled()
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      expect.anything(),
      expect.objectContaining({
        truncated: false,
        partialCauses: ['JUDGE_OVER_CAP'],
        judgeBudget: expect.objectContaining({
          diffChars: bigDiff.length,
          tierChars: JUDGE_DIFF_TOP_TIER_CHARS,
          reviewedChars: 0,
        }),
      })
    )
  })

  // LUM-758 — 上面那条只钉了 `truncated`/`partial` 两个标志位。截断之后
  // `stages.judge` 一直还是 'RAN'，在 PR 行里渲染成 “AI review: checked”：
  // 一个整文件没看过的层在宣称自己通过了。P9 说安全信号不得声称未建立的结论。
  // LUM-832 — and P9 still holds: the layer is never read as a pass.
  test('an over-cap diff never reads as a reviewed AI review layer', async () => {
    const bigDiff = overTopTierDiff()
    fetchPrDiff.mockResolvedValue(bigDiff)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      expect.anything(),
      expect.objectContaining({
        stages: expect.objectContaining({ judge: 'SKIPPED' }),
        judgeStatus: 'SKIPPED',
      })
    )
  })

  // LUM-758 — 预算按字节位置切时，一个文件有没有被 AI review 看过，取决于
  // 它的文件名排第几。LUM-832: over the cap the review no longer runs on a
  // trimmed selection at all, so no file — signal-carrying or not — is sent;
  // the whole-file packing below only ever sees diffs within the cap.
  test('over the cap no file is sent to the model, not even the one carrying the signal', async () => {
    const section = (path: string, body: string[]): string =>
      [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -0,0 +1,${body.length} @@`,
        ...body.map(l => `+${l}`),
      ].join('\n')
    // 尺寸卡在「恰好装得下两个」：sink 文件如果很小，贪心的跳过-继续
    // 无论排序如何都会把它捎带进去，测试就守不住优先级这件事本身。
    const filler = Array.from(
      { length: 4200 },
      (_, i) => `const pad${i} = ${i}`
    )
    const bigDiff = [
      section('app/a.ts', filler),
      section('lib/b.ts', filler),
      section('zz/sink.ts', [...filler, 'exec(userInput)']),
    ].join('\n')
    expect(bigDiff.length).toBeGreaterThan(JUDGE_DIFF_TOP_TIER_CHARS)
    expect(bigDiff.slice(0, JUDGE_DIFF_TOP_TIER_CHARS)).not.toContain(
      'exec(userInput)'
    )

    fetchPrDiff.mockResolvedValue(bigDiff)
    judgeSecurity.mockResolvedValue({ findings: [] })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })

    expect(judgeSecurity).not.toHaveBeenCalled()
    expect(repo.persistResult.mock.calls[0]![2].partialCauses).toContain(
      'JUDGE_OVER_CAP'
    )
  })

  // LUM-758 — 预算按改动源文件数分档。定值 60k 编码的是成本而不是容量，
  // 而成本该随要审的代码量走（L3 hunt 早就是这么分档的）。
  test('a big PR gets the wider budget and the matching timeout, not the flat 60k', async () => {
    const section = (path: string, body: string[]): string =>
      [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -0,0 +1,${body.length} @@`,
        ...body.map(l => `+${l}`),
      ].join('\n')
    const bigDiff = Array.from({ length: 31 }, (_, i) =>
      section(
        `lib/f${i}.ts`,
        Array.from({ length: 120 }, (_, j) => `const pad${j} = ${j}`)
      )
    ).join('\n')
    expect(bigDiff.length).toBeGreaterThan(SECURITY_DIFF_MAX_CHARS)

    fetchPrDiff.mockResolvedValue(bigDiff)
    judgeSecurity.mockResolvedValue({ findings: [] })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })

    const calls = judgeSecurity.mock.calls as unknown[][]
    const last = calls[calls.length - 1]![0] as {
      diff: string
      timeoutMs: number
    }
    expect(last.timeoutMs).toBe(JUDGE_TIMEOUT_CEILING_MS)
    // 分档之后整个 PR 都进得去：没有 omission marker，层也不是 PARTIAL。
    expect(last.diff).not.toContain('files omitted')
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      expect.anything(),
      expect.objectContaining({
        truncated: false,
        stages: expect.objectContaining({ judge: 'RAN' }),
      })
    )
  })

  // LUM-811 — LUM-758 按改动源文件数选档、发的却是字符预算，于是有一段反向
  // 区间：文件少而胖的 PR 比文件多而瘦的 PR 拿到更少的预算。这个 PR 就是那
  // 个形状（实测标本 PR 1028：6 个源文件、170,955 字符），旧规则给它 60k、丢
  // 掉六成；选档量改成 diff 自身的长度之后它整份进得去。
  test('sizes the judge budget by diff length, not changed source file count', async () => {
    const section = (path: string, body: string[]): string =>
      [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -0,0 +1,${body.length} @@`,
        ...body.map(l => `+${l}`),
      ].join('\n')
    // 6 个源文件——旧规则下这是最小档（≤12 个文件 → 60k）——但每个都很胖。
    const fatDiff = Array.from({ length: 6 }, (_, i) =>
      section(
        `lib/fat${i}.ts`,
        Array.from(
          { length: 530 },
          (_, j) => `const pad${j} = ${j} // ${'y'.repeat(20)}`
        )
      )
    ).join('\n')
    const sourceFiles = fatDiff
      .split('\n')
      .filter(l => l.startsWith('diff --git ')).length
    expect(sourceFiles).toBe(6)
    expect(fatDiff.length).toBeGreaterThan(120_000)
    expect(fatDiff.length).toBeLessThan(180_000)

    fetchPrDiff.mockResolvedValue(fatDiff)
    judgeSecurity.mockResolvedValue({ findings: [] })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })

    const calls = judgeSecurity.mock.calls as unknown[][]
    const last = calls[calls.length - 1]![0] as {
      diff: string
      timeoutMs: number
    }
    expect(last.timeoutMs).toBe(JUDGE_TIMEOUT_CEILING_MS)
    expect(last.diff).not.toContain('files omitted')
    // 每个文件都被看到了，一个没丢。
    for (let i = 0; i < 6; i++) expect(last.diff).toContain(`lib/fat${i}.ts`)
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      expect.anything(),
      expect.objectContaining({
        truncated: false,
        stages: expect.objectContaining({ judge: 'RAN' }),
      })
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
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { autoReviewAdmissionService } from '@/ee/security/services/auto-review-admission.service'

test('LUM-1056: exhausted AI budget still runs secrets and records an incomplete paused head', async () => {
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  ;(prReviewControlRepository.reserve as jest.Mock).mockResolvedValueOnce(false)
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity).not.toHaveBeenCalled()
  expect(repo.persistResult).toHaveBeenCalledWith(
    's1',
    expect.arrayContaining([
      expect.objectContaining({ provenance: 'DETERMINISTIC', kind: 'SECRET' }),
    ]),
    expect.objectContaining({
      stages: expect.objectContaining({ secrets: 'RAN', judge: 'PAUSED' }),
    })
  )
})

test('LUM-1137: a rate-limited push runs secrets, pauses the AI layers and is recorded as rate-limited (not paused)', async () => {
  fetchPrDiff.mockResolvedValue(SECRET_DIFF)
  ;(autoReviewAdmissionService.admit as jest.Mock).mockResolvedValueOnce({
    allowed: false,
    rateLimited: true,
  })
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity).not.toHaveBeenCalled()
  expect(repo.persistResult).toHaveBeenCalledWith(
    's1',
    expect.anything(),
    expect.objectContaining({
      stages: expect.objectContaining({ secrets: 'RAN', judge: 'PAUSED' }),
      partialCauses: expect.arrayContaining(['AI_REVIEW_RATE_LIMITED']),
    })
  )
  const [, , result] = repo.persistResult.mock.calls[0]!
  expect(result.partialCauses).not.toContain('AI_REVIEW_PAUSED')
})

test('LUM-1137: a manual review is neither admitted nor rate-limited', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
    reviewMode: 'incremental',
  })
  expect(autoReviewAdmissionService.admit).not.toHaveBeenCalled()
  expect(judgeSecurity).toHaveBeenCalledTimes(1)
})

test('LUM-1056: manual full review bypasses the automatic budget', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
    reviewMode: 'full',
  })
  expect(prReviewControlRepository.reserve).not.toHaveBeenCalled()
  expect(judgeSecurity).toHaveBeenCalledTimes(1)
})

test('LUM-1056: same-head manual review preserves a human ruling even when the judge finds the issue again', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  judgeSecurity.mockResolvedValue({
    findings: [
      {
        kind: 'sql_injection',
        severity: 'HIGH',
        filePath: 'src/a.ts',
        line: 1,
        title: 'Query',
        detail: 'Query',
        evidence: 'db.query(id)',
      },
    ],
  })
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  const old = {
    ...repo.persistResult.mock.calls[0]![1][0],
    id: 'old-finding',
    disposition: 'FALSE_POSITIVE',
    dispositionNote: 'human ruled',
    dispositionedById: 'member',
    dispositionedAt: new Date(),
    suggestedDisposition: null,
    suggestionOutcome: null,
    suggestedReason: null,
  }
  repo.persistResult.mockClear()
  repo.findByPrAndSha.mockResolvedValueOnce({
    id: 's1',
    status: 'FINDINGS',
    startedAt: new Date(),
  })
  repo.restart.mockResolvedValueOnce([old] as never)
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
    reviewMode: 'full',
  })
  expect(repo.persistResult).toHaveBeenCalledWith(
    's1',
    expect.arrayContaining([
      expect.objectContaining({
        fingerprint: old.fingerprint,
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'human ruled',
        inheritedFromFindingId: 'old-finding',
      }),
    ]),
    expect.anything()
  )
})

test('LUM-1056: paused and incremental scans retain old undispositioned findings instead of silently resolving them', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  ;(prReviewControlRepository.reserve as jest.Mock).mockResolvedValueOnce(false)
  ;(prReviewControlRepository.priorFindings as jest.Mock).mockResolvedValueOnce(
    [
      {
        id: 'old-finding',
        scanId: 'old-scan',
        fingerprint: 'old-fp',
        provenance: 'LLM_JUDGE',
        kind: 'CORRECTNESS',
        severity: 'HIGH',
        ruleId: 'review:logic_error',
        filePath: 'unchanged.ts',
        line: 7,
        title: 'old issue',
        detail: 'old issue',
        evidence: 'old evidence',
        disposition: null,
        callChain: null,
        secretDowngrade: null,
      },
    ]
  )
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(repo.persistResult).toHaveBeenCalledWith(
    's1',
    expect.arrayContaining([
      expect.objectContaining({
        scanId: 's1',
        fingerprint: 'old-fp',
        inheritedFromFindingId: 'old-finding',
        disposition: null,
      }),
    ]),
    expect.anything()
  )
})

test('LUM-1056: incremental review excludes unchanged files; missing comparison falls back to full', async () => {
  const a = 'diff --git a/src/a.ts b/src/a.ts\n' + CLEAN_DIFF
  const b =
    'diff --git a/src/b.ts b/src/b.ts\n' + CLEAN_DIFF.replace(/a\.ts/g, 'b.ts')
  fetchPrDiff.mockResolvedValue(a + '\n' + b)
  ;(prReviewControlRepository.baseline as jest.Mock).mockResolvedValueOnce({
    headSha: 'previous',
  })
  ;(gh.fetchReviewChangedPaths as jest.Mock).mockResolvedValueOnce(['src/a.ts'])
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity.mock.calls[0]![0].diff).toContain('src/a.ts')
  expect(judgeSecurity.mock.calls[0]![0].diff).not.toContain('src/b.ts')
  // LUM-1127: the scope is recorded for the PR write-back's thread rules.
  expect(repo.persistResult.mock.calls[0]![2]).toMatchObject({
    judgeReviewScope: ['src/a.ts'],
  })

  judgeSecurity.mockClear()
  repo.persistResult.mockClear()
  ;(prReviewControlRepository.baseline as jest.Mock).mockResolvedValueOnce({
    headSha: 'unreachable',
  })
  ;(gh.fetchReviewChangedPaths as jest.Mock).mockRejectedValueOnce(
    new Error('diverged')
  )
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity.mock.calls[0]![0].diff).toContain('src/b.ts')
  // Full review: null = the whole PR diff.
  expect(repo.persistResult.mock.calls[0]![2]).toMatchObject({
    judgeReviewScope: null,
  })
})

test('LUM-1056: a push during diff retrieval cannot publish a checked result for the old head', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  fetchPrHeadSha.mockResolvedValueOnce('old').mockResolvedValueOnce('new')
  const result = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(result).toMatchObject({ status: 'FAILED' })
  expect(repo.persistResult).not.toHaveBeenCalled()
  expect(judgeSecurity).not.toHaveBeenCalled()
})

function priorJudgeFinding(filePath: string) {
  return {
    id: 'old-finding',
    scanId: 'old-scan',
    fingerprint: 'old-fp',
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    severity: 'HIGH',
    ruleId: 'review:logic_error',
    filePath,
    line: 7,
    title: 'old issue',
    detail: 'old issue',
    evidence: 'old evidence',
    disposition: null,
    callChain: null,
    secretDowngrade: null,
  }
}

test('LUM-1056: a complete judge pass over a file that no longer reports its finding closes it', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  ;(prReviewControlRepository.priorFindings as jest.Mock).mockResolvedValueOnce(
    [priorJudgeFinding('src/a.ts')]
  )
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity).toHaveBeenCalledTimes(1)
  const rows = repo.persistResult.mock.calls[0]![1] as { fingerprint: string }[]
  expect(rows.map(r => r.fingerprint)).not.toContain('old-fp')
})

test('LUM-1056: an incremental pass keeps a finding in a file outside its scope', async () => {
  const a = 'diff --git a/src/a.ts b/src/a.ts\n' + CLEAN_DIFF
  const b =
    'diff --git a/src/b.ts b/src/b.ts\n' + CLEAN_DIFF.replace(/a\.ts/g, 'b.ts')
  fetchPrDiff.mockResolvedValue(a + '\n' + b)
  ;(prReviewControlRepository.baseline as jest.Mock).mockResolvedValueOnce({
    headSha: 'previous',
  })
  ;(gh.fetchReviewChangedPaths as jest.Mock).mockResolvedValueOnce(['src/a.ts'])
  ;(prReviewControlRepository.priorFindings as jest.Mock).mockResolvedValueOnce(
    [priorJudgeFinding('src/b.ts')]
  )
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(repo.persistResult).toHaveBeenCalledWith(
    's1',
    expect.arrayContaining([
      expect.objectContaining({ fingerprint: 'old-fp' }),
    ]),
    expect.anything()
  )
})

test('LUM-1056: a push during diff retrieval does not spend an automatic round', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  fetchPrHeadSha.mockResolvedValueOnce('old').mockResolvedValueOnce('new')
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(prReviewControlRepository.reserve).not.toHaveBeenCalled()
})

test('LUM-1056: a head superseded before persistence returns its round', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  fetchPrHeadSha
    .mockResolvedValueOnce('old')
    .mockResolvedValueOnce('old')
    .mockResolvedValueOnce('new')
  const result = await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  expect(result).toMatchObject({ status: 'FAILED' })
  expect(prReviewControlRepository.reserve).toHaveBeenCalledWith('pr1', 'old')
  expect(prReviewControlRepository.release).toHaveBeenCalledWith('pr1', 'old')
})

test('LUM-1056: a failure other than a superseded head keeps the reservation', async () => {
  fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
  repo.persistResult.mockRejectedValueOnce(new Error('db down'))
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(prReviewControlRepository.release).not.toHaveBeenCalled()
})

jest.mock('@/ee/security/services/auto-review-admission.service', () =>
  require('@/test-utils/ee/auto-review-admission-mock').delegatingAdmission()
)
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      reviewPaused: false,
      reviewHeads: [],
    }),
  },
}))

describe('LUM-1152: `@<app> ignore` in the PR description', () => {
  const fetchPrBody = gh.fetchPrBody as jest.Mock
  const admit = autoReviewAdmissionService.admit as jest.Mock
  const prevSlug = process.env.GITHUB_APP_SLUG
  beforeEach(() => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
  })
  afterAll(() => {
    if (prevSlug === undefined) delete process.env.GITHUB_APP_SLUG
    else process.env.GITHUB_APP_SLUG = prevSlug
  })

  test('skips the automatic AI layers, keeps the deterministic ones and spends no budget', async () => {
    fetchPrBody.mockResolvedValue('Refactor.\n\n@uselumo ignore')
    fetchPrDiff.mockResolvedValue(SECRET_DIFF)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(judgeSecurity).not.toHaveBeenCalled()
    expect(admit).not.toHaveBeenCalled()
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      expect.arrayContaining([
        expect.objectContaining({
          provenance: 'DETERMINISTIC',
          kind: 'SECRET',
        }),
      ]),
      expect.objectContaining({
        stages: expect.objectContaining({ secrets: 'RAN', judge: 'PAUSED' }),
        partialCauses: expect.arrayContaining(['AI_REVIEW_IGNORED']),
      })
    )
    const [, , result] = repo.persistResult.mock.calls[0]!
    expect(result.partialCauses).not.toContain('AI_REVIEW_PAUSED')
    // The task-linked PR still gets its summary (and the DONE-gate scan row).
    expect(syncReview).toHaveBeenCalledWith('s1')
  })

  test('removed from the description: the next push is reviewed', async () => {
    fetchPrBody.mockResolvedValue('Refactor.')
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(admit).toHaveBeenCalled()
    expect(judgeSecurity).toHaveBeenCalledTimes(1)
  })

  test('a manual review still runs, without reading the description', async () => {
    fetchPrBody.mockResolvedValue('@uselumo ignore')
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
      reviewMode: 'incremental',
    })
    expect(fetchPrBody).not.toHaveBeenCalled()
    expect(judgeSecurity).toHaveBeenCalledTimes(1)
  })
})

// LUM-1152 follow-up — production probe: a manual review asked for while
// the ignored head's scan was still in flight (managed scanners PENDING) was
// deduplicated and never ran.
jest.mock('@/ee/security/services/security-deferred-review-start', () => ({
  startDeferredManualReview: jest.fn().mockResolvedValue(true),
}))
import { startDeferredManualReview } from '@/ee/security/services/security-deferred-review-start'
import { logger as lumoLogger } from '@/lib/logger'

describe('LUM-1152 follow-up: manual review on an in-flight ignored head', () => {
  const defer = startDeferredManualReview as jest.Mock
  const fetchPrBody = gh.fetchPrBody as jest.Mock
  const prevSlug = process.env.GITHUB_APP_SLUG
  beforeEach(() => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
    fetchPrBody.mockResolvedValue('@uselumo ignore')
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    repo.findByPrAndSha.mockResolvedValueOnce({
      id: 's1',
      status: 'CLEAN',
      startedAt: new Date(),
    })
  })
  afterAll(() => {
    if (prevSlug === undefined) delete process.env.GITHUB_APP_SLUG
    else process.env.GITHUB_APP_SLUG = prevSlug
  })

  test('a full review refused because the scan is in flight is deferred, not dropped', async () => {
    repo.restart.mockResolvedValueOnce(false as never)
    const r = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
      reviewMode: 'full',
    })
    expect(r).toEqual({ deduped: true, scanId: 's1' })
    expect(defer).toHaveBeenCalledWith({
      pullRequestId: 'pr1',
      scanId: 's1',
      reviewMode: 'full',
    })
    expect(judgeSecurity).not.toHaveBeenCalled()
  })

  test('a full review records its mode, so a deferred full request can tell', async () => {
    repo.restart.mockResolvedValueOnce([] as never)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
      reviewMode: 'full',
    })
    const [, , result] = repo.persistResult.mock.calls[0]!
    expect(result.judgeReviewMode).toBe('full')
  })

  test('an automatic review records incremental; a held one records none', async () => {
    repo.findByPrAndSha.mockReset().mockResolvedValue(null)
    fetchPrBody.mockResolvedValue('no directive')
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult.mock.calls[0]![2].judgeReviewMode).toBe(
      'incremental'
    )
    repo.persistResult.mockClear()
    fetchPrBody.mockResolvedValue('@uselumo ignore')
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult.mock.calls[0]![2].judgeReviewMode).toBeNull()
  })

  test('the deferred dispatch is never deferred again, and its dedupe is logged', async () => {
    const info = jest.spyOn(lumoLogger, 'info').mockImplementation(() => {})
    repo.restart.mockResolvedValueOnce(false as never)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
      reviewMode: 'incremental',
      deferred: true,
    })
    expect(defer).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        'deferred manual incremental review deduplicated pr=pr1 scan=s1'
      )
    )
  })

  test('once settled, the manual full review runs the judge on the ignored head', async () => {
    repo.restart.mockResolvedValueOnce([] as never)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
      reviewMode: 'full',
      deferred: true,
    })
    expect(judgeSecurity).toHaveBeenCalledTimes(1)
    expect(fetchPrBody).not.toHaveBeenCalled()
    const [, , result] = repo.persistResult.mock.calls[0]!
    expect(result.partialCauses ?? []).not.toContain('AI_REVIEW_IGNORED')
    expect(result.stages.judge).not.toBe('PAUSED')
  })
})
