/**
 * LUM-732 — PR security scan orchestration.
 *
 * run():  resolve PR → current head sha → dedup on (pr, sha) → fetch diff →
 *         deterministic secret scan → LLM judge (dynamic import, fail-soft) →
 *         inherit dispositions by fingerprint → persist → finalize.
 * Runs inside the /api/internal/pr-security-scan worker (300s), never inline.
 *
 * Secrets never reach a row: scanSecrets redacts before returning, and every
 * free-text field the LLM judge authors goes through redactKnownSecrets.
 */
import { logger } from '@/lib/logger'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  prSecurityScanRepository,
  type NewFindingInput,
  type ScanTrigger,
  type FindingDisposition,
  type FindingKind,
  type FindingProvenance,
  type FindingSeverity,
  type FindingRow,
  type ScanStatus,
  type JudgeStatus,
  type ScanWithFindings,
} from '@/lib/repositories/pr-security-scan.repository'
import { fetchPrDiff, fetchPrHeadSha } from '@/lib/integrations/github/contents'
import {
  addedLinesWithNumbers,
  scanSecrets,
  truncateSecurityDiff,
  redactKnownSecrets,
  vulnerabilityFingerprint,
  INCOMPLETE_STAGE_STATES,
  stagesOf,
  type ScanStages,
} from '@/lib/security-scan'
import { projectRepository } from '@/lib/repositories/project.repository'
import { isBlockingFinding, latestScanPerPr } from './pr-security-scan-gate'
import { isManagedScanEnabled } from './security-managed-scan.config'
import { startSecurityManagedScan } from './security-managed-scan-start'
// No LLM/gateway import inside — safe to import statically from stage A.
import { securityPrReviewService } from './security-pr-review.service'
import { waitUntil } from '@vercel/functions'

export const DETECTOR_VERSION = 'secrets@1;sarif@1;judge@1'

/**
 * LUM-735 — how long stages.external may sit PENDING (the repo has pushed
 * SARIF before, just not for this sha yet) before the panel should read it
 * as CI having gone quiet rather than "still running". Purely a view-layer
 * hint (`SecurityScanView.externalLate`) — it never changes the persisted
 * stage itself.
 */
export const EXTERNAL_PENDING_LATE_MS = 30 * 60 * 1000

/**
 * How long a scan may sit in RUNNING/PENDING before the next trigger treats it
 * as dead and re-runs it in place (review I6). The worker itself is capped at
 * 300s, so anything past 10 minutes is a row whose process is gone — a deploy,
 * an OOM, a hard timeout. Without this every later trigger on the same head
 * sha deduped onto the corpse: a permanently "Scanning" badge and a DONE gate
 * that never learns anything. Longer than the worker cap on purpose, so a slow
 * but live scan is never restarted underneath itself.
 */
export const STALE_RUNNING_MS = 10 * 60 * 1000

// ── View types (shared by route, hook and components) ────────────────────────

export interface SecurityFindingView {
  id: string
  kind: FindingKind
  ruleId: string
  severity: FindingSeverity
  provenance: FindingProvenance
  filePath: string
  line: number | null
  title: string
  detail: string
  evidence: string
  fingerprint: string
  /** The rule's `helpUri` from the pushed SARIF; null for Lumo's own layers. */
  externalRef: string | null
  disposition: FindingDisposition | null
  dispositionNote: string | null
  inherited: boolean
  blocking: boolean
}

export interface SecurityScanView {
  id: string
  status: ScanStatus
  headSha: string
  trigger: ScanTrigger
  judgeStatus: JudgeStatus | null
  truncated: boolean
  /** LUM-735 — per-layer outcome; legacy rows are derived from judgeStatus. */
  stages: ScanStages
  partial: boolean
  /**
   * False when the scan FAILED, any layer is FAILED / NOT_CONFIGURED /
   * PARTIAL, or `partial` is set: never render as a full pass. A FAILED scan
   * can carry `stages: {}` (it crashed before any layer ran), and
   * `isCompleteScan({})` is true by contract for legacy rows, so status is
   * checked separately.
   */
  complete: boolean
  /** stages.external is PENDING and the scan started more than 30 min ago — the scanner has not reported. */
  externalLate: boolean
  error: string | null
  startedAt: string
  finishedAt: string | null
  findings: SecurityFindingView[]
}

