/**
 * LUM-732 — PR security scan orchestration.
 *
 * run():  resolve PR → current head sha → dedup on (pr, sha) → fetch diff →
 *         deterministic secret scan → LLM judge (dynamic import, fail-soft) →
 *         inherit dispositions by fingerprint → persist → finalize.
 * Runs inside the /api/internal/pr-security-scan worker (300s), never inline.
 *
 * Secrets never reach a row: scanSecrets redacts before returning, and every
 * free-text field the LLM judge authors is redacted (`redactFindingProse`).
 */
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import {
  recordAuditEvent,
  type WorkspaceAudit,
} from '@/lib/services/audit.service'
import { scrubScanIfRepositoryUnconfirmed } from '@/ee/security/services/scan-code-retention.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { findingStatement } from '@/ee/security/security-scan/agent-reminder'
import { sanitizeField } from '@/lib/utils/sanitize'
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
} from '@/ee/security/repositories/pr-security-scan.repository'
import { suggestionOutcomeFor } from '@/ee/security/security-scan/suggestion'
import {
  cleanPrSummary,
  type PrSummary,
} from '@/ee/security/security-scan/pr-summary'
import {
  fetchPrChangedFiles,
  fetchPrDiff,
  fetchPrHeadSha,
  fetchReviewChangedPaths,
} from '@/lib/integrations/github/contents'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { isPrReviewIgnored } from './pr-ignore-directive'
import { startDeferredManualReview } from './security-deferred-review-start'
import { autoReviewAdmissionService } from '@/ee/security/services/auto-review-admission.service'
import {
  DEFAULT_AUTO_PAUSE_AFTER,
  affectedReviewDiff,
  reviewBudgetView,
  type ReviewBudgetView,
} from '@/ee/security/security-scan/review-control'
import type { SecretDowngradeReason } from '@/ee/security/security-scan/types'
import {
  packedFileBody,
  reviewContextBudget,
} from '@/ee/security/security-scan/review-context'
import { loadReviewLearnings } from '@/ee/security/services/review-learnings.service'
import {
  SERVER_CONFIG_MAX_CHARS,
  planServerConfigContext,
} from '@/ee/security/security-scan/server-config-context'
import { reviewContextService } from './review-context.service'
import { isReviewVerifierEnabled } from './review-verifier.config'
import { verifierAppliesTo } from '@/ee/security/security-scan/verifier'
import type { ReviewVerifierJob } from './review-verifier.service'
import { isBugKind } from '@/ee/security/security-scan/review-kinds'
import { redactFindingProse } from '@/ee/security/security-scan/finding-prose'
import { validateCodeSuggestion } from '@/ee/security/security-scan/code-suggestion'
import {
  createFindingAnchor,
  type FindingAnchorMethod,
} from '@/ee/security/security-scan/finding-anchor'
import { rightSideLinesWithNumbers } from '@/lib/diff/diff-lines'
import {
  addedLinesWithNumbers,
  scanSecrets,
  packSecurityDiff,
  judgeDiffTier,
  redactKnownSecrets,
  redactFindingText,
  redactForInjection,
  judgeFindingFingerprint,
  INCOMPLETE_STAGE_STATES,
  stagesOf,
  evaluateHuntTrigger,
  L4_CROSSING_CATEGORIES,
  type ScanStages,
  type JudgeBudget,
} from '@/ee/security/security-scan'
import { isGraphSourcePath } from '@/ee/security/security-scan/graph/imports'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import {
  isBlockingFinding,
  latestScanPerPr,
  loadQueueExitContexts,
  loadSecurityPolicy,
  queueExitOf,
} from './pr-security-scan-gate'
import type { QueueExitReason } from '@/ee/security/security-scan/queue-exit'
import {
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
} from '@/ee/security/security-scan/policy'
import { isManagedScanEnabled } from './security-managed-scan.config'
import { isRewardHackEnabled } from './security-reward-hack.config'
import { startSecurityManagedScan } from './security-managed-scan-start'
import { securityManagedScanOpsService } from './security-managed-scan-ops.service'
import { HUNT_MAX_HUNTED_FILES, type HuntJob } from './security-hunt.config'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { repoConfigService } from './repo-config.service'
import { preMergeChecksService } from './pre-merge-checks.service'
import { REPO_CONFIG_FIELDS } from '@/ee/security/security-scan/repo-config'
import type { RepoConfigFile } from '@/ee/security/validation/repo-config'
import type { RepoReviewSettingValues } from '@/ee/security/security-scan/auto-review-policy'
import { DEFAULT_REVIEW_PROFILE } from '@/ee/security/security-scan/review-profile'
import {
  diffFileStats,
  prWholeSummaryService,
  type WholeSummaryResult,
} from './pr-whole-summary.service'
import {
  cleanSequenceDiagram,
  DEFAULT_SEQUENCE_DIAGRAMS,
  sequenceDiagramEligible,
  type SequenceDiagram,
} from '@/ee/security/security-scan/sequence-diagram'
import {
  DEFAULT_HIGH_LEVEL_SUMMARY,
  parseHighLevelSummary,
} from '@/ee/security/security-scan/pr-description-summary'
import {
  planPathInstructions,
  verifyPathInstructionClaim,
  renderToneInstructions,
} from '@/ee/security/security-scan/path-instructions'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'
import {
  filterReviewableDiff,
  pathFilterSkips,
  reviewablePathPredicate,
} from '@/ee/security/security-scan/reviewable-path'
import { loadSecurityLayers } from './security-workspace-switches.service'
import {
  recordHuntStartBestEffort,
  startSecurityHunt,
} from './security-hunt-start'
import { securityGraphRulesService } from './security-graph-rules.service'
import { securityBaselineService } from './security-baseline.service'
// No LLM/gateway import inside — safe to import statically from stage A.
import { securityPrReviewService } from './security-pr-review.service'
import { waitUntil } from '@/lib/runtime/wait-until'
import {
  huntBatchProgress,
  planHuntBatches,
  type HuntBatchProgress,
} from '@/ee/security/security-scan/hunt/batches'
import { JUDGE_DIFF_BUDGET_TIERS } from '@/ee/security/security-scan/truncate'
import {
  JUDGE_MAX_REVIEWED_FILES,
  planPartialReview,
} from '@/ee/security/security-scan/partial-review'
import type { JudgeOverCapRecord } from '@/ee/security/security-scan/judge-budget'
import {
  hasSizeNotice,
  scanSizeCaps,
  type ScanSizeCaps,
} from '@/ee/security/security-scan/size-caps'
import {
  encodePrTooLarge,
  GITHUB_DIFF_MAX_FILES,
  SCAN_STAGE_KEYS,
  isOwnedUnfinished,
  isReviewRateLimited,
  isReviewIgnored,
  scanCoverageState,
  type HuntOverCapInput,
  type JudgeOverCapInput,
  type JudgePartialInput,
  type PartialCause,
  type PrTooLargeInput,
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
  // LUM-988: the agentic verifier's verdict on an LLM_JUDGE row, and why.
  verifierVerdict: 'CONFIRMED' | 'REJECTED' | null
  verifierReason: string | null
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
   * it runs on (file-cap notice). null otherwise.
   */
  huntOverCap: HuntOverCapInput | null
  /**
   * LUM-832 — the AI review did not run: the diff was over its size cap
   * (size-cap notice). null otherwise.
   */
  judgeOverCap: JudgeOverCapInput | null
  /** LUM-1144 — the AI review ran on part of an over-cap diff (skipped files named). null otherwise. */
  judgePartial: JudgePartialInput | null
  /**
   * LUM-1079 — the whole PR was too large to scan (more changed files than
   * GitHub returns a diff for, or GitHub refused the diff): no layer ran.
   * Told with the reason and what to do (split / narrow), never as our
   * "didn't finish" and never as checked. null otherwise.
   */
  prTooLarge: PrTooLargeInput | null
  /**
   * LUM-1137 — the paused AI layers were rate-limited (the author's hourly
   * cap), not paused: the next push is reviewed. Present only when true.
   */
  reviewRateLimited?: true
  /**
   * LUM-1152 — the paused AI layers were skipped because the PR description
   * carries `@<app> ignore`. Present only when true.
   */
  reviewIgnored?: true
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

/**
 * LUM-1128: which surface a ruling came through. A Clerk browser session is
 * WEB (the delivery panel); an API-key bearer is CLI (`lumo finding
 * disposition`, run after the user approved its exit-4 envelope). Recorded on
 * the SECURITY_FINDING_DISPOSITIONED activity so the timeline says which
 * surface ruled — and a web correction of a CLI ruling reads as such.
 */
export type FindingDispositionChannel = 'WEB' | 'CLI'

export interface FindingDispositionVia {
  channel: FindingDispositionChannel
  /** The caller's X-Lumo-Session-Id (CLI only); null when unbound / web. */
  sessionId: string | null
}

const WEB_VIA: FindingDispositionVia = { channel: 'WEB', sessionId: null }

type ScopedFinding = NonNullable<
  Awaited<ReturnType<typeof prSecurityScanRepository.findFindingWithScope>>
>

/** The finding, or a 404 when it is missing or not on this task. */
async function findFindingOnTask(
  taskId: string,
  findingId: string
): Promise<ScopedFinding> {
  const finding = await prSecurityScanRepository.findFindingWithScope(findingId)
  if (!finding || finding.scan.pullRequest.taskId !== taskId) {
    throw Object.assign(new Error('Security finding not found on this task'), {
      status: 404,
    })
  }
  return finding
}

/**
 * LUM-1128: the SECURITY_FINDING_DISPOSITIONED timeline entry — which surface
 * ruled, when, and (CLI) from which session. `to: 'OPEN'` is a reopen.
 */
function findingRulingActivity(
  taskId: string,
  finding: ScopedFinding,
  actorId: string | null,
  t: {
    from: FindingDisposition | null
    to: FindingDisposition | 'OPEN'
    via: FindingDispositionVia
  }
) {
  return {
    taskId,
    actorId,
    type: 'SECURITY_FINDING_DISPOSITIONED' as const,
    payload: {
      findingId: finding.id,
      ruleId: finding.ruleId,
      severity: finding.severity,
      filePath: finding.filePath,
      line: finding.line,
      from: t.from,
      to: t.to,
      channel: t.via.channel,
      sessionId: t.via.sessionId,
      confirmedAt: new Date().toISOString(),
    },
  }
}

/**
 * LUM-1128: one finding as `lumo finding disposition` reads it to build its
 * envelope — the fields the user approves, nothing else (ISP). `title` and
 * `statement` are untrusted scan output, sanitized and injection-redacted
 * before they reach an agent's context.
 */
export interface CliFindingRow {
  id: string
  severity: FindingSeverity
  provenance: FindingProvenance
  ruleId: string
  filePath: string
  line: number | null
  title: string
  statement: string
  prNumber: number
  disposition: FindingDisposition | null
  blocking: boolean
}

export interface TaskSecurityScans {
  prs: {
    reviewControl?: ReviewBudgetView
    pr: {
      id: string
      number: number
      title: string
      url: string
      state: string
      repo?: string
      headSha?: string | null
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
    // LUM-1234: a REWARD_HACK row's detail is the judge's prose, which may
    // describe what the agent sessions show — every reader of this view (the
    // panel, the CLI, agents) gets the fixed title only; the evidence view
    // serves the prose to viewers who may open those sessions.
    detail: f.kind === 'REWARD_HACK' ? '' : f.detail,
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
    verifierVerdict: f.verifierVerdict ?? null,
    verifierReason: f.verifierReason ?? null,
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
    error: s.error,
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
    ...(isReviewRateLimited(s.partialCauses)
      ? { reviewRateLimited: true as const }
      : {}),
    ...(isReviewIgnored(s.partialCauses)
      ? { reviewIgnored: true as const }
      : {}),
    ownedUnfinished: isOwnedUnfinished({
      status: s.status,
      stages,
      partial: s.partial,
      partialCauses: s.partialCauses ?? [],
      hasSizeNotice: hasSizeNotice(sizeCaps),
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
/** LUM-1056: the PR head moved while this run read or reviewed it. */
class HeadMovedError extends Error {}

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
    if ((await prSecurityScanRepository.claimPending(existing.id)) === false)
      return { deduped: true, scanId: existing.id }
    return { scanId: existing.id }
  }
  if (isRerunnable(existing)) {
    if (
      (await prSecurityScanRepository.restart(
        existing.id,
        false,
        existing.startedAt
      )) === false
    )
      return { deduped: true, scanId: existing.id }
    return { scanId: existing.id }
  }
  return { deduped: true, scanId: existing.id }
}

// LUM-739: `inheritDispositions` lives in a pure module now (shared with the
// hunt workflow's persistence); re-exported so existing importers keep working.
import { inheritDispositions } from '@/ee/security/security-scan/inherit-dispositions'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
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

/**
 * LUM-988 — `judgeFindingFingerprint` (rule + file + quoted line) repeats
 * when one scan reports the same rule on the same text twice: two `return
 * null` lines in one file, or two problems on one line. A shared key would
 * let a human's ruling on one silence the other, so every member of a
 * repeated group is keyed on its POSITION — the reported line — never on
 * the order the model happened to list them in (that order flips between
 * pushes, and an ordinal would then hand a FALSE_POSITIVE to a real bug).
 * A unique key is left as it is. Members that also share the line (two
 * problems on one line) fall back to a title-sorted ordinal — rare, and
 * the worst case is one re-posted comment, never a wrongly inherited ruling.
 * Same 16-hex shape as every key.
 */
export function positionalFingerprints(
  rows: ReadonlyArray<{
    fingerprint: string
    line: number | null
    title: string
  }>
): string[] {
  const hash = (s: string) =>
    createHash('sha256').update(s).digest('hex').slice(0, 16)
  const groupSize = new Map<string, number>()
  for (const r of rows)
    groupSize.set(r.fingerprint, (groupSize.get(r.fingerprint) ?? 0) + 1)
  const positional = rows.map(r =>
    (groupSize.get(r.fingerprint) ?? 0) > 1
      ? hash(`${r.fingerprint}#L${r.line ?? 'none'}`)
      : r.fingerprint
  )
  // Same group AND same line: order those by title, not by emission.
  const order = rows
    .map((r, i) => ({ key: positional[i]!, title: r.title, i }))
    .sort((a, b) =>
      a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : a.title < b.title
            ? -1
            : a.title > b.title
              ? 1
              : a.i - b.i
    )
  const seen = new Map<string, number>()
  const out = [...positional]
  for (const o of order) {
    if ((groupSize.get(rows[o.i]!.fingerprint) ?? 0) <= 1) continue
    const n = (seen.get(o.key) ?? 0) + 1
    seen.set(o.key, n)
    if (n > 1) out[o.i] = hash(`${o.key}#${n}`)
  }
  return out
}

/**
 * LUM-988 — mark the hold, then start the verifier; release the hold if the
 * run could not be queued. Never throws: the scan is already settled.
 */
async function startVerifierBestEffort(
  job: ReviewVerifierJob
): Promise<boolean> {
  try {
    await prSecurityScanRepository.markVerifierStarted(job.scanId)
  } catch (error) {
    // No hold recorded: comments post unverified, as before LUM-988.
    logger.warn(
      `[pr-security-scan] verifier mark failed scan=${job.scanId}: ${error instanceof Error ? error.message : error}`
    )
    return false
  }
  // Dynamic import: the starter pulls the workflow runtime and the sandbox
  // client, which stay out of stage A's static graph (jest ESM trap).
  const { startReviewVerifier } = await import('./review-verifier-start')
  if (await startReviewVerifier(job)) return true
  try {
    await prSecurityScanRepository.completeVerification(job.scanId, [])
  } catch (error) {
    logger.warn(
      `[pr-security-scan] verifier hold release failed scan=${job.scanId}: ${error instanceof Error ? error.message : error}`
    )
  }
  return false
}

/**
 * LUM-988 — stage A kept the managed scan's VM alive (the judge had not run
 * yet) and then started nothing that will use it: queue the verifier
 * workflow in release-only mode, which stops the VM after its hand-off.
 * Without this an AI review with nothing to verify idled the VM to its
 * 35-minute timeout (the leak LUM-852 removed). Never throws.
 */
async function releaseKeptVmBestEffort(job: ReviewVerifierJob): Promise<void> {
  try {
    const { startReviewVerifier } = await import('./review-verifier-start')
    await startReviewVerifier({ ...job, releaseOnly: true })
  } catch (error) {
    logger.warn(
      `[pr-security-scan] VM release could not be queued scan=${job.scanId}: ${error instanceof Error ? error.message : error}`
    )
  }
}

/**
 * LUM-1143 — the repository's path filters; a failed read falls back to the
 * built-in exclusions only (never a failed scan over a settings read).
 */
async function repoPathFiltersBestEffort(
  workspaceId: string,
  repo: string
): Promise<string[]> {
  try {
    return await repoReviewSettingRepository.findPathFilters(
      workspaceId,
      repo.toLowerCase()
    )
  } catch (error) {
    logger.warn(
      `[pr-security-scan] path filters unavailable repo=${repo}: ${error instanceof Error ? error.message : String(error)}`
    )
    return []
  }
}

/**
 * LUM-1147 — the repository's stored review style; a failed read (or no
 * row) is the defaults — never a failed scan over a settings read.
 */
async function repoReviewStyleBestEffort(
  workspaceId: string,
  repo: string
): Promise<ReviewStyle> {
  try {
    const row = await repoReviewSettingRepository.findReviewStyle(
      workspaceId,
      repo.toLowerCase()
    )
    // LUM-1151: a row read without the column (older fixtures) = default.
    if (row)
      return {
        ...row,
        highLevelSummary: parseHighLevelSummary(row.highLevelSummary),
        // LUM-1155: likewise — a row without the column = default (on).
        sequenceDiagrams:
          typeof row.sequenceDiagrams === 'boolean'
            ? row.sequenceDiagrams
            : DEFAULT_SEQUENCE_DIAGRAMS,
      }
  } catch (error) {
    logger.warn(
      `[pr-security-scan] review style unavailable repo=${repo}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return {
    pathInstructions: [],
    reviewProfile: DEFAULT_REVIEW_PROFILE,
    toneInstructions: null,
    highLevelSummary: DEFAULT_HIGH_LEVEL_SUMMARY,
    sequenceDiagrams: DEFAULT_SEQUENCE_DIAGRAMS,
  }
}

type ReviewStyle = Pick<
  RepoReviewSettingValues,
  | 'pathInstructions'
  | 'reviewProfile'
  | 'toneInstructions'
  | 'highLevelSummary'
  | 'sequenceDiagrams'
>

/** What one scan's review reads from the repository's settings. */
export interface ScanReviewSettings extends ReviewStyle {
  pathFilters: string[]
}

/** PURE — a field's file value over the stored one (file > stored). */
function fileOver<K extends 'pathFilters' | keyof ReviewStyle>(
  file: RepoConfigFile | null,
  key: K,
  stored: ScanReviewSettings[K]
): ScanReviewSettings[K] {
  const fromFile = file
    ? (REPO_CONFIG_FIELDS[key].read(file) as ScanReviewSettings[K] | undefined)
    : undefined
  // `null` from the file (e.g. a blank tone) is a value: it clears.
  return fromFile !== undefined ? fromFile : stored
}

/**
 * LUM-1146 — the path filters the review reads: `.lumo.yaml` on the PR's
 * BASE commit wins over the repository's stored filters (the PR's own copy
 * is only checked). How the file was read goes on the row for the PR
 * summary. LUM-1147: the review style (path instructions, profile, tone)
 * resolves the same way, and the profile in force goes on the row for the
 * write-back. Never fails the scan — any failure falls back to the stored
 * settings.
 */
async function reviewSettingsBestEffort(
  pr: { workspaceId: string; repo: string; number: number },
  scanId: string,
  headSha: string,
  diff: string
): Promise<ScanReviewSettings> {
  const [pathFilters, style] = await Promise.all([
    repoPathFiltersBestEffort(pr.workspaceId, pr.repo),
    repoReviewStyleBestEffort(pr.workspaceId, pr.repo),
  ])
  let settings: ScanReviewSettings = { pathFilters, ...style }
  try {
    const { file, notice } = await repoConfigService.forPullRequest({
      workspaceId: pr.workspaceId,
      repo: pr.repo,
      prNumber: pr.number,
      headSha,
      diff,
    })
    try {
      await prSecurityScanRepository.setRepoConfig(scanId, notice)
    } catch (error) {
      logger.warn(
        `[pr-security-scan] repo config notice not stored scan=${scanId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    settings = {
      pathFilters: fileOver(file, 'pathFilters', settings.pathFilters),
      pathInstructions: fileOver(
        file,
        'pathInstructions',
        settings.pathInstructions
      ),
      reviewProfile: fileOver(file, 'reviewProfile', settings.reviewProfile),
      toneInstructions: fileOver(
        file,
        'toneInstructions',
        settings.toneInstructions
      ),
      highLevelSummary: fileOver(
        file,
        'highLevelSummary',
        settings.highLevelSummary
      ),
      sequenceDiagrams: fileOver(
        file,
        'sequenceDiagrams',
        settings.sequenceDiagrams
      ),
    }
  } catch (error) {
    logger.warn(
      `[pr-security-scan] repo config unavailable repo=${pr.repo}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  try {
    await prSecurityScanRepository.setReviewProfile(
      scanId,
      settings.reviewProfile
    )
  } catch (error) {
    logger.warn(
      `[pr-security-scan] review profile not stored scan=${scanId}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  // LUM-1151: where this review's high-level summary goes (the write-back
  // reads it; a missed write reads as the default).
  try {
    await prSecurityScanRepository.setHighLevelSummary(
      scanId,
      settings.highLevelSummary
    )
  } catch (error) {
    logger.warn(
      `[pr-security-scan] high-level summary setting not stored scan=${scanId}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return settings
}

/**
 * LUM-1079 — `fetchPrDiff` flags GitHub's "diff too large" refusal (406)
 * with `diffTooLarge: true` on the error it throws.
 */
export function isPrDiffTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { diffTooLarge?: unknown }).diffTooLarge === true
  )
}

/**
 * LUM-1079 — the PR's changed-file count, or null when it could not be read.
 * Best-effort: a failed read only skips the early check — the diff request
 * still runs, and GitHub's own 406 is the backstop.
 */
async function changedFilesBestEffort(pr: {
  workspaceId: string
  repo: string
  number: number
}): Promise<number | null> {
  try {
    return await fetchPrChangedFiles({
      workspaceId: pr.workspaceId,
      fullName: pr.repo,
      prNumber: pr.number,
    })
  } catch (error) {
    logger.info(
      `[pr-security-scan] changed-file count unavailable ${pr.repo}#${pr.number}: ${error instanceof Error ? error.message : error}`
    )
    return null
  }
}

/**
 * LUM-1079 — the PR was too large to scan: no layer ran, so every layer is
 * SKIPPED and the row says why (cause PR_TOO_LARGE, numbers on `error`).
 * Status stays FAILED — the scan vouches for nothing, so it can never read
 * as CLEAN or checked, and a re-trigger re-runs it in place — but every
 * surface tells it as a limit on the change, with what to do, instead of
 * our "didn't finish". The PR summary says the same.
 */
async function finishTooLarge(
  scanId: string,
  tooLarge: PrTooLargeInput
): Promise<RunScanResult> {
  logger.info(
    `[pr-security-scan] PR too large to scan scan=${scanId} reason=${tooLarge.reason} files=${tooLarge.changedFiles ?? '?'}`
  )
  const stages: ScanStages = {}
  for (const key of SCAN_STAGE_KEYS) stages[key] = 'SKIPPED'
  // LUM-1234 (R10): a layer the platform does not offer has no key at all.
  if (!isRewardHackEnabled()) delete stages.rewardHack
  await prSecurityScanRepository.finalize(scanId, {
    status: 'FAILED',
    judgeStatus: null,
    truncated: false,
    stages,
    partialCauses: ['PR_TOO_LARGE'],
    error: encodePrTooLarge(tooLarge),
  })
  waitUntil(securityPrReviewService.sync(scanId))
  return { deduped: false, scanId, status: 'FAILED', findings: 0 }
}

/**
 * LUM-1234 — run the reward-hack layer. Dynamic import: keeps the layer's
 * model client and session reads out of stage A's static graph. The runner
 * never throws; a failed import is stamped FAILED so the layer never sits
 * PENDING for a run that does not exist.
 */
async function startRewardHackLayer(
  scanId: string,
  runToken: Date | undefined
): Promise<void> {
  try {
    const { runRewardHackLayer } = await import('./reward-hack-layer.service')
    await runRewardHackLayer(scanId, {}, runToken ? { runToken } : {})
  } catch (error) {
    logger.error(
      `[pr-security-scan] reward-hack layer not started scan=${scanId}: ${error instanceof Error ? error.message : String(error)}`
    )
    if (runToken)
      await prSecurityScanRepository.persistRewardHackResult(scanId, runToken, {
        findings: [],
        stage: 'FAILED',
        partialCauses: [],
      })
    else
      await prSecurityScanRepository.mergeStages(scanId, {
        rewardHack: 'FAILED',
      })
  }
}

export const prSecurityScanService = {
  async run(input: {
    pullRequestId: string
    trigger: ScanTrigger
    reviewMode?: 'incremental' | 'full'
    /** LUM-1152 follow-up: dispatched by a deferred manual review. */
    deferred?: boolean
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
    let manualFindings:
      | Awaited<ReturnType<typeof prReviewControlRepository.priorFindings>>
      | undefined
    if (existing) {
      if (input.reviewMode) {
        const claimed = await prSecurityScanRepository.restart(
          existing.id,
          true
        )
        if (!Array.isArray(claimed)) {
          // LUM-1152 follow-up: the head's scan is still in flight. Its AI
          // layers may be held (ignore / pause / hourly cap), so the review
          // asked for waits for it to settle instead of being dropped — once.
          if (!input.deferred)
            await startDeferredManualReview({
              pullRequestId: pr.id,
              scanId: existing.id,
              reviewMode: input.reviewMode,
            })
          else
            logger.info(
              `[pr-security-scan] deferred manual ${input.reviewMode} review deduplicated pr=${pr.id} scan=${existing.id}: the head's scan is in flight again`
            )
          return { deduped: true, scanId: existing.id }
        }
        manualFindings = claimed
        scanId = existing.id
      } else {
        const adopted = await adoptExisting(existing)
        if ('deduped' in adopted) return adopted
        scanId = adopted.scanId
      }
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
    // LUM-988: stage A kept the managed scan's VM alive for a consumer (the
    // hunt; since LUM-1084 never the verifier); if none starts — including
    // when stage A itself fails — it owns releasing that VM
    // (`releaseKeptVmBestEffort`).
    let keptVm: ReviewVerifierJob | null = null
    let vmConsumerStarted = false
    let reservedHead = false

    try {
      // LUM-1079: a PR GitHub will not return a diff for is told as too
      // large — checked by file count BEFORE asking, with GitHub's own
      // refusal (406) as the backstop. Never our FAILED "didn't finish".
      const changedFiles = await changedFilesBestEffort(pr)
      if (changedFiles !== null && changedFiles > GITHUB_DIFF_MAX_FILES)
        return await finishTooLarge(scanId, {
          reason: 'FILE_LIMIT',
          changedFiles,
          capFiles: GITHUB_DIFF_MAX_FILES,
        })
      let diff: string
      try {
        diff = await fetchPrDiff({
          workspaceId: pr.workspaceId,
          fullName: pr.repo,
          prNumber: pr.number,
        })
      } catch (error) {
        if (!isPrDiffTooLargeError(error)) throw error
        return await finishTooLarge(scanId, {
          reason: 'DIFF_REFUSED',
          changedFiles,
          capFiles: GITHUB_DIFF_MAX_FILES,
        })
      }
      const files = addedLinesWithNumbers(diff)
      // The PR diff endpoint follows a moving ref. Refuse a push that raced
      // this read rather than attaching another head's code to this scan.
      if (
        (await fetchPrHeadSha({
          workspaceId: pr.workspaceId,
          fullName: pr.repo,
          prNumber: pr.number,
        })) !== headSha
      )
        throw new HeadMovedError('PR head changed while reading review diff')
      // Reserved only once the diff is proven to be this head's: a push that
      // raced the read must not spend a round on a head nobody reviewed.
      // LUM-1137: every push, until N reviewed commits, under an hourly cap.
      // LUM-1152: `@<app> ignore` in the description skips the automatic AI
      // layers before the budget is touched; the deterministic layers run.
      // LUM-1234 (R12): the reward-hack layer is an automatic AI layer too —
      // but only for a PR with a task (no task = no sessions = SKIPPED), so a
      // task-less PR in a reward-hack-only workspace spends no review slot.
      const aiLayers =
        layers.aiReview || layers.hunt || (layers.rewardHack && !!pr.taskId)
      const automaticAi = aiLayers && input.reviewMode === undefined
      const ignored = automaticAi && (await isPrReviewIgnored(pr))
      const admission =
        automaticAi && !ignored
          ? await autoReviewAdmissionService.admit(pr, headSha)
          : null
      const aiAllowed =
        aiLayers &&
        (input.reviewMode !== undefined || admission?.allowed === true)
      reservedHead = aiAllowed && input.reviewMode === undefined
      const reviewAllowed = layers.aiReview && aiAllowed
      const reviewPaused = aiLayers && !aiAllowed
      if (reviewPaused)
        partialCauses.push(
          ignored
            ? 'AI_REVIEW_IGNORED'
            : admission?.rateLimited
              ? 'AI_REVIEW_RATE_LIMITED'
              : 'AI_REVIEW_PAUSED'
        )
      let reviewDiff = diff
      // Paths whose PR-diff sections the judge reviews; null = the whole diff.
      let reviewScope: Set<string> | null = null
      // LUM-1151: the AI review reads only the files changed since its last
      // complete review — its own summary would describe that slice.
      let incrementalSlice = false
      if (reviewAllowed && input.reviewMode !== 'full') {
        const baseline = await prReviewControlRepository.baseline(pr.id, scanId)
        if (baseline) {
          try {
            const paths = await fetchReviewChangedPaths({
              workspaceId: pr.workspaceId,
              fullName: pr.repo,
              base: baseline.headSha,
              head: headSha,
            })
            reviewDiff = affectedReviewDiff(diff, paths)
            if (reviewDiff !== diff) {
              reviewScope = new Set(paths)
              incrementalSlice = true
            }
          } catch {
            logger.info(
              `[pr-security-scan] incremental baseline unavailable pr=${pr.id}: full review`
            )
          }
        }
      }
      // LUM-1143 — the repository's path filters (LUM-1146: `.lumo.yaml` on
      // the base commit first; built-in: lockfiles, generated code, build
      // output) decide what the AI review and the hunt read. The secret scan
      // and graph rules still see every file.
      // LUM-1147: and the review style the AI review reads.
      const reviewSettings = await reviewSettingsBestEffort(
        pr,
        scanId,
        headSha,
        diff
      )
      const isReviewable = reviewablePathPredicate(reviewSettings.pathFilters)
      // LUM-1215: what the filters left out of the whole PR, for the
      // summary — a built-in default never hides a file silently. Only when
      // the AI review may run: a paused / turned-off review skipped nothing.
      const reviewPathSkips = reviewAllowed
        ? pathFilterSkips(
            files.map(f => f.path),
            reviewSettings.pathFilters
          )
        : null
      const reviewable = filterReviewableDiff(reviewDiff, isReviewable)
      if (reviewable.excluded.length > 0) {
        reviewDiff = reviewable.diff
        reviewScope = new Set(reviewable.kept)
      }
      const reviewFiles = addedLinesWithNumbers(reviewDiff)
      const huntFiles = files.filter(f => isReviewable(f.path))
      // LUM-1151 (user ruling) — the high-level summary always describes
      // the WHOLE PR: an incremental review gets a separate, budgeted
      // summary-only call over the whole reviewable diff, alongside the
      // review. Never rejects; a full review keeps the AI review's own.
      // LUM-1155 — the call-flow diagram rides on the call this review
      // already makes (the AI review, or the whole-PR summary call of an
      // incremental review): asked for only when the repository wants
      // diagrams and the whole reviewable PR is not trivial.
      const diagramWanted =
        reviewAllowed &&
        reviewSettings.sequenceDiagrams &&
        sequenceDiagramEligible(
          diffFileStats(filterReviewableDiff(diff, isReviewable).diff)
        )
      const wholeSummary: Promise<WholeSummaryResult> | null = incrementalSlice
        ? prWholeSummaryService.summarizeWithDiagram({
            pullRequestId: pr.id,
            scanId,
            diff,
            isReviewable,
            tone: renderToneInstructions(
              reviewSettings.toneInstructions,
              guardPromptLineText
            ),
            ...(diagramWanted ? { withSequenceDiagram: true } : {}),
          })
        : null
      // LUM-1148 — the pre-merge checks run alongside the review, on every
      // head the AI review is allowed to read (the whole PR diff, not the
      // incremental scope). Never rejects; awaited before the result lands.
      const preMergeChecks = reviewAllowed
        ? preMergeChecksService.run(
            {
              scanId,
              pullRequestId: pr.id,
              workspaceId: pr.workspaceId,
              repo: pr.repo,
              prNumber: pr.number,
              headSha,
            },
            diff
          )
        : Promise.resolve(null)

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
        huntFiles.length > 0
          ? evaluateHuntTrigger({
              files: huntFiles,
              hasHighFinding: secretHigh,
              hasOpenL4Crossing: hasOpenCrossing,
            })
          : null
      // LUM-832: over the file cap the hunt will not run, so its VM is not
      // kept alive for it either.
      // LUM-1143: the hunt reads only reviewable source files.
      const huntSourcePaths = touchedSourcePaths.filter(isReviewable)
      const huntOverCap = huntSourcePaths.length > HUNT_MAX_HUNTED_FILES
      const huntWantedForVm =
        layers.hunt &&
        aiAllowed &&
        !huntOverCap &&
        (triggerFirstPass?.hunt ?? false)
      // LUM-1084: the agentic verifier no longer shares this VM. It starts
      // while the managed scan is still scanning, waited 30 s + 90 s for the
      // hand-off marker and then booted its own VM anyway; it now boots its
      // own at once (see the verifier start below), so the VM is kept alive
      // for the hunt only.

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
      // LUM-1150: "a minute from now" is not a promise — a run that lands
      // before this stage A persists has already synced; see the write-back
      // below.
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
            if (runId && huntWantedForVm) {
              keptVm = {
                scanId,
                workspaceId: pr.workspaceId,
                repo: pr.repo,
                prNumber: pr.number,
                headSha,
                managedScanStarted: true,
                stopAttachedWhenDone: true,
                releaseOnly: true,
              }
            }
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
          const last = await securityColumnsRepository.findLastSarifIngestAt(
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
      // The judge's own budget cut files (JUDGE_TRUNCATED) — unlike the size
      // cap's partial review (LUM-1144), its scope is not recorded per file.
      let packTruncated = false
      // LUM-814: what the budget pass decided, for the scan row. null until
      // the pass actually runs — a scan with no files never had a budget, and
      // "not recorded" is the honest reading of that, not a budget of zero.
      let judgeBudget: JudgeBudget | null = null
      // LUM-849: the judge's own description of the PR, for the summary
      // comment. Only a judge that answered writes one.
      let prSummary: PrSummary | null = null
      // LUM-1155: the cleaned call-flow diagram, when one was asked for.
      let sequenceDiagram: SequenceDiagram | null = null
      const judgeRows: NewFindingInput[] = []
      // LUM-832 / LUM-1144 — the AI review's cap: at most the top tier's
      // characters and `JUDGE_MAX_REVIEWED_FILES` files of the REVIEWABLE
      // diff (path filters already applied, so lockfiles and generated files
      // never count). Over it, the files that fit are reviewed and the rest
      // skipped by name — unless more than a quarter would be skipped: then
      // the review does not run at all (no model call, no tokens) and the
      // customer is told how to get it (narrow the scope or split the PR).
      const judgeCapChars =
        JUDGE_DIFF_BUDGET_TIERS[JUDGE_DIFF_BUDGET_TIERS.length - 1]!.chars
      // LUM-866: AI review off for the workspace = the judge is SKIPPED —
      // no model call, and no over-cap notice for a review nobody asked for.
      const reviewPlan =
        reviewAllowed && reviewFiles.length > 0
          ? planPartialReview(reviewDiff, {
              maxChars: judgeCapChars,
              maxFiles: JUDGE_MAX_REVIEWED_FILES,
              priorityPaths:
                triggerFirstPass?.sites.map(site => site.path) ?? [],
            })
          : null
      const judgeOverCap = reviewPlan?.kind === 'OVER_CAP'
      const partialOverCap = reviewPlan?.kind === 'PARTIAL'
      const overCap: JudgeOverCapRecord | null =
        reviewPlan && reviewPlan.kind !== 'WHOLE'
          ? {
              files: reviewPlan.totalFiles,
              capFiles: JUDGE_MAX_REVIEWED_FILES,
              capChars: judgeCapChars,
              skippedPaths: reviewPlan.skipped,
            }
          : null
      if (reviewPlan?.kind === 'OVER_CAP') {
        judgeBudget = {
          diffChars: reviewDiff.length,
          tierChars: judgeCapChars,
          reviewedChars: 0,
          coveredFiles: 0,
          droppedFiles: reviewPlan.totalFiles,
          ...(overCap ? { overCap } : {}),
        }
        partialCauses.push('JUDGE_OVER_CAP')
        logger.info(
          `[pr-security-scan] judge over cap pr=${pr.id} sha=${headSha} diffChars=${reviewDiff.length} cap=${judgeCapChars} files=${reviewPlan.totalFiles} capFiles=${JUDGE_MAX_REVIEWED_FILES} wouldSkip=${reviewPlan.skipped.length}: not run`
        )
      }
      // What the judge reads: the reviewable diff, or its in-cap part.
      let judgeDiff = reviewDiff
      if (reviewPlan?.kind === 'PARTIAL') {
        judgeDiff = reviewPlan.diff
        // Only the files actually read may close a finding (LUM-1127).
        reviewScope = new Set(reviewPlan.reviewed)
        partialCauses.push('JUDGE_PARTIAL_OVER_CAP')
        logger.info(
          `[pr-security-scan] judge partial pr=${pr.id} sha=${headSha} diffChars=${reviewDiff.length} files=${reviewPlan.totalFiles} reviewed=${reviewPlan.reviewed.length} skipped=${reviewPlan.skipped.length}`
        )
      }
      if (reviewAllowed && reviewFiles.length > 0 && !judgeOverCap) {
        // LUM-758: the budget is spent on WHOLE files, the ones the static
        // pass already flagged first — never on a character offset, which
        // made a file's coverage depend on where its name sorted.
        // LUM-811: 预算按 diff 自身的字符长度分档——选档量必须等于被配给量。
        // LUM-758 拿改动源文件数选档、发的却是字符预算，于是文件少而胖的 PR
        // 比文件多而瘦的 PR 拿到更少的预算；`judgeDiffTier` 现在只收 diff，
        // 再把别的量喂进来是 tsc 错误。天花板（180k / 180s）不动。
        const tier = judgeDiffTier(judgeDiff)
        const capped = packSecurityDiff(judgeDiff, {
          priorityPaths: triggerFirstPass?.sites.map(site => site.path) ?? [],
          maxChars: tier.chars,
        })
        packTruncated = capped.truncated
        truncated = capped.truncated || partialOverCap
        // LUM-814: recorded whether or not it truncated — the untruncated
        // case is the one the old `truncated` boolean could say nothing
        // about, and it is where the near-misses live.
        // LUM-1144: `diffChars` is the REVIEWABLE diff the tier was chosen
        // from (path filters / incremental scope applied), never the raw PR
        // diff — a filtered lockfile is not review input. Files the size cap
        // skipped count as dropped; filtered files are in neither number.
        judgeBudget = {
          diffChars: reviewDiff.length,
          tierChars: tier.chars,
          reviewedChars: capped.reviewedChars,
          coveredFiles: capped.covered.length,
          droppedFiles:
            capped.dropped.length +
            (reviewPlan?.kind === 'PARTIAL' ? reviewPlan.skipped.length : 0),
          ...(overCap ? { overCap } : {}),
        }
        if (capped.truncated) {
          // Coverage owed: the tier is a budget we chose (LUM-811), and the
          // dropped files are ours to review, not the PR's to shrink.
          partialCauses.push('JUDGE_TRUNCATED')
          logger.info(
            `[pr-security-scan] judge budget pr=${pr.id} sha=${headSha} tier=${tier.chars} diffChars=${judgeDiff.length} sourceFiles=${touchedSourcePaths.length} reviewed=${capped.covered.length} dropped=${capped.dropped.length}: ${capped.dropped.slice(0, 20).join(' ')}`
          )
        }
        // LUM-988 — the PR-head content of the files the review covers, as
        // context: one contents:read token for the scan (refused for an
        // unconfirmed repository, LUM-883), revoked after. The context shares
        // the prompt budget with the diff (`reviewContextBudget`), so a
        // top-tier diff gets little or none. Any failure is logged and the
        // review runs on the diff alone. Never throws.
        // LUM-1131 — what reviewers ruled intentional / not applicable in
        // this PR's threads and merged PRs' threads, for the files this review
        // reads. Bounded (≤ 4k chars) and paid for out of the context
        // budget, so the prompt ceiling holds. Never throws.
        const learnings = await loadReviewLearnings({
          workspaceId: pr.workspaceId,
          repo: pr.repo,
          pullRequestId: pr.id,
          reviewedPaths: capped.covered,
        })
        // LUM-1147 — the owners' instructions for the files this review
        // reads, and the tone: guarded, bounded, and paid for out of the
        // same context budget as the learnings.
        const { text: pathInstructions, sent: sentInstructions } =
          planPathInstructions(
            reviewSettings.pathInstructions,
            capped.covered,
            guardPromptLineText
          )
        const tone = renderToneInstructions(
          reviewSettings.toneInstructions,
          guardPromptLineText
        )
        // LUM-1208 — when the reviewed lines start or configure a server,
        // the config files next to it that the PR does not change (a
        // Trunk.toml binding 0.0.0.0), read-only: ≤ 8k chars, masked, paid
        // for first out of the same context budget. No trigger, no token.
        const serverConfigPlan = planServerConfigContext(capped.text)
        const serverConfig =
          serverConfigPlan.triggers.length > 0
            ? await reviewContextService.loadServerConfig({
                workspaceId: pr.workspaceId,
                repo: pr.repo,
                headSha,
                plan: serverConfigPlan,
                changedPaths: files.map(f => f.path),
                maxChars: Math.min(
                  SERVER_CONFIG_MAX_CHARS,
                  reviewContextBudget(
                    capped.text.length +
                      learnings.length +
                      pathInstructions.length +
                      tone.length
                  )
                ),
              })
            : null
        if (serverConfig?.error) {
          logger.warn(
            `[pr-security-scan] server config context unavailable pr=${pr.id} sha=${headSha}: ${serverConfig.error}`
          )
        }
        const serverConfigText = serverConfig?.text ?? ''
        if (serverConfig && serverConfig.included.length > 0 && judgeBudget) {
          judgeBudget = {
            ...judgeBudget,
            serverConfig: {
              paths: serverConfig.included,
              chars: serverConfigText.length,
            },
          }
          logger.info(
            `[pr-security-scan] server config context pr=${pr.id} sha=${headSha} chars=${serverConfigText.length} files=${serverConfig.included.join(' ')}`
          )
        }
        const context = await reviewContextService.load({
          workspaceId: pr.workspaceId,
          repo: pr.repo,
          headSha,
          paths: capped.covered,
          maxChars: reviewContextBudget(
            capped.text.length +
              learnings.length +
              pathInstructions.length +
              tone.length +
              serverConfigText.length
          ),
        })
        if (context.error) {
          logger.warn(
            `[pr-security-scan] review context unavailable pr=${pr.id} sha=${headSha}: ${context.error} — reviewing the diff only`
          )
        }
        try {
          // Dynamic import keeps @ai-sdk/gateway out of the static graph.
          const { judgeSecurity } =
            await import('@/ee/security/llm/security-judge-client')
          // LUM-784: the diff is untrusted text about to enter a model's
          // context — every registry secret is masked before the judge sees
          // it. Secrets are stage A's job (deterministic, above); the judge
          // still sees the `AKIA…(len 20)` shape if it wants to reason about
          // a hardcoded credential, it just never sees the value.
          const {
            findings,
            prSummary: rawSummary,
            sequenceDiagram: rawDiagram,
          } = await judgeSecurity({
            diff: redactForInjection(capped.text).text,
            timeoutMs: tier.timeoutMs,
            // Customer files entering a prompt: same mask as the diff.
            context: redactForInjection(context.text).text,
            ...(learnings ? { learnings } : {}),
            ...(pathInstructions ? { pathInstructions } : {}),
            ...(tone ? { tone } : {}),
            // LUM-1208: masked by the loader, like the file context here.
            ...(serverConfigText ? { serverConfig: serverConfigText } : {}),
            // LUM-1155: an incremental slice's diagram would describe the
            // slice — that review's diagram comes from the whole-PR call.
            ...(diagramWanted && !incrementalSlice
              ? { withSequenceDiagram: true }
              : {}),
          })
          judgeStatus = 'RAN'
          // Model text headed for a public PR: redacted and neutralised here,
          // and again on read (`parsePrSummary`).
          prSummary = cleanPrSummary(rawSummary)
          if (diagramWanted && !incrementalSlice)
            sequenceDiagram = cleanSequenceDiagram(rawDiagram)
          // LUM-1212: a finding the model returned without a line gets the
          // line its quoted evidence sits on (exact, else none — never a
          // guess). The fingerprint below still keys on the model's own
          // output, so an existing finding keeps its identity.
          const anchorLine = createFindingAnchor(
            rightSideLinesWithNumbers(diff)
          )
          const modelLines: Array<number | null> = []
          const anchored: Record<FindingAnchorMethod, number> = {
            model: 0,
            evidence: 0,
            hunk: 0,
            none: 0,
          }
          for (const j of findings) {
            const isCredential = j.kind === 'hardcoded_credential'
            // LUM-988: a correctness finding is CORRECTNESS / `review:<kind>`,
            // never VULNERABILITY — the panel and the PR comment label it as
            // a bug, not a security defect. Still LLM_JUDGE, so advisory.
            const isBug = isBugKind(j.kind)
            const ruleId = isCredential
              ? 'secret:llm-hardcoded-credential'
              : isBug
                ? `review:${j.kind}`
                : `vuln:${j.kind}`
            // EVERY free-text field the judge authored is redacted, not just
            // `evidence` (LUM-732 review C1). The model echoes the offending
            // line wherever it likes — a title quoting the key, a detail
            // spelling it out, a hallucinated path with a token in it — so
            // redacting one field left the raw secret in the other three.
            // Every pass runs every pattern over the text and ends with a
            // quoted-span pass; LUM-1013 / LUM-1200: the prose variants, so
            // quoted prose and inline code stay readable while
            // credential-shaped and credential-keyed values are still masked.
            const filePath = redactKnownSecrets(j.filePath)
            // LUM-1200 follow-up: the title and detail are prose about the
            // code (`redactFindingProse`); the evidence is the code line itself and
            // keeps the stricter pass.
            const title = redactFindingProse(j.title, isCredential)
            const evidence = redactFindingText(j.evidence)
            // The fingerprint keeps the blanket-masked evidence it has always
            // been keyed on (still redacted, never raw), so findings from
            // scans before LUM-1013 keep their key and a human's
            // FALSE_POSITIVE is still inherited — and, with no evidence, the
            // title it has always fallen back to.
            const fingerprintEvidence = redactKnownSecrets(j.evidence)
            const fingerprintTitle = redactFindingText(j.title)
            const anchor = anchorLine({
              line: j.line,
              filePath,
              evidence: j.evidence,
            })
            anchored[anchor.method]++
            modelLines.push(j.line)
            // LUM-1150: the one-click fix, only when its range is exactly
            // this head's added lines around the finding; else none.
            const codeSuggestion = validateCodeSuggestion({
              suggestion: j.suggestion,
              line: anchor.line,
              severity: j.severity,
              filePath,
              evidence: j.evidence,
              files,
              // The file as read at this head (the review's context), so a
              // name imported outside the diff is known to be in scope.
              fileText: packedFileBody(context, filePath),
            })
            // LUM-1147: the path instruction the model says this finding
            // applies — kept only when it was sent and matches this file.
            const pathInstruction = verifyPathInstructionClaim(
              j.instruction,
              filePath,
              sentInstructions,
              guardPromptLineText
            )
            judgeRows.push({
              scanId,
              kind: isCredential
                ? 'SECRET'
                : isBug
                  ? 'CORRECTNESS'
                  : 'VULNERABILITY',
              ruleId,
              severity: j.severity,
              provenance: 'LLM_JUDGE',
              filePath,
              line: anchor.line,
              title,
              detail: redactFindingProse(j.detail, isCredential),
              evidence,
              // LUM-988: keyed on the quoted line, not the re-worded title;
              // repeats are made positional below.
              fingerprint: judgeFindingFingerprint(
                ruleId,
                filePath,
                fingerprintEvidence,
                fingerprintTitle
              ),
              externalRef: null,
              disposition: null,
              ...(codeSuggestion ? { codeSuggestion } : {}),
              ...(pathInstruction ? { pathInstruction } : {}),
            })
          }
          // LUM-988: one key per finding, by position (see positionalFingerprints).
          // LUM-1212: the position is the MODEL's line, as before the anchor.
          positionalFingerprints(
            judgeRows.map((r, i) => ({ ...r, line: modelLines[i] ?? null }))
          ).forEach((fp, i) => {
            judgeRows[i]!.fingerprint = fp
          })
          if (anchored.evidence + anchored.hunk + anchored.none > 0)
            logger.info(
              `[pr-security-scan] anchored line-less findings pr=${pr.id} sha=${headSha} evidence=${anchored.evidence} hunk=${anchored.hunk} none=${anchored.none}`
            )
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
      // Keep previous AI findings until explicit verification rejects them.
      // Absence from an incremental scope is never evidence of a fix.
      const carried =
        manualFindings ??
        (await prReviewControlRepository.priorFindings(pr.id, scanId))
      const seen = new Set(judgeRows.map(row => row.fingerprint))
      // A complete judge pass over a finding's file that does not report it
      // again closes it: that file was re-read, not merely left out of scope.
      // LUM-1144: a partial review over the size cap closes only within its
      // reviewed files (`reviewScope`); a skipped file is never re-read.
      const judgeCompleted = judgeStatus === 'RAN' && !packTruncated
      for (const finding of carried) {
        if (finding.verifierVerdict === 'REJECTED') continue
        if (seen.has(finding.fingerprint)) continue
        if (
          judgeCompleted &&
          (reviewScope === null || reviewScope.has(finding.filePath))
        )
          continue
        judgeRows.push({
          scanId,
          kind: finding.kind,
          ruleId: finding.ruleId,
          severity: finding.severity,
          provenance: finding.provenance,
          filePath: finding.filePath,
          line: finding.line,
          title: finding.title,
          detail: finding.detail,
          evidence: finding.evidence,
          fingerprint: finding.fingerprint,
          externalRef: finding.externalRef,
          disposition: finding.disposition,
          dispositionNote: finding.dispositionNote,
          dispositionedById: finding.dispositionedById,
          dispositionedAt: finding.dispositionedAt,
          suggestedDisposition: finding.suggestedDisposition,
          suggestedReason: finding.suggestedReason,
          suggestionOutcome: finding.suggestionOutcome,
          cwe: finding.cwe,
          reachability: finding.reachability,
          falsifierVerdict: finding.falsifierVerdict,
          persisting: finding.persisting,
          inheritedFromFindingId: finding.id,
          // LUM-1147: still the finding a path instruction asked for — only
          // while that instruction is still configured for its file.
          pathInstruction: verifyPathInstructionClaim(
            finding.pathInstruction,
            finding.filePath,
            reviewSettings.pathInstructions,
            guardPromptLineText
          ),
          ...(Array.isArray(finding.callChain)
            ? {
                callChain: finding.callChain as Array<{
                  from: string
                  to: string
                }>,
              }
            : {}),
          secretDowngrade:
            finding.secretDowngrade as SecretDowngradeReason | null,
        })
      }
      stages.judge = layers.aiReviewTurnedOff
        ? 'DISABLED'
        : layers.aiReview && reviewPaused
          ? 'PAUSED'
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
        files: huntFiles,
        hasHighFinding:
          secretHigh || judgeRows.some(r => r.severity === 'HIGH'),
        hasOpenL4Crossing: hasOpenCrossing,
      })
      const huntWanted =
        layers.hunt &&
        aiAllowed &&
        huntFiles.length > 0 &&
        huntTrigger.hunt &&
        !huntOverCap
      // Off (LUMO_SECURITY_HUNT=off, or the workspace's hunt switch — LUM-866)
      // = no hunt layer at all, not a SKIPPED one: the key is stamped only
      // when the layer exists for this PR.
      if (layers.hunt)
        stages.hunt = !aiAllowed ? 'PAUSED' : huntWanted ? 'PENDING' : 'SKIPPED'
      // LUM-892: the platform offers the hunt but the customer turned it
      // off — the layer is shown as off in settings rather than vanishing,
      // so a reader can tell "not checked" from "nothing to check".
      else if (layers.huntTurnedOff) stages.hunt = 'DISABLED'
      // LUM-1234: the reward-hack layer ("Agent behavior") reads the agent
      // sessions behind the PR, so a PR with no task has nothing to judge.
      // It runs after this result is persisted (below), like the hunt. With
      // the platform switch off (LUMO_REWARD_HACK) there is no layer at all,
      // as for the hunt: a NOT_CONFIGURED key would read every scan as
      // unfinished while the layer is not offered.
      // R12: held by the same pause / ignore / hourly cap as the AI review.
      if (layers.rewardHack)
        stages.rewardHack = !pr.taskId
          ? 'SKIPPED'
          : !aiAllowed
            ? 'PAUSED'
            : 'PENDING'
      else if (layers.rewardHackTurnedOff) stages.rewardHack = 'DISABLED'
      // LUM-832 — a hunt the trigger wanted but the file cap forbids does not
      // run (an industry-standard file cap): recorded, with the numbers the
      // customer's notice needs. A diff with no hunt signal is SKIPPED plain.
      const huntSkippedForCap =
        layers.hunt &&
        aiAllowed &&
        huntFiles.length > 0 &&
        huntTrigger.hunt &&
        huntOverCap
      if (huntSkippedForCap) partialCauses.push('HUNT_OVERSIZED')

      // LUM-1148: the checks' results are on the row before the write-back.
      await preMergeChecks
      // LUM-1151: an incremental slice's summary never reaches the PR.
      if (wholeSummary) {
        const whole = await wholeSummary
        prSummary = whole.summary
        sequenceDiagram = whole.sequenceDiagram
      }
      const prior =
        await prSecurityScanRepository.findDispositionedByPullRequest(pr.id)
      const rows = inheritDispositions(
        [...secretRows, ...graphRows, ...judgeRows],
        [...(manualFindings ?? []), ...prior]
      )

      // `status` stays "are there findings" (732 semantics — FAILED still
      // means the worker itself broke and is re-run in place). Whether the
      // scan may be READ as a full pass is `stages` → view.complete. Rows
      // written by the SARIF ingest worker (EXTERNAL_TOOL) are counted via
      // `externalCount`, not `rows` — stage A never re-reads or re-persists
      // them.
      const status: 'CLEAN' | 'FINDINGS' =
        rows.length + externalCount > 0 ? 'FINDINGS' : 'CLEAN'
      if (
        (await fetchPrHeadSha({
          workspaceId: pr.workspaceId,
          fullName: pr.repo,
          prNumber: pr.number,
        })) !== headSha
      )
        throw new HeadMovedError('PR head changed before review completed')
      // Spec §6.1: findings and the status describing them are ONE write, so a
      // crash between them can never leave a FINDINGS scan with no rows (or
      // rows nobody can see under a scan still RUNNING).
      const persisted = await prSecurityScanRepository.persistResult(
        scanId,
        rows,
        {
          ...(manualFindings !== undefined
            ? { replaceStageAFindings: true }
            : {}),
          status,
          judgeStatus,
          truncated,
          judgeBudget,
          prSummary,
          // LUM-1155: like prSummary — null leaves the column alone.
          sequenceDiagram,
          // LUM-1127: which files this head's AI review read — the PR
          // write-back only resolves a judge thread for a file it covered.
          judgeReviewScope: reviewScope ? [...reviewScope].sort() : null,
          // LUM-1215: the files the path filters skipped (null = none).
          reviewPathSkips,
          // LUM-1152 follow-up: a deferred full review is satisfied only by a
          // full one (user ruling).
          judgeReviewMode:
            judgeStatus === 'RAN'
              ? input.reviewMode === 'full'
                ? 'full'
                : 'incremental'
              : null,
          stages,
          partialCauses,
          ...(huntSkippedForCap
            ? {
                huntAudit: {
                  overCap: {
                    sourceFiles: huntSourcePaths.length,
                    capFiles: HUNT_MAX_HUNTED_FILES,
                  },
                },
              }
            : {}),
          ...(externalError ? { error: externalError } : {}),
        }
      )
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
          // LUM-1143: only the reviewable ones (path filters).
          touchedSourcePaths: huntSourcePaths,
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
        const huntBatches = planHuntBatches(huntSourcePaths, huntTrigger.sites)
        if (huntBatches) {
          huntJob.batches = huntBatches
          huntJob.batchIndex = 0
        }
        const runId = await startSecurityHunt(huntJob)
        if (runId) {
          huntRunStarted = true
          vmConsumerStarted = true
          await recordHuntStartBestEffort(scanId, huntJob, runId)
        } else
          await prSecurityScanRepository.mergeStages(scanId, { hunt: 'FAILED' })
      }
      // LUM-988: the AI review's findings go to the agentic verifier. Marked
      // BEFORE the sync below, so every write-back from here on holds the
      // LLM_JUDGE inline comments until it finishes (or VERIFIER_HOLD_MS).
      // A run that cannot be queued releases the hold at once.
      // Only when some row is one the verifier may reject (non-HIGH bug): a
      // scan of security / HIGH findings has nothing for it to change.
      if (
        reviewAllowed &&
        judgeRows.some(r => verifierAppliesTo(r)) &&
        isReviewVerifierEnabled()
      ) {
        await startVerifierBestEffort({
          scanId,
          workspaceId: pr.workspaceId,
          repo: pr.repo,
          prNumber: pr.number,
          headSha,
          // LUM-1084: boot its own VM at once — never wait on the managed
          // scan's (that wait cost ~2 min per scan and lost the race in the
          // LUM-1084 production logs). Not a consumer of the kept VM either,
          // which is released below when the hunt did not start.
          managedScanStarted: false,
          stopAttachedWhenDone: false,
        })
      }
      if (keptVm && !vmConsumerStarted) await releaseKeptVmBestEffort(keptVm)
      // LUM-1234: the row is settled — the reward-hack layer runs in the
      // background and syncs the PR summary itself when its verdict lands.
      if (stages.rewardHack === 'PENDING')
        waitUntil(startRewardHackLayer(scanId, persisted?.startedAt))
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
      // LUM-1150: unless the managed run already landed — its one sync may
      // have read the row before this result was on it (probe PR #59: the
      // summary stayed "still running"). The hunt starts only after the
      // persist above, so its sync always reads the result.
      // `?.`: a caller's mock may resolve nothing.
      const managedAlreadyLanded = persisted?.managedLayerLanded === true
      if (
        (!huntRunStarted && (!managedRunStarted || managedAlreadyLanded)) ||
        blocksDone
      ) {
        waitUntil(securityPrReviewService.sync(scanId))
      }
      return { deduped: false, scanId, status, findings: rows.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        `[pr-security-scan] scan failed pr=${pr.id} sha=${headSha}: ${message}`
      )
      // A newer push superseded this head before its review landed. The
      // round was never delivered, so it goes back to the budget.
      if (reservedHead && error instanceof HeadMovedError)
        await prReviewControlRepository.release(pr.id, headSha)
      // LUM-739: a hunt that was never started must not read as "scanning".
      if (stages.hunt === 'PENDING') delete stages.hunt
      // LUM-1234: nor the reward-hack layer, which starts after the persist.
      if (stages.rewardHack === 'PENDING') delete stages.rewardHack
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
      // LUM-988: the VM kept alive for a consumer that will now never run.
      if (keptVm && !vmConsumerStarted) await releaseKeptVmBestEffort(keptVm)
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
    const [controls, workspaceLimit] = await Promise.all([
      Promise.all(prs.map(pr => prReviewControlRepository.get(pr.id))),
      prs.length > 0
        ? securityColumnsRepository.findReviewAutoPauseAfter(
            prs[0]!.workspaceId
          )
        : Promise.resolve(DEFAULT_AUTO_PAUSE_AFTER),
    ])
    for (const pr of prs) {
      const scan = latest.get(pr.id)
      const view = scan
        ? toScanView(scan, policy, await countFixed(scan), f =>
            queueExitOf(f, pr, exitContexts, policy)
          )
        : null
      if (view && pr.headSha && scan?.headSha !== pr.headSha) {
        view.complete = false
        view.coverage = 'UNFINISHED'
        view.ownedUnfinished = false
      }
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
      const control = controls[prs.indexOf(pr)]!
      out.push({
        pr,
        latest: view,
        // LUM-1137: reviewed commits against the PR's (else the
        // workspace's) pause-after; limit 0 = never pauses.
        reviewControl: reviewBudgetView(control, workspaceLimit),
      })
    }
    return {
      prs: out,
      blocking: { count },
      suggested: { count: suggested },
      scanningOff,
    }
  },

  /**
   * LUM-1128 — every finding on the task's latest scan per PR, flat, in the
   * shape the CLI envelope shows. Same read model as the panel (`getForTask`),
   * so `blocking` here is exactly what the DONE gate counts.
   */
  async listFindingsForTask(taskId: string): Promise<CliFindingRow[]> {
    const view = await this.getForTask(taskId)
    const rows: CliFindingRow[] = []
    for (const { pr, latest } of view.prs) {
      if (!latest) continue
      for (const f of latest.findings) {
        rows.push({
          id: f.id,
          severity: f.severity,
          provenance: f.provenance,
          ruleId: f.ruleId,
          filePath: f.filePath,
          line: f.line,
          title: redactForInjection(sanitizeField(f.title)).text,
          statement: findingStatement({
            ...f,
            prNumber: pr.number,
          }),
          prNumber: pr.number,
          disposition: f.disposition,
          blocking: f.blocking,
        })
      }
    }
    return rows
  },

  async disposition(
    taskId: string,
    findingId: string,
    disposition: FindingDisposition,
    note: string | null,
    actorMemberId: string,
    audit: WorkspaceAudit,
    via: FindingDispositionVia = WEB_VIA
  ): Promise<SecurityFindingView> {
    const finding = await findFindingOnTask(taskId, findingId)
    const actor = await memberRepository.findActorByMemberId(actorMemberId)
    // LUM-1128 follow-up: the ruling and its timeline entry are one
    // transaction, and `from` is read inside it — a failed activity insert
    // rolls the ruling back instead of leaving it applied behind a 500.
    // Like crossings, a ruling that leaves the disposition unchanged (a
    // re-save of the same value, e.g. to edit the note) gets no entry.
    const { row: updated, from } =
      await prSecurityScanRepository.updateDisposition(
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
        },
        prior =>
          prior === disposition
            ? null
            : findingRulingActivity(taskId, finding, actor?.id ?? null, {
                from: prior,
                to: disposition,
                via,
              })
      )
    // LUM-907: ids and enum values only — the note stays on the finding.
    // Recorded after the commit; `recordAuditEvent` never throws.
    if (from !== disposition) {
      await recordAuditEvent({
        workspaceId: audit.workspaceId,
        action: 'security_finding.dispositioned',
        target: { type: 'security_finding', id: findingId },
        metadata: { taskId, from, to: disposition },
        context: audit.context,
      })
    }
    return toFindingView(
      updated,
      await loadSecurityPolicy(finding.scan.pullRequest.workspaceId)
    )
  },

  /**
   * LUM-1128 follow-up — revert a ruling to open (the web panel's "Reopen").
   * Web only, like a crossing's OPEN revert: the route refuses it from a
   * bearer (CLI) caller. The finding is undecided again, so it blocks DONE
   * exactly as before it was ruled (same `isBlockingFinding`), and the row
   * keeps `dispositionedAt` = now with `disposition` null — the reopen
   * marker `findDispositionedByPullRequest` returns, so the next push does
   * not re-inherit an older ruling of the same fingerprint. The suggestion
   * (if any) stays, its outcome back to pending. An already-open finding is
   * a no-op (nothing written, nothing audited).
   */
  async reopen(
    taskId: string,
    findingId: string,
    actorMemberId: string,
    audit: WorkspaceAudit
  ): Promise<SecurityFindingView> {
    const finding = await findFindingOnTask(taskId, findingId)
    const policy = await loadSecurityPolicy(
      finding.scan.pullRequest.workspaceId
    )
    if (finding.disposition === null) return toFindingView(finding, policy)
    const actor = await memberRepository.findActorByMemberId(actorMemberId)
    const { row: updated, from } =
      await prSecurityScanRepository.updateDisposition(
        findingId,
        {
          disposition: null,
          dispositionNote: null,
          dispositionedById: actorMemberId,
          dispositionedAt: new Date(),
          suggestionOutcome: null,
        },
        prior =>
          prior === null
            ? null
            : findingRulingActivity(taskId, finding, actor?.id ?? null, {
                from: prior,
                to: 'OPEN',
                via: WEB_VIA,
              })
      )
    if (from !== null) {
      await recordAuditEvent({
        workspaceId: audit.workspaceId,
        action: 'security_finding.dispositioned',
        target: { type: 'security_finding', id: findingId },
        metadata: { taskId, from, to: 'OPEN' },
        context: audit.context,
      })
    }
    return toFindingView(updated, policy)
  },

  /**
   * LUM-740 — "confirm all suspected false positives": every undispositioned
   * finding on the task's PRs that the falsifier suggested as a false
   * positive is dispositioned FALSE_POSITIVE with outcome CONFIRMED, in one
   * write. Human-only by the route's red line; the actor is stamped.
   */
  async dispositionSuggested(
    taskId: string,
    actorMemberId: string,
    audit: WorkspaceAudit
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
    // Only undispositioned suggestions are written, so `confirmed` counts
    // real changes: nothing confirmed = nothing changed = no audit row.
    if (confirmed > 0) {
      await recordAuditEvent({
        workspaceId: audit.workspaceId,
        action: 'security_finding.suggestions_confirmed',
        target: { type: 'task', id: taskId },
        metadata: { confirmed, disposition: 'FALSE_POSITIVE' },
        context: audit.context,
      })
    }
    return { confirmed }
  },
}
