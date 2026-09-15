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
} from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  isBlockingFinding,
  loadQueueExitContexts,
  loadSecurityPolicy,
  queueExitOf,
} from '@/lib/services/pr-security-scan-gate'
import type { QueueExitReason } from '@/lib/security-scan/queue-exit'
import { stagesOf } from '@/lib/security-scan/stages'
import { externalFailureReason } from '@/shared/src/security-scan'
import {
  parseHuntCoverage,
  type HuntCoverage,
} from '@/lib/security-scan/hunt/coverage'
import type {
  ScanStages,
  SecretDowngradeReason,
} from '@/lib/security-scan/types'
import { redactPromptLine } from '@/lib/security-scan/inject-guard'
import { sanitizeField } from '@/lib/utils/sanitize'
import type { ShellDetailTask } from '@/shared/src/hunt-audit'

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
  suggestionOutcome: SuggestionOutcome | null
  secretDowngrade: SecretDowngradeReason | null
  cwe: string | null
  reachability: FindingReachability | null
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
  /** P8 — the scrubbed external-scanner reason, or null (raw crash text is never published). */
  externalFailureReason: string | null
  startedAt: string
  finishedAt: string | null
  /** null = not metered (team rule: null ≠ 0). */
  tokenSpent: number | null
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
}

const DETAIL_MAX = 600
const TRACE_TEXT_MAX = 400
const CMD_MAX = 400

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
  return {
    coverage: parseHuntCoverage(raw),
    plannedBy: str(audit?.plannedBy),
    plannedReason: cleanText(audit?.plannedReason, DETAIL_MAX, tally) ?? null,
    diff,
    candidates: num(audit?.candidates),
    falsifierRejects: num(audit?.falsifierRejects),
    mechanicallyRejected: rejected,
    error: cleanText(audit?.error, DETAIL_MAX, tally) ?? null,
    tasks: readHuntTasks(raw, tally),
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
    const [rows, policy, exitContexts] = await Promise.all([
      prSecurityScanRepository.listByPullRequest(pr.id, input.all ? null : 1),
      loadSecurityPolicy(workspaceId),
      loadQueueExitContexts([pr], workspaceId),
    ])
    const tally = { redacted: 0 }
    const scans: ScanReadoutView[] = rows.map(scan => {
      const findings: FindingReadoutView[] = scan.findings.map(f => {
        const queueExit =
          f.disposition === null && !f.persisting
            ? queueExitOf(f, pr, exitContexts, policy)
            : null
        const open =
          f.disposition === null && !f.persisting && queueExit === null
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
          dispositionedAt: f.dispositionedAt
            ? f.dispositionedAt.toISOString()
            : null,
          blocking: open && isBlockingFinding(f, policy),
          open,
          persisting: f.persisting,
          queueExit,
          falsifierVerdict: f.falsifierVerdict ?? null,
          suggestedDisposition: f.suggestedDisposition ?? null,
          suggestionOutcome: f.suggestionOutcome ?? null,
          secretDowngrade: f.secretDowngrade ?? null,
          cwe: f.cwe ?? null,
          reachability: f.reachability ?? null,
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
        externalFailureReason:
          stages.external === 'FAILED'
            ? (cleanText(
                externalFailureReason(scan.error),
                DETAIL_MAX,
                tally
              ) ?? null)
            : null,
        startedAt: scan.startedAt.toISOString(),
        finishedAt: scan.finishedAt ? scan.finishedAt.toISOString() : null,
        tokenSpent: scan.tokenSpent,
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
      all: input.all,
      redactedSecrets: tally.redacted,
    }
  },
}
