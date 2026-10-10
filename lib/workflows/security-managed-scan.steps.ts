/**
 * LUM-735 v5 — the one `'use step'` of the managed scan. Everything
 * secret-bearing (installation token, clone, raw SARIF) lives inside this
 * step's process; the platform persists only its input (scan/PR identifiers)
 * and its output (redacted findings). Default retry policy (3 retries) —
 * the service throws for transient failures and returns values for scanner
 * failures.
 */
import { securityManagedScanService } from '@/ee/security/services/security-managed-scan.service'
import { securitySarifIngestService } from '@/ee/security/services/security-sarif-ingest.service'
import type {
  ManagedScanJob,
  ManagedScanOutcome,
} from '@/ee/security/services/security-managed-scan.config'

export async function scanRepositoryInSandboxStep(
  job: ManagedScanJob
): Promise<ManagedScanOutcome> {
  'use step'
  return securityManagedScanService.scanRepository(job)
}

/** LUM-892 — re-read the workspace's scan switch before anything lands. */
export async function stopIfScanningOffStep(
  scanId: string,
  pr: ManagedScanJob['pr']
): Promise<boolean> {
  'use step'
  return securitySarifIngestService.stopIfScanningOff(scanId, pr)
}
