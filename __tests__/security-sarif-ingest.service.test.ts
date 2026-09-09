/** @jest-environment node */
import { gzipSync } from 'node:zlib'

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/services/security-sarif-blob', () => ({
  fetchPrivateBlob: jest.fn(),
  deleteBlob: jest.fn(),
  listSarifBlobs: jest.fn(),
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
} from '@/lib/services/security-sarif-ingest.service'
import * as blob from '@/lib/services/security-sarif-blob'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'

const KEY = 'AKIAABCDEFGHIJKLMNOP'
const fetchBlob = blob.fetchPrivateBlob as jest.Mock
const delBlob = blob.deleteBlob as jest.Mock
const diff = fetchPrDiff as jest.Mock
const findPr = pullRequestRepository.findByRepoAndNumber as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const dispatchStageA = dispatchPrSecurityScan as jest.Mock

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
const multiRunSarifDoc = (run1Results: unknown[], run2Results: unknown[]) => ({
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'Semgrep OSS',
          rules: [
            {
              id: 'r1',
              shortDescription: { text: 'Rule one' },
              helpUri: 'https://h/1',
            },
          ],
        },
      },
      results: run1Results,
    },
    {
      tool: {
        driver: {
          name: 'Gitleaks',
          rules: [
            {
              id: 'r1',
              shortDescription: { text: 'Rule one' },
              helpUri: 'https://h/2',
            },
          ],
        },
      },
      results: run2Results,
    },
  ],
})
const gz = (doc: unknown) => gzipSync(Buffer.from(JSON.stringify(doc)))
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

test('happy path: gunzip → normalise → replace tool findings → external RAN → stamp repo → delete blob', async () => {
  fetchBlob.mockResolvedValue(gz(sarifDoc([result(1), result(2), result(99)])))
  const out = await securitySarifIngestService.ingest(JOB)
  expect(out).toEqual({
    outcome: 'INGESTED',
    scanId: 's1',
    findings: 2,
    partial: false,
  })
  expect(repo.createIfAbsent).toHaveBeenCalledWith(
    expect.objectContaining({
      pullRequestId: 'pr1',
      headSha: 'sha1',
      trigger: 'SARIF_PUSH',
      status: 'PENDING',
      workspaceId: 'w1',
      taskId: 't1',
    })
  )
  const rows = repo.ingestExternalFindings.mock.calls[0]![2]
  // LUM-735 review C1: findings + `stages.external=RAN` + `partial` are ONE
  // repository call (one transaction holding the scan-row lock), not a
  // replace followed by a separate mergeStages two concurrent ingests could
  // interleave.
  expect(repo.ingestExternalFindings).toHaveBeenCalledWith(
    's1',
    ['semgrep-oss'],
    expect.any(Array),
    { partial: false }
  )
  expect(repo.mergeStages).not.toHaveBeenCalled()
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({
    provenance: 'EXTERNAL_TOOL',
    ruleId: 'ext:semgrep-oss:r1',
    externalRef: 'https://h/1',
    scanId: 's1',
  })
  expect(projectRepository.markSarifIngested).toHaveBeenCalledWith(
    'w1',
    'o/r',
    expect.any(Date)
  )
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
  expect(fetchBlob).toHaveBeenCalledWith(JOB.url, SARIF_MAX_GZ_BYTES)
})

test("a two-run SARIF replaces both runs' tool prefixes, not just the first, even when the second run's only result is outside the diff", async () => {
  fetchBlob.mockResolvedValue(gz(multiRunSarifDoc([result(1)], [result(99)])))
  await securitySarifIngestService.ingest(JOB)
  expect(repo.ingestExternalFindings).toHaveBeenCalledWith(
    's1',
    ['semgrep-oss', 'gitleaks'],
    expect.any(Array),
    { partial: false }
  )
})

test('the CLEAN→FINDINGS flip is decided inside the ingest transaction, not from a stale read', async () => {
  // LUM-735 review C1: the service used to re-read the scan row AFTER the
  // write and then flip it in a second transaction — a window in which the
  // other completion path could have already finalized. The flip now happens
  // under the same row lock as the write; the service only reports it.
  repo.createIfAbsent.mockResolvedValue({
    id: 's1',
    created: false,
    status: 'CLEAN',
    startedAt: new Date(),
  })
  repo.ingestExternalFindings.mockResolvedValue({
    written: 1,
    flippedToFindings: true,
  })
  fetchBlob.mockResolvedValue(gz(sarifDoc([result(1)])))
  const out = await securitySarifIngestService.ingest(JOB)
  expect(out).toMatchObject({ outcome: 'INGESTED', findings: 1 })
  expect(repo.ingestExternalFindings).toHaveBeenCalledTimes(1)
  expect(repo.mergeStages).not.toHaveBeenCalled()
})

