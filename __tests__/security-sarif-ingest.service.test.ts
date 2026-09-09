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
    replaceExternalFindings: jest.fn(),
    mergeStages: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
    findScanRow: jest.fn(),
  },
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

const KEY = 'AKIAABCDEFGHIJKLMNOP'
const fetchBlob = blob.fetchPrivateBlob as jest.Mock
const delBlob = blob.deleteBlob as jest.Mock
const diff = fetchPrDiff as jest.Mock
const findPr = pullRequestRepository.findByRepoAndNumber as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>

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
  repo.replaceExternalFindings.mockImplementation(
    async (_s, _t, rows) => rows.length
  )
  repo.findScanRow.mockResolvedValue({
    id: 's1',
    status: 'PENDING',
    stages: null,
    partial: false,
    startedAt: new Date(),
  })
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
  const rows = repo.replaceExternalFindings.mock.calls[0]![2]
  expect(repo.replaceExternalFindings).toHaveBeenCalledWith(
    's1',
    'semgrep-oss',
    expect.any(Array)
  )
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({
    provenance: 'EXTERNAL_TOOL',
    ruleId: 'ext:semgrep-oss:r1',
    externalRef: 'https://h/1',
    scanId: 's1',
  })
  expect(repo.mergeStages).toHaveBeenCalledWith(
    's1',
    { external: 'RAN' },
    { partial: false }
  )
  expect(projectRepository.markSarifIngested).toHaveBeenCalledWith(
    'w1',
    'o/r',
    expect.any(Date)
  )
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
})

test('a finalized CLEAN scan gets status FINDINGS when the push brings rows', async () => {
  repo.findScanRow.mockResolvedValue({
    id: 's1',
    status: 'CLEAN',
    stages: { secrets: 'RAN' },
    partial: false,
    startedAt: new Date(),
  })
  repo.createIfAbsent.mockResolvedValue({
    id: 's1',
    created: false,
    status: 'CLEAN',
    startedAt: new Date(),
  })
  fetchBlob.mockResolvedValue(gz(sarifDoc([result(1)])))
  await securitySarifIngestService.ingest(JOB)
  expect(repo.mergeStages).toHaveBeenCalledWith(
    's1',
    { external: 'RAN' },
    { partial: false, status: 'FINDINGS' }
  )
})

test('RED LINE: gitleaks-style payload never lands the secret; the SARIF itself is never persisted', async () => {
  fetchBlob.mockResolvedValue(
    gz(
      sarifDoc([result(2, { message: { text: `Secret: ${KEY}` } })], 'gitleaks')
    )
  )
  await securitySarifIngestService.ingest({ ...JOB, tool: 'gitleaks' })
  const rows = repo.replaceExternalFindings.mock.calls[0]![2]
  expect(rows[0]).toMatchObject({ kind: 'SECRET' })
  expect(JSON.stringify(rows)).not.toContain(KEY)
  expect(JSON.stringify(repo.mergeStages.mock.calls)).not.toContain(KEY)
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
  expect(repo.replaceExternalFindings.mock.calls[0]![2][0]).toMatchObject({
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

test('oversized gzip → FAILED before parsing', async () => {
  fetchBlob.mockResolvedValue(Buffer.alloc(SARIF_MAX_GZ_BYTES + 1))
  const out = await securitySarifIngestService.ingest(JOB)
  expect(out).toMatchObject({
    outcome: 'FAILED',
    reason: expect.stringMatching(/size/i),
  })
})

test('pruneStaleBlobs deletes only security-sarif blobs older than 24h', async () => {
  const now = new Date('2026-09-10T00:00:00Z')
  ;(blob.listSarifBlobs as jest.Mock).mockResolvedValue([
    { url: 'u-old', uploadedAt: new Date('2026-09-08T00:00:00Z') },
    { url: 'u-new', uploadedAt: new Date('2026-09-09T23:00:00Z') },
  ])
  expect(await securitySarifIngestService.pruneStaleBlobs(now)).toEqual({
    deleted: 1,
  })
  expect(delBlob).toHaveBeenCalledWith('u-old')
  expect(delBlob).not.toHaveBeenCalledWith('u-new')
})
