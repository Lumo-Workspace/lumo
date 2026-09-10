/**
 * LUM-735 — SARIF ingest, split per stage so each can run as a durable
 * Vercel Workflow step (lib/workflows/security-sarif-ingest.ts):
 *
 *   resolveScan        PR lookup → shared scan row (PENDING, SARIF_PUSH)
 *   fetchAndNormalize  private blob → size gate → gunzip → parse → diff-aware,
 *                      redacted findings (the SARIF text never leaves here)
 *   persistFindings    replace this tool's EXTERNAL_TOOL rows, stages.external=RAN
 *   markExternalFailed stages.external=FAILED (P9: never a fake CLEAN)
 *   deleteBlobSafely   best-effort blob delete
 *
 * Contract with the workflow: a *deterministic* failure (bad gzip, not SARIF
 * 2.1.0, over the caps) is returned as a value so the step is not retried; a
 * *transient* one (blob store, GitHub, database) is thrown so it is.
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
  type RawSarifFinding,
} from '@/lib/security-scan'
import {
  inheritDispositions,
  DETECTOR_VERSION,
} from './pr-security-scan.service'
import { dispatchPrSecurityScan } from './pr-security-scan-dispatch'
import { fetchPrivateBlob, deleteBlob } from './security-sarif-blob'

export const SARIF_MAX_GZ_BYTES = 100 * 1024 * 1024
export const SARIF_MAX_RAW_BYTES = 400 * 1024 * 1024

export interface SarifIngestJob {
  url: string
  pathname: string
  /**
   * Present only when the report was pushed with a `security:ingest` ApiKey,
   * whose workspace is the trust boundary. A GitHub Actions OIDC push proves a
   * repository instead, and ownership follows the PullRequest row, so the
   * field is absent and no cross-workspace check applies.
   */
  workspaceId?: string | undefined
  repository: string
  headSha: string
  prNumber: number
  tool: string
}

export interface ResolvedPr {
  id: string
  workspaceId: string
  repo: string
  number: number
}

export type ResolveOutcome =
  | { kind: 'discarded'; reason: 'pr_not_found' | 'workspace_mismatch' }
  | { kind: 'ok'; scanId: string; pr: ResolvedPr }

export interface FetchAndNormalizeInput {
  url: string
  tool: string
  scanId: string
  pr: ResolvedPr
}

export type NormalizeOutcome =
  | { kind: 'not_found' }
  | { kind: 'failed'; reason: string }
  | {
      kind: 'ok'
      tool: string
      tools: string[]
      findings: RawSarifFinding[]
      truncated: boolean
      dropped: NormalizeResult['dropped']
    }

export interface PersistInput {
  scanId: string
  pr: ResolvedPr
  repository: string
  prNumber: number
  auth: 'key' | 'oidc'
  tool: string
  tools: string[]
  findings: RawSarifFinding[]
  truncated: boolean
  dropped: NormalizeResult['dropped']
}

