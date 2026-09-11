/** @jest-environment node */
jest.mock('@/lib/workflows/security-managed-scan.steps', () => ({
  scanRepositoryInSandboxStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn(),
  markSarifStagesStep: jest.fn(),
  deleteSarifBlobStep: jest.fn(),
}))

jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
}))

import { securityManagedScanWorkflow } from '@/lib/workflows/security-managed-scan'
import { scanRepositoryInSandboxStep } from '@/lib/workflows/security-managed-scan.steps'
import {
  persistSarifFindingsStep,
  markSarifExternalFailedStep,
  markSarifStagesStep,
} from '@/lib/workflows/security-sarif-ingest.steps'
import { syncPrReviewStep } from '@/lib/workflows/security-pr-review.steps'

const scan = scanRepositoryInSandboxStep as jest.Mock
const persist = persistSarifFindingsStep as jest.Mock
const markFailed = markSarifExternalFailedStep as jest.Mock
const markStages = markSarifStagesStep as jest.Mock
const syncReview = syncPrReviewStep as jest.Mock

const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const JOB = { scanId: 's1', pr: PR, headSha: 'a'.repeat(40) }
const ok = (tool: string, n: number) => ({
  kind: 'ok',
  tool,
  tools: [tool],
  findings: Array.from({ length: n }, (_, i) => ({ ruleId: `${tool}-${i}` })),
  truncated: false,
  dropped: { notInDiff: 0, noLocation: 0, duplicate: 0 },
})

/** LUM-738: a tree with no package sources — the LUM-735 fixtures' default third tool. */
const skipped = () => ({
  kind: 'skipped',
  reason: 'osv-scanner found no package sources',
})

beforeEach(() => {
  jest.resetAllMocks()
  markFailed.mockResolvedValue(undefined)
  markStages.mockResolvedValue(undefined)
  syncReview.mockResolvedValue(undefined)
  persist.mockImplementation(
    async (input: { findings: unknown[]; truncated: boolean }) => ({
      written: input.findings.length,
      partial: input.truncated,
    })
  )
})

it('persists every tool that succeeded (gitleaks first) with auth=managed and returns INGESTED', async () => {
  scan.mockResolvedValue({
    gitleaks: ok('gitleaks', 1),
    semgrep: ok('semgrep', 2),
    'osv-scanner': skipped(),
  })
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'INGESTED',
    scanId: 's1',
    findings: 3,
    partial: false,
  })
  expect(scan).toHaveBeenCalledWith(JOB)
  expect(persist).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      scanId: 's1',
      pr: PR,
      repository: 'o/r',
      prNumber: 7,
      auth: 'managed',
      tool: 'gitleaks',
      tools: ['gitleaks'],
    })
  )
  expect(persist).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ auth: 'managed', tool: 'semgrep' })
  )
  expect(markFailed).not.toHaveBeenCalled()
})

it('partial is the OR of the tools’ truncation', async () => {
  scan.mockResolvedValue({
    gitleaks: ok('gitleaks', 0),
    semgrep: { ...ok('semgrep', 1), truncated: true },
    'osv-scanner': skipped(),
  })
  await expect(securityManagedScanWorkflow(JOB)).resolves.toMatchObject({
    outcome: 'INGESTED',
    partial: true,
  })
})

it('one tool failed: persists the other first, then stamps FAILED with that tool’s reason', async () => {
  scan.mockResolvedValue({
    gitleaks: { kind: 'failed', reason: 'gitleaks exit 2' },
    semgrep: ok('semgrep', 1),
    'osv-scanner': skipped(),
  })
  const order: string[] = []
  persist.mockImplementation(async () => {
    order.push('persist')
    return { written: 1, partial: false }
  })
  markFailed.mockImplementation(async () => {
    order.push('mark')
  })
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'gitleaks exit 2',
  })
  expect(persist).toHaveBeenCalledTimes(1)
  expect(persist).toHaveBeenCalledWith(
    expect.objectContaining({ tool: 'semgrep' })
  )
  expect(order).toEqual(['persist', 'mark'])
  expect(markFailed).toHaveBeenCalledWith('s1', 'gitleaks exit 2', {
    external: 'FAILED',
  })
})

