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
import {
  prepareSuggestionsStep,
  judgeSuggestionStep,
  finishSuggestionsStep,
} from './security-suggest.steps'
import type { ScanStages } from '@/lib/security-scan/types'

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
  reason?: string,
  /** LUM-738: which layers failed; the step defaults to `external` alone. */
  patch?: ScanStages
): Promise<void> {
  try {
    // Only pass the patch when there is one: the ingest workflow's callers
    // (and their tests) still see the two-argument LUM-735 shape.
    await (patch
      ? markSarifExternalFailedStep(scanId, reason, patch)
      : markSarifExternalFailedStep(scanId, reason))
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

/**
 * LUM-740: run the falsifier over the findings just persisted and record
 * suggested false positives — BEFORE the PR write-back, so a suggested row
 * never gets an inline comment. A failure here is a missing suggestion, never
 * a changed outcome.
 */
export async function suggestDispositionsBestEffort(
  scanId: string
): Promise<void> {
  let prepared
  try {
    prepared = await prepareSuggestionsStep(scanId)
  } catch {
    // Retries exhausted inside the step; the service already logged it.
    return
  }
  if (!prepared.enabled) return
  let tokens = 0
  for (const candidate of prepared.candidates) {
    try {
      tokens += (await judgeSuggestionStep(candidate)).tokens
    } catch {
      // One finding's judgment is lost; the others still run.
    }
  }
  try {
    await finishSuggestionsStep(scanId, tokens)
  } catch {
    // The stamp is best effort: the PR write-back holds the external rows
    // for this scan only until a later scan of the PR lands.
  }
}
