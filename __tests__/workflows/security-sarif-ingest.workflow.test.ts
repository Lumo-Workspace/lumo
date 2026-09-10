/** @jest-environment node */
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  resolveSarifScanStep: jest.fn(),
  fetchAndNormalizeSarifStep: jest.fn(),
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn().mockResolvedValue(undefined),
  deleteSarifBlobStep: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
}))

import { sleep } from 'workflow'
import {
  securitySarifIngestWorkflow,
  SARIF_FAILED_BLOB_TTL,
} from '@/lib/workflows/security-sarif-ingest'
import * as steps from '@/lib/workflows/security-sarif-ingest.steps'
import { syncPrReviewStep } from '@/lib/workflows/security-pr-review.steps'

const resolve = steps.resolveSarifScanStep as jest.Mock
const fetchNorm = steps.fetchAndNormalizeSarifStep as jest.Mock
const persist = steps.persistSarifFindingsStep as jest.Mock
const markFailed = steps.markSarifExternalFailedStep as jest.Mock
const delBlob = steps.deleteSarifBlobStep as jest.Mock
const sleepMock = sleep as unknown as jest.Mock
const syncReview = syncPrReviewStep as jest.Mock

const JOB = {
  url: 'https://blob.vercel-storage.com/security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  pathname: 'security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  repository: 'o/r',
  headSha: 'sha1',
  prNumber: 7,
  tool: 'semgrep',
}
const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const OK = {
  kind: 'ok',
  tool: 'semgrep',
  tools: ['semgrep'],
  findings: [],
  truncated: false,
  dropped: { notInDiff: 0, noLocation: 0, duplicate: 0 },
}

beforeEach(() => {
  jest.resetAllMocks()
  resolve.mockResolvedValue({ kind: 'ok', scanId: 's1', pr: PR })
  delBlob.mockResolvedValue(undefined)
  markFailed.mockResolvedValue(undefined)
  syncReview.mockResolvedValue(undefined)
})

it('exposes a 24h blob TTL', () => {
  expect(SARIF_FAILED_BLOB_TTL).toBe('24h')
})

it('happy path: resolve → fetch → persist → delete blob, no sleep', async () => {
  fetchNorm.mockResolvedValue(OK)
  persist.mockResolvedValue({ written: 3, partial: false })
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'INGESTED',
    scanId: 's1',
    findings: 3,
    partial: false,
  })
  expect(fetchNorm).toHaveBeenCalledWith({
    url: JOB.url,
    tool: 'semgrep',
    scanId: 's1',
    pr: PR,
  })
  expect(persist).toHaveBeenCalledWith(
    expect.objectContaining({
      scanId: 's1',
      pr: PR,
      auth: 'oidc',
      tools: ['semgrep'],
    })
  )
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
  expect(sleepMock).not.toHaveBeenCalled()
  expect(markFailed).not.toHaveBeenCalled()
})

it('happy path: persists before deleting the blob', async () => {
  fetchNorm.mockResolvedValue(OK)
  persist.mockResolvedValue({ written: 1, partial: false })
  const order: string[] = []
  persist.mockImplementation(async () => {
    order.push('persist')
    return { written: 1, partial: false }
  })
  delBlob.mockImplementation(async () => {
    order.push('delete')
  })
  await securitySarifIngestWorkflow(JOB)
  expect(order).toEqual(['persist', 'delete'])
})

it('a blob delete whose retries are exhausted still leaves the outcome INGESTED', async () => {
  fetchNorm.mockResolvedValue(OK)
  persist.mockResolvedValue({ written: 3, partial: false })
  delBlob.mockRejectedValue(new Error('blob delete failed'))
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'INGESTED',
    scanId: 's1',
    findings: 3,
    partial: false,
  })
  expect(markFailed).not.toHaveBeenCalled()
})

it('a blob delete whose retries are exhausted still leaves the outcome FAILED with the original reason', async () => {
  fetchNorm.mockResolvedValue({
    kind: 'failed',
    reason: 'Unsupported SARIF: not JSON',
  })
  delBlob.mockRejectedValue(new Error('blob delete failed'))
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'Unsupported SARIF: not JSON',
  })
  expect(markFailed).toHaveBeenCalledWith('s1', 'Unsupported SARIF: not JSON')
  expect(sleepMock).toHaveBeenCalledWith('24h')
})

it('returns DISCARDED with the resolve reason, deleting the blob and calling no other step', async () => {
  resolve.mockResolvedValue({ kind: 'discarded', reason: 'workspace_mismatch' })
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'DISCARDED',
    reason: 'workspace_mismatch',
  })
  // The delete lives here, not in resolveScan, so it is platform-retried.
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
  expect(fetchNorm).not.toHaveBeenCalled()
  expect(persist).not.toHaveBeenCalled()
  expect(markFailed).not.toHaveBeenCalled()
  expect(sleepMock).not.toHaveBeenCalled()
})

it('passes auth=key when the job carries a workspaceId', async () => {
  fetchNorm.mockResolvedValue(OK)
  persist.mockResolvedValue({ written: 0, partial: false })
  await securitySarifIngestWorkflow({ ...JOB, workspaceId: 'w1' })
  expect(persist).toHaveBeenCalledWith(expect.objectContaining({ auth: 'key' }))
})

