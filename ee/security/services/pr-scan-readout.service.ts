/**
 * LUM-788 — the by-PR security-scan read-out behind `lumo pr scan <number>`.
 *
 * Until now a SaaS user could only see a scan through `lumo task status`
 * (one summary line per linked PR) — nothing per PR, nothing for a PR whose
 * title carries no `[LUM-N]`, and none of the `huntAudit` the L3 layer
 * persists (per-task commands, trace, stop arithmetic, sites, model, diff
 * sizing). This service reads all of it, read-only and LLM-free, so the
 * route can import it statically (the same boundary as
 * `pr-security-reminder.service.ts`; `pr-security-scan.service.ts` reaches
 * the LLM gateway and stays behind a dynamic import).
 *
 * Honesty rules inherited from LUM-732/737: a FAILED / never-run layer is
 * "could not confirm", never "clean"; the external-scanner reason is
 * published only in its prefixed, scrubbed form (P8); finding `evidence`
 * never leaves the server (the repository never loads it); disposition is a
 * human-only column this read-out reports and never touches.
 */
import { isVerifierRejected } from '@/ee/security/security-scan/verifier'
import { scanSizeCaps } from '@/ee/security/security-scan/size-caps'
import { parseReviewPathSkips } from '@/ee/security/security-scan/reviewable-path'
import type {
  HuntOverCapInput,
  JudgeOverCapInput,
  JudgePartialInput,
  PrTooLargeInput,
  ReviewPathSkipsInput,
} from '@/shared/src/security-scan'
import {
  prSecurityScanRepository,
  type FindingDisposition,
  type FindingKind,
  type FindingProvenance,
  type FindingSeverity,
  type ReadoutFindingRow,
  type ScanReadoutRow,
  type ScanStatus,
  type ScanTrigger,
  type JudgeStatus,
  type FalsifierVerdict,
  type FindingReachability,
  type SuggestionOutcome,
} from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  isBlockingFinding,
  loadQueueExitContexts,
  loadSecurityPolicy,
  queueExitOf,
} from '@/ee/security/services/pr-security-scan-gate'
import type { QueueExitReason } from '@/ee/security/security-scan/queue-exit'
import { stagesOf } from '@/ee/security/security-scan/stages'
import { externalFailureReason } from '@/shared/src/security-scan'
import {
  parseHuntCoverage,
  type HuntCoverage,
} from '@/ee/security/security-scan/hunt/coverage'
import {
  parseJudgeBudget,
  type JudgeBudget,
} from '@/ee/security/security-scan/judge-budget'
import type {
  ScanStages,
  SecretDowngradeReason,
} from '@/ee/security/security-scan/types'
import { redactPromptLine } from '@/lib/security-scan/inject-guard'
import { sanitizeField } from '@/lib/utils/sanitize'
import { loadSecurityLayers } from '@/ee/security/services/security-workspace-switches.service'
import type { ShellDetailTask } from '@/shared/src/hunt-audit'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import {
  reviewBudgetView,
  type ReviewBudgetView,
} from '@/ee/security/security-scan/review-control'

export interface PullRequestScanReadoutInput {
  number: number
  /** `owner/repo` — required only when the number exists in several repos. */
  repo?: string | undefined
  /** true = every head's scan newest-first; false = the latest head only. */
  all: boolean
}

/**
 * Where a finding's disposition came from. `HUMAN` = a member ruled on this
 * row; `INHERITED` = copied from an earlier scan of the same PR (same
 * fingerprint); `SUGGESTED_CONFIRMED` = the LLM suggested it and a human
 * confirmed. Never an LLM verdict on its own — a suggestion that was not
 * confirmed leaves `disposition` null and shows up as `suggestedDisposition`.
 */
export type DispositionSource = 'HUMAN' | 'INHERITED' | 'SUGGESTED_CONFIRMED'

