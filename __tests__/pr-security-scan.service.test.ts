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
jest.mock('@/lib/integrations/github/code-scanning', () => ({
  fetchCodeScanningAlerts: jest.fn(),
  fetchActiveSecretScanningAlerts: jest.fn(),
}))
jest.mock('@/lib/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByPrAndSha: jest.fn(),
    create: jest.fn(),
    restart: jest.fn(),
    finalize: jest.fn(),
    createFindings: jest.fn(),
    persistResult: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
    findLatestByPullRequestIds: jest.fn(),
    findFindingWithScope: jest.fn(),
    updateDisposition: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))

import {
  prSecurityScanService,
  STALE_RUNNING_MS,
} from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/security-judge-client'
import * as codeScanning from '@/lib/integrations/github/code-scanning'
import {
  stagesOf,
  isCompleteScan,
} from '@/lib/services/pr-security-scan.service'
import { secretFingerprint } from '@/lib/security-scan/redact'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const prRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const judgeSecurity = judge.judgeSecurity as jest.Mock
const fetchCodeScanningAlerts =
  codeScanning.fetchCodeScanningAlerts as jest.Mock
const fetchActiveSecretScanningAlerts =
  codeScanning.fetchActiveSecretScanningAlerts as jest.Mock

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
  prRepo.findById.mockResolvedValue(PR as never)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' })
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  judgeSecurity.mockResolvedValue({ findings: [] })
  fetchCodeScanningAlerts.mockResolvedValue({
    configured: false,
    reason: 'Advanced Security must be enabled',
  })
  fetchActiveSecretScanningAlerts.mockResolvedValue({
    configured: false,
    reason: 'Secret scanning is disabled',
  })
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
  // A stale PENDING row (queued but never picked up) ages out the same way.
  repo.findByPrAndSha.mockResolvedValue({
    id: 's-queued',
    status: 'PENDING',
    startedAt: new Date(now - STALE_RUNNING_MS - 1),
  })
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(repo.restart).toHaveBeenLastCalledWith('s-queued')
  // Never a second row for the same (pr, sha): restart is in-place.
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

describe('LUM-735 external oracle + stages', () => {
  const CODE_ALERT = {
    number: 7,
    htmlUrl: 'https://github.com/o/r/security/code-scanning/7',
    toolName: 'Semgrep OSS',
    ruleId: 'js.sqli',
    ruleDescription: 'SQL built from input',
    securitySeverityLevel: 'high',
    severity: 'error',
    path: 'src/a.ts',
    startLine: 1,
    messageText: 'tainted',
  }

  test('a repo without code scanning finalizes CLEAN-by-findings but stages.external=NOT_CONFIGURED', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ status: 'CLEAN', findings: 0 })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        status: 'CLEAN',
        partial: false,
        stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
      })
    )
  })

  test('code-scanning alerts in changed files land as EXTERNAL_TOOL findings with externalRef', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    fetchCodeScanningAlerts.mockResolvedValue({
      configured: true,
      truncated: false,
      alerts: [
        CODE_ALERT,
        { ...CODE_ALERT, number: 8, path: 'src/not-in-diff.ts' },
      ],
    })
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({ status: 'FINDINGS', findings: 1 })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [
        expect.objectContaining({
          kind: 'VULNERABILITY',
          provenance: 'EXTERNAL_TOOL',
          ruleId: 'ext:semgrep-oss:js.sqli',
          severity: 'HIGH',
          filePath: 'src/a.ts',
          externalRef: 'https://github.com/o/r/security/code-scanning/7',
          evidence: '',
        }),
      ],
      expect.objectContaining({
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
      })
    )
    expect(fetchCodeScanningAlerts).toHaveBeenCalledWith({
      workspaceId: 'w1',
      fullName: 'o/r',
      prNumber: 7,
    })
  })

  test('an external fetch error marks stages.external=FAILED and does not throw the scan', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    fetchCodeScanningAlerts.mockRejectedValue(
      Object.assign(new Error('GitHub API 500'), { status: 500 })
    )
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

  test('a truncated alert page marks stages.external=PARTIAL and partial=true', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    fetchCodeScanningAlerts.mockResolvedValue({
      configured: true,
      truncated: true,
      alerts: [],
    })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's1',
      [],
      expect.objectContaining({
        partial: true,
        stages: expect.objectContaining({ external: 'PARTIAL' }),
      })
    )
  })

  test('an ACTIVE secret-scanning alert upgrades the matching A1 hit to HIGH with the alert URL', async () => {
    fetchPrDiff.mockResolvedValue(SECRET_DIFF)
    fetchActiveSecretScanningAlerts.mockResolvedValue({
      configured: true,
      truncated: false,
      alerts: [
        {
          number: 3,
          htmlUrl: 'https://github.com/o/r/security/secret-scanning/3',
          secretType: 'aws_access_key_id',
          secretTypeDisplayName: 'Amazon AWS Access Key ID',
          paths: ['src/cfg.ts'],
        },
      ],
    })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    const rows = repo.persistResult.mock.calls[0]![1]
    expect(rows[0]).toMatchObject({
      ruleId: 'secret:aws-access-key-id',
      provenance: 'DETERMINISTIC',
      severity: 'HIGH',
      externalRef: 'https://github.com/o/r/security/secret-scanning/3',
    })
    expect(rows[0]!.detail).toContain('Amazon AWS Access Key ID')
    expect(JSON.stringify(rows)).not.toContain(KEY)
    expect(fetchActiveSecretScanningAlerts).toHaveBeenCalledWith({
      workspaceId: 'w1',
      fullName: 'o/r',
    })
  })

  test('secret-scanning is only consulted when A1 found something', async () => {
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(fetchActiveSecretScanningAlerts).not.toHaveBeenCalled()
  })

  test('judge UNAVAILABLE is mirrored as stages.judge=FAILED; an empty diff is SKIPPED', async () => {
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
    jest.clearAllMocks()
    prRepo.findById.mockResolvedValue(PR as never)
    fetchPrHeadSha.mockResolvedValue('sha-9')
    repo.findByPrAndSha.mockResolvedValue(null)
    repo.create.mockResolvedValue({ id: 's9' })
    repo.findDispositionedByPullRequest.mockResolvedValue([])
    fetchCodeScanningAlerts.mockResolvedValue({
      configured: false,
      reason: 'off',
    })
    fetchPrDiff.mockResolvedValue('')
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.persistResult).toHaveBeenCalledWith(
      's9',
      [],
      expect.objectContaining({
        stages: expect.objectContaining({ judge: 'SKIPPED' }),
      })
    )
  })

  test('a scan that throws after stages were collected finalizes FAILED with those stages', async () => {
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

  test('getForTask exposes stages, partial, complete and externalRef on the view', async () => {
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
        stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
        partial: false,
        detectorVersion: 'x',
        error: null,
        startedAt: new Date('2026-09-09T00:00:00Z'),
        finishedAt: null,
        findings: [
          {
            id: 'f1',
            scanId: 's1',
            kind: 'VULNERABILITY',
            ruleId: 'ext:semgrep-oss:js.sqli',
            severity: 'MEDIUM',
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
      stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
      partial: false,
      complete: false,
    })
    expect(out.prs[0]!.latest!.findings[0]).toMatchObject({
      externalRef: 'https://github.com/o/r/security/code-scanning/7',
      blocking: false,
    })
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
    expect(isCompleteScan({})).toBe(true)
  })
})
