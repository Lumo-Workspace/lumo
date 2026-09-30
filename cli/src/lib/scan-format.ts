import { sanitizeField } from './sanitize'
import {
  formatQueueExits,
  SCAN_STAGE_KEYS,
  SCAN_UNFINISHED_NOTE,
  SCANNING_OFF_NOTE,
  formatHuntOverCap,
  formatHuntProgress,
  formatJudgeOverCap,
  formatTurnedOffNote,
  isOwnedUnfinished,
  scanStageLabel,
  scanStageStateLabel,
  turnedOffLayers,
} from '../../../shared/src/security-scan'

/**
 * LUM-788 — the scan-line grammar shared by `lumo task status` (one line per
 * linked PR, LUM-735) and `lumo pr scan` (one block per scan). Extracted so
 * the two surfaces cannot name a layer, a state or a queue exit two
 * different ways; the display labels themselves come from
 * `shared/src/security-scan.ts`, the same map the GitHub PR summary and the
 * web panel render from (LUM-763).
 */

/** What one scan's layer line needs — a structural subset of both payloads. */
export interface ScanLayerLineInput {
  /** LUM-832 — the scan row's status; a FAILED scan is never "checked". */
  status?: string
  stages: Partial<Record<string, string>>
  partial: boolean
  /**
   * LUM-832 — a batched hunt's covered source files (decorates Exploit
   * paths). Absent on an older server and on an un-batched hunt.
   */
  huntProgress?: { coveredFiles: number; totalFiles: number } | null | undefined
  /** LUM-832 — the causes; absent on an older server (reads as unattributed). */
  partialCauses?: string[] | undefined
  /** LUM-832 — the hunt did not run: over its file cap. Absent on an older server. */
  huntOverCap?: { sourceFiles: number; capFiles: number } | null | undefined
  /** LUM-832 — the AI review did not run: over its size cap. Absent on an older server. */
  judgeOverCap?: { diffChars: number; capChars: number } | null | undefined
  /** Raw external-tool hits that are not dependencies (decorates Code scan). */
  externalFindings: number
  /** LUM-738 — DEPENDENCY rows (decorates Dependencies). Absent on an older server. */
  dependencyFindings?: number | undefined
  /** LUM-738 — rows already on the default-branch baseline. */
  persistingFindings?: number | undefined
  /** LUM-775 — rows that left the queue on a merged / closed PR, by reason. */
  queueExits?: Partial<Record<string, number>> | undefined
  /**
   * P8 — the SCRUBBED external-scanner reason (text after the `external: `
   * prefix), already null when the layer did not fail or the error carried
   * no prefix. Callers derive it with `externalFailureReason`.
   */
  externalFailureReason: string | null
}

const EXTERNAL_ERROR_TAIL = 200

function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(-max)}` : s
}

/**
 * ` · Secrets: checked · Code scan: checked (2 external findings) ·
 * Dependencies: checked (1 dependency finding, 1 already on main) ·
 * AI review: checked · Exploit paths: checked · 3 left the queue
 * (2 resolved on main, 1 merged unreviewed) — <scrubbed reason>`, or `''`
 * when the scan carries no stage at all. The caller prefixes its own head
 * (`  PR #945 · scan CLEAN` / `Scan abc1234 · FINDINGS`).
 *
 * Stage segments only for keys present, in secrets/external/supplyChain/
 * judge/hunt order; the `(N external findings)` count only decorates the
 * Code scan segment, the dependency count (with its already-on-main share)
 * only the Dependencies segment, and each only when N > 0.
 */
