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
import { scrubScanIfRepositoryUnconfirmed } from '@/lib/services/scan-code-retention.service'
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
  type FindingReachability,
  type FalsifierVerdict,
  type SuggestionOutcome,
} from '@/lib/repositories/pr-security-scan.repository'
import { suggestionOutcomeFor } from '@/lib/security-scan/suggestion'
import { cleanPrSummary, type PrSummary } from '@/lib/security-scan/pr-summary'
import { fetchPrDiff, fetchPrHeadSha } from '@/lib/integrations/github/contents'
import {
  addedLinesWithNumbers,
  scanSecrets,
  packSecurityDiff,
  judgeDiffTier,
  redactKnownSecrets,
  redactForInjection,
  vulnerabilityFingerprint,
  INCOMPLETE_STAGE_STATES,
  stagesOf,
  evaluateHuntTrigger,
  L4_CROSSING_CATEGORIES,
  type ScanStages,
  type JudgeBudget,
} from '@/lib/security-scan'
import { isGraphSourcePath } from '@/lib/security-scan/graph/imports'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import {
  isBlockingFinding,
  latestScanPerPr,
  loadQueueExitContexts,
  loadSecurityPolicy,
  queueExitOf,
} from './pr-security-scan-gate'
import type { QueueExitReason } from '@/lib/security-scan/queue-exit'
import {
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
} from '@/lib/security-scan/policy'
import { isManagedScanEnabled } from './security-managed-scan.config'
import { startSecurityManagedScan } from './security-managed-scan-start'
import { securityManagedScanOpsService } from './security-managed-scan-ops.service'
import { HUNT_MAX_HUNTED_FILES, type HuntJob } from './security-hunt.config'
import { loadSecurityLayers } from './security-workspace-switches.service'
import {
  recordHuntStartBestEffort,
  startSecurityHunt,
} from './security-hunt-start'
import { securityGraphRulesService } from './security-graph-rules.service'
import { securityBaselineService } from './security-baseline.service'
// No LLM/gateway import inside — safe to import statically from stage A.
import { securityPrReviewService } from './security-pr-review.service'
import { waitUntil } from '@vercel/functions'
import {
  huntBatchProgress,
  planHuntBatches,
  type HuntBatchProgress,
} from '@/lib/security-scan/hunt/batches'
import { JUDGE_DIFF_BUDGET_TIERS } from '@/lib/security-scan/truncate'
import { scanSizeCaps, type ScanSizeCaps } from '@/lib/security-scan/size-caps'
import {
  isOwnedUnfinished,
  scanCoverageState,
  type HuntOverCapInput,
  type JudgeOverCapInput,
  type PartialCause,
  type ScanCoverageState,
} from '@/shared/src/security-scan'

