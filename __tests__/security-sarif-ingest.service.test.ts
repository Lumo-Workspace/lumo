/** @jest-environment node */
import { gzipSync } from 'node:zlib'

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/services/security-sarif-blob', () => ({
  fetchPrivateBlob: jest.fn(),
  deleteBlob: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findByRepoAndNumber: jest.fn(),
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    markSarifIngested: jest.fn(),
    findLastSarifIngestAt: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    createIfAbsent: jest.fn(),
    ingestExternalFindings: jest.fn(),
    mergeStages: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
  },
}))
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
}))

import {
  securitySarifIngestService,
  SARIF_MAX_GZ_BYTES,
  type PersistInput,
} from '@/lib/services/security-sarif-ingest.service'
import * as blob from '@/lib/services/security-sarif-blob'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { logger } from '@/lib/logger'
import {
  parseSarif,
  normalizeSarif,
  changedLinesOf,
  addedLinesWithNumbers,
  type RawSarifFinding,
} from '@/lib/security-scan'

const KEY = 'AKIAABCDEFGHIJKLMNOP'
const fetchBlob = blob.fetchPrivateBlob as jest.Mock
const delBlob = blob.deleteBlob as jest.Mock
const diff = fetchPrDiff as jest.Mock
const findPr = pullRequestRepository.findByRepoAndNumber as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const dispatchStageA = dispatchPrSecurityScan as jest.Mock
const logInfo = logger.info as jest.Mock

const JOB = {
  url: 'https://blob.vercel-storage.com/security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  pathname: 'security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  workspaceId: 'w1',
  repository: 'o/r',
  headSha: 'sha1',
  prNumber: 7,
  tool: 'semgrep',
}
const DIFF = [
  '--- a/src/db.ts',
  '+++ b/src/db.ts',
  '@@ -1,0 +1,2 @@',
  '+const a = 1',
  `+const k = "${KEY}"`,
].join('\n')
const sarifDoc = (results: unknown[], tool = 'Semgrep OSS') => ({
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: tool,
          rules: [
            {
              id: 'r1',
              shortDescription: { text: 'Rule one' },
              helpUri: 'https://h/1',
            },
          ],
        },
      },
      results,
    },
  ],
})
const result = (line: number, extra: object = {}) => ({
  ruleId: 'r1',
  level: 'error',
  message: { text: 'bad' },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: 'src/db.ts' },
        region: { startLine: line, snippet: { text: `line ${line}` } },
      },
    },
  ],
  ...extra,
})

const SARIF_FIXTURE = sarifDoc([result(1), result(2), result(99)])
const GITLEAKS_FIXTURE = sarifDoc(
  [result(2, { message: { text: `Secret: ${KEY}` } })],
  'gitleaks'
)

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  repo: 'o/r',
  number: 7,
  taskId: null,
}
const RESOLVED_PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }

const RAW_FINDING: RawSarifFinding = {
  kind: 'VULNERABILITY',
  ruleId: 'ext:semgrep-oss:r1',
  severity: 'HIGH',
  filePath: 'src/db.ts',
  line: 1,
  title: 'Rule one',
  detail: 'bad',
  evidence: '',
  fingerprint: 'fp-1',
  externalRef: 'https://h/1',
}

const PERSIST_INPUT: PersistInput = {
  scanId: 's1',
  pr: RESOLVED_PR,
  repository: 'o/r',
  prNumber: 7,
  auth: 'key',
  tool: 'semgrep-oss',
  tools: ['semgrep-oss'],
  findings: [RAW_FINDING],
  truncated: false,
  dropped: { notInDiff: 0, noLocation: 0, duplicate: 0 },
}

beforeEach(() => {
  jest.clearAllMocks()
  findPr.mockResolvedValue({
    id: 'pr1',
    workspaceId: 'w1',
    taskId: 't1',
    repo: 'o/r',
    number: 7,
  })
  diff.mockResolvedValue(DIFF)
  repo.createIfAbsent.mockResolvedValue({
    id: 's1',
    created: true,
    status: 'PENDING',
    startedAt: new Date(),
  })
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.ingestExternalFindings.mockImplementation(async (_s, _t, rows) => ({
    written: rows.length,
    flippedToFindings: false,
  }))
})

