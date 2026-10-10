/** @jest-environment node */
jest.mock('@/lib/workflows/security-baseline-scan.steps', () => ({
  scanBaselineInSandboxStep: jest.fn(),
  persistSecurityBaselineStep: jest.fn(),
}))

import { securityBaselineScanWorkflow } from '@/lib/workflows/security-baseline-scan'
import {
  scanBaselineInSandboxStep,
  persistSecurityBaselineStep,
} from '@/lib/workflows/security-baseline-scan.steps'

const scan = scanBaselineInSandboxStep as jest.Mock
const persist = persistSecurityBaselineStep as jest.Mock
const JOB = { workspaceId: 'w1', repo: 'o/r', sha: 'b'.repeat(40) }

beforeEach(() => {
  jest.resetAllMocks()
  persist.mockResolvedValue(1)
})

describe('LUM-738 baseline lifecycle — workflow', () => {
  it('scans then persists the outcome as-is and reports what landed', async () => {
    const outcome = {
      fingerprints: ['a', 'b'],
      partial: false,
      tools: ['gitleaks', 'semgrep', 'osv-scanner'],
      failed: [],
      skipped: [],
    }
    scan.mockResolvedValue(outcome)
    await expect(securityBaselineScanWorkflow(JOB)).resolves.toEqual({
      outcome: 'WRITTEN',
      fingerprints: 2,
      partial: false,
      tools: ['gitleaks', 'semgrep', 'osv-scanner'],
      failed: [],
      skipped: [],
    })
    expect(scan).toHaveBeenCalledWith(JOB)
    expect(persist).toHaveBeenCalledWith(JOB, outcome)
  })

  it('a tool that failed inside the sandbox is a value: the rest is still written (partial baseline errs toward "new")', async () => {
    scan.mockResolvedValue({
      fingerprints: ['a'],
      partial: true,
      tools: ['gitleaks'],
      failed: ['semgrep exit 2'],
      skipped: ['osv-scanner'],
    })
    await expect(securityBaselineScanWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'WRITTEN',
      partial: true,
      failed: ['semgrep exit 2'],
      skipped: ['osv-scanner'],
    })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('a step exhausting its retries returns FAILED and writes nothing (the claim stays until it goes stale)', async () => {
    scan.mockRejectedValue(new Error('sandbox_unavailable'))
    await expect(securityBaselineScanWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      reason: 'sandbox_unavailable',
    })
    expect(persist).not.toHaveBeenCalled()
    scan.mockResolvedValue({
      fingerprints: [],
      partial: false,
      tools: [],
      failed: [],
      skipped: [],
    })
    persist.mockRejectedValue(new Error('P1001'))
    await expect(securityBaselineScanWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      reason: 'P1001',
    })
  })
})
