/** @jest-environment node */
/**
 * LUM-1025 (LUM-1024 ruling) — the four Vercel-Sandbox-backed workflows
 * (managed scan, baseline scan, hunt, review verifier) are OFF when Sandbox
 * credentials are not configured: the kill switches read false and the start
 * entry points skip without ever calling the Workflow runtime.
 */
const mockStart = jest.fn()
jest.mock('workflow/api', () => ({
  start: (...args: unknown[]) => mockStart(...args),
  getRun: jest.fn(),
}))
jest.mock('@/lib/workflows/security-managed-scan', () => ({
  securityManagedScanWorkflow: 'managed',
}))
jest.mock('@/lib/workflows/security-baseline-scan', () => ({
  securityBaselineScanWorkflow: 'baseline',
}))
jest.mock('@/lib/workflows/security-hunt', () => ({
  securityHuntWorkflow: 'hunt',
}))
jest.mock('@/lib/workflows/review-verifier', () => ({
  reviewVerifierWorkflow: 'verifier',
}))
jest.mock('@/ee/security/services/scan-code-retention.service', () => ({
  scrubScanIfRepositoryUnconfirmed: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { recordHuntStart: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { startSecurityManagedScan } from '@/ee/security/services/security-managed-scan-start'
import { startSecurityBaselineScan } from '@/ee/security/services/security-baseline-scan-start'
import { startSecurityHunt } from '@/ee/security/services/security-hunt-start'
import { startReviewVerifier } from '@/ee/security/services/review-verifier-start'
import { isManagedScanEnabled } from '@/ee/security/services/security-managed-scan.config'
import { isHuntEnabled } from '@/ee/security/services/security-hunt.config'
import { isReviewVerifierEnabled } from '@/ee/security/services/review-verifier.config'
import {
  platformSecurityCeiling,
  resolveSecurityLayers,
} from '@/ee/security/security-scan/workspace-switches'
import { logger } from '@/lib/logger'
import type { ManagedScanJob } from '@/ee/security/services/security-managed-scan.config'
import type { BaselineScanJob } from '@/ee/security/services/security-managed-scan.config'
import type { HuntJob } from '@/ee/security/services/security-hunt.config'
import type { ReviewVerifierJob } from '@/ee/security/services/review-verifier.service'

const SAVED = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  mockStart.mockResolvedValue({ runId: 'run_1' })
  delete process.env.VERCEL
  delete process.env.VERCEL_OIDC_TOKEN
})
afterAll(() => {
  process.env = SAVED
})

const managedJob = {
  scanId: 's1',
  pr: { id: 'p', workspaceId: 'w', repo: 'o/r', number: 1 },
  headSha: 'abcdef1234',
  huntWanted: false,
} as unknown as ManagedScanJob
const baselineJob = {
  workspaceId: 'w',
  repo: 'o/r',
  sha: 'abcdef1234',
} as unknown as BaselineScanJob
const huntJob = {
  scanId: 's1',
  repo: 'o/r',
  prNumber: 1,
} as unknown as HuntJob
const verifierJob = {
  scanId: 's1',
  repo: 'o/r',
  prNumber: 1,
} as unknown as ReviewVerifierJob

describe('without Vercel Sandbox credentials', () => {
  it('every kill switch reads off', () => {
    expect(isManagedScanEnabled({})).toBe(false)
    expect(isHuntEnabled({})).toBe(false)
    expect(isReviewVerifierEnabled({})).toBe(false)
    expect(platformSecurityCeiling({})).toEqual({
      managedScan: false,
      hunt: false,
      rewardHack: false,
      sandbox: false,
    })
    expect(resolveSecurityLayers(null, {})).toMatchObject({
      scan: true,
      managedScan: false,
      hunt: false,
      // the hunt is not offered at all, so it is not "turned off" by anyone
      huntTurnedOff: false,
    })
  })

  it('the managed scan start skips without calling the Workflow runtime', async () => {
    await expect(startSecurityManagedScan(managedJob)).resolves.toBeNull()
    expect(mockStart).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Vercel Sandbox is not configured')
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('the baseline scan start skips', async () => {
    await expect(startSecurityBaselineScan(baselineJob)).resolves.toBeNull()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('the hunt start skips', async () => {
    await expect(startSecurityHunt(huntJob)).resolves.toBeNull()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('the review verifier start skips', async () => {
    await expect(startReviewVerifier(verifierJob)).resolves.toBe(false)
    expect(mockStart).not.toHaveBeenCalled()
  })
})

describe('with Vercel Sandbox credentials', () => {
  it('the switches stay on by default and an explicit off still wins', () => {
    expect(isManagedScanEnabled({ VERCEL: '1' })).toBe(true)
    expect(isHuntEnabled({ VERCEL_OIDC_TOKEN: 'jwt' })).toBe(true)
    expect(isReviewVerifierEnabled({ VERCEL: '1' })).toBe(true)
    expect(
      isManagedScanEnabled({ VERCEL: '1', LUMO_MANAGED_SCAN: 'off' })
    ).toBe(false)
    expect(platformSecurityCeiling({ VERCEL: '1' }).sandbox).toBe(true)
  })

  it('the four starts call the Workflow runtime', async () => {
    process.env.VERCEL = '1'
    await expect(startSecurityManagedScan(managedJob)).resolves.toBe('run_1')
    await expect(startSecurityBaselineScan(baselineJob)).resolves.toBe('run_1')
    await expect(startSecurityHunt(huntJob)).resolves.toBe('run_1')
    await expect(startReviewVerifier(verifierJob)).resolves.toBe(true)
    expect(mockStart).toHaveBeenCalledTimes(4)
  })
})
