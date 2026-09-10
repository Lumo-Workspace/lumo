/**
 * LUM-735 v4 — `'use step'` boundaries for the SARIF ingest workflow. Each
 * step is a one-line delegate so the service stays a plain, unit-testable
 * module and the compiler only rewrites this file. Steps run in the full
 * Node runtime with the default retry policy (3 retries) — the service
 * decides what is retryable by throwing vs. returning (see its header).
 */
import {
  securitySarifIngestService,
  type FetchAndNormalizeInput,
  type NormalizeOutcome,
  type PersistInput,
  type PersistOutcome,
  type ResolveOutcome,
  type SarifIngestJob,
} from '@/lib/services/security-sarif-ingest.service'

export async function resolveSarifScanStep(
  job: SarifIngestJob
): Promise<ResolveOutcome> {
  'use step'
  return securitySarifIngestService.resolveScan(job)
}

export async function fetchAndNormalizeSarifStep(
  input: FetchAndNormalizeInput
): Promise<NormalizeOutcome> {
  'use step'
  return securitySarifIngestService.fetchAndNormalize(input)
}

export async function persistSarifFindingsStep(
  input: PersistInput
): Promise<PersistOutcome> {
  'use step'
  return securitySarifIngestService.persistFindings(input)
}

export async function markSarifExternalFailedStep(
  scanId: string
): Promise<void> {
  'use step'
  return securitySarifIngestService.markExternalFailed(scanId)
}

export async function deleteSarifBlobStep(url: string): Promise<void> {
  'use step'
  const deleted = await securitySarifIngestService.deleteBlobSafely(url)
  if (!deleted) throw new Error('blob delete failed')
}