describe('resolveScan', () => {
  it('discards + deletes the blob when the PR is unknown', async () => {
    findPr.mockResolvedValue(null)
    await expect(securitySarifIngestService.resolveScan(JOB)).resolves.toEqual({
      kind: 'discarded',
      reason: 'pr_not_found',
    })
    expect(delBlob).toHaveBeenCalledWith(JOB.url)
    expect(repo.createIfAbsent).not.toHaveBeenCalled()
  })

  it('discards when the key workspace does not own the PR', async () => {
    findPr.mockResolvedValue({ ...PR, workspaceId: 'other' })
    await expect(securitySarifIngestService.resolveScan(JOB)).resolves.toEqual({
      kind: 'discarded',
      reason: 'workspace_mismatch',
    })
    expect(delBlob).toHaveBeenCalledWith(JOB.url)
  })

  it('skips the workspace check on the OIDC path (no workspaceId)', async () => {
    findPr.mockResolvedValue({ ...PR, workspaceId: 'other' })
    repo.createIfAbsent.mockResolvedValue({
      id: 's1',
      created: false,
      status: 'RUNNING',
      startedAt: new Date(),
    })
    const { workspaceId: _omit, ...oidcJob } = JOB
    void _omit
    await expect(
      securitySarifIngestService.resolveScan(oidcJob)
    ).resolves.toEqual({
      kind: 'ok',
      scanId: 's1',
      pr: { ...RESOLVED_PR, workspaceId: 'other' },
    })
  })

  it('creates a PENDING SARIF_PUSH row and dispatches stage A when it created the row', async () => {
    findPr.mockResolvedValue(PR)
    repo.createIfAbsent.mockResolvedValue({
      id: 's1',
      created: true,
      status: 'PENDING',
      startedAt: new Date(),
    })
    await securitySarifIngestService.resolveScan(JOB)
    expect(repo.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId: 'pr1',
        headSha: 'sha1',
        trigger: 'SARIF_PUSH',
        status: 'PENDING',
      })
    )
    expect(dispatchStageA).toHaveBeenCalledWith('pr1', 'SARIF_PUSH')
  })

  it('does not dispatch stage A when the row already existed', async () => {
    findPr.mockResolvedValue(PR)
    repo.createIfAbsent.mockResolvedValue({
      id: 's1',
      created: false,
      status: 'RUNNING',
      startedAt: new Date(),
    })
    await securitySarifIngestService.resolveScan(JOB)
    expect(dispatchStageA).not.toHaveBeenCalled()
  })

  it('propagates a DB failure so the step retries', async () => {
    findPr.mockRejectedValue(new Error('db down'))
    await expect(securitySarifIngestService.resolveScan(JOB)).rejects.toThrow(
      'db down'
    )
  })
})

describe('fetchAndNormalize', () => {
  const INPUT = { url: JOB.url, tool: 'semgrep', scanId: 's1', pr: RESOLVED_PR }

  it('returns not_found when the blob is already gone', async () => {
    fetchBlob.mockResolvedValue(null)
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).resolves.toEqual({ kind: 'not_found' })
    expect(fetchBlob).toHaveBeenCalledWith(INPUT.url, SARIF_MAX_GZ_BYTES)
  })

  it('throws (retryable) when the blob store errors', async () => {
    fetchBlob.mockRejectedValue(new Error('blob 503'))
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).rejects.toThrow('blob 503')
  })

  it('returns failed (not retried) for an over-cap blob', async () => {
    fetchBlob.mockRejectedValue(
      Object.assign(new Error('gzip size 999 exceeds cap'), { status: 413 })
    )
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).resolves.toEqual({
      kind: 'failed',
      reason: expect.stringContaining('exceeds cap'),
    })
  })

  it('returns failed for a non-gzip body and for a non-2.1.0 document', async () => {
    fetchBlob.mockResolvedValue(Buffer.from('not gzip'))
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).resolves.toMatchObject({ kind: 'failed' })
    fetchBlob.mockResolvedValue(
      gzipSync(JSON.stringify({ version: '2.0.0', runs: [] }))
    )
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).resolves.toMatchObject({ kind: 'failed' })
  })

  it('throws when the diff fetch fails (retryable)', async () => {
    fetchBlob.mockResolvedValue(gzipSync(JSON.stringify(SARIF_FIXTURE)))
    diff.mockRejectedValue(new Error('github 502'))
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).rejects.toThrow('github 502')
  })

  it('keeps only findings on added lines and reports drops', async () => {
    // Port of the old happy-path test's diff-aware assertions: DIFF only adds
    // lines 1-2 of src/db.ts, so result(99) is dropped as notInDiff while
    // result(1)/result(2) survive.
    fetchBlob.mockResolvedValue(gzipSync(JSON.stringify(SARIF_FIXTURE)))
    diff.mockResolvedValue(DIFF)
    const out = await securitySarifIngestService.fetchAndNormalize(INPUT)
    if (out.kind !== 'ok') throw new Error(`expected ok, got ${out.kind}`)
    expect(out.tool).toBe('semgrep-oss')
    expect(out.tools).toEqual(['semgrep-oss'])
    expect(out.findings).toHaveLength(2)
    expect(out.findings.map(f => f.line).sort()).toEqual([1, 2])
    expect(out.dropped).toEqual({ notInDiff: 1, noLocation: 0, duplicate: 0 })
    expect(out.truncated).toBe(false)
  })

  it('RED LINE: no field of the returned findings contains the plaintext key', async () => {
    fetchBlob.mockResolvedValue(gzipSync(JSON.stringify(GITLEAKS_FIXTURE)))
    diff.mockResolvedValue(DIFF)
    const out = await securitySarifIngestService.fetchAndNormalize({
      ...INPUT,
      tool: 'gitleaks',
    })
    expect(out.kind).toBe('ok')
    expect(JSON.stringify(out)).not.toContain(KEY)
  })
})

