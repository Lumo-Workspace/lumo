/**
 * Workflow-side helpers shared by the SARIF ingest and managed-scan
 * workflows. Deterministic (no I/O of their own): each wraps one step whose
 * platform retries are already exhausted when its error reaches here, and
 * swallows that final failure so an outcome the workflow has already decided
 * is not changed by it.
 */
import {
  deleteSarifBlobStep,
  markSarifExternalFailedStep,
} from './security-sarif-ingest.steps'
import { syncPrReviewStep } from './security-pr-review.steps'

/** After the step's own retries a leaked blob must not fail an outcome that is already decided. */
export async function deleteBlobBestEffort(url: string): Promise<void> {
  try {
    await deleteSarifBlobStep(url)
  } catch {
    // Retries exhausted inside the step; the service already logged it.
  }
}

/**
 * P9 stamp: retried by the platform; a final failure must still let the run
 * finish its cleanup. `reason` (already scrubbed by the caller, P8) rides
 * along into `PrSecurityScan.error` — see `markExternalFailed`.
 */
export async function markFailedBestEffort(
  scanId: string,
  reason?: string
): Promise<void> {
  try {
    await markSarifExternalFailedStep(scanId, reason)
  } catch {
    // Retries exhausted inside the step; the service already logged it.
  }
}

/**
 * LUM-735 Task 2: put the scan on its PR. The service already swallows every
 * GitHub failure, so this only guards the step boundary itself — a comment
 * must never turn an INGESTED run into a FAILED one.
 */
export async function syncPrReviewBestEffort(scanId: string): Promise<void> {
  try {
    await syncPrReviewStep(scanId)
  } catch {
    // Retries exhausted inside the step; the service already logged it.
  }
}