export interface FindingReadoutView {
  id: string
  kind: FindingKind
  ruleId: string
  severity: FindingSeverity
  provenance: FindingProvenance
  filePath: string
  line: number | null
  title: string
  detail: string
  externalRef: string | null
  disposition: FindingDisposition | null
  dispositionSource: DispositionSource | null
  dispositionNote: string | null
  dispositionedAt: string | null
  /** Undispositioned, not persisting, still in the queue, and the policy blocks DONE on it. */
  blocking: boolean
  /** Undispositioned, not persisting, still in the queue (advisory or blocking). */
  open: boolean
  /** LUM-738 — already on the default-branch baseline; not introduced here. */
  persisting: boolean
  /** LUM-775 — why an undispositioned row left the queue (merged/closed PR). */
  queueExit: QueueExitReason | null
  falsifierVerdict: FalsifierVerdict | null
  suggestedDisposition: FindingDisposition | null
  /**
   * LUM-988 — the agentic verifier's verdict on an LLM_JUDGE row (null = not
   * verified) and its one-sentence reason. A REJECTED row is never `open`.
   */
  verifierVerdict: 'CONFIRMED' | 'REJECTED' | null
  verifierReason: string | null
  suggestionOutcome: SuggestionOutcome | null
  secretDowngrade: SecretDowngradeReason | null
  cwe: string | null
  reachability: FindingReachability | null
  /**
   * LUM-1189 — the hunt's source→sink call chain (each hop sanitized and
   * capped); null on non-hunt rows. The web panel's chain, for the CLI.
   */
  callChain: Array<{ from: string; to: string }> | null
  /** LUM-1189 — why the falsifier suggested `suggestedDisposition` (sanitized). */
  suggestedReason: string | null
}

/** The scan-level hunt facts `lumo pr scan --full` prints, read off `huntAudit`. */
export interface HuntReadoutView {
  /** LUM-762 per-task coverage; null when the audit holds nothing usable. */
  coverage: HuntCoverage | null
  plannedBy: string | null
  plannedReason: string | null
  /** LUM-787 — what the hunt was sized to. Absent on rows before the allocator. */
  diff: {
    sourceFiles: number
    sites: number
    taskCap: number
    oversized: boolean
  } | null
  candidates: number | null
  falsifierRejects: number | null
  mechanicallyRejected: number | null
  /**
   * LUM-798 — how the mechanical gate placed each candidate's sink. Absent on
   * scans written before the gate counted it.
   *
   * Two shapes, told apart by `kind` rather than by guessing: `legacy` rows
   * counted a placement only when the candidate ALSO survived every later
   * check, so their tier numbers understate placement and cannot be added to
   * a `placement` row's. Keeping them distinct is the point — silently
   * summing the two would restate the very error the follow-up fixed.
   */
  resolution: ResolutionReadout | null
  /** The layer's own failure reason (P9: lives in the audit, not the shared `error` column). */
  error: string | null
  /** The raw per-task rows (commands, trace, stop, wrap-up, sites, model), free text redacted. */
  tasks: ShellDetailTask[]
}

export interface ScanReadoutView {
  id: string
  headSha: string
  status: ScanStatus
  trigger: ScanTrigger
  judgeStatus: JudgeStatus | null
  truncated: boolean
  stages: ScanStages
  partial: boolean
  /** LUM-832 — why it is not whole (drives owned vs over-cap wording). */
  partialCauses: string[]
  /** LUM-832 — the hunt did not run: over its file cap. null otherwise. */
  huntOverCap: HuntOverCapInput | null
  /** LUM-832 — the AI review did not run: over its size cap. null otherwise. */
  judgeOverCap: JudgeOverCapInput | null
  /** LUM-1144 — the AI review ran on part of an over-cap diff (skipped files named). null otherwise. */
  judgePartial: JudgePartialInput | null
  /** LUM-1079 — the whole PR was too large to scan. null otherwise. */
  prTooLarge: PrTooLargeInput | null
  /**
   * LUM-1215 — what the path filters left out of the AI review (built-in
   * skips named, terminal-sanitised; the repository's own counted). null =
   * nothing skipped, or not recorded.
   */
  reviewPathSkips: ReviewPathSkipsInput | null
  /** P8 — the scrubbed external-scanner reason, or null (raw crash text is never published). */
  externalFailureReason: string | null
  startedAt: string
  finishedAt: string | null
  /** null = not metered (team rule: null ≠ 0). */
  tokenSpent: number | null
  /**
   * LUM-814 — the judge's budget arithmetic; null = not recorded on this scan
   * (a row written before the column existed, or a scan whose judge never
   * reached the budget step). null is never "spent nothing".
   */
  judgeBudget: JudgeBudget | null
  counts: {
    findings: number
    open: number
    blocking: number
    dispositioned: number
    persisting: number
    /** EXTERNAL_TOOL rows that are not dependencies (the Code-scan decoration). */
    externalFindings: number
    /** DEPENDENCY rows (osv-scanner), regardless of disposition. */
    dependencyFindings: number
  }
  /** LUM-775 — rows that left the queue, by reason; `{}` on an open PR. */
  queueExits: Partial<Record<QueueExitReason, number>>
  findings: FindingReadoutView[]
  hunt: HuntReadoutView | null
}

