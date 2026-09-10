/** @jest-environment node */
jest.mock('@/lib/workflows/security-managed-scan.steps', () => ({
  scanRepositoryInSandboxStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn(),
  deleteSarifBlobStep: jest.fn(),
}))

import { securityManagedScanWorkflow } from '@/lib/workflows/security-managed-scan'
import { scanRepositoryInSandboxStep } from '@/lib/workflows/security-managed-scan.steps'
import {
  persistSarifFindingsStep,
  markSarifExternalFailedStep,
} from '@/lib/workflows/security-sarif-ingest.steps'

const scan = scanRepositoryInSandboxStep as jest.Mock
const persist = persistSarifFindingsStep as jest.Mock
const markFailed = markSarifExternalFailedStep as jest.Mock

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

beforeEach(() => {
  jest.resetAllMocks()
  markFailed.mockResolvedValue(undefined)
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
})

it('both tools failed: no persist, FAILED with both reasons', async () => {
  scan.mockResolvedValue({
    gitleaks: { kind: 'failed', reason: 'gitleaks exit 2' },
    semgrep: { kind: 'failed', reason: 'semgrep produced no report' },
  })
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'gitleaks exit 2; semgrep produced no report',
  })
  expect(persist).not.toHaveBeenCalled()
  expect(markFailed).toHaveBeenCalledWith('s1')
})

it('the scan step exhausting its retries (throws) stamps FAILED with the error message', async () => {
  scan.mockRejectedValue(new Error('sandbox_unavailable'))
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'sandbox_unavailable',
  })
  expect(persist).not.toHaveBeenCalled()
  expect(markFailed).toHaveBeenCalledWith('s1')
})

it('a persist step exhausting its retries stamps FAILED (never a fake RAN)', async () => {
  scan.mockResolvedValue({
    gitleaks: ok('gitleaks', 1),
    semgrep: ok('semgrep', 1),
  })
  persist.mockRejectedValueOnce(new Error('P1001'))
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual({
    outcome: 'FAILED',
    scanId: 's1',
    reason: 'P1001',
  })
  expect(markFailed).toHaveBeenCalledWith('s1')
})

it('markFailed exhausting its retries still returns FAILED', async () => {
  scan.mockRejectedValue(new Error('boom'))
  markFailed.mockRejectedValue(new Error('db down'))
  await expect(securityManagedScanWorkflow(JOB)).resolves.toMatchObject({
    outcome: 'FAILED',
    reason: 'boom',
  })
})
