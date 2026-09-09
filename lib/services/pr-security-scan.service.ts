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
  mapCodeScanningAlerts,
  enhanceSecretFindings,
  INCOMPLETE_STAGE_STATES,
  type ScanStages,
} from '@/lib/security-scan'
import {
  fetchCodeScanningAlerts,
  fetchActiveSecretScanningAlerts,
} from '@/lib/integrations/github/code-scanning'
import { isBlockingFinding, latestScanPerPr } from './pr-security-scan-gate'

export const DETECTOR_VERSION = 'secrets@1;external@1;judge@1'

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
  /** Alert URL on GitHub (EXTERNAL_TOOL, or an A1 hit confirmed by secret scanning). */
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
   * False when any layer is FAILED / NOT_CONFIGURED / PARTIAL, or the scan
   * itself is FAILED: never render as a full pass. A FAILED scan can carry
   * `stages: {}` (it crashed before any layer ran), and `isCompleteScan({})`
   * is true by contract for legacy rows, so status is checked separately.
   */
  complete: boolean
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
 * LUM-735 — stages for a scan row. Rows written before the column existed
 * carry null; for them the only per-layer fact on record is judgeStatus, so
 * the legacy view is derived from it (UNAVAILABLE → FAILED, SKIPPED → SKIPPED)
 * and no `external` key is claimed — those scans never consulted GitHub.
 */
export function stagesOf(scan: {
  stages: ScanStages | null
  judgeStatus: JudgeStatus | null
}): ScanStages {
  if (scan.stages) return scan.stages
  const legacy: ScanStages = { secrets: 'RAN' }
  if (scan.judgeStatus === 'RAN') legacy.judge = 'RAN'
  else if (scan.judgeStatus === 'UNAVAILABLE') legacy.judge = 'FAILED'
  else if (scan.judgeStatus === 'SKIPPED') legacy.judge = 'SKIPPED'
  return legacy
}

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
    complete: s.status !== 'FAILED' && isCompleteScan(stages),
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

/** Copy a prior human disposition onto a new finding with the same fingerprint. */
function inheritDispositions(
  fresh: NewFindingInput[],
  prior: Awaited<
    ReturnType<typeof prSecurityScanRepository.findDispositionedByPullRequest>
  >
): NewFindingInput[] {
  const byFp = new Map<string, (typeof prior)[number]>()
  for (const p of prior)
    if (!byFp.has(p.fingerprint)) byFp.set(p.fingerprint, p)
  return fresh.map(f => {
    const p = byFp.get(f.fingerprint)
    if (!p) return f
    return {
      ...f,
      disposition: p.disposition,
      dispositionNote: p.dispositionNote,
      dispositionedById: p.dispositionedById,
      dispositionedAt: p.dispositionedAt,
      inheritedFromFindingId: p.id,
    }
  })
}

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
      if (!isRerunnable(existing)) return { deduped: true, scanId: existing.id }
      await prSecurityScanRepository.restart(existing.id)
      scanId = existing.id
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
        // unique constraint on (pullRequestId, headSha). That is a dedup, not
        // a failure — the winner's row is already there.
        if (!isUniqueViolation(error)) throw error
        const winner = await prSecurityScanRepository.findByPrAndSha(
          pr.id,
          headSha
        )
        if (!winner) throw error
        return { deduped: true, scanId: winner.id }
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
      const changedFiles = new Set(files.map(f => f.path))

      // ── A1: deterministic secret scan (pure) ────────────────────────────
      let secretHits = enhanceSecretFindings(scanSecrets(files), [])
      stages.secrets = 'RAN'

      // ── A1+: GitHub secret-scanning "active" alerts upgrade A1 hits ─────
      // Opportunistic: a missing or failed lookup leaves A1's own verdict
      // standing at its own severity — nothing is hidden, only not upgraded —
      // so it does not fail a stage. Only consulted when there is a hit to
      // upgrade, to keep the per-scan GitHub call count bounded.
      if (secretHits.length > 0) {
        try {
          const sec = await fetchActiveSecretScanningAlerts({
            workspaceId: pr.workspaceId,
            fullName: pr.repo,
          })
          if (sec.configured) {
            secretHits = enhanceSecretFindings(secretHits, sec.alerts)
            // A live key beyond the location cap may have been missed by the
            // upgrade — the scan must say so, not read as a full pass.
            if (sec.truncated) partial = true
          }
        } catch (error) {
          logger.warn(
            `[pr-security-scan] secret-scanning lookup failed pr=${pr.id}:`,
            error instanceof Error ? error.message : error
          )
        }
      }

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
        externalRef: f.externalRef,
        disposition: null,
      }))

      // ── A2: external oracle — GitHub code-scanning alerts for this PR ───
      // Only consulted when the diff actually added lines: an empty diff has
      // no changed-file set to filter alerts against, matching the judge's
      // own files.length gate below (spec P9's "layer ran" fact stays SKIPPED,
      // not a wasted GitHub call for a scan with nothing to check).
      const externalRows: NewFindingInput[] = []
      if (files.length === 0) {
        stages.external = 'SKIPPED'
      } else {
        try {
          const ext = await fetchCodeScanningAlerts({
            workspaceId: pr.workspaceId,
            fullName: pr.repo,
            prNumber: pr.number,
          })
          if (!ext.configured) {
            stages.external = 'NOT_CONFIGURED'
          } else {
            for (const f of mapCodeScanningAlerts(ext.alerts, changedFiles)) {
              externalRows.push({
                scanId,
                kind: f.kind,
                ruleId: f.ruleId,
                severity: f.severity,
                provenance: 'EXTERNAL_TOOL',
                filePath: f.filePath,
                line: f.line,
                title: f.title,
                detail: f.detail,
                evidence: f.evidence,
                fingerprint: f.fingerprint,
                externalRef: f.externalRef,
                disposition: null,
              })
            }
            stages.external = ext.truncated ? 'PARTIAL' : 'RAN'
            if (ext.truncated) partial = true
          }
        } catch (error) {
          // A failed oracle is a FAILED layer, never a silent CLEAN (spec P9).
          stages.external = 'FAILED'
          logger.warn(
            `[pr-security-scan] code-scanning lookup failed pr=${pr.id} sha=${headSha}:`,
            error instanceof Error ? error.message : error
          )
        }
      }

      // ── A4: LLM judge (advisory, fail-soft) ─────────────────────────────
      let judgeStatus: JudgeStatus = 'SKIPPED'
      let truncated = false
      const judgeRows: NewFindingInput[] = []
      if (files.length > 0) {
        const capped = truncateSecurityDiff(diff)
        truncated = capped.truncated
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
      const rows = inheritDispositions(
        [...secretRows, ...externalRows, ...judgeRows],
        prior
      )

      // `status` stays "are there findings" (732 semantics — FAILED still
      // means the worker itself broke and is re-run in place). Whether the
      // scan may be READ as a full pass is `stages` → view.complete.
      const status: 'CLEAN' | 'FINDINGS' =
        rows.length > 0 ? 'FINDINGS' : 'CLEAN'
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