export interface PullRequestScanReadout {
  reviewControl?: ReviewBudgetView & { currentHead: string | null }
  version: 1
  pullRequest: {
    repo: string
    number: number
    title: string
    url: string
    state: string
    /** `LUM-42`, or null for a PR no task is linked to. */
    task: { identifier: string } | null
  }
  /** Newest first. One entry (the latest head) unless `all` was requested. */
  scans: ScanReadoutView[]
  all: boolean
  /** LUM-784 — registry secrets redacted from free text before it left the server. */
  redactedSecrets: number
  /**
   * LUM-901 — the workspace has scanning turned off: the scans here are for
   * earlier commits and no longer vouch for the PR. Additive.
   */
  scanningOff: boolean
}

/**
 * LUM-1189 — `GET /api/tasks/[id]/security-scans` for a bearer caller (or
 * `?view=readout`): every PR linked to the task, each the same read-out
 * `lumo pr scan` prints, plus totals off each PR's latest scan.
 */
export interface TaskScanReadout {
  version: 1
  task: { identifier: string }
  /** Newest PR first. Empty when no PR is linked to the task. */
  pullRequests: PullRequestScanReadout[]
  totals: {
    pullRequests: number
    /** PRs with at least one scan on record. */
    scanned: number
    /** Open findings on the latest scan of each PR. */
    open: number
    /** Findings that block DONE on the latest scan of each PR. */
    blocking: number
  }
  all: boolean
  /** Sum of the per-PR `redactedSecrets`. */
  redactedSecrets: number
  scanningOff: boolean
}

const DETAIL_MAX = 600
const TRACE_TEXT_MAX = 400
const CMD_MAX = 400
/** LUM-1189 — one call-chain hop is a symbol / file:line, never prose. */
const HOP_MAX = 200
/** LUM-1189 — hops printed per chain; the rest is elided with a marker. */
const CHAIN_MAX_HOPS = 20

/**
 * One free-text field on its way to an agent's terminal: control characters
 * stripped, registry secrets masked (LUM-784), length capped. The count is
 * accumulated by the caller so the CLI can print one notice for the payload.
 */
function cleanText(
  value: unknown,
  max: number,
  tally: { redacted: number }
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const r = redactPromptLine(sanitizeField(value))
  if (r.marker) tally.redacted += 1
  return r.text.length > max ? `${r.text.slice(0, max)}…` : r.text
}

/**
 * LUM-1189 — the stored `callChain` Json as the read-out prints it: hops of
 * the right shape only, each through `cleanText`, at most CHAIN_MAX_HOPS
 * (an elided tail is one `…` hop). null when the row carries none.
 */
export function readCallChain(
  raw: unknown,
  tally: { redacted: number }
): Array<{ from: string; to: string }> | null {
  if (!Array.isArray(raw)) return null
  const hops: Array<{ from: string; to: string }> = []
  for (const hop of raw) {
    if (hop === null || typeof hop !== 'object') continue
    const h = hop as Record<string, unknown>
    const from = cleanText(h.from, HOP_MAX, tally)
    const to = cleanText(h.to, HOP_MAX, tally)
    if (from === undefined || to === undefined) continue
    hops.push({ from, to })
  }
  if (hops.length === 0) return null
  if (hops.length > CHAIN_MAX_HOPS) {
    const kept = hops.slice(0, CHAIN_MAX_HOPS)
    kept.push({ from: '…', to: `${hops.length - CHAIN_MAX_HOPS} more hops` })
    return kept
  }
  return hops
}

