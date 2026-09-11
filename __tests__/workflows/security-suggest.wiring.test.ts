/**
 * @jest-environment node
 *
 * LUM-740 — both writers of EXTERNAL_TOOL findings run the suggested-
 * disposition step after persisting and BEFORE the PR write-back, so a
 * suggested row never gets an inline comment; a step failure changes
 * nothing about the run's outcome.
 */
jest.mock('@/lib/workflows/security-managed-scan.steps', () => ({
  scanRepositoryInSandboxStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  resolveSarifScanStep: jest.fn(),
  fetchAndNormalizeSarifStep: jest.fn(),
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn().mockResolvedValue(undefined),
  markSarifStagesStep: jest.fn().mockResolvedValue(undefined),
  deleteSarifBlobStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/workflows/security-suggest.steps', () => ({
  suggestDispositionsStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('workflow', () => ({ sleep: jest.fn() }))

import { securityManagedScanWorkflow } from '@/lib/workflows/security-managed-scan'
import { securitySarifIngestWorkflow } from '@/lib/workflows/security-sarif-ingest'
import { scanRepositoryInSandboxStep } from '@/lib/workflows/security-managed-scan.steps'
import * as steps from '@/lib/workflows/security-sarif-ingest.steps'
import { syncPrReviewStep } from '@/lib/workflows/security-pr-review.steps'
import { suggestDispositionsStep } from '@/lib/workflows/security-suggest.steps'

const scan = scanRepositoryInSandboxStep as jest.Mock
const resolve = steps.resolveSarifScanStep as jest.Mock
const fetchNorm = steps.fetchAndNormalizeSarifStep as jest.Mock
const persist = steps.persistSarifFindingsStep as jest.Mock
const sync = syncPrReviewStep as jest.Mock
const suggest = suggestDispositionsStep as jest.Mock

const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const MANAGED_JOB = { scanId: 's1', pr: PR, headSha: 'a'.repeat(40) }
const SARIF_JOB = {
  url: 'https://blob.vercel-storage.com/security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  pathname: 'security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  repository: 'o/r',
  headSha: 'sha1',
  prNumber: 7,
  tool: 'semgrep',
}
const ok = (tool: string, n: number) => ({
  kind: 'ok',
  tool,
  tools: [tool],
  findings: Array.from({ length: n }, (_, i) => ({ ruleId: `${tool}-${i}` })),
  truncated: false,
  dropped: { notInDiff: 0, noLocation: 0, duplicate: 0 },
})
const skipped = () => ({ kind: 'skipped', reason: 'no package sources' })

describe('LUM-740 suggested disposition wiring', () => {
  const order: string[] = []
  beforeEach(() => {
    jest.clearAllMocks()
    order.length = 0
    suggest.mockImplementation(async () => {
      order.push('suggest')
    })
    sync.mockImplementation(async () => {
      order.push('sync')
    })
    persist.mockImplementation(
      async (input: { findings: unknown[]; truncated: boolean }) => {
        order.push('persist')
        return { written: input.findings.length, partial: input.truncated }
      }
    )
    resolve.mockResolvedValue({ kind: 'ok', scanId: 's1', pr: PR })
  })

  it('managed scan: suggests after the tools persisted and before the PR sync', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 1),
      semgrep: ok('semgrep', 2),
      'osv-scanner': skipped(),
    })
    await expect(
      securityManagedScanWorkflow(MANAGED_JOB)
    ).resolves.toMatchObject({ outcome: 'INGESTED', findings: 3 })
    expect(suggest).toHaveBeenCalledWith('s1')
    expect(order).toEqual(['persist', 'persist', 'suggest', 'sync'])
  })

  it('managed scan: nothing written → no suggestion step', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 0),
      semgrep: ok('semgrep', 0),
      'osv-scanner': skipped(),
    })
    await securityManagedScanWorkflow(MANAGED_JOB)
    expect(suggest).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('managed scan: a failing suggestion step leaves the outcome INGESTED and still syncs', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 1),
      semgrep: ok('semgrep', 0),
      'osv-scanner': skipped(),
    })
    suggest.mockRejectedValue(new Error('gateway down'))
    await expect(
      securityManagedScanWorkflow(MANAGED_JOB)
    ).resolves.toMatchObject({ outcome: 'INGESTED', findings: 1 })
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('SARIF ingest: suggests after persist and before the PR sync', async () => {
    fetchNorm.mockResolvedValue(ok('semgrep', 3))
    await expect(securitySarifIngestWorkflow(SARIF_JOB)).resolves.toMatchObject(
      {
        outcome: 'INGESTED',
        findings: 3,
      }
    )
    expect(suggest).toHaveBeenCalledWith('s1')
    expect(order).toEqual(['persist', 'suggest', 'sync'])
  })

  it('SARIF ingest: an empty report → no suggestion step', async () => {
    fetchNorm.mockResolvedValue(ok('semgrep', 0))
    await securitySarifIngestWorkflow(SARIF_JOB)
    expect(suggest).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledWith('s1')
  })
})