it('both tools failed: no persist, FAILED with both reasons', async () => {
  scan.mockResolvedValue({
    gitleaks: { kind: 'failed', reason: 'gitleaks exit 2' },
    semgrep: { kind: 'failed', reason: 'semgrep produced no report' },
    'osv-scanner': skipped(),
  })
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'gitleaks exit 2; semgrep produced no report',
  })
  expect(persist).not.toHaveBeenCalled()
  expect(markFailed).toHaveBeenCalledWith(
    's1',
    'gitleaks exit 2; semgrep produced no report',
    { external: 'FAILED' }
  )
})

it('the scan step exhausting its retries (throws) stamps FAILED with the error message', async () => {
  scan.mockRejectedValue(new Error('sandbox_unavailable'))
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'sandbox_unavailable',
  })
  expect(persist).not.toHaveBeenCalled()
  expect(markFailed).toHaveBeenCalledWith('s1', 'sandbox_unavailable', {
    external: 'FAILED',
    supplyChain: 'FAILED',
  })
})

it('a persist step exhausting its retries stamps FAILED (never a fake RAN)', async () => {
  scan.mockResolvedValue({
    gitleaks: ok('gitleaks', 1),
    semgrep: ok('semgrep', 1),
    'osv-scanner': skipped(),
  })
  persist.mockRejectedValueOnce(new Error('P1001'))
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'P1001',
  })
  expect(markFailed).toHaveBeenCalledWith('s1', 'P1001', {
    external: 'FAILED',
    supplyChain: 'FAILED',
  })
})

it('markFailed exhausting its retries still returns FAILED', async () => {
  scan.mockRejectedValue(new Error('boom'))
  markFailed.mockRejectedValue(new Error('db down'))
  await expect(securityManagedScanWorkflow(JOB)).resolves.toMatchObject({
    outcome: 'FAILED',
    reason: 'boom',
  })
})

// ── LUM-735 Task 2: the PR write-back ──────────────────────────────────────

it('INGESTED: posts the findings back to the PR', async () => {
  scan.mockResolvedValue({
    gitleaks: ok('gitleaks', 1),
    semgrep: ok('semgrep', 0),
    'osv-scanner': skipped(),
  })
  await securityManagedScanWorkflow(JOB)
  expect(syncReview).toHaveBeenCalledWith('s1')
})

it('FAILED: still posts, after the failure is stamped', async () => {
  scan.mockRejectedValue(new Error('sandbox_unavailable'))
  const order: string[] = []
  markFailed.mockImplementation(async () => {
    order.push('mark')
  })
  syncReview.mockImplementation(async () => {
    order.push('review')
  })
  await securityManagedScanWorkflow(JOB)
  expect(order).toEqual(['mark', 'review'])
})

it('a write-back whose retries are exhausted never changes the outcome', async () => {
  scan.mockResolvedValue({
    gitleaks: ok('gitleaks', 1),
    semgrep: ok('semgrep', 1),
    'osv-scanner': skipped(),
  })
  syncReview.mockRejectedValue(new Error('github down'))
  await expect(securityManagedScanWorkflow(JOB)).resolves.toMatchObject({
    outcome: 'INGESTED',
  })
  expect(markFailed).not.toHaveBeenCalled()
})

// ── LUM-738: osv-scanner → stages.supplyChain ──────────────────────────────