export function formatScanLayerTail(s: ScanLayerLineInput): string {
  const segments: string[] = []
  for (const key of SCAN_STAGE_KEYS) {
    const state = s.stages[key]
    if (!state) continue
    const head = `${scanStageLabel(key)}: ${scanStageStateLabel(state)}`
    if (key === 'external' && s.externalFindings > 0) {
      const noun = s.externalFindings === 1 ? 'finding' : 'findings'
      segments.push(`${head} (${s.externalFindings} external ${noun})`)
    } else if (key === 'supplyChain' && (s.dependencyFindings ?? 0) > 0) {
      const n = s.dependencyFindings ?? 0
      const noun = n === 1 ? 'finding' : 'findings'
      const persisting = s.persistingFindings ?? 0
      const tail = persisting > 0 ? `, ${persisting} already on main` : ''
      segments.push(`${head} (${n} dependency ${noun}${tail})`)
    } else if (key === 'hunt' && s.huntProgress) {
      segments.push(`${head} (${formatHuntProgress(s.huntProgress)})`)
    } else {
      segments.push(head)
    }
  }
  let line = ''
  if (segments.length > 0) line += ` · ${segments.join(' · ')}`
  // LUM-832: one owned note when something did not finish, whatever the
  // cause — never the bare `partial`, which read as a verdict on the PR.
  if (
    isOwnedUnfinished({
      ...s,
      hasSizeNotice: Boolean(s.huntOverCap || s.judgeOverCap),
    })
  )
    line += ` · ${SCAN_UNFINISHED_NOTE}`
  // LUM-775: what left the queue because the PR merged / closed, and why —
  // so a merged PR's line explains where its findings went instead of
  // silently listing fewer open rows than the scan found.
  const exits = formatQueueExits(s.queueExits)
  if (exits) line += ` · ${exits}`
  // LUM-756 (P8): only the prefixed, scrubbed scanner reason is printed, and
  // only the text after the prefix (the caller has already applied the rule).
  if (s.externalFailureReason) {
    line += ` — ${sanitizeField(tail(s.externalFailureReason, EXTERNAL_ERROR_TAIL))}`
  }
  return line
}

/**
 * LUM-832 — the size-cap notices, one line each under the scan line, in the
 * same words as the PR summary: a layer over its cap did not run, and how to
 * get it (CodeRabbit's shape). Empty when no layer was skipped for size.
 */
export function formatSizeCapLines(s: {
  huntOverCap?: { sourceFiles: number; capFiles: number } | null | undefined
  judgeOverCap?: { diffChars: number; capChars: number } | null | undefined
}): string[] {
  const lines: string[] = []
  if (s.judgeOverCap) lines.push(formatJudgeOverCap(s.judgeOverCap))
  if (s.huntOverCap) lines.push(formatHuntOverCap(s.huntOverCap))
  return lines
}

/**
 * LUM-892 — the layers the customer turned off in the workspace settings,
 * one line in the PR summary's words. Empty when none was.
 */
export function formatTurnedOffLines(
  stages: Partial<Record<string, string>>
): string[] {
  const keys = turnedOffLayers(stages)
  return keys.length > 0 ? [formatTurnedOffNote(keys)] : []
}

/**
 * LUM-892 — the scan's status word for a head line. A CLEAN scan with a layer
 * turned off in settings did not check everything, so it is never printed as
 * a bare CLEAN.
 */
export function formatScanStatus(
  status: string,
  stages: Partial<Record<string, string>>,
  scanningOff = false
): string {
  // LUM-901: with scanning off, a CLEAN is about an earlier commit — never
  // the PR's answer now.
  if (status === 'CLEAN' && scanningOff)
    return 'no findings on the commit it scanned (scanning is off now)'
  return status === 'CLEAN' && turnedOffLayers(stages).length > 0
    ? 'no findings in the checks that ran'
    : status
}

/**
 * LUM-901 — the workspace has scanning turned off: one line, in the PR
 * summary's words. Empty when it is on (or an older server did not say).
 */
export function formatScanningOffLines(
  scanningOff: boolean | undefined
): string[] {
  return scanningOff ? [SCANNING_OFF_NOTE] : []
}

/**
 * LUM-814 — the judge's budget arithmetic as the server recorded it. Shape
 * frozen: an older CLI must keep working against a newer server, and this CLI
 * must keep working against a server that has no such column (the field is
 * absent, which reads the same as "not recorded").
 */
export interface JudgeBudgetLine {
  diffChars: number
  tierChars: number
  reviewedChars: number
  coveredFiles: number
  droppedFiles: number
}