function dispositionSourceOf(f: ReadoutFindingRow): DispositionSource | null {
  if (f.disposition === null) return null
  if (f.inheritedFromFindingId !== null) return 'INHERITED'
  if (f.suggestionOutcome === 'CONFIRMED') return 'SUGGESTED_CONFIRMED'
  return 'HUMAN'
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * `huntAudit.tasks[]` as the CLI's `formatHuntTaskDetail` reads them —
 * numbers copied when they are numbers, free text (commands, the gate's
 * refusal reason, the model's step text, the wrap-up answer) redacted and
 * capped, anything of the wrong shape dropped rather than trusted.
 */
function readHuntTasks(
  raw: unknown,
  tally: { redacted: number }
): ShellDetailTask[] {
  const rows = (raw as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(rows)) return []
  const out: ShellDetailTask[] = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const task: ShellDetailTask = {
      taskId: str(r.taskId) ?? '?',
      stopped: str(r.stopped) ?? '?',
    }
    const model = str(r.model)
    if (model) task.model = sanitizeField(model)
    const sites = num(r.sites)
    if (sites !== null) task.sites = sites
    const sh = r.shell
    if (sh && typeof sh === 'object') {
      const s = sh as Record<string, unknown>
      const shell: NonNullable<ShellDetailTask['shell']> = {}
      for (const k of [
        'calls',
        'refused',
        'failed',
        'notFound',
        'empty',
        'stepClipped',
        // LUM-799 — commands the task re-ran; the counter that tells a search
        // that narrowed down from one that looped.
        'repeated',
      ] as const) {
        const v = num(s[k])
        if (v !== null) shell[k] = v
      }
      if (Array.isArray(s.commands)) {
        shell.commands = s.commands
          .filter(
            (c): c is Record<string, unknown> => !!c && typeof c === 'object'
          )
          .map(c => {
            const cmd: NonNullable<
              NonNullable<ShellDetailTask['shell']>['commands']
            >[number] = {}
            const text = cleanText(c.cmd, CMD_MAX, tally)
            if (text !== undefined) cmd.cmd = text
            if (c.denied === true) cmd.denied = true
            const reason = cleanText(c.reason, CMD_MAX, tally)
            if (reason !== undefined) cmd.reason = reason
            const chars = num(c.chars)
            if (chars !== null) cmd.chars = chars
            if (c.compressed === true) cmd.compressed = true
            if (c.clipped === true) cmd.clipped = true
            return cmd
          })
      }
      task.shell = shell
    }
    if (Array.isArray(r.trace)) {
      task.trace = r.trace
        .filter(
          (t): t is Record<string, unknown> => !!t && typeof t === 'object'
        )
        .map(t => {
          const step: NonNullable<ShellDetailTask['trace']>[number] = {}
          const i = num(t.i)
          if (i !== null) step.i = i
          const tool = str(t.tool)
          if (tool) step.tool = sanitizeField(tool)
          const text = cleanText(t.text, TRACE_TEXT_MAX, tally)
          if (text !== undefined) step.text = text
          for (const k of [
            'inputTokens',
            'outputTokens',
            'reasoningTokens',
            'elidedChars',
          ] as const) {
            const v = num(t[k])
            if (v !== null) step[k] = v
          }
          const finish = str(t.finishReason)
          if (finish) step.finishReason = sanitizeField(finish)
          return step
        })
    }
    if (r.stop && typeof r.stop === 'object') {
      const s = r.stop as Record<string, unknown>
      const stop: NonNullable<ShellDetailTask['stop']> = {}
      const by = str(s.by)
      if (by) stop.by = sanitizeField(by)
      for (const k of [
        'spent',
        'budget',
        'reserve',
        'lastStep',
        'next',
        'steps',
        // LUM-799 — the repeat streak the search ended on.
        'repeatSteps',
      ] as const) {
        const v = num(s[k])
        if (v !== null) stop[k] = v
      }
      task.stop = stop
    }
    if (r.wrapUp && typeof r.wrapUp === 'object') {
      const w = r.wrapUp as Record<string, unknown>
      const wrapUp: NonNullable<ShellDetailTask['wrapUp']> = {
        ran: w.ran === true,
      }
      const skipped = str(w.skipped)
      if (skipped) wrapUp.skipped = sanitizeField(skipped)
      const submitted = num(w.submitted)
      if (submitted !== null) wrapUp.submitted = submitted
      const text = cleanText(w.text, TRACE_TEXT_MAX, tally)
      if (text !== undefined) wrapUp.text = text
      const tokens = num(w.tokens)
      if (tokens !== null) wrapUp.tokens = tokens
      const finish = str(w.finishReason)
      if (finish) wrapUp.finishReason = sanitizeField(finish)
      const error = cleanText(w.error, TRACE_TEXT_MAX, tally)
      if (error !== undefined) wrapUp.error = error
      task.wrapUp = wrapUp
    }
    out.push(task)
  }
  return out
}

/**
 * LUM-798 — the two tally shapes a `huntAudit` row can carry. `placement` is
 * the follow-up's two-axis tally; `legacy` is the first version, whose tier
 * counts only include candidates that survived to acceptance.
 */
export type ResolutionReadout =
  | {
      kind: 'placement'
      placed: { subgraph: number; sinkRule: number; sandbox: number }
      unplaced: number
      accepted: number
      rejected: number
    }
  | {
      kind: 'legacy'
      subgraph: number
      sinkRule: number
      sandbox: number
      rejected: number
    }

function readResolution(raw: unknown): ResolutionReadout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rejected = num(r.rejected)
  if (rejected === null) return null
  // The nested `placed` is what distinguishes the shapes; a flat row can only
  // be the legacy one, and is reported as such rather than upgraded.
  const placedRaw = r.placed
  if (placedRaw && typeof placedRaw === 'object') {
    const pl = placedRaw as Record<string, unknown>
    const subgraph = num(pl.subgraph)
    const sinkRule = num(pl.sinkRule)
    const sandbox = num(pl.sandbox)
    const unplaced = num(r.unplaced)
    const accepted = num(r.accepted)
    if (
      subgraph === null ||
      sinkRule === null ||
      sandbox === null ||
      unplaced === null ||
      accepted === null
    ) {
      return null
    }
    return {
      kind: 'placement',
      placed: { subgraph, sinkRule, sandbox },
      unplaced,
      accepted,
      rejected,
    }
  }
  const subgraph = num(r.subgraph)
  const sinkRule = num(r.sinkRule)
  const sandbox = num(r.sandbox)
  if (subgraph === null || sinkRule === null || sandbox === null) return null
  return { kind: 'legacy', subgraph, sinkRule, sandbox, rejected }
}

