/**
 * LUM-735 v4 — durable SARIF ingest (spec §6 L1, §8, §9, principles P8/P9).
 *
 * One run per pushed report, started by both completion paths (a second run
 * of the same report finds the blob gone → ALREADY_PROCESSED, or queues on
 * the scan-row lock inside persist). The workflow body is deterministic and
 * does no I/O itself: every side effect is a step, and a failed report keeps
 * its blob for 24h (for a human to inspect) via `sleep`, which replaced the
 * daily prune cron.
 *
 * Every exit from this workflow deletes the blob: the run is the only thing
 * that knows the report is finished with. Deletion is retried by the platform
 * (the step throws on failure); `deleteBlobBestEffort` swallows the residual
 * failure so a leaked blob never flips an outcome that is already decided —
 * the daily orphan sweep (`/api/cron/prune-security-sarif`) is the backstop
 * for blobs that never got a run at all.
 */
import { sleep } from 'workflow'
import type {
  IngestResult,
  ResolveOutcome,
  SarifIngestJob,
} from '@/lib/services/security-sarif-ingest.service'
import {
  fetchAndNormalizeSarifStep,
  persistSarifFindingsStep,
  resolveSarifScanStep,
} from './security-sarif-ingest.steps'
import {
  deleteBlobBestEffort,
  markFailedBestEffort,
  syncPrReviewBestEffort,
} from './security-scan-helpers'

/** How long a report that failed to ingest stays in blob storage. */
export const SARIF_FAILED_BLOB_TTL = '24h'

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export async function securitySarifIngestWorkflow(
  job: SarifIngestJob
): Promise<IngestResult> {
  'use workflow'

  let resolved: ResolveOutcome
  try {
    resolved = await resolveSarifScanStep(job)
  } catch (error) {
    // No scan row to stamp FAILED on. The blob must still not leak: keep it
    // for the same window, then delete, and let the run show as failed.
    await sleep(SARIF_FAILED_BLOB_TTL)
    await deleteBlobBestEffort(job.url)
    throw error
  }
  if (resolved.kind === 'discarded') {
    // Nobody owns this report: no scan row, nothing to inspect later. The
    // delete happens here rather than inside resolveScan so it goes through
    // the platform-retried step.
    await deleteBlobBestEffort(job.url)
    return { outcome: 'DISCARDED', reason: resolved.reason }
  }
  const { scanId, pr } = resolved

  let failure: string
  try {
    const fetched = await fetchAndNormalizeSarifStep({
      url: job.url,
      tool: job.tool,
      scanId,
      pr,
    })
    if (fetched.kind === 'not_found') return { outcome: 'ALREADY_PROCESSED' }
    if (fetched.kind === 'ok') {
      const { written, partial } = await persistSarifFindingsStep({
        scanId,
        pr,
        repository: job.repository,
        prNumber: job.prNumber,
        auth: job.workspaceId === undefined ? 'oidc' : 'key',
        tool: fetched.tool,
        tools: fetched.tools,
        findings: fetched.findings,
        truncated: fetched.truncated,
        dropped: fetched.dropped,
      })
      await deleteBlobBestEffort(job.url)
      // The findings are on the row: put them on the PR (idempotent, and it
      // never throws — see `securityPrReviewService.sync`).
      await syncPrReviewBestEffort(scanId)
      return { outcome: 'INGESTED', scanId, findings: written, partial }
    }
    failure = fetched.reason
  } catch (error) {
    // A step that exhausted its retries (blob store, GitHub, database).
    failure = reasonOf(error)
  }

  // P9: the layer failed — say so, never a fake CLEAN. Blob kept for
  // SARIF_FAILED_BLOB_TTL so the report can be inspected or re-pushed.
  await markFailedBestEffort(scanId, failure)
  // The PR should say the external layer failed, not stay silent.
  await syncPrReviewBestEffort(scanId)
  await sleep(SARIF_FAILED_BLOB_TTL)
  await deleteBlobBestEffort(job.url)
  return { outcome: 'FAILED', scanId, reason: failure }
}
