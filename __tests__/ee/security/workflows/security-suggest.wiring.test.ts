/**
 * @jest-environment node
 *
 * LUM-740 — both writers of EXTERNAL_TOOL findings run the suggested-
 * disposition step after persisting and BEFORE the PR write-back, so a
 * suggested row never gets an inline comment; a step failure changes
 * nothing about the run's outcome.
 */

// LUM-866: every workspace here has the default switches (all on).
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/workflows/security-managed-scan.steps', () => ({
  scanRepositoryInSandboxStep: jest.fn(),
  // LUM-892: scanning stays on unless a test says otherwise.
  stopIfScanningOffStep: jest.fn(async () => false),
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
  prepareSuggestionsStep: jest.fn(),
  judgeSuggestionStep: jest.fn(),
  finishSuggestionsStep: jest.fn(),
}))
jest.mock('workflow', () => ({ sleep: jest.fn() }))

import { securityManagedScanWorkflow } from '@/lib/workflows/security-managed-scan'
import { securitySarifIngestWorkflow } from '@/lib/workflows/security-sarif-ingest'
import { scanRepositoryInSandboxStep } from '@/lib/workflows/security-managed-scan.steps'
import * as steps from '@/lib/workflows/security-sarif-ingest.steps'
import { syncPrReviewStep } from '@/lib/workflows/security-pr-review.steps'
import {
  prepareSuggestionsStep,
  judgeSuggestionStep,
  finishSuggestionsStep,
} from '@/lib/workflows/security-suggest.steps'

const scan = scanRepositoryInSandboxStep as jest.Mock
const resolve = steps.resolveSarifScanStep as jest.Mock
const fetchNorm = steps.fetchAndNormalizeSarifStep as jest.Mock
const persist = steps.persistSarifFindingsStep as jest.Mock
const sync = syncPrReviewStep as jest.Mock
const prepare = prepareSuggestionsStep as jest.Mock
const judge = judgeSuggestionStep as jest.Mock
const finish = finishSuggestionsStep as jest.Mock

const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const MANAGED_JOB = {
  scanId: 's1',
  pr: PR,
  headSha: 'a'.repeat(40),
  huntWanted: false,
}
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
    prepare.mockImplementation(async () => {
      order.push('prepare')
      return {
        enabled: true,
        candidates: [
          { id: 'f1', hunk: 'h' },
          { id: 'f2', hunk: 'h' },
        ],
      }
    })
    judge.mockImplementation(async () => {
      order.push('judge')
      return { suggested: false, tokens: 3 }
    })
    finish.mockImplementation(async () => {
      order.push('finish')
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
      // LUM-846: no workflows, no IaC — neither persists nor fails.
      zizmor: skipped(),
      trivy: skipped(),
    })
    await expect(
      securityManagedScanWorkflow(MANAGED_JOB)
    ).resolves.toMatchObject({ outcome: 'INGESTED', findings: 3 })
    expect(prepare).toHaveBeenCalledWith('s1')
    expect(judge).toHaveBeenCalledTimes(2)
    expect(finish).toHaveBeenCalledWith('s1', 6)
    expect(order).toEqual([
      'persist',
      'persist',
      'prepare',
      'judge',
      'judge',
      'finish',
      'sync',
    ])
  })

  it('managed scan: one judge step failing does not stop the others nor the finish', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 1),
      semgrep: ok('semgrep', 0),
      'osv-scanner': skipped(),
      // LUM-846: no workflows, no IaC — neither persists nor fails.
      zizmor: skipped(),
      trivy: skipped(),
    })
    judge
      .mockRejectedValueOnce(new Error('gateway 502'))
      .mockResolvedValueOnce({ suggested: true, tokens: 4 })
    await securityManagedScanWorkflow(MANAGED_JOB)
    expect(finish).toHaveBeenCalledWith('s1', 4)
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('managed scan: a switched-off pass prepares nothing and never calls finish', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 1),
      semgrep: ok('semgrep', 0),
      'osv-scanner': skipped(),
      // LUM-846: no workflows, no IaC — neither persists nor fails.
      zizmor: skipped(),
      trivy: skipped(),
    })
    prepare.mockResolvedValue({ enabled: false, candidates: [] })
    await securityManagedScanWorkflow(MANAGED_JOB)
    expect(judge).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('managed scan: nothing written → no suggestion step', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 0),
      semgrep: ok('semgrep', 0),
      'osv-scanner': skipped(),
      // LUM-846: no workflows, no IaC — neither persists nor fails.
      zizmor: skipped(),
      trivy: skipped(),
    })
    await securityManagedScanWorkflow(MANAGED_JOB)
    expect(prepare).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('managed scan: a failing prepare step leaves the outcome INGESTED and still syncs', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 1),
      semgrep: ok('semgrep', 0),
      'osv-scanner': skipped(),
      // LUM-846: no workflows, no IaC — neither persists nor fails.
      zizmor: skipped(),
      trivy: skipped(),
    })
    prepare.mockRejectedValue(new Error('gateway down'))
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
    expect(prepare).toHaveBeenCalledWith('s1')
    expect(order).toEqual([
      'persist',
      'prepare',
      'judge',
      'judge',
      'finish',
      'sync',
    ])
  })

  it('SARIF ingest: an empty report → no suggestion step', async () => {
    fetchNorm.mockResolvedValue(ok('semgrep', 0))
    await securitySarifIngestWorkflow(SARIF_JOB)
    expect(prepare).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledWith('s1')
  })
})