function readHunt(
  scan: ScanReadoutRow,
  tally: { redacted: number }
): HuntReadoutView | null {
  const stages = stagesOf(scan)
  const raw = scan.huntAudit
  const audit =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null
  // No hunt layer and no audit → nothing to say. A layer that ran (or
  // failed) with an audit prints whatever the row carries.
  if (!stages.hunt && !audit) return null
  const diffRaw = audit?.diff
  const diff =
    diffRaw && typeof diffRaw === 'object'
      ? (() => {
          const d = diffRaw as Record<string, unknown>
          const sourceFiles = num(d.sourceFiles)
          const sites = num(d.sites)
          const taskCap = num(d.taskCap)
          return sourceFiles === null || sites === null || taskCap === null
            ? null
            : { sourceFiles, sites, taskCap, oversized: d.oversized === true }
        })()
      : null
  const rejected = Array.isArray(audit?.rejected) ? audit.rejected.length : null
  const resolution = readResolution(audit?.resolution)
  return {
    coverage: parseHuntCoverage(raw),
    plannedBy: str(audit?.plannedBy),
    plannedReason: cleanText(audit?.plannedReason, DETAIL_MAX, tally) ?? null,
    diff,
    candidates: num(audit?.candidates),
    falsifierRejects: num(audit?.falsifierRejects),
    mechanicallyRejected: rejected,
    resolution,
    error: cleanText(audit?.error, DETAIL_MAX, tally) ?? null,
    tasks: readHuntTasks(raw, tally),
  }
}

/** LUM-1215 — the stored skips with each path terminal-sanitised. */
function readoutPathSkips(raw: unknown): ReviewPathSkipsInput | null {
  const skips = parseReviewPathSkips(raw)
  if (!skips) return null
  return {
    ...skips,
    builtIn: {
      ...skips.builtIn,
      paths: skips.builtIn.paths.map(p => sanitizeField(p)),
    },
  }
}

/** LUM-788 — the PR row the read-out prints (`SCAN_READOUT_PR_SELECT`). */
type ReadoutPr = Awaited<
  ReturnType<typeof pullRequestRepository.findByNumberInWorkspace>
>[number]

/** The workspace-level facts every PR's read-out shares — loaded once. */
interface ReadoutContext {
  policy: Awaited<ReturnType<typeof loadSecurityPolicy>>
  exitContexts: Awaited<ReturnType<typeof loadQueueExitContexts>>
  scanningOff: boolean
  workspaceLimit: Awaited<
    ReturnType<typeof securityColumnsRepository.findReviewAutoPauseAfter>
  >
}