function count(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * LUM-814 — one line of budget arithmetic under the layer line:
 *
 *   `AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left, 2.2%`
 *   `AI review budget: diff 261,400 chars · tier 180,000 · over by 81,400 ·
 *    12 of 41 files dropped, 30.9% of the diff unreviewed`
 *   `AI review budget: not recorded on this scan`
 *
 * It is unconditional by design. `truncated` alone cannot tell a PR that
 * spent 2% of its tier from one that spent 98%, and the near-miss is exactly
 * the case worth seeing: both print `AI review: checked` and read identically
 * without these numbers. Deciding to print them only on truncation would say
 * nothing about any PR that was reviewed whole — which is most of them.
 *
 * `null` prints "not recorded", never a budget of zero: a scan from before
 * the column existed spent an unknown amount, not nothing. Same fail-closed
 * rule as `tokens not metered`.
 *
 * Headroom is clamped at zero and no threshold is flagged. A "near cap"
 * marker would need a constant nobody derived, and the percentage already
 * says how near it is — whoever reads 2.2% does not need to be told twice.
 * The count of changed SOURCE FILES is deliberately absent: LUM-811 stopped
 * selecting the tier by it, so printing it beside the budget would imply a
 * relationship that no longer exists.
 *
 * Headed by the same display label as the layer's own segment (LUM-763), so
 * the two lines cannot name the layer two different ways.
 */
export function formatJudgeBudgetLine(b: JudgeBudgetLine | null): string {
  const head = `${scanStageLabel('judge')} budget`
  if (b === null) return `${head}: not recorded on this scan`
  const parts = [
    `diff ${count(b.diffChars)} chars`,
    `tier ${count(b.tierChars)}`,
  ]
  if (b.droppedFiles > 0) {
    if (b.diffChars > b.tierChars)
      parts.push(`over by ${count(b.diffChars - b.tierChars)}`)
    const total = b.coveredFiles + b.droppedFiles
    // Share of the DIFF left unreviewed, not the share of files: one dropped
    // lockfile and one dropped route handler are not the same loss.
    const unreviewed =
      b.diffChars > 0
        ? ((b.diffChars - b.reviewedChars) / b.diffChars) * 100
        : 0
    parts.push(
      `${count(b.droppedFiles)} of ${count(total)} files dropped, ${unreviewed.toFixed(1)}% of the diff unreviewed`
    )
  } else {
    const left = Math.max(0, b.tierChars - b.diffChars)
    const pct = b.tierChars > 0 ? (left / b.tierChars) * 100 : 0
    parts.push(`${count(left)} left, ${pct.toFixed(1)}%`)
  }
  return `${head}: ${parts.join(' · ')}`
}

/** LUM-762 — one planned task's coverage row (shape frozen for older CLIs). */
export interface HuntCoverageRow {
  taskId?: string | undefined
  objective?: string | undefined
  category: string
  stopped: string
  elapsedMs: number
  tokens: number
  candidates: number
  attempts: number
}

export interface HuntCoverageInput {
  total: number
  done: number
  categories: HuntCoverageRow[]
}

/**
 * LUM-762 — the hunt's per-task read-out, one line under its scan:
 * `Exploit paths 2/3 done · t1 idor 41.2s done · t2 injection 72.0s done
 * (2 attempts) · t3 race skipped`. Headed by the same display label as the
 * layer's own segment (LUM-763) — the detail line and the line above it
 * must not name the layer two different ways. Elapsed time is summed over a
 * task's attempts; a skipped task has none to print.
 *
 * LUM-758: a plan may hold two tasks of the same category, so the row is led
 * by its task id. Pre-task-graph audits carry no id — the row then prints
 * exactly as it always did.
 */
export function formatHuntCoverageLine(hunt: HuntCoverageInput): string {
  const parts = hunt.categories.map(c => {
    const attempts = c.attempts > 1 ? ` (${c.attempts} attempts)` : ''
    const spent =
      c.stopped === 'skipped' ? '' : `${(c.elapsedMs / 1000).toFixed(1)}s `
    const id = c.taskId === undefined ? '' : `${sanitizeField(c.taskId)} `
    return `${id}${sanitizeField(c.category)} ${spent}${sanitizeField(c.stopped)}${attempts}`
  })
  return `${scanStageLabel('hunt')} ${hunt.done}/${hunt.total} done · ${parts.join(' · ')}`
}