export interface TaskSecurityScans {
  prs: {
    pr: {
      id: string
      number: number
      title: string
      url: string
      state: string
    }
    latest: SecurityScanView | null
  }[]
  blocking: { count: number }
}

export type RunScanResult =
  | { skipped: true; reason: 'pr_not_found' }
  | { deduped: true; scanId: string }
  | {
      deduped: false
      scanId: string
      status: 'CLEAN' | 'FINDINGS' | 'FAILED'
      findings: number
    }

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
}
const PROVENANCE_RANK: Record<FindingProvenance, number> = {
  DETERMINISTIC: 0,
  EXTERNAL_TOOL: 1,
  LLM_JUDGE: 2,
}

/** True when a Prisma write failed on a unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  )
}

/**
 * LUM-735 (review) — `stagesOf` is now the pure `lib/security-scan/stages.ts`
 * implementation, re-exported here for existing importers of this module
 * (this file stays behind the LLM-gateway dynamic-import boundary; the pure
 * version is what `pr-security-reminder.service.ts` imports statically).
 */
export { stagesOf }

/** Spec P9: a scan with any incomplete layer must not read as a full pass. */
export function isCompleteScan(stages: ScanStages): boolean {
  return !Object.values(stages).some(s => s && INCOMPLETE_STAGE_STATES.has(s))
}

function sortFindings<
  T extends { severity: FindingSeverity; provenance: FindingProvenance },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance]
  )
}

function toFindingView(f: FindingRow): SecurityFindingView {
  return {
    id: f.id,
    kind: f.kind,
    ruleId: f.ruleId,
    severity: f.severity,
    provenance: f.provenance,
    filePath: f.filePath,
    line: f.line,
    title: f.title,
    detail: f.detail,
    evidence: f.evidence,
    fingerprint: f.fingerprint,
    externalRef: f.externalRef,
    disposition: f.disposition,
    dispositionNote: f.dispositionNote,
    inherited: f.inheritedFromFindingId !== null,
    blocking: isBlockingFinding(f),
  }
}

function toScanView(s: ScanWithFindings): SecurityScanView {
  const stages = stagesOf(s)
  return {
    id: s.id,
    status: s.status,
    headSha: s.headSha,
    trigger: s.trigger,
    judgeStatus: s.judgeStatus,
    truncated: s.truncated,
    stages,
    partial: s.partial,
    complete: s.status !== 'FAILED' && !s.partial && isCompleteScan(stages),
    externalLate:
      stages.external === 'PENDING' &&
      Date.now() - s.startedAt.getTime() > EXTERNAL_PENDING_LATE_MS,
    error: s.error,
    startedAt: s.startedAt.toISOString(),
    finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
    findings: sortFindings(s.findings).map(toFindingView),
  }
}

/**
 * True when an existing row for this (pr, sha) should be re-run in place: it
 * FAILED, or it is still RUNNING/PENDING past `STALE_RUNNING_MS` — a worker
 * that died without finalizing. Anything else is a live or finished scan and
 * the caller dedups onto it.
 */
function isRerunnable(existing: {
  status: ScanStatus
  startedAt: Date
}): boolean {
  if (existing.status === 'FAILED') return true
  if (existing.status !== 'RUNNING' && existing.status !== 'PENDING')
    return false
  return Date.now() - existing.startedAt.getTime() > STALE_RUNNING_MS
}

/**
 * The three-way rule for a row this run() did not just create — whether
 * found by `findByPrAndSha` up front, or re-read as the winner of a P2002
 * race after a concurrent `create()` lost (LUM-735 review): a PENDING row is
 * always the SARIF ingest's and must be claimed, never restarted or deduped
 * onto; a FAILED/stale-RUNNING row is re-run in place; anything else is a
 * live or finished scan to dedup onto.
 */