async function loadReadoutContext(
  workspaceId: string,
  prs: readonly ReadoutPr[]
): Promise<ReadoutContext> {
  const [policy, exitContexts, layers, workspaceLimit] = await Promise.all([
    loadSecurityPolicy(workspaceId),
    loadQueueExitContexts(prs, workspaceId),
    loadSecurityLayers(workspaceId),
    securityColumnsRepository.findReviewAutoPauseAfter(workspaceId),
  ])
  return { policy, exitContexts, scanningOff: !layers.scan, workspaceLimit }
}

/**
 * One PR's read-out — the exact payload `lumo pr scan` renders. Shared by
 * the by-number read (LUM-788) and the by-task read (LUM-1189) so the two
 * can never disagree on a finding's standing or on what text is cleaned.
 */
async function buildPullRequestReadout(
  pr: ReadoutPr,
  all: boolean,
  ctx: ReadoutContext
): Promise<PullRequestScanReadout> {
  const { policy, exitContexts, workspaceLimit } = ctx
  const [rows, control] = await Promise.all([
    prSecurityScanRepository.listByPullRequest(pr.id, all ? null : 1),
    prReviewControlRepository.get(pr.id),
  ])
  const tally = { redacted: 0 }
  const scans: ScanReadoutView[] = rows.map(scan => {
    const findings: FindingReadoutView[] = scan.findings.map(f => {
      const queueExit =
        f.disposition === null && !f.persisting
          ? queueExitOf(f, pr, exitContexts, policy)
          : null
      const open =
        f.disposition === null &&
        !f.persisting &&
        queueExit === null &&
        !isVerifierRejected(f)
      return {
        id: f.id,
        kind: f.kind,
        ruleId: sanitizeField(f.ruleId),
        severity: f.severity,
        provenance: f.provenance,
        filePath: sanitizeField(f.filePath),
        line: f.line,
        title: cleanText(f.title, DETAIL_MAX, tally) ?? '',
        detail: cleanText(f.detail, DETAIL_MAX, tally) ?? '',
        externalRef: f.externalRef,
        disposition: f.disposition,
        dispositionSource: dispositionSourceOf(f),
        dispositionNote:
          cleanText(f.dispositionNote, DETAIL_MAX, tally) ?? null,
        // A reopened row keeps dispositionedAt as its reopen marker
        // (LUM-1128 follow-up) — it is not a ruling time to show.
        dispositionedAt:
          f.disposition && f.dispositionedAt
            ? f.dispositionedAt.toISOString()
            : null,
        blocking: open && isBlockingFinding(f, policy),
        open,
        persisting: f.persisting,
        queueExit,
        falsifierVerdict: f.falsifierVerdict ?? null,
        suggestedDisposition: f.suggestedDisposition ?? null,
        suggestionOutcome: f.suggestionOutcome ?? null,
        verifierVerdict: f.verifierVerdict ?? null,
        verifierReason: cleanText(f.verifierReason, DETAIL_MAX, tally) ?? null,
        secretDowngrade: f.secretDowngrade ?? null,
        cwe: f.cwe ?? null,
        reachability: f.reachability ?? null,
        callChain: readCallChain(f.callChain, tally),
        suggestedReason:
          cleanText(f.suggestedReason, DETAIL_MAX, tally) ?? null,
      }
    })
    const queueExits: Partial<Record<QueueExitReason, number>> = {}
    for (const f of findings) {
      if (f.queueExit)
        queueExits[f.queueExit] = (queueExits[f.queueExit] ?? 0) + 1
    }
    const stages = stagesOf(scan)
    return {
      id: scan.id,
      headSha: scan.headSha,
      status: scan.status,
      trigger: scan.trigger,
      judgeStatus: scan.judgeStatus,
      truncated: scan.truncated,
      stages,
      partial: scan.partial,
      partialCauses: scan.partialCauses ?? [],
      ...scanSizeCaps({
        stages,
        partialCauses: scan.partialCauses ?? [],
        huntAudit: scan.huntAudit,
        judgeBudget: scan.judgeBudget,
        error: scan.error,
      }),
      reviewPathSkips: readoutPathSkips(scan.reviewPathSkips),
      externalFailureReason:
        stages.external === 'FAILED'
          ? (cleanText(externalFailureReason(scan.error), DETAIL_MAX, tally) ??
            null)
          : null,
      startedAt: scan.startedAt.toISOString(),
      finishedAt: scan.finishedAt ? scan.finishedAt.toISOString() : null,
      tokenSpent: scan.tokenSpent,
      judgeBudget: parseJudgeBudget(scan.judgeBudget),
      counts: {
        findings: findings.length,
        open: findings.filter(f => f.open).length,
        blocking: findings.filter(f => f.blocking).length,
        dispositioned: findings.filter(f => f.disposition !== null).length,
        persisting: findings.filter(f => f.persisting).length,
        externalFindings: findings.filter(
          f => f.provenance === 'EXTERNAL_TOOL' && f.kind !== 'DEPENDENCY'
        ).length,
        dependencyFindings: findings.filter(f => f.kind === 'DEPENDENCY')
          .length,
      },
      queueExits,
      findings,
      hunt: readHunt(scan, tally),
    }
  })
  return {
    version: 1,
    // LUM-1137: reviewed commits against the PR's (else the workspace's)
    // pause-after; limit 0 = never pauses.
    reviewControl: {
      ...reviewBudgetView(control, workspaceLimit),
      currentHead: pr.headSha,
    },
    pullRequest: {
      repo: pr.repo,
      number: pr.number,
      title: sanitizeField(pr.title),
      url: pr.url,
      state: pr.state,
      task: pr.task
        ? { identifier: `${pr.task.team.identifier}-${pr.task.number}` }
        : null,
    },
    scans,
    all,
    redactedSecrets: tally.redacted,
    scanningOff: ctx.scanningOff,
  }
}