export const DETECTOR_VERSION = 'secrets@1;sarif@1;judge@1;hunt@1;graph@1'

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
  /** LUM-738: already on the default-branch baseline — not introduced by this PR (advisory, muted). */
  persisting: boolean
  /**
   * LUM-775: the PR merged or closed and this undispositioned row has left
   * the queue — derived at read time from PR state × baseline × policy,
   * never stored. Muted with its reason in the panel; `blocking` is false
   * while set. null on an open PR and on every dispositioned / persisting row.
   */
  queueExit: QueueExitReason | null
  // LUM-739 (hunt rows; null elsewhere) — surfaced by the panel (LUM-740).
  cwe: string | null
  reachability: FindingReachability | null
  callChain: Array<{ from: string; to: string }> | null
  falsifierVerdict: FalsifierVerdict | null
  // LUM-740: the falsifier's suggestion and the human's verdict on it.
  suggestedDisposition: FindingDisposition | null
  suggestedReason: string | null
  suggestionOutcome: SuggestionOutcome | null
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
  /**
   * LUM-832 — the one state the customer is told: in progress, checked, or
   * unfinished on our side. `complete` is exactly `coverage === 'CHECKED'`.
   * The cause is never on the view — it is internal (`partialCauses`).
   */
  coverage: ScanCoverageState
  /**
   * LUM-832 — for a hunt run in batches (an oversized diff): source files
   * covered so far of the total. null for an un-batched hunt.
   */
  huntProgress: HuntBatchProgress | null
  /**
   * LUM-832 — the hunt did not run: the diff touched more source files than
   * it runs on (CodeRabbit-style notice). null otherwise.
   */
  huntOverCap: HuntOverCapInput | null
  /**
   * LUM-832 — the AI review did not run: the diff was over its size cap
   * (CodeRabbit-style notice). null otherwise.
   */
  judgeOverCap: JudgeOverCapInput | null
  /**
   * LUM-832 — unfinished for a reason of OURS (a fault, a budget shortfall),
   * which gets the owned line. False when a size cap is the only gap: that
   * is a limit on the change, told by its notice alone.
   */
  ownedUnfinished: boolean
  /** stages.external is PENDING and the scan started more than 30 min ago — the scanner has not reported. */
  externalLate: boolean
  error: string | null
  startedAt: string
  finishedAt: string | null
  /**
   * LUM-911 — the code this scan quoted (evidence, call chains, finding
   * text) was cleared by a retention or access scrub; findings show their
   * rule, file and line only.
   */
  codeScrubbed: boolean
  /**
   * LUM-740: open findings of the PR's previous scan whose fingerprint this
   * scan no longer carries — what the latest push fixed. 0 for a first scan.
   */
  fixed: number
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
  /** LUM-740: open findings the falsifier suggested as false positives, across the task's PRs. */
  suggested: { count: number }
  /**
   * LUM-892 — the workspace turned scanning off: new pushes are not scanned,
   * and the scans shown are from before. Their findings still gate DONE.
   */
  scanningOff: boolean
}

export type RunScanResult =
  | { skipped: true; reason: 'pr_not_found' | 'workspace_scan_disabled' }
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

function toFindingView(
  f: FindingRow,
  policy: SecurityPolicy,
  queueExit: QueueExitReason | null = null
): SecurityFindingView {
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
    blocking: queueExit === null && isBlockingFinding(f, policy),
    persisting: f.persisting,
    queueExit,
    cwe: f.cwe ?? null,
    reachability: f.reachability ?? null,
    callChain: f.callChain ?? null,
    falsifierVerdict: f.falsifierVerdict ?? null,
    suggestedDisposition: f.suggestedDisposition ?? null,
    suggestedReason: f.suggestedReason ?? null,
    suggestionOutcome: f.suggestionOutcome ?? null,
  }
}

/** The view's `complete` rule, shared with the read model's `fixed` gate. */
function isViewComplete(s: ScanWithFindings): boolean {
  return coverageOf(s) === 'CHECKED'
}

/** LUM-832 — the size-cap notices this scan carries. */
function sizeCapsOf(s: ScanWithFindings): ScanSizeCaps {
  return scanSizeCaps({
    stages: stagesOf(s),
    partialCauses: s.partialCauses ?? [],
    huntAudit: s.huntAudit,
    judgeBudget: s.judgeBudget,
  })
}

/** LUM-832 — the shared customer state, over the row's derived stages. */
function coverageOf(s: ScanWithFindings): ScanCoverageState {
  return scanCoverageState({
    status: s.status,
    stages: stagesOf(s),
    partial: s.partial,
  })
}

/** LUM-775: the row's queue exit on its PR, or null while it is still queued. */
type QueueExitOfRow = (row: FindingRow) => QueueExitReason | null

