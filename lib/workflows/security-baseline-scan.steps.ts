/**
 * LUM-738 — `'use step'` boundaries of the repository baseline scan. The
 * sandbox step carries the installation token, the clone and the raw SARIF
 * in its own process and returns fingerprints only; the persist step writes
 * that set to `ProjectRepository.securityBaseline`. Default retry policy.
 */
import { securityManagedScanService } from '@/lib/services/security-managed-scan.service'
import { securityBaselineService } from '@/lib/services/security-baseline.service'
import type {
  BaselineScanJob,
  BaselineScanOutcome,
} from '@/lib/services/security-managed-scan.config'

export async function scanBaselineInSandboxStep(
  job: BaselineScanJob
): Promise<BaselineScanOutcome> {
  'use step'
  return securityManagedScanService.scanBaseline(job)
}

export async function persistSecurityBaselineStep(
  job: BaselineScanJob,
  outcome: BaselineScanOutcome
): Promise<number> {
  'use step'
  return securityBaselineService.persist(job, outcome)
}