it('pr_not_found: deletes the blob immediately — nothing owns the report, so nothing keeps it', async () => {
  resolve.mockResolvedValue({ kind: 'discarded', reason: 'pr_not_found' })
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'DISCARDED',
    reason: 'pr_not_found',
  })
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
  expect(fetchNorm).not.toHaveBeenCalled()
  expect(persist).not.toHaveBeenCalled()
  expect(markFailed).not.toHaveBeenCalled()
  expect(sleepMock).not.toHaveBeenCalled()
})

it('returns ALREADY_PROCESSED when the blob is gone (second run of the same report)', async () => {
  fetchNorm.mockResolvedValue({ kind: 'not_found' })
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'ALREADY_PROCESSED',
  })
  expect(persist).not.toHaveBeenCalled()
  expect(markFailed).not.toHaveBeenCalled()
})

it('deterministic failure: marks FAILED, keeps the blob 24h, then deletes it', async () => {
  fetchNorm.mockResolvedValue({
    kind: 'failed',
    reason: 'Unsupported SARIF: not JSON',
  })
  const order: string[] = []
  markFailed.mockImplementation(async () => {
    order.push('mark')
  })
  sleepMock.mockImplementation(async () => {
    order.push('sleep')
  })
  delBlob.mockImplementation(async () => {
    order.push('delete')
  })
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'Unsupported SARIF: not JSON',
  })
  expect(markFailed).toHaveBeenCalledWith('s1', 'Unsupported SARIF: not JSON')
  expect(sleepMock).toHaveBeenCalledWith('24h')
  expect(order).toEqual(['mark', 'sleep', 'delete'])
  expect(persist).not.toHaveBeenCalled()
})

it('a P9 stamp whose retries are exhausted still yields FAILED, and still sleeps then deletes', async () => {
  fetchNorm.mockResolvedValue({
    kind: 'failed',
    reason: 'Unsupported SARIF: not JSON',
  })
  markFailed.mockRejectedValue(new Error('mergeStages down'))
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    // The original reason survives — not the mark-failed error.
    reason: 'Unsupported SARIF: not JSON',
  })
  expect(markFailed).toHaveBeenCalledWith('s1', 'Unsupported SARIF: not JSON')
  expect(sleepMock).toHaveBeenCalledWith('24h')
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
})

it('a step that exhausted its retries (throws) takes the same FAILED path', async () => {
  fetchNorm.mockResolvedValue(OK)
  persist.mockRejectedValue(new Error('P1001 db unreachable'))
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'P1001 db unreachable',
  })
  expect(markFailed).toHaveBeenCalledWith('s1', 'P1001 db unreachable')
  expect(sleepMock).toHaveBeenCalledWith('24h')
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
})

it('resolve failure: no scan row to mark — still sleeps 24h, deletes the blob and rethrows', async () => {
  resolve.mockRejectedValue(new Error('db down'))
  await expect(securitySarifIngestWorkflow(JOB)).rejects.toThrow('db down')
  expect(markFailed).not.toHaveBeenCalled()
  expect(sleepMock).toHaveBeenCalledWith('24h')
  expect(delBlob).toHaveBeenCalledWith(JOB.url)
})

// ── LUM-735 Task 2: the PR write-back runs on every path that touched findings ──

it('INGESTED: posts the findings back to the PR', async () => {
  fetchNorm.mockResolvedValue(OK)
  persist.mockResolvedValue({ written: 3, partial: false })
  await securitySarifIngestWorkflow(JOB)
  expect(syncReview).toHaveBeenCalledWith('s1')
})

it('FAILED: posts the write-back after stamping the failure, before the blob TTL sleep', async () => {
  fetchNorm.mockResolvedValue({ kind: 'failed', reason: 'not JSON' })
  const order: string[] = []
  markFailed.mockImplementation(async () => {
    order.push('mark')
  })
  syncReview.mockImplementation(async () => {
    order.push('review')
  })
  sleepMock.mockImplementation(async () => {
    order.push('sleep')
  })
  await securitySarifIngestWorkflow(JOB)
  expect(order).toEqual(['mark', 'review', 'sleep'])
})

it('a write-back whose retries are exhausted never changes the outcome', async () => {
  fetchNorm.mockResolvedValue(OK)
  persist.mockResolvedValue({ written: 1, partial: false })
  syncReview.mockRejectedValue(new Error('github down'))
  await expect(securitySarifIngestWorkflow(JOB)).resolves.toEqual({
    outcome: 'INGESTED',
    scanId: 's1',
    findings: 1,
    partial: false,
  })
  expect(markFailed).not.toHaveBeenCalled()
})

it('DISCARDED and ALREADY_PROCESSED touch no findings, so no write-back', async () => {
  resolve.mockResolvedValue({ kind: 'discarded', reason: 'pr_not_found' })
  await securitySarifIngestWorkflow(JOB)
  expect(syncReview).not.toHaveBeenCalled()

  resolve.mockResolvedValue({ kind: 'ok', scanId: 's1', pr: PR })
  fetchNorm.mockResolvedValue({ kind: 'not_found' })
  await securitySarifIngestWorkflow(JOB)
  expect(syncReview).not.toHaveBeenCalled()
})