function toScanView(
  s: ScanWithFindings,
  policy: SecurityPolicy,
  fixed: number,
  queueExit: QueueExitOfRow = () => null
): SecurityScanView {
  const stages = stagesOf(s)
  const sizeCaps = sizeCapsOf(s)
  return {
    id: s.id,
    status: s.status,
    headSha: s.headSha,
    trigger: s.trigger,
    judgeStatus: s.judgeStatus,
    truncated: s.truncated,
    stages,
    partial: s.partial,
    complete: isViewComplete(s),
    coverage: coverageOf(s),
    huntProgress: huntBatchProgress(s.huntJob, stages.hunt),
    ...sizeCaps,
    ownedUnfinished: isOwnedUnfinished({
      status: s.status,
      stages,
      partial: s.partial,
      partialCauses: s.partialCauses ?? [],
      hasSizeNotice:
        sizeCaps.huntOverCap !== null || sizeCaps.judgeOverCap !== null,
    }),
    externalLate:
      stages.external === 'PENDING' &&
      Date.now() - s.startedAt.getTime() > EXTERNAL_PENDING_LATE_MS,
    error: s.error,
    startedAt: s.startedAt.toISOString(),
    finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
    codeScrubbed: s.codeScrubbedAt != null,
    fixed,
    findings: sortFindings(s.findings).map(f =>
      toFindingView(f, policy, queueExit(f))
    ),
  }
}

/**
 * LUM-740: previous-scan open fingerprints that this scan no longer carries.
 * Only for a complete scan — while a layer is still pending its rows have
 * not landed, and "3 fixed" would be a claim the next minute retracts.
 */
