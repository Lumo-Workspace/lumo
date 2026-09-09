/**
 * LUM-735 — SARIF ingest worker logic (spec §6 L1, §8, §9).
 *
 * fetch private blob → size gate → gunzip → JSON.parse → parseSarif →
 * resolve PR (must be this workspace's) → diff → normalise (diff-aware,
 * redacted) → replace this tool's EXTERNAL_TOOL rows → stages.external=RAN →
 * stamp ProjectRepository.lastSarifIngestAt → delete the blob.
 *
 * The SARIF document only ever exists in this function's memory. On a parse
 * failure the blob is KEPT (24h, see pruneStaleBlobs) so a human can inspect
 * it; everything else deletes it. Runs inside /api/internal/security-sarif-ingest.
 */
import { gunzipSync } from 'node:zlib'
import { waitUntil } from '@vercel/functions'
import { logger } from '@/lib/logger'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import {
  prSecurityScanRepository,
  type NewFindingInput,
} from '@/lib/repositories/pr-security-scan.repository'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import {
  addedLinesWithNumbers,
  parseSarif,
  normalizeSarif,
  changedLinesOf,
  type NormalizeResult,
} from '@/lib/security-scan'
import {
  inheritDispositions,
  DETECTOR_VERSION,
} from './pr-security-scan.service'
import { dispatchPrSecurityScan } from './pr-security-scan-dispatch'
import {
  fetchPrivateBlob,
  deleteBlob,
  listSarifBlobs,
} from './security-sarif-blob'

export const SARIF_MAX_GZ_BYTES = 100 * 1024 * 1024
export const SARIF_MAX_RAW_BYTES = 400 * 1024 * 1024
export const SARIF_FAILED_BLOB_TTL_MS = 24 * 60 * 60 * 1000

export interface SarifIngestJob {
  url: string
  pathname: string
  /**
   * Present only when the report was pushed with a `security:ingest` ApiKey,
   * whose workspace is the trust boundary. A GitHub Actions OIDC push proves a
   * repository instead, and ownership follows the PullRequest row, so the
   * field is absent and no cross-workspace check applies.
   *
   * `| undefined` is explicit for `exactOptionalPropertyTypes`: this is the
   * type Zod infers for `.optional()`, so a parsed job assigns cleanly.
   */
  workspaceId?: string | undefined
  repository: string
  headSha: string
  prNumber: number
  tool: string
}

export type IngestResult =
  | { outcome: 'INGESTED'; scanId: string; findings: number; partial: boolean }
  | { outcome: 'ALREADY_PROCESSED' }
  | { outcome: 'DISCARDED'; reason: 'pr_not_found' | 'workspace_mismatch' }
  | { outcome: 'FAILED'; scanId: string | null; reason: string }

function sized(reason: string): Error {
  return Object.assign(new Error(reason), { status: 413 })
}

/** Strips CR/LF and caps length before a caller-supplied string reaches a log line. */
function logSafe(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').slice(0, 120)
}

/** Never throws: a blob-store hiccup on delete must not change the outcome the caller already decided. */
async function safeDelete(url: string): Promise<boolean> {
  try {
    await deleteBlob(url)
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn(
      `[security-sarif-ingest] blob delete failed: ${reason.slice(0, 200)}`
    )
    return false
  }
}