export interface PersistOutcome {
  written: number
  partial: boolean
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
      new Error(`Unsupported SARIF: gunzip failed (${message(error)})`),
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

/** A deterministic decode/parse/size failure carries a 4xx status; anything else is transient. */
function isDeterministic(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return status === 413 || status === 422
}

export const securitySarifIngestService = {
  /**
   * Step 1. Whoever arrives first creates the shared scan row (spec §9). A
   * PENDING row tells stage A to claim it rather than dedupe onto it, and
   * when this push beat every PR webhook the row would otherwise never get
   * stage A at all — so it is dispatched here (best-effort, never throws).
   * DB errors propagate: the step retries, `createIfAbsent` is idempotent.
   */
  async resolveScan(job: SarifIngestJob): Promise<ResolveOutcome> {
    const pr = await pullRequestRepository.findByRepoAndNumber(
      job.repository,
      job.prNumber
    )
    if (!pr) {
      logger.warn(
        `[security-sarif-ingest] no PR ${logSafe(job.repository)}#${job.prNumber} — discarding ${logSafe(job.tool)} report`
      )
      await securitySarifIngestService.deleteBlobSafely(job.url)
      return { kind: 'discarded', reason: 'pr_not_found' }
    }
    if (job.workspaceId !== undefined && pr.workspaceId !== job.workspaceId) {
      logger.warn(
        `[security-sarif-ingest] PR ${logSafe(job.repository)}#${job.prNumber} belongs to another workspace — discarding`
      )
      await securitySarifIngestService.deleteBlobSafely(job.url)
      return { kind: 'discarded', reason: 'workspace_mismatch' }
    }
    const scan = await prSecurityScanRepository.createIfAbsent({
      pullRequestId: pr.id,
      taskId: pr.taskId ?? null,
      workspaceId: pr.workspaceId,
      headSha: job.headSha,
      trigger: 'SARIF_PUSH',
      detectorVersion: DETECTOR_VERSION,
      status: 'PENDING',
    })
    if (scan.created) await dispatchPrSecurityScan(pr.id, 'SARIF_PUSH')
    return {
      kind: 'ok',
      scanId: scan.id,
      pr: {
        id: pr.id,
        workspaceId: pr.workspaceId,
        repo: pr.repo,
        number: pr.number,
      },
    }
  },

  /**
   * Step 2. The SARIF document only ever exists in this function's memory;
   * what it returns is the redacted, diff-aware finding list (P8). A blob
   * that is already gone means another run of the same report finished
   * first (`not_found`).
   */
  async fetchAndNormalize(
    input: FetchAndNormalizeInput
  ): Promise<NormalizeOutcome> {
    let gz: Buffer | null
    try {
      gz = await fetchPrivateBlob(input.url, SARIF_MAX_GZ_BYTES)
    } catch (error) {
      if (!isDeterministic(error)) throw error
      return securitySarifIngestService._failed(input, message(error), 'n/a')
    }
    if (!gz) return { kind: 'not_found' }
    let runs: ReturnType<typeof parseSarif>
    try {
      runs = parseSarif(decode(gz))
    } catch (error) {
      if (!isDeterministic(error)) throw error
      return securitySarifIngestService._failed(
        input,
        message(error),
        `${gz.byteLength}B`
      )
    }
    // Anything below is I/O (GitHub) or pure computation over an already
    // well-formed document — never a SARIF-shape failure, so nothing here is
    // caught: a GitHub error propagates with ITS OWN status (e.g. 404/422)
    // and must not be mistaken for a deterministic SARIF failure (P-retry).
    const diff = await fetchPrDiff({
      workspaceId: input.pr.workspaceId,
      fullName: input.pr.repo,
      prNumber: input.pr.number,
    })
    const n = normalizeSarif(runs, {
      toolHint: input.tool,
      changedLines: changedLinesOf(addedLinesWithNumbers(diff)),
    })
    return {
      kind: 'ok',
      tool: n.tool,
      tools: n.tools,
      findings: n.findings,
      truncated: n.truncated,
      dropped: n.dropped,
    }
  },

  /** Logs and shapes a deterministic failure (exported on the object only so tests can spy on it; not a public API). */
  _failed(
    input: FetchAndNormalizeInput,
    reason: string,
    gzSize: string
  ): NormalizeOutcome {
    logger.error(
      `[security-sarif-ingest] FAILED tool=${logSafe(input.tool)} gz=${gzSize} scan=${input.scanId}: ${reason.slice(0, 200)}`
    )
    return { kind: 'failed', reason: reason.slice(0, 500) }
  },

  /**
   * Step 3. ONE transaction inside the repository: the scan-row update takes
   * the row lock, then this push's deletes, the inserts and the
   * CLEAN→FINDINGS flip — a concurrent run of the same report queues on that
   * lock instead of interleaving. Errors propagate so the step retries; the
   * replace is idempotent.
   */
  async persistFindings(input: PersistInput): Promise<PersistOutcome> {
    const prior = await prSecurityScanRepository.findDispositionedByPullRequest(
      input.pr.id
    )
    const rows: NewFindingInput[] = inheritDispositions(
      input.findings.map(f => ({
        scanId: input.scanId,
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
    const { written, flippedToFindings } =
      await prSecurityScanRepository.ingestExternalFindings(
        input.scanId,
        input.tools,
        rows,
        { partial: input.truncated }
      )
    await projectRepository.markSarifIngested(
      input.pr.workspaceId,
      input.pr.repo,
      new Date()
    )
    logger.info(
      `[security-sarif-ingest] ${logSafe(input.repository)}#${input.prNumber} ${logSafe(input.tool)}: ${written} findings auth=${input.auth}${flippedToFindings ? ' (scan flipped CLEAN→FINDINGS)' : ''} (dropped notInDiff=${input.dropped.notInDiff} noLocation=${input.dropped.noLocation} dup=${input.dropped.duplicate})`
    )
    return { written, partial: input.truncated }
  },

  /** Never throws: a second failure while recording the first must not crash the run. */
  async markExternalFailed(scanId: string): Promise<void> {
    try {
      await prSecurityScanRepository.mergeStages(
        scanId,
        { external: 'FAILED' },
        {}
      )
    } catch (error) {
      logger.warn(
        `[security-sarif-ingest] mergeStages(external=FAILED) also failed scan=${scanId}: ${message(error).slice(0, 200)}`
      )
    }
  },

  /** Never throws: a blob-store hiccup on delete must not change an outcome already decided. */
  async deleteBlobSafely(url: string): Promise<boolean> {
    try {
      await deleteBlob(url)
      return true
    } catch (error) {
      logger.warn(
        `[security-sarif-ingest] blob delete failed: ${message(error).slice(0, 200)}`
      )
      return false
    }
  },
}