async function countFixed(scan: ScanWithFindings): Promise<number> {
  if (!isViewComplete(scan)) return 0
  const previous = await prSecurityScanRepository.findPreviousOpenFingerprints(
    scan.pullRequestId,
    scan.startedAt
  )
  if (previous.length === 0) return 0
  const current = new Set(scan.findings.map(f => f.fingerprint))
  return previous.filter(fp => !current.has(fp)).length
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

/**
 * LUM-739 — the L3 trigger's third condition: an OPEN (undispositioned) L4
 * session-guard crossing on the PR's task. Best-effort: a read failure must
 * not fail stage A, it just does not trigger the hunt.
 */
async function hasOpenL4Crossing(taskId: string | null): Promise<boolean> {
  if (!taskId) return false
  try {
    const open =
      await boundaryCrossingRepository.findUndispositionedByTask(taskId)
    return open.some(c =>
      (L4_CROSSING_CATEGORIES as readonly string[]).includes(c.category)
    )
  } catch {
    return false
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export const prSecurityScanService = {
  async run(input: {
    pullRequestId: string
    trigger: ScanTrigger
  }): Promise<RunScanResult> {
    const pr = await pullRequestRepository.findById(input.pullRequestId)
    if (!pr) return { skipped: true, reason: 'pr_not_found' }
    // LUM-866: the workspace's own switches, under the platform ceiling. Scan
    // off = nothing at all for this PR — no row, no layer, no new comment.
    // LUM-892: but a summary an earlier scan left on the PR is rewritten to
    // say scanning is off, so its old "no findings" does not stand.
    const layers = await loadSecurityLayers(pr.workspaceId)
    if (!layers.scan) {
      await securityPrReviewService.markScanningOff(pr)
      return { skipped: true, reason: 'workspace_scan_disabled' }
    }

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
    // LUM-832: each set point below names its cause; the row derives
    // `partial` from them (see `mergePartial` in the repository).
    const partialCauses: PartialCause[] = []

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
        // LUM-758 follow-up: the scanner already decided WHY this is LOW; keep
        // the cause on the row so the reader is not left guessing.
        secretDowngrade: f.downgrade ?? null,
      }))

      // ── A1b: deterministic graph rules (LUM-785, LUM-794) ───────────────
      // Two rules over one read of the diff subgraph (touched TS/TSX files +
      // one hop of imports), decided right here in process — no VM, no model,
      // no falsifier:
      //   `llm-output-to-sink`  — a model-call result reaching a raw-SQL /
      //     shell / eval / fs-write / fetch call with no zod-parse on the path
      //     (HIGH for the code-execution sinks, so it blocks DONE under the
      //     default policy, exactly like a secret).
      //   `agent-loop-unbounded` — a model call inside a loop with no step
      //     ceiling and no exit path at all (always MEDIUM: a cost and
      //     availability defect, advisory under the default policy).
      // Fail-soft: a read that fails makes the scan `partial` with the reason
      // logged, never a FAILED stage A. Hitting the file/read cap is NOT
      // partial — a bounded graph is these rules' design (LUM-762).
      const touchedSourcePaths = files
        .map(f => f.path)
        .filter(isGraphSourcePath)
      const graph = await securityGraphRulesService.run({
        scanId,
        workspaceId: pr.workspaceId,
        repo: pr.repo,
        headSha,
        touchedSourcePaths,
      })
      // Our fault: the read failed, not the customer's diff.
      if (graph.partial) partialCauses.push('GRAPH_READ_FAILED')
      if (graph.capped) {
        logger.info(
          `[pr-security-scan] graph rules capped pr=${pr.id} files=${graph.files}`
        )
      }
      if (graph.error) {
        logger.warn(
          `[pr-security-scan] graph rules partial pr=${pr.id} sha=${headSha}: ${graph.error}`
        )
      }
      const graphRows: NewFindingInput[] = graph.rows

      // ── L3 trigger, first pass (LUM-758) ────────────────────────────────
      // The managed scan has to know whether to keep its VM alive for the
      // hunt BEFORE it is started, so the trigger is evaluated here, where
      // only A1's findings exist. The judge (A4) can only ADD a reason
      // ('stage-a:high'), never remove one, so this pass never over-claims:
      // `huntWantedForVm` implies the final `huntWanted`. The other direction
      // — a judge HIGH that turns the hunt on after the managed scan already
      // started — just means the hunt boots its own VM, which is a first-class
      // path (§2), not a failure.
      const hasOpenCrossing = await hasOpenL4Crossing(pr.taskId)
      // LUM-785: a graph-rule HIGH is stage A's own finding too.
      const secretHigh = [...secretRows, ...graphRows].some(
        r => r.severity === 'HIGH'
      )
      // LUM-758: evaluated even when the hunt is off, because the judge (A4)
      // reads `sites` off it to decide which files fit in its budget. Pure and
      // cheap; the hunt flag only decides whether the VM is kept alive.
      const triggerFirstPass =
        files.length > 0
          ? evaluateHuntTrigger({
              files,
              hasHighFinding: secretHigh,
              hasOpenL4Crossing: hasOpenCrossing,
            })
          : null
      // LUM-832: over the file cap the hunt will not run, so its VM is not
      // kept alive for it either.
      const huntOverCap = touchedSourcePaths.length > HUNT_MAX_HUNTED_FILES
      const huntWantedForVm =
        layers.hunt && !huntOverCap && (triggerFirstPass?.hunt ?? false)

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
      // LUM-745: a prefixed reason for an external layer stage A itself
      // decided (the hourly cap) — carried into persistResult so the panel,
      // CLI and PR summary can show it. null = nothing to say.
      let externalError: string | null = null
      try {
        externalCount =
          await prSecurityScanRepository.countExternalFindings(scanId)
        if (externalCount > 0) {
          stages.external = 'RAN'
        } else if (isManagedScanEnabled()) {
          // LUM-745: a newer head makes every older PENDING run on this PR
          // moot — stamp, cancel and stop them first (never throws), then
          // ask whether this workspace may start another this hour.
          await securityManagedScanOpsService.supersedeOlderRuns({
            pullRequestId: pr.id,
            exceptScanId: scanId,
            newHeadSha: headSha,
          })
          const cap = await securityManagedScanOpsService.enforceHourlyCap({
            workspaceId: pr.workspaceId,
          })
          if (cap.capped) {
            // No sandbox starts; the reason is a fact on the row (P9).
            stages.external = 'FAILED'
            stages.supplyChain = 'FAILED'
            externalError = cap.reason
          } else {
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
              // LUM-758: keep the VM alive past this run for the hunt to
              // attach to — one microVM, two layers.
              huntWanted: huntWantedForVm,
            })
            stages.external = runId ? 'PENDING' : 'FAILED'
            // LUM-738: osv-scanner rides the same run — its layer is pending
            // (or, if nothing could be queued, failed) with the external one.
            stages.supplyChain = runId ? 'PENDING' : 'FAILED'
            managedRunStarted = Boolean(runId)
            if (runId) {
              // LUM-745: the id is what supersede / the sweep cancel by. A
              // failed write leaves this run to the 45-min sweep; it must
              // never fail a scan whose run is already going.
              try {
                await prSecurityScanRepository.setManagedRunId(scanId, runId)
              } catch (error) {
                logger.warn(
                  `[pr-security-scan] managedRunId write failed scan=${scanId}:`,
                  error instanceof Error ? error.message : error
                )
              }
              // LUM-738: the run's DEPENDENCY rows are judged new-vs-persisting
              // against the repository baseline; a repo scanned for the first
              // time has none, so request one now (never throws; the PR scan
              // must not fail over the baseline).
              await securityBaselineService.ensure({
                workspaceId: pr.workspaceId,
                repo: pr.repo,
              })
            }
          }
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
      // LUM-814: what the budget pass decided, for the scan row. null until
      // the pass actually runs — a scan with no files never had a budget, and
      // "not recorded" is the honest reading of that, not a budget of zero.
      let judgeBudget: JudgeBudget | null = null
      // LUM-849: the judge's own description of the PR, for the summary
      // comment. Only a judge that answered writes one.
      let prSummary: PrSummary | null = null
      const judgeRows: NewFindingInput[] = []
      // LUM-832 — like CodeRabbit's limit, a diff over the AI review's top
      // tier is not reviewed at all: no model call, no tokens. The customer is
      // told the change is too large and how to get the review (narrow the
      // scope or split the PR); the numbers are on `judgeBudget`.
      const judgeCapChars =
        JUDGE_DIFF_BUDGET_TIERS[JUDGE_DIFF_BUDGET_TIERS.length - 1]!.chars
      // LUM-866: AI review off for the workspace = the judge is SKIPPED —
      // no model call, and no over-cap notice for a review nobody asked for.
      const judgeOverCap =
        layers.aiReview && files.length > 0 && diff.length > judgeCapChars
      if (judgeOverCap) {
        judgeBudget = {
          diffChars: diff.length,
          tierChars: judgeCapChars,
          reviewedChars: 0,
          coveredFiles: 0,
          droppedFiles: files.length,
        }
        partialCauses.push('JUDGE_OVER_CAP')
        logger.info(
          `[pr-security-scan] judge over cap pr=${pr.id} sha=${headSha} diffChars=${diff.length} cap=${judgeCapChars}: not run`
        )
      }
      if (layers.aiReview && files.length > 0 && !judgeOverCap) {
        // LUM-758: the budget is spent on WHOLE files, the ones the static
        // pass already flagged first — never on a character offset, which
        // made a file's coverage depend on where its name sorted.
        // LUM-811: 预算按 diff 自身的字符长度分档——选档量必须等于被配给量。
        // LUM-758 拿改动源文件数选档、发的却是字符预算，于是文件少而胖的 PR
        // 比文件多而瘦的 PR 拿到更少的预算；`judgeDiffTier` 现在只收 diff，
        // 再把别的量喂进来是 tsc 错误。天花板（180k / 180s）不动。
        const tier = judgeDiffTier(diff)
        const capped = packSecurityDiff(diff, {
          priorityPaths: triggerFirstPass?.sites.map(site => site.path) ?? [],
          maxChars: tier.chars,
        })
        truncated = capped.truncated
        // LUM-814: recorded whether or not it truncated — the untruncated
        // case is the one the old `truncated` boolean could say nothing
        // about, and it is where the near-misses live.
        judgeBudget = {
          diffChars: diff.length,
          tierChars: tier.chars,
          reviewedChars: capped.reviewedChars,
          coveredFiles: capped.covered.length,
          droppedFiles: capped.dropped.length,
        }
        if (truncated) {
          // Coverage owed: the tier is a budget we chose (LUM-811), and the
          // dropped files are ours to review, not the PR's to shrink.
          partialCauses.push('JUDGE_TRUNCATED')
          logger.info(
            `[pr-security-scan] judge budget pr=${pr.id} sha=${headSha} tier=${tier.chars} diffChars=${diff.length} sourceFiles=${touchedSourcePaths.length} reviewed=${capped.covered.length} dropped=${capped.dropped.length}: ${capped.dropped.slice(0, 20).join(' ')}`
          )
        }
        try {
          // Dynamic import keeps @ai-sdk/gateway out of the static graph.
          const { judgeSecurity } =
            await import('@/lib/llm/security-judge-client')
          // LUM-784: the diff is untrusted text about to enter a model's
          // context — every registry secret is masked before the judge sees
          // it. Secrets are stage A's job (deterministic, above); the judge
          // still sees the `AKIA…(len 20)` shape if it wants to reason about
          // a hardcoded credential, it just never sees the value.
          const { findings, prSummary: rawSummary } = await judgeSecurity({
            diff: redactForInjection(capped.text).text,
            timeoutMs: tier.timeoutMs,
          })
          judgeStatus = 'RAN'
          // Model text headed for a public PR: redacted and neutralised here,
          // and again on read (`parsePrSummary`).
          prSummary = cleanPrSummary(rawSummary)
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
      //
      // LUM-758: a judge that ran over a budget-trimmed diff is PARTIAL, not
      // RAN. It used to render as "AI review: checked" while whole files had
      // never been looked at — a layer claiming a pass it did not establish,
      // which is the one thing spec P9 forbids. JUDGE_TRUNCATED was already on
      // the scan level; this puts the fact on the line that is wrong.
      //
      // LUM-892: turned off in the workspace settings = DISABLED, not
      // SKIPPED. SKIPPED is a completed layer ("nothing to review"), so an
      // AI review the customer switched off used to let the scan read CLEAN.
      stages.judge = layers.aiReviewTurnedOff
        ? 'DISABLED'
        : judgeStatus === 'RAN'
          ? truncated
            ? 'PARTIAL'
            : 'RAN'
          : judgeStatus === 'UNAVAILABLE'
            ? 'FAILED'
            : 'SKIPPED'

      // ── L3 trigger (LUM-739) ────────────────────────────────────────────
      // Pure decision here; the hunt itself is a Vercel Workflow started
      // AFTER this scan's own result is persisted (below), so the workflow's
      // write can never be overwritten by stage A's persistResult, which
      // replaces `stages` wholesale except the ingest-owned external key.
      // LUM-758: the same pure call as the first pass above, now that the
      // judge's rows exist. `hasOpenCrossing` is reused rather than re-read —
      // one query, and a trigger that cannot disagree with itself mid-scan.
      const huntTrigger = evaluateHuntTrigger({
        files,
        hasHighFinding:
          secretHigh || judgeRows.some(r => r.severity === 'HIGH'),
        hasOpenL4Crossing: hasOpenCrossing,
      })
      const huntWanted =
        layers.hunt && files.length > 0 && huntTrigger.hunt && !huntOverCap
      // Off (LUMO_SECURITY_HUNT=off, or the workspace's hunt switch — LUM-866)
      // = no hunt layer at all, not a SKIPPED one: the key is stamped only
      // when the layer exists for this PR.
      if (layers.hunt) stages.hunt = huntWanted ? 'PENDING' : 'SKIPPED'
      // LUM-892: the platform offers the hunt but the customer turned it
      // off — the layer is shown as off in settings rather than vanishing,
      // so a reader can tell "not checked" from "nothing to check".
      else if (layers.huntTurnedOff) stages.hunt = 'DISABLED'
      // LUM-832 — a hunt the trigger wanted but the file cap forbids does not
      // run (like CodeRabbit's file limit): recorded, with the numbers the
      // customer's notice needs. A diff with no hunt signal is SKIPPED plain.
      const huntSkippedForCap =
        layers.hunt && files.length > 0 && huntTrigger.hunt && huntOverCap
      if (huntSkippedForCap) partialCauses.push('HUNT_OVERSIZED')

      const prior =
        await prSecurityScanRepository.findDispositionedByPullRequest(pr.id)
      const rows = inheritDispositions(
        [...secretRows, ...graphRows, ...judgeRows],
        prior
      )

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
        judgeBudget,
        prSummary,
        stages,
        partialCauses,
        ...(huntSkippedForCap
          ? {
              huntAudit: {
                overCap: {
                  sourceFiles: touchedSourcePaths.length,
                  capFiles: HUNT_MAX_HUNTED_FILES,
                },
              },
            }
          : {}),
        ...(externalError ? { error: externalError } : {}),
      })
      // LUM-896: the token was checked against the confirmed list when it
      // was minted; the list may have narrowed since.
      await scrubScanIfRepositoryUnconfirmed(scanId)
      // LUM-739: the row is settled — now hand the sha to the hunt. A start
      // that cannot even queue the run is a FAILED layer (P9), stamped on the
      // row so the panel never waits for a run that does not exist.
      let huntRunStarted = false
      if (huntWanted) {
        const huntJob: HuntJob = {
          scanId,
          pullRequestId: pr.id,
          taskId: pr.taskId,
          workspaceId: pr.workspaceId,
          repo: pr.repo,
          prNumber: pr.number,
          headSha,
          // LUM-758: the trigger already computed these — the planning step
          // and its deterministic fallback both run off them.
          reasons: huntTrigger.reasons,
          // LUM-758 Task 10 review: the SAME `files` the trigger just read,
          // filtered by the same source-path predicate it filters by — zero
          // extra API calls. `reasons` says a signal fired; this says which
          // source files it could have fired in. Short circuit A needs it to
          // tell a `stage-a:high` PR that touched code from one that touched
          // none, and the planner needs it to place a signal at all.
          touchedSourcePaths,
          // LUM-758 follow-up: the SAME walk's located hits — which rule fired,
          // in which file, on which added line. Computed already; discarding it
          // is what made the agent re-derive it with `rg` on its own budget.
          signalSites: huntTrigger.sites,
          // LUM-758 §5.1: false means no managed scan VM is coming, so the
          // hunt goes straight to creating its own instead of polling 30 s.
          // LUM-876: a run started with `huntWanted: false` (the hunt was
          // turned on only by the judge's HIGH, after the run had started)
          // stops its own VM and never writes the hand-off marker — there is
          // nothing for the hunt to wait for either.
          managedScanStarted: managedRunStarted && huntWantedForVm,
        }
        // LUM-832: an oversized diff (within HUNT_MAX_HUNTED_FILES) is hunted
        // in risk-ordered batches across runs. The plan rides on the job from
        // the first run, so the covered share is readable (0 of N) the moment
        // the hunt starts.
        const huntBatches = planHuntBatches(
          touchedSourcePaths,
          huntTrigger.sites
        )
        if (huntBatches) {
          huntJob.batches = huntBatches
          huntJob.batchIndex = 0
        }
        const runId = await startSecurityHunt(huntJob)
        if (runId) {
          huntRunStarted = true
          await recordHuntStartBestEffort(scanId, huntJob, runId)
        } else
          await prSecurityScanRepository.mergeStages(scanId, { hunt: 'FAILED' })
      }
      // LUM-735 Task 2: the findings are on the row — put them on the PR.
      // Best-effort like the dispatchers: `sync` never throws, and the
      // markers make a repeat (from a workflow) comment-free.
      // Skipped when this run queued the managed scan: that workflow syncs
      // once it has persisted, and one summary per scan is the contract —
      // unless stage A itself found something that blocks DONE, which must
      // reach the PR even if the managed run never executes.
      // LUM-740: "blocks DONE" is the workspace's policy here as everywhere.
      const policy = await loadSecurityPolicy(pr.workspaceId)
      const blocksDone = rows.some(r =>
        isBlockingFinding(
          {
            provenance: r.provenance,
            severity: r.severity,
            disposition: r.disposition ?? null,
          },
          policy
        )
      )
      // LUM-739: same rule for a started hunt run — it syncs when it lands.
      if ((!managedRunStarted && !huntRunStarted) || blocksDone) {
        waitUntil(securityPrReviewService.sync(scanId))
      }
      return { deduped: false, scanId, status, findings: rows.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        `[pr-security-scan] scan failed pr=${pr.id} sha=${headSha}: ${message}`
      )
      // LUM-739: a hunt that was never started must not read as "scanning".
      if (stages.hunt === 'PENDING') delete stages.hunt
      await prSecurityScanRepository.finalize(scanId, {
        status: 'FAILED',
        judgeStatus: null,
        truncated: false,
        stages,
        partialCauses,
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
    const scanningOff =
      prs.length > 0 && !(await loadSecurityLayers(prs[0]!.workspaceId)).scan
    // LUM-740: one policy read per task — every scan is in its workspace.
    // LUM-775: plus the default-branch baseline of each repo with a merged
    // PR, for the queue-exit rules.
    const [policy, exitContexts] =
      scans.length > 0
        ? await Promise.all([
            loadSecurityPolicy(scans[0]!.workspaceId),
            loadQueueExitContexts(prs, scans[0]!.workspaceId),
          ])
        : [DEFAULT_SECURITY_POLICY, new Map()]
    let count = 0
    let suggested = 0
    const out = []
    for (const pr of prs) {
      const scan = latest.get(pr.id)
      const view = scan
        ? toScanView(scan, policy, await countFixed(scan), f =>
            queueExitOf(f, pr, exitContexts, policy)
          )
        : null
      if (view) {
        count += view.findings.filter(f => f.blocking).length
        suggested += view.findings.filter(
          f =>
            f.disposition === null &&
            !f.persisting &&
            f.queueExit === null &&
            f.suggestedDisposition !== null
        ).length
      }
      out.push({ pr, latest: view })
    }
    return {
      prs: out,
      blocking: { count },
      suggested: { count: suggested },
      scanningOff,
    }
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
        // LUM-740: the human's verdict on the falsifier's suggestion (R2).
        suggestionOutcome: suggestionOutcomeFor(
          finding.suggestedDisposition,
          disposition
        ),
      }
    )
    return toFindingView(
      updated,
      await loadSecurityPolicy(finding.scan.pullRequest.workspaceId)
    )
  },

  /**
   * LUM-740 — "confirm all suspected false positives": every undispositioned
   * finding on the task's PRs that the falsifier suggested as a false
   * positive is dispositioned FALSE_POSITIVE with outcome CONFIRMED, in one
   * write. Human-only by the route's red line; the actor is stamped.
   */
  async dispositionSuggested(
    taskId: string,
    actorMemberId: string
  ): Promise<{ confirmed: number }> {
    // The latest scan per PR — the rows the panel shows and counts.
    const prs = await pullRequestRepository.findManyForSecurityByTaskId(taskId)
    const scans = await prSecurityScanRepository.findLatestByPullRequestIds(
      prs.map(p => p.id)
    )
    const scanIds = [...latestScanPerPr(scans).values()].map(s => s.id)
    const confirmed = await prSecurityScanRepository.confirmSuggestedByScanIds(
      scanIds,
      {
        dispositionNote: 'Confirmed LLM suggestion (bulk)',
        dispositionedById: actorMemberId,
        dispositionedAt: new Date(),
      }
    )
    return { confirmed }
  },
}