test('a SARIF-created PENDING row is handed to stage A; an existing row is not', async () => {
  // LUM-735 review I3: when the push arrives before any PR webhook, the row
  // this ingest just created is PENDING and nothing would ever run stage A
  // on it — the panel would sit on "waiting for CI" forever with the secret
  // scan and judge never having run.
  fetchBlob.mockResolvedValue(gz(sarifDoc([result(1)])))
  await securitySarifIngestService.ingest(JOB)
  expect(dispatchStageA).toHaveBeenCalledWith('pr1', 'SARIF_PUSH')

  dispatchStageA.mockClear()
  repo.createIfAbsent.mockResolvedValue({
    id: 's1',
    created: false,
    status: 'RUNNING',
    startedAt: new Date(),
  })
  await securitySarifIngestService.ingest(JOB)
  expect(dispatchStageA).not.toHaveBeenCalled()
})

test('RED LINE: gitleaks-style payload never lands the secret; the SARIF itself is never persisted', async () => {
  fetchBlob.mockResolvedValue(
    gz(
      sarifDoc([result(2, { message: { text: `Secret: ${KEY}` } })], 'gitleaks')
    )
  )
  await securitySarifIngestService.ingest({ ...JOB, tool: 'gitleaks' })
  const rows = repo.ingestExternalFindings.mock.calls[0]![2]
  expect(rows[0]).toMatchObject({ kind: 'SECRET' })
  expect(rows).not.toHaveLength(0)
  expect(JSON.stringify(rows)).not.toContain(KEY)
  expect(JSON.stringify(repo.ingestExternalFindings.mock.calls)).not.toContain(
    KEY
  )
})

test('inherits a prior human disposition by fingerprint across pushes', async () => {
  fetchBlob.mockResolvedValue(
    gz(
      sarifDoc([
        result(1, { partialFingerprints: { primaryLocationLineHash: 'fp-1' } }),
      ])
    )
  )
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
  await securitySarifIngestService.ingest(JOB)
  expect(repo.ingestExternalFindings.mock.calls[0]![2][0]).toMatchObject({
    disposition: 'FALSE_POSITIVE',
    inheritedFromFindingId: 'old',
  })
})

test('blob already gone → ALREADY_PROCESSED (the other completion path won)', async () => {
  fetchBlob.mockResolvedValue(null)
  expect(await securitySarifIngestService.ingest(JOB)).toEqual({
    outcome: 'ALREADY_PROCESSED',
  })
  expect(repo.createIfAbsent).not.toHaveBeenCalled()
})

test('unknown PR or a PR from another workspace → DISCARDED and the blob is deleted', async () => {
  fetchBlob.mockResolvedValue(gz(sarifDoc([])))
  findPr.mockResolvedValue(null)
  expect(await securitySarifIngestService.ingest(JOB)).toEqual({
    outcome: 'DISCARDED',
    reason: 'pr_not_found',
  })
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
  findPr.mockResolvedValue({
    id: 'pr9',
    workspaceId: 'OTHER',
    taskId: null,
    repo: 'o/r',
    number: 7,
  })
  expect(await securitySarifIngestService.ingest(JOB)).toEqual({
    outcome: 'DISCARDED',
    reason: 'workspace_mismatch',
  })
})

test('invalid SARIF → FAILED with reason on the scan, blob KEPT for debugging', async () => {
  fetchBlob.mockResolvedValue(gz({ version: '1.0', runs: [] }))
  const out = await securitySarifIngestService.ingest(JOB)
  expect(out).toMatchObject({ outcome: 'FAILED', scanId: 's1' })
  expect(repo.mergeStages).toHaveBeenCalledWith(
    's1',
    { external: 'FAILED' },
    {}
  )
  expect(delBlob).not.toHaveBeenCalled()
})