/** Never throws: a second failure while recording the first must not crash the ingest. */
async function safeMarkExternalFailed(scanId: string): Promise<void> {
  try {
    await prSecurityScanRepository.mergeStages(
      scanId,
      { external: 'FAILED' },
      {}
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn(
      `[security-sarif-ingest] mergeStages(external=FAILED) also failed scan=${scanId}: ${reason.slice(0, 200)}`
    )
  }
}

type FetchOutcome =
  | { kind: 'ok'; gz: Buffer }
  | { kind: 'not_found' }
  | { kind: 'too_large'; reason: string }
  | { kind: 'error'; reason: string }

/** Distinguishes "blob already gone" from "too big to buffer" from "blob store errored" — each needs different handling. */
async function fetchBlobSafely(url: string): Promise<FetchOutcome> {
  try {
    const gz = await fetchPrivateBlob(url, SARIF_MAX_GZ_BYTES)
    return gz ? { kind: 'ok', gz } : { kind: 'not_found' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return (error as { status?: number }).status === 413
      ? { kind: 'too_large', reason }
      : { kind: 'error', reason }
  }
}

/** gunzip + parse with both caps enforced; throws {status} on any violation. */
function decode(gz: Buffer): unknown {
  if (gz.byteLength > SARIF_MAX_GZ_BYTES)
    throw sized(`gzip size ${gz.byteLength} exceeds cap`)
  let raw: Buffer
  try {
    raw = gunzipSync(gz, { maxOutputLength: SARIF_MAX_RAW_BYTES })
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
      throw sized('raw size exceeds cap')
    throw Object.assign(
      new Error(
        `Unsupported SARIF: gunzip failed (${(error as Error).message})`
      ),
      { status: 422 }
    )
  }
  if (raw.byteLength >= SARIF_MAX_RAW_BYTES) throw sized('raw size exceeds cap')
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw Object.assign(new Error('Unsupported SARIF: not JSON'), {
      status: 422,
    })
  }
}

export const securitySarifIngestService = {
  async ingest(job: SarifIngestJob): Promise<IngestResult> {
    const fetched = await fetchBlobSafely(job.url)
    if (fetched.kind === 'not_found') return { outcome: 'ALREADY_PROCESSED' }
    if (fetched.kind === 'error') {
      logger.error(
        `[security-sarif-ingest] blob fetch failed tool=${logSafe(job.tool)} repo=${logSafe(job.repository)}: ${fetched.reason.slice(0, 200)}`
      )
      return {
        outcome: 'FAILED',
        scanId: null,
        reason: fetched.reason.slice(0, 200),
      }
    }
    // fetched.kind is 'ok' or 'too_large' from here on. A too-large report
    // still needs a scan row so the FAILED stage lands somewhere (below).

    const pr = await pullRequestRepository.findByRepoAndNumber(
      job.repository,
      job.prNumber
    )
    if (!pr) {
      logger.warn(
        `[security-sarif-ingest] no PR ${logSafe(job.repository)}#${job.prNumber} — discarding ${logSafe(job.tool)} report`
      )
      await safeDelete(job.url)
      return { outcome: 'DISCARDED', reason: 'pr_not_found' }
    }
    if (job.workspaceId !== undefined && pr.workspaceId !== job.workspaceId) {
      logger.warn(
        `[security-sarif-ingest] PR ${logSafe(job.repository)}#${job.prNumber} belongs to another workspace — discarding`
      )
      await safeDelete(job.url)
      return { outcome: 'DISCARDED', reason: 'workspace_mismatch' }
    }

    // Whoever arrives first creates the shared scan row (spec §9). A PENDING
    // row tells stage A to claim it rather than dedupe onto it.
    const scan = await prSecurityScanRepository.createIfAbsent({
      pullRequestId: pr.id,
      taskId: pr.taskId ?? null,
      workspaceId: pr.workspaceId,
      headSha: job.headSha,
      trigger: 'SARIF_PUSH',
      detectorVersion: DETECTOR_VERSION,
      status: 'PENDING',
    })
    if (scan.created) {
      // LUM-735 review I3 — the push beat every PR webhook here, so this
      // PENDING row is one nothing else will ever run stage A on: the secret
      // scan and the judge would never run and the panel would sit on
      // "waiting for CI" forever. Stage A resolves the real head sha itself,
      // so it either claims this row (same sha) or dedupes onto the current
      // head's row. Not awaited: dispatch never throws, and a scan that fails
      // to start must not fail the ingest that already has a report — but it
      // is registered with `waitUntil`, not dropped on the floor, so the
      // serverless runtime keeps the instance alive until it settles instead
      // of freezing the moment this handler returns.
      waitUntil(dispatchPrSecurityScan(pr.id, 'SARIF_PUSH'))
    }

    let normalized: NormalizeResult
    try {
      // A too-large fetch never got its bytes buffered; raise the same
      // {status:413} `decode` would, so it's handled by the one catch below.
      if (fetched.kind === 'too_large') throw sized(fetched.reason)
      const runs = parseSarif(decode(fetched.gz))
      const diff = await fetchPrDiff({
        workspaceId: pr.workspaceId,
        fullName: pr.repo,
        prNumber: pr.number,
      })
      normalized = normalizeSarif(runs, {
        toolHint: job.tool,
        changedLines: changedLinesOf(addedLinesWithNumbers(diff)),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const gzSize = fetched.kind === 'ok' ? `${fetched.gz.byteLength}B` : 'n/a'
      logger.error(
        `[security-sarif-ingest] FAILED tool=${logSafe(job.tool)} gz=${gzSize} scan=${scan.id}: ${reason.slice(0, 200)}`
      )
      await safeMarkExternalFailed(scan.id)
      // Blob kept for debugging; pruneStaleBlobs removes it after 24h.
      return {
        outcome: 'FAILED',
        scanId: scan.id,
        reason: reason.slice(0, 500),
      }
    }

    try {
      const prior =
        await prSecurityScanRepository.findDispositionedByPullRequest(pr.id)
      const rows: NewFindingInput[] = inheritDispositions(
        normalized.findings.map(f => ({
          scanId: scan.id,
          kind: f.kind,
          ruleId: f.ruleId,
          severity: f.severity,
          provenance: 'EXTERNAL_TOOL' as const,
          filePath: f.filePath,
          line: f.line,
          title: f.title,
          detail: f.detail,
          evidence: f.evidence,
          fingerprint: f.fingerprint,
          externalRef: f.externalRef,
          disposition: null,
        })),
        prior
      )
      // ONE transaction: the scan-row update (which takes the row lock),
      // this push's deletes, the inserts and the CLEAN→FINDINGS flip. Both
      // completion paths dispatch the same job milliseconds apart, so a
      // second ingest is very likely running right now — it blocks on that
      // row lock instead of interleaving its delete with our insert.
      //
      // Every run in the document prefixed its rows with its own tool slug
      // (`ext:<slug>:<ruleId>`) — the replace must delete each run's prior
      // rows, or rows from runs other than the first accumulate across
      // pushes. The key comes from the parsed runs (`normalized.tools`), not
      // from which rows survived the diff filter, so a run whose only result
      // was dropped still gets its stale prior rows cleared.
      const { written, flippedToFindings } =
        await prSecurityScanRepository.ingestExternalFindings(
          scan.id,
          normalized.tools,
          rows,
          { partial: normalized.truncated }
        )
      await projectRepository.markSarifIngested(
        pr.workspaceId,
        pr.repo,
        new Date()
      )
      await safeDelete(job.url)
      logger.info(
        `[security-sarif-ingest] ${logSafe(job.repository)}#${job.prNumber} ${normalized.tool}: ${written} findings auth=${job.workspaceId ? 'key' : 'oidc'}${flippedToFindings ? ' (scan flipped CLEAN→FINDINGS)' : ''} (dropped notInDiff=${normalized.dropped.notInDiff} noLocation=${normalized.dropped.noLocation} dup=${normalized.dropped.duplicate})`
      )
      return {
        outcome: 'INGESTED',
        scanId: scan.id,
        findings: written,
        partial: normalized.truncated,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.error(
        `[security-sarif-ingest] write stage failed scan=${scan.id}: ${reason.slice(0, 200)}`
      )
      await safeMarkExternalFailed(scan.id)
      // Blob kept for 24h (pruneStaleBlobs) so the report is still there to
      // inspect, or to re-push by hand. Nothing retries this job on its own.
      return {
        outcome: 'FAILED',
        scanId: scan.id,
        reason: reason.slice(0, 200),
      }
    }
  },

  /**
   * Cron: a blob older than 24h under the prefix is a failed ingest nobody
   * looked at. One bad delete (a blob store hiccup) must not stop the rest
   * of the sweep — each is wrapped independently and counted.
   */
  async pruneStaleBlobs(
    now: Date = new Date()
  ): Promise<{ deleted: number; failed: number }> {
    const blobs = await listSarifBlobs()
    let deleted = 0
    let failed = 0
    for (const b of blobs) {
      if (now.getTime() - b.uploadedAt.getTime() > SARIF_FAILED_BLOB_TTL_MS) {
        if (await safeDelete(b.url)) deleted += 1
        else failed += 1
      }
    }
    return { deleted, failed }
  },
}