describe('LUM-738 osv-scanner in the managed workflow', () => {
  it('persists osv-scanner rows under the supplyChain stage, after the external tools, and counts them', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 1),
      semgrep: ok('semgrep', 1),
      'osv-scanner': ok('osv-scanner', 2),
    })
    await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
      outcome: 'INGESTED',
      scanId: 's1',
      findings: 4,
      partial: false,
    })
    expect(persist).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tool: 'gitleaks', stage: 'external' })
    )
    expect(persist).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tool: 'semgrep', stage: 'external' })
    )
    expect(persist).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        tool: 'osv-scanner',
        stage: 'supplyChain',
        auth: 'managed',
      })
    )
    expect(markStages).not.toHaveBeenCalled()
    expect(markFailed).not.toHaveBeenCalled()
  })

  it('a skipped osv-scanner (no package sources) stamps supplyChain SKIPPED, persists nothing for it, and the run is still INGESTED', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 0),
      semgrep: ok('semgrep', 0),
      'osv-scanner': skipped(),
    })
    await expect(securityManagedScanWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'INGESTED',
      findings: 0,
    })
    expect(markStages).toHaveBeenCalledWith('s1', { supplyChain: 'SKIPPED' })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(markFailed).not.toHaveBeenCalled()
  })

  it('an osv-scanner failure stamps supplyChain FAILED only — the external tools are persisted and external stays RAN', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 1),
      semgrep: ok('semgrep', 0),
      'osv-scanner': { kind: 'failed', reason: 'osv-scanner exit 129' },
    })
    await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      scanId: 's1',
      reason: 'osv-scanner exit 129',
    })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(markFailed).toHaveBeenCalledWith('s1', 'osv-scanner exit 129', {
      supplyChain: 'FAILED',
    })
    expect(syncReview).toHaveBeenCalledWith('s1')
  })

  it('external and supply-chain failures are stamped together with both reasons', async () => {
    scan.mockResolvedValue({
      gitleaks: { kind: 'failed', reason: 'gitleaks exit 2' },
      semgrep: ok('semgrep', 0),
      'osv-scanner': {
        kind: 'failed',
        reason: 'osv-scanner produced no report',
      },
    })
    await securityManagedScanWorkflow(JOB)
    expect(markFailed).toHaveBeenCalledWith(
      's1',
      'gitleaks exit 2; osv-scanner produced no report',
      { external: 'FAILED', supplyChain: 'FAILED' }
    )
  })

  it('the SKIPPED stamp exhausting its retries fails the run for both layers (never a silent gap)', async () => {
    scan.mockResolvedValue({
      gitleaks: ok('gitleaks', 0),
      semgrep: ok('semgrep', 0),
      'osv-scanner': skipped(),
    })
    markStages.mockRejectedValue(new Error('db down'))
    await expect(securityManagedScanWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'FAILED',
      reason: 'db down',
    })
    expect(markFailed).toHaveBeenCalledWith('s1', 'db down', {
      external: 'FAILED',
      supplyChain: 'FAILED',
    })
  })
})

it('LUM-745: a run superseded before its sandbox step returns DISCARDED without stamping or syncing', async () => {
  const superseded = { kind: 'skipped', reason: 'superseded' }
  scan.mockResolvedValue({
    gitleaks: superseded,
    semgrep: superseded,
    'osv-scanner': superseded,
  })
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'DISCARDED',
    reason: 'superseded',
  })
  expect(persist).not.toHaveBeenCalled()
  expect(markFailed).not.toHaveBeenCalled()
  expect(markStages).not.toHaveBeenCalled()
  expect(syncReview).not.toHaveBeenCalled()
})

it('LUM-745: only a full superseded outcome short-circuits — a lone skipped osv-scanner still runs the loop', async () => {
  scan.mockResolvedValue({
    gitleaks: ok('gitleaks', 0),
    semgrep: ok('semgrep', 0),
    'osv-scanner': { kind: 'skipped', reason: 'superseded' },
  })
  const result = await securityManagedScanWorkflow(JOB)
  expect(result.outcome).toBe('INGESTED')
  expect(persist).toHaveBeenCalledTimes(2)
})