test('a write-stage failure after a successful parse marks external FAILED and keeps the blob for inspection', async () => {
  fetchBlob.mockResolvedValue(gz(sarifDoc([result(1)])))
  repo.ingestExternalFindings.mockRejectedValueOnce(
    new Error('db write failed')
  )
  const out = await securitySarifIngestService.ingest(JOB)
  expect(out).toMatchObject({ outcome: 'FAILED', scanId: 's1' })
  expect(repo.mergeStages).toHaveBeenCalledWith(
    's1',
    { external: 'FAILED' },
    {}
  )
  expect(delBlob).not.toHaveBeenCalled()
})

test('a parse/normalize failure whose own mergeStages(external=FAILED) also rejects does not throw', async () => {
  fetchBlob.mockResolvedValue(gz({ version: '1.0', runs: [] }))
  repo.mergeStages.mockRejectedValueOnce(new Error('mergeStages down'))
  const out = await securitySarifIngestService.ingest(JOB)
  expect(out).toMatchObject({ outcome: 'FAILED', scanId: 's1' })
  expect(delBlob).not.toHaveBeenCalled()
})

test('a second failure while marking external FAILED does not throw or change the outcome', async () => {
  fetchBlob.mockResolvedValue(gz(sarifDoc([result(1)])))
  repo.ingestExternalFindings.mockRejectedValueOnce(
    new Error('db write failed')
  )
  repo.mergeStages.mockRejectedValueOnce(new Error('mergeStages also down'))
  const out = await securitySarifIngestService.ingest(JOB)
  expect(out).toMatchObject({ outcome: 'FAILED', scanId: 's1' })
  expect(delBlob).not.toHaveBeenCalled()
})

test('oversized gzip (rejected before buffering) → FAILED, scan row still created, blob kept', async () => {
  fetchBlob.mockRejectedValue(
    Object.assign(new Error('gzip size 200000000 exceeds cap'), {
      status: 413,
    })
  )
  const out = await securitySarifIngestService.ingest(JOB)
  expect(repo.createIfAbsent).toHaveBeenCalled()
  expect(out).toMatchObject({
    outcome: 'FAILED',
    scanId: 's1',
    reason: expect.stringMatching(/size/i),
  })
  expect(repo.mergeStages).toHaveBeenCalledWith(
    's1',
    { external: 'FAILED' },
    {}
  )
  expect(delBlob).not.toHaveBeenCalled()
})

test('blob store error on fetch (not a size rejection) → FAILED with no scan row created', async () => {
  fetchBlob.mockRejectedValue(new Error('blob store unavailable'))
  const out = await securitySarifIngestService.ingest(JOB)
  expect(repo.createIfAbsent).not.toHaveBeenCalled()
  expect(out).toEqual({
    outcome: 'FAILED',
    scanId: null,
    reason: 'blob store unavailable',
  })
})

test('a delete failure never changes the outcome: happy path stays INGESTED', async () => {
  fetchBlob.mockResolvedValue(gz(sarifDoc([result(1)])))
  delBlob.mockRejectedValueOnce(new Error('delete failed'))
  const out = await securitySarifIngestService.ingest(JOB)
  expect(out).toMatchObject({ outcome: 'INGESTED' })
})

test('pruneStaleBlobs deletes only security-sarif blobs older than 24h', async () => {
  const now = new Date('2026-09-10T00:00:00Z')
  ;(blob.listSarifBlobs as jest.Mock).mockResolvedValue([
    { url: 'u-old', uploadedAt: new Date('2026-09-08T00:00:00Z') },
    { url: 'u-new', uploadedAt: new Date('2026-09-09T23:00:00Z') },
  ])
  expect(await securitySarifIngestService.pruneStaleBlobs(now)).toEqual({
    deleted: 1,
    failed: 0,
  })
  expect(delBlob).toHaveBeenCalledWith('u-old')
  expect(delBlob).not.toHaveBeenCalledWith('u-new')
})

test('pruneStaleBlobs continues past a failed delete and reports it separately', async () => {
  const now = new Date('2026-09-10T00:00:00Z')
  ;(blob.listSarifBlobs as jest.Mock).mockResolvedValue([
    { url: 'u-old-1', uploadedAt: new Date('2026-09-08T00:00:00Z') },
    { url: 'u-old-2', uploadedAt: new Date('2026-09-08T00:00:00Z') },
  ])
  delBlob
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce(undefined)
  expect(await securitySarifIngestService.pruneStaleBlobs(now)).toEqual({
    deleted: 1,
    failed: 1,
  })
  expect(delBlob).toHaveBeenCalledWith('u-old-1')
  expect(delBlob).toHaveBeenCalledWith('u-old-2')
})