export const prScanReadoutService = {
  /**
   * The scans of one PR in the caller's workspace. 404 when the workspace
   * knows no such PR (a number that belongs to another workspace is
   * indistinguishable from one that never existed — no existence leak);
   * 409 with the candidate repos when the number exists in several and no
   * `repo` narrowed it.
   */
  async getForPullRequest(
    workspaceId: string,
    input: PullRequestScanReadoutInput
  ): Promise<PullRequestScanReadout> {
    const prs = await pullRequestRepository.findByNumberInWorkspace(
      workspaceId,
      input.number,
      input.repo ?? null
    )
    if (prs.length === 0) {
      throw Object.assign(
        new Error(
          `PR #${input.number}${input.repo ? ` in ${input.repo}` : ''} not found in this workspace`
        ),
        { status: 404 }
      )
    }
    if (prs.length > 1) {
      throw Object.assign(
        new Error(
          `PR #${input.number} exists in several repos — pass --repo <owner/repo>`
        ),
        { status: 409, repos: prs.map(p => p.repo) }
      )
    }
    const pr = prs[0]!
    return buildPullRequestReadout(
      pr,
      input.all,
      await loadReadoutContext(workspaceId, [pr])
    )
  },

  /**
   * LUM-1189 — the read-out of every PR linked to a task, one
   * `PullRequestScanReadout` each (newest PR first), behind `lumo task scans`.
   * The caller resolved `taskId` inside `workspaceId`; the PR read is scoped
   * to it again. Totals are summed off the per-PR latest scans.
   */
  async getForTask(
    workspaceId: string,
    task: { id: string; identifier: string },
    input: { all: boolean }
  ): Promise<TaskScanReadout> {
    const prs = await pullRequestRepository.findManyForScanReadoutByTaskId(
      workspaceId,
      task.id
    )
    const ctx = await loadReadoutContext(workspaceId, prs)
    const pullRequests = await Promise.all(
      prs.map(pr => buildPullRequestReadout(pr, input.all, ctx))
    )
    let blocking = 0
    let open = 0
    let redactedSecrets = 0
    for (const r of pullRequests) {
      const latest = r.scans[0]
      if (latest) {
        blocking += latest.counts.blocking
        open += latest.counts.open
      }
      redactedSecrets += r.redactedSecrets
    }
    return {
      version: 1,
      task: { identifier: task.identifier },
      pullRequests,
      totals: {
        pullRequests: pullRequests.length,
        scanned: pullRequests.filter(r => r.scans.length > 0).length,
        open,
        blocking,
      },
      all: input.all,
      redactedSecrets,
      scanningOff: ctx.scanningOff,
    }
  },
}
