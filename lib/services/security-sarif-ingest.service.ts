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
  workspaceId: string
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

/** gunzip + parse with both caps enforced; throws {status} on any violation. */
function decode(gz: Buffer): unknown {
  if (gz.byteLength > SARIF_MAX_GZ_BYTES)
    throw sized(`gzip size ${gz.byteLength} exceeds cap`)
  let raw: Buffer
  try {
    raw = gunzipSync(gz, { maxOutputLength: SARIF_MAX_RAW_BYTES })
  } catch (error) {
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
    const gz = await fetchPrivateBlob(job.url)
    if (!gz) return { outcome: 'ALREADY_PROCESSED' }

    const pr = await pullRequestRepository.findByRepoAndNumber(
      job.repository,
      job.prNumber
    )
    if (!pr) {
      logger.warn(
        `[security-sarif-ingest] no PR ${job.repository}#${job.prNumber} — discarding ${job.tool} report`
      )
      await deleteBlob(job.url)
      return { outcome: 'DISCARDED', reason: 'pr_not_found' }
    }
    if (pr.workspaceId !== job.workspaceId) {
      logger.warn(
        `[security-sarif-ingest] PR ${job.repository}#${job.prNumber} belongs to another workspace — discarding`
      )
      await deleteBlob(job.url)
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

    let normalized: NormalizeResult
    try {
      const runs = parseSarif(decode(gz))
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
      logger.error(
        `[security-sarif-ingest] FAILED tool=${job.tool} gz=${gz.byteLength}B scan=${scan.id}: ${reason}`
      )
      await prSecurityScanRepository.mergeStages(
        scan.id,
        { external: 'FAILED' },
        {}
      )
      // Blob kept for debugging; pruneStaleBlobs removes it after 24h.
      return {
        outcome: 'FAILED',
        scanId: scan.id,
        reason: reason.slice(0, 500),
      }
    }

    const prior = await prSecurityScanRepository.findDispositionedByPullRequest(
      pr.id
    )
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
    const written = await prSecurityScanRepository.replaceExternalFindings(
      scan.id,
      normalized.tool,
      rows
    )

    // A scan stage A already finalized as CLEAN now has findings: say so.
    const row = await prSecurityScanRepository.findScanRow(scan.id)
    const flip = row?.status === 'CLEAN' && written > 0
    await prSecurityScanRepository.mergeStages(
      scan.id,
      { external: 'RAN' },
      flip
        ? { partial: normalized.truncated, status: 'FINDINGS' }
        : { partial: normalized.truncated }
    )
    await projectRepository.markSarifIngested(
      pr.workspaceId,
      pr.repo,
      new Date()
    )
    await deleteBlob(job.url)
    logger.info(
      `[security-sarif-ingest] ${job.repository}#${job.prNumber} ${normalized.tool}: ${written} findings (dropped notInDiff=${normalized.dropped.notInDiff} noLocation=${normalized.dropped.noLocation} dup=${normalized.dropped.duplicate})`
    )
    return {
      outcome: 'INGESTED',
      scanId: scan.id,
      findings: written,
      partial: normalized.truncated,
    }
  },

  /** Cron: a blob older than 24h under the prefix is a failed ingest nobody looked at. */
  async pruneStaleBlobs(now: Date = new Date()): Promise<{ deleted: number }> {
    const blobs = await listSarifBlobs()
    let deleted = 0
    for (const b of blobs) {
      if (now.getTime() - b.uploadedAt.getTime() > SARIF_FAILED_BLOB_TTL_MS) {
        await deleteBlob(b.url)
        deleted += 1
      }
    }
    return { deleted }
  },
}