async function adoptExisting(existing: {
  id: string
  status: ScanStatus
  startedAt: Date
}): Promise<{ scanId: string } | { deduped: true; scanId: string }> {
  if (existing.status === 'PENDING') {
    // Created by a CI SARIF push before any webhook ran (LUM-735): stage A
    // claims it in place. Its EXTERNAL_TOOL rows are the push's, kept.
    await prSecurityScanRepository.claimPending(existing.id)
    return { scanId: existing.id }
  }
  if (isRerunnable(existing)) {
    await prSecurityScanRepository.restart(existing.id)
    return { scanId: existing.id }
  }
  return { deduped: true, scanId: existing.id }
}

// LUM-739: `inheritDispositions` lives in a pure module now (shared with the
// hunt workflow's persistence); re-exported so existing importers keep working.
import { inheritDispositions } from '@/lib/security-scan/inherit-dispositions'
export { inheritDispositions }

// ── Service ──────────────────────────────────────────────────────────────────

export const prSecurityScanService = {
  async run(input: {
    pullRequestId: string
    trigger: ScanTrigger
  }): Promise<RunScanResult> {
    const pr = await pullRequestRepository.findById(input.pullRequestId)
    if (!pr) return { skipped: true, reason: 'pr_not_found' }

    const headSha = await fetchPrHeadSha({
      workspaceId: pr.workspaceId,
      fullName: pr.repo,
      prNumber: pr.number,
    })

    const existing = await prSecurityScanRepository.findByPrAndSha(
      pr.id,
      headSha
    )
    let scanId: string
    if (existing) {
      const adopted = await adoptExisting(existing)
      if ('deduped' in adopted) return adopted
      scanId = adopted.scanId
    } else {
      try {
        const created = await prSecurityScanRepository.create({
          pullRequestId: pr.id,
          taskId: pr.taskId,
          workspaceId: pr.workspaceId,
          headSha,
          trigger: input.trigger,
          detectorVersion: DETECTOR_VERSION,
        })
        scanId = created.id
      } catch (error) {
        // Concurrent triggers (webhook + manual link) can both see null from
        // findByPrAndSha above and both call create(); the loser hits the
        // unique constraint on (pullRequestId, headSha). The winner's row is
        // already there, but it may itself be a PENDING row the SARIF ingest
        // created (LUM-735 review) — so it goes through the same
        // claim/restart/dedupe rule as the `existing` branch above, not a
        // blind dedup.
        if (!isUniqueViolation(error)) throw error
        const winner = await prSecurityScanRepository.findByPrAndSha(
          pr.id,
          headSha
        )
        if (!winner) throw error
        const adopted = await adoptExisting(winner)
        if ('deduped' in adopted) return adopted
        scanId = adopted.scanId
      }
    }

    // Collected across layers so the FAILED path can still say which layers
    // ran before the crash (spec P9: a failed layer is a fact, not a blank).
    const stages: ScanStages = {}
    let partial = false

    try {
      const diff = await fetchPrDiff({
        workspaceId: pr.workspaceId,
        fullName: pr.repo,
        prNumber: pr.number,
      })
      const files = addedLinesWithNumbers(diff)

      // ── A1: deterministic secret scan (pure) ────────────────────────────
      const secretHits = scanSecrets(files)
      stages.secrets = 'RAN'

      const secretRows: NewFindingInput[] = secretHits.map(f => ({
        scanId,
        kind: f.kind,
        ruleId: f.ruleId,
        severity: f.severity,
        provenance: 'DETERMINISTIC',
        filePath: f.filePath,
        line: f.line,
        title: f.title,
        detail: f.detail,
        evidence: f.evidence,
        fingerprint: f.fingerprint,
        externalRef: null,
        disposition: null,
      }))

      // ── A2: external oracle — SARIF pushed by the repo's own CI, or the
      // Lumo-managed scan (LUM-735) ────────────────────────────────────────
      // Three-way rule: if EXTERNAL_TOOL rows already landed for this scan
      // (the ingest worker wrote them, from either source), that's RAN and
      // stage A starts nothing. Otherwise, when the managed scan is enabled
      // (LUMO_MANAGED_SCAN !== 'off'), stage A starts it itself for this head
      // sha — PENDING on success, FAILED if start() couldn't even queue it.
      // With the managed scan off, fall back to the pre-v0.3 read-only guess:
      // PENDING if this repo has ever pushed SARIF before (CI is presumably
      // still running for this sha), else NOT_CONFIGURED.
      let externalCount = 0
      // LUM-735 Task 2: did THIS stage A queue the managed run? If it did, the
      // run's own `sync` will post the summary a minute from now with the
      // external findings on it — posting one here as well would put a second,
      // already-stale summary on the PR (the marker upsert only dedupes across
      // syncs, not against a sync that has not happened yet).
      let managedRunStarted = false
      try {
        externalCount =
          await prSecurityScanRepository.countExternalFindings(scanId)
        if (externalCount > 0) {
          stages.external = 'RAN'
        } else if (isManagedScanEnabled()) {
          // v0.3: Lumo scans the head sha itself (spec §6 L1). The run
          // persists findings and flips external to RAN/FAILED; until then
          // the panel shows "scanning", never CLEAN (§14 Q1).
          const runId = await startSecurityManagedScan({
            scanId,
            pr: {
              id: pr.id,
              workspaceId: pr.workspaceId,
              repo: pr.repo,
              number: pr.number,
            },
            headSha,
          })
          stages.external = runId ? 'PENDING' : 'FAILED'
          managedRunStarted = Boolean(runId)
        } else {
          const last = await projectRepository.findLastSarifIngestAt(
            pr.workspaceId,
            pr.repo
          )
          stages.external = last ? 'PENDING' : 'NOT_CONFIGURED'
        }
      } catch (error) {
        stages.external = 'FAILED'
        // Nothing is going to sync on our behalf after a failure here.
        managedRunStarted = false
        logger.warn(
          `[pr-security-scan] external stage lookup failed pr=${pr.id}:`,
          error instanceof Error ? error.message : error
        )
      }

      // ── A4: LLM judge (advisory, fail-soft) ─────────────────────────────
      let judgeStatus: JudgeStatus = 'SKIPPED'
      let truncated = false
      const judgeRows: NewFindingInput[] = []
      if (files.length > 0) {
        const capped = truncateSecurityDiff(diff)
        truncated = capped.truncated
        if (truncated) partial = true
        try {
          // Dynamic import keeps @ai-sdk/gateway out of the static graph.
          const { judgeSecurity } =
            await import('@/lib/llm/security-judge-client')
          const { findings } = await judgeSecurity({ diff: capped.text })
          judgeStatus = 'RAN'
          for (const j of findings) {
            const isCredential = j.kind === 'hardcoded_credential'
            const ruleId = isCredential
              ? 'secret:llm-hardcoded-credential'
              : `vuln:${j.kind}`
            // EVERY free-text field the judge authored is redacted, not just
            // `evidence` (LUM-732 review C1). The model echoes the offending
            // line wherever it likes — a title quoting the key, a detail
            // spelling it out, a hallucinated path with a token in it — so
            // redacting one field left the raw secret in the other three.
            // `redactKnownSecrets` runs every pattern over the text and ends
            // with `maskQuotedValues`, so it is the whole two-layer pass on
            // its own. The fingerprint is taken over the REDACTED path/title
            // so it stays reproducible from the persisted row.
            const filePath = redactKnownSecrets(j.filePath)
            const title = redactKnownSecrets(j.title)
            judgeRows.push({
              scanId,
              kind: isCredential ? 'SECRET' : 'VULNERABILITY',
              ruleId,
              severity: j.severity,
              provenance: 'LLM_JUDGE',
              filePath,
              line: j.line,
              title,
              detail: redactKnownSecrets(j.detail),
              evidence: redactKnownSecrets(j.evidence),
              fingerprint: vulnerabilityFingerprint(ruleId, filePath, title),
              externalRef: null,
              disposition: null,
            })
          }
        } catch (error) {
          // FAIL-SOFT for the judge only: the deterministic result still lands,
          // and UNAVAILABLE is stamped so the panel never reads as a full pass.
          judgeStatus = 'UNAVAILABLE'
          logger.warn(
            `[pr-security-scan] judge unavailable pr=${pr.id} sha=${headSha}:`,
            error instanceof Error ? error.message : error
          )
        }
      }
      // judgeStatus stays the 732 column; stages.judge is the same fact in
      // the per-layer vocabulary so the panel has ONE rule for "complete".
      stages.judge =
        judgeStatus === 'RAN'
          ? 'RAN'
          : judgeStatus === 'UNAVAILABLE'
            ? 'FAILED'
            : 'SKIPPED'

      const prior =
        await prSecurityScanRepository.findDispositionedByPullRequest(pr.id)
      const rows = inheritDispositions([...secretRows, ...judgeRows], prior)

      // `status` stays "are there findings" (732 semantics — FAILED still
      // means the worker itself broke and is re-run in place). Whether the
      // scan may be READ as a full pass is `stages` → view.complete. Rows
      // written by the SARIF ingest worker (EXTERNAL_TOOL) are counted via
      // `externalCount`, not `rows` — stage A never re-reads or re-persists
      // them.
      const status: 'CLEAN' | 'FINDINGS' =
        rows.length + externalCount > 0 ? 'FINDINGS' : 'CLEAN'
      // Spec §6.1: findings and the status describing them are ONE write, so a
      // crash between them can never leave a FINDINGS scan with no rows (or
      // rows nobody can see under a scan still RUNNING).
      await prSecurityScanRepository.persistResult(scanId, rows, {
        status,
        judgeStatus,
        truncated,
        stages,
        partial,
      })
      // LUM-735 Task 2: the findings are on the row — put them on the PR.
      // Best-effort like the dispatchers: `sync` never throws, and the
      // markers make a repeat (from a workflow) comment-free.
      // Skipped when this run queued the managed scan: that workflow syncs
      // once it has persisted, and one summary per scan is the contract —
      // unless stage A itself found something that blocks DONE, which must
      // reach the PR even if the managed run never executes.
      const blocksDone = rows.some(r =>
        isBlockingFinding({
          provenance: r.provenance,
          severity: r.severity,
          disposition: r.disposition ?? null,
        })
      )
      if (!managedRunStarted || blocksDone) {
        waitUntil(securityPrReviewService.sync(scanId))
      }
      return { deduped: false, scanId, status, findings: rows.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        `[pr-security-scan] scan failed pr=${pr.id} sha=${headSha}: ${message}`
      )
      await prSecurityScanRepository.finalize(scanId, {
        status: 'FAILED',
        judgeStatus: null,
        truncated: false,
        stages,
        partial,
        error: message.slice(0, 500),
      })
      // A FAILED stage A still has something to say on the PR (P9).
      waitUntil(securityPrReviewService.sync(scanId))
      return { deduped: false, scanId, status: 'FAILED', findings: 0 }
    }
  },

  async getForTask(taskId: string): Promise<TaskSecurityScans> {
    const prs = await pullRequestRepository.findManyForSecurityByTaskId(taskId)
    const scans = await prSecurityScanRepository.findLatestByPullRequestIds(
      prs.map(p => p.id)
    )
    const latest = latestScanPerPr(scans)
    let count = 0
    const out = prs.map(pr => {
      const scan = latest.get(pr.id)
      const view = scan ? toScanView(scan) : null
      if (view) count += view.findings.filter(f => f.blocking).length
      return { pr, latest: view }
    })
    return { prs: out, blocking: { count } }
  },

  async disposition(
    taskId: string,
    findingId: string,
    disposition: FindingDisposition,
    note: string | null,
    actorMemberId: string
  ): Promise<SecurityFindingView> {
    const finding =
      await prSecurityScanRepository.findFindingWithScope(findingId)
    if (!finding || finding.scan.pullRequest.taskId !== taskId) {
      throw Object.assign(
        new Error('Security finding not found on this task'),
        { status: 404 }
      )
    }
    const updated = await prSecurityScanRepository.updateDisposition(
      findingId,
      {
        disposition,
        dispositionNote: note,
        dispositionedById: actorMemberId,
        dispositionedAt: new Date(),
      }
    )
    return toFindingView(updated)
  },
}