describe('persistFindings', () => {
  it('replaces this push’s tools, stamps lastSarifIngestAt and returns written/partial', async () => {
    // Port of the old ingestExternalFindings assertions: tools list,
    // EXTERNAL_TOOL provenance, inheritDispositions applied, partial =
    // truncated, and the CLEAN→FINDINGS flip is only reported (logged), not
    // decided by the service itself.
    repo.findDispositionedByPullRequest.mockResolvedValue([
      {
        id: 'old',
        fingerprint: 'fp-1',
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'n',
        dispositionedById: 'm',
        dispositionedAt: new Date(),
      },
    ])
    repo.ingestExternalFindings.mockResolvedValue({
      written: 1,
      flippedToFindings: true,
    })
    const input: PersistInput = { ...PERSIST_INPUT, truncated: true }
    const out = await securitySarifIngestService.persistFindings(input)
    expect(out).toEqual({ written: 1, partial: true })
    expect(repo.ingestExternalFindings).toHaveBeenCalledWith(
      's1',
      ['semgrep-oss'],
      expect.any(Array),
      { partial: true }
    )
    const rows = repo.ingestExternalFindings.mock.calls[0]![2]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      scanId: 's1',
      provenance: 'EXTERNAL_TOOL',
      ruleId: 'ext:semgrep-oss:r1',
      disposition: 'FALSE_POSITIVE',
      inheritedFromFindingId: 'old',
    })
    expect(projectRepository.markSarifIngested).toHaveBeenCalledWith(
      'w1',
      'o/r',
      expect.any(Date)
    )
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining('scan flipped CLEAN→FINDINGS')
    )
  })

  it('RED LINE: nothing handed to the repository or the logger contains the plaintext key', async () => {
    // Port of the old RED LINE test, now exercised at the persist boundary:
    // real normalizeSarif output for a gitleaks-style hit is handed to
    // persistFindings, and neither the repository call nor the log line may
    // carry the plaintext key.
    const normalized = normalizeSarif(parseSarif(GITLEAKS_FIXTURE), {
      toolHint: 'gitleaks',
      changedLines: changedLinesOf(addedLinesWithNumbers(DIFF)),
    })
    const input: PersistInput = {
      ...PERSIST_INPUT,
      tool: 'gitleaks',
      tools: normalized.tools,
      findings: normalized.findings,
      truncated: normalized.truncated,
      dropped: normalized.dropped,
    }
    await securitySarifIngestService.persistFindings(input)
    expect(
      JSON.stringify(repo.ingestExternalFindings.mock.calls)
    ).not.toContain(KEY)
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain(KEY)
  })

  it('propagates a write failure so the step retries', async () => {
    repo.ingestExternalFindings.mockRejectedValue(new Error('P1001'))
    await expect(
      securitySarifIngestService.persistFindings(PERSIST_INPUT)
    ).rejects.toThrow('P1001')
  })
})

describe('markExternalFailed / deleteBlobSafely', () => {
  it('markExternalFailed merges external=FAILED and swallows a second failure', async () => {
    repo.mergeStages.mockRejectedValue(new Error('again'))
    await expect(
      securitySarifIngestService.markExternalFailed('s1')
    ).resolves.toBeUndefined()
    expect(repo.mergeStages).toHaveBeenCalledWith(
      's1',
      { external: 'FAILED' },
      {}
    )
  })

  it('deleteBlobSafely returns false and warns instead of throwing', async () => {
    delBlob.mockRejectedValue(new Error('nope'))
    await expect(
      securitySarifIngestService.deleteBlobSafely(JOB.url)
    ).resolves.toBe(false)
  })
})
