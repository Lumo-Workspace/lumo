import { fmtCount, fmtPercent } from './format'
import { sanitizeField } from './sanitize'
import {
  formatQueueExits,
  SCAN_STAGE_KEYS,
  SCAN_UNFINISHED_NOTE,
  SCANNING_OFF_NOTE,
  PR_TOO_LARGE_STATUS,
  formatHuntOverCap,
  formatHuntProgress,
  formatJudgeOverCap,
  formatJudgePartial,
  formatPrTooLarge,
  formatReviewPathSkips,
  formatTurnedOffNote,
  isOwnedUnfinished,
  heldStageLabel,
  scanStageLabel,
  scanStageStateLabel,
  turnedOffLayers,
  type JudgeOverCapInput,
  type JudgePartialInput,
  type ReviewPathSkipsInput,
} from '../../../shared/src/security-scan'
import type { Field } from './report-layout'

/** LUM-832 / LUM-1144 — the AI review did not run: over its size cap. */
export type JudgeOverCapLine = JudgeOverCapInput
/** LUM-1144 — the AI review read part of an over-cap diff. */
export type JudgePartialLine = JudgePartialInput
/** LUM-1215 — what the path filters left out of the AI review. */
export type ReviewPathSkipsLine = ReviewPathSkipsInput
import { renderTable } from './ui'

/**
 * LUM-788 — the scan-line grammar shared by `lumo task status` (one line per
 * linked PR, LUM-735) and `lumo pr show` (one block per scan). Extracted so
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
  judgeOverCap?: JudgeOverCapLine | null | undefined
  /** LUM-1144 — the AI review read part of an over-cap diff. Absent on an older server. */
  judgePartial?: JudgePartialLine | null | undefined
  /** LUM-1079 — the whole PR was too large to scan. Absent on an older server. */
  prTooLarge?: PrTooLargeLine | null | undefined
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

/** LUM-1079 — the too-large facts as the server sends them (shape frozen). */
export interface PrTooLargeLine {
  reason: 'FILE_LIMIT' | 'DIFF_REFUSED'
  changedFiles: number | null
  capFiles: number
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
  const segments = scanLayerRows(s).map(r => `${r.label}: ${r.value}`)
  let line = ''
  if (segments.length > 0) line += ` · ${segments.join(' · ')}`
  for (const note of scanLayerNotes(s)) line += ` · ${note}`
  // LUM-756 (P8): only the prefixed, scrubbed scanner reason is printed, and
  // only the text after the prefix (the caller has already applied the rule).
  const reason = scrubbedExternalReason(s)
  if (reason) line += ` — ${reason}`
  return line
}

/** One layer of a scan as a labelled row (LUM-1091): `Code scan` / `checked (2 external findings)`. */
export interface ScanLayerRow {
  key: string
  label: string
  value: string
}

/**
 * The layer segments of `formatScanLayerTail` as rows — same keys, same
 * order, same words — for the reports that print one labelled row per layer
 * (LUM-1091). Stage rows only for keys present, in secrets/external/
 * supplyChain/judge/hunt order; the `(N external findings)` count only
 * decorates Code scan, the dependency count (with its already-on-main share)
 * only Dependencies, and each only when N > 0.
 */
export function scanLayerRows(s: ScanLayerLineInput): ScanLayerRow[] {
  const rows: ScanLayerRow[] = []
  for (const key of SCAN_STAGE_KEYS) {
    const state = s.stages[key]
    if (!state) continue
    // LUM-1137 / LUM-1152: a paused layer of a rate-limited or ignored
    // scan says so.
    const head =
      (state === 'PAUSED' ? heldStageLabel(s.partialCauses) : null) ??
      scanStageStateLabel(state)
    let value = head
    if (key === 'external' && s.externalFindings > 0) {
      const noun = s.externalFindings === 1 ? 'finding' : 'findings'
      value = `${head} (${s.externalFindings} external ${noun})`
    } else if (key === 'supplyChain' && (s.dependencyFindings ?? 0) > 0) {
      const n = s.dependencyFindings ?? 0
      const noun = n === 1 ? 'finding' : 'findings'
      const persisting = s.persistingFindings ?? 0
      const tail = persisting > 0 ? `, ${persisting} already on main` : ''
      value = `${head} (${n} dependency ${noun}${tail})`
    } else if (key === 'hunt' && s.huntProgress) {
      value = `${head} (${formatHuntProgress(s.huntProgress)})`
    }
    rows.push({ key, label: scanStageLabel(key), value })
  }
  return rows
}

/**
 * The scan-wide notes that follow the layers: the owned "didn't finish"
 * sentence (LUM-832) and where a merged / closed PR's rows went (LUM-775).
 */
export function scanLayerNotes(s: ScanLayerLineInput): string[] {
  const notes: string[] = []
  // LUM-832: one owned note when something did not finish, whatever the
  // cause — never the bare `partial`, which read as a verdict on the PR.
  if (
    isOwnedUnfinished({
      ...s,
      hasSizeNotice: Boolean(
        s.huntOverCap || s.judgeOverCap || s.judgePartial || s.prTooLarge
      ),
    })
  )
    notes.push(SCAN_UNFINISHED_NOTE)
  // LUM-775: what left the queue because the PR merged / closed, and why —
  // so a merged PR's line explains where its findings went instead of
  // silently listing fewer open rows than the scan found.
  const exits = formatQueueExits(s.queueExits)
  if (exits) notes.push(exits)
  return notes
}

/** P8 — the scrubbed, tail-clipped external-scanner reason, or null. */
function scrubbedExternalReason(s: ScanLayerLineInput): string | null {
  return s.externalFailureReason
    ? sanitizeField(tail(s.externalFailureReason, EXTERNAL_ERROR_TAIL))
    : null
}

/** What `scanFields` adds under the layer rows; each optional. */
export interface ScanFieldExtras {
  /** LUM-814 — printed under AI review when given (null = not recorded). */
  judgeBudget?: JudgeBudgetLine | null
  /** LUM-762 — the hunt's per-task table under Exploit paths. */
  hunt?: HuntCoverageInput | null
  /** `pr show` — the AI review has not covered every file yet. */
  truncated?: boolean
}

/**
 * LUM-1091 — one scan as labelled rows: a row per layer (with the judge's
 * budget and the hunt's per-task table nested under their own layer), then
 * `Note` / `Queue` rows for the scan-wide notes. The scrubbed external
 * reason rides on the Code scan row it explains. Shared by `task status`,
 * `pr show` and `task show --scans`, so they cannot drift.
 */
export function scanFields(
  s: ScanLayerLineInput,
  extras: ScanFieldExtras = {}
): Field[] {
  const reason = scrubbedExternalReason(s)
  const fields: Field[] = []
  let reasonPlaced = false
  for (const r of scanLayerRows(s)) {
    const f: Field = { label: r.label, value: r.value }
    if (r.key === 'external' && reason) {
      f.value = `${r.value} — ${reason}`
      reasonPlaced = true
    }
    if (r.key === 'judge') {
      const sub: string[] = []
      // LUM-1156: a size-capped partial review is a limit on the change,
      // told as the PR summary tells it — never "not covered … yet".
      if (s.judgePartial)
        sub.push(
          `over the size limit — reviewed ${fmtCount(s.judgePartial.reviewedFiles)} of ${fmtCount(s.judgePartial.totalFiles)} reviewable files`
        )
      else if (extras.truncated)
        sub.push('AI review has not covered every file yet')
      if (extras.judgeBudget !== undefined)
        sub.push(formatJudgeBudgetLine(extras.judgeBudget, s.judgePartial))
      if (sub.length > 0) f.sub = sub
    }
    if (r.key === 'hunt' && extras.hunt && extras.hunt.categories.length > 0)
      f.sub = formatHuntCoverageLines(extras.hunt)
    fields.push(f)
  }
  if (extras.truncated && !s.stages.judge)
    fields.push({
      label: 'Note',
      value: 'AI review has not covered every file yet',
    })
  for (const n of scanLayerNotes(s)) {
    fields.push({
      label: n === SCAN_UNFINISHED_NOTE ? 'Note' : 'Queue',
      value: n,
    })
  }
  if (reason && !reasonPlaced)
    fields.push({ label: 'Scanner error', value: reason })
  return fields
}

/**
 * LUM-832 — the size-cap notices, one line each under the scan line, in the
 * same words as the PR summary: a layer over its cap did not run, and how to
 * get it. Empty when no layer was skipped for size.
 */
export function formatSizeCapLines(s: {
  huntOverCap?: { sourceFiles: number; capFiles: number } | null | undefined
  judgeOverCap?: JudgeOverCapLine | null | undefined
  /** LUM-1144 — the AI review read part of an over-cap diff. Absent on an older server. */
  judgePartial?: JudgePartialLine | null | undefined
  prTooLarge?: PrTooLargeLine | null | undefined
}): string[] {
  const lines: string[] = []
  // LUM-1079: the whole PR was too large — why, and what to do.
  if (s.prTooLarge) lines.push(formatPrTooLarge(s.prTooLarge))
  if (s.judgeOverCap) lines.push(formatJudgeOverCap(s.judgeOverCap))
  // LUM-1144: file names are repository text — terminal-sanitised.
  if (s.judgePartial)
    lines.push(
      formatJudgePartial(s.judgePartial, {
        renderPath: p => sanitizeField(p).slice(0, 200),
      })
    )
  if (s.huntOverCap) lines.push(formatHuntOverCap(s.huntOverCap))
  return lines
}

/**
 * LUM-1215 — the files the path filters left out of the AI review, in the
 * PR summary's words: the built-in defaults' skips named (terminal-safe),
 * the repository's own counted. Empty when none (or an older server).
 */
export function formatPathSkipLines(s: {
  reviewPathSkips?: ReviewPathSkipsLine | null | undefined
}): string[] {
  if (!s.reviewPathSkips) return []
  return formatReviewPathSkips(s.reviewPathSkips, {
    renderPath: p => sanitizeField(p).slice(0, 200),
  })
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
  scanningOff = false,
  prTooLarge = false
): string {
  // LUM-1079: nothing was scanned because the PR was too large — never
  // FAILED ("didn't finish on our side") and never CLEAN.
  if (prTooLarge) return PR_TOO_LARGE_STATUS
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
  /** LUM-1208 — read-only server config the review got; absent = none. */
  serverConfig?: { paths: string[]; chars: number }
}

/** LUM-1208 — ` · server config 1 file (255 chars, read-only): a/Trunk.toml`. */
function serverConfigSegment(b: JudgeBudgetLine): string {
  const c = b.serverConfig
  if (!c || c.paths.length === 0) return ''
  const n = c.paths.length
  return ` · server config ${fmtCount(n)} file${n === 1 ? '' : 's'} (${fmtCount(c.chars)} chars, read-only): ${c.paths.join(', ')}`
}

/**
 * LUM-814 — one line of budget arithmetic under the layer line:
 *
 *   `AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left (2%)`
 *   `AI review budget: diff 261,400 chars · tier 180,000 · over by 81,400 ·
 *    12 of 41 files dropped, 30.9% of the diff unreviewed`
 *   `AI review budget: not recorded on this scan`
 *   `AI review budget: diff 305,874 chars · size limit 180,000 chars, 150 files ·
 *    over by 125,874 · reviewed 3 of 4 files, 1 left out for size (99.8% of the diff)`
 *    (LUM-1156 — a size-capped partial review)
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
export function formatJudgeBudgetLine(
  b: JudgeBudgetLine | null,
  partial?: JudgePartialLine | null
): string {
  const head = `${scanStageLabel('judge')} budget`
  if (b === null) return `${head}: not recorded on this scan`
  // LUM-1156: a size-capped partial review is measured against the size
  // limit the customer is told about, not the internal tier the reviewed
  // part happened to fit in.
  if (partial) {
    const left = partial.totalFiles - partial.reviewedFiles
    const outPct =
      b.diffChars > 0
        ? ((b.diffChars - b.reviewedChars) / b.diffChars) * 100
        : 0
    const parts = [
      `diff ${fmtCount(b.diffChars)} chars`,
      `size limit ${fmtCount(partial.capChars)} chars, ${fmtCount(partial.capFiles)} files`,
    ]
    if (b.diffChars > partial.capChars)
      parts.push(`over by ${fmtCount(b.diffChars - partial.capChars)}`)
    parts.push(
      `reviewed ${fmtCount(partial.reviewedFiles)} of ${fmtCount(partial.totalFiles)} files, ${fmtCount(left)} left out for size (${fmtPercent(outPct)} of the diff)`
    )
    return `${head}: ${parts.join(' · ')}${serverConfigSegment(b)}`
  }
  const parts = [
    `diff ${fmtCount(b.diffChars)} chars`,
    `tier ${fmtCount(b.tierChars)}`,
  ]
  if (b.droppedFiles > 0) {
    if (b.diffChars > b.tierChars)
      parts.push(`over by ${fmtCount(b.diffChars - b.tierChars)}`)
    const total = b.coveredFiles + b.droppedFiles
    // Share of the DIFF left unreviewed, not the share of files: one dropped
    // lockfile and one dropped route handler are not the same loss.
    const unreviewed =
      b.diffChars > 0
        ? ((b.diffChars - b.reviewedChars) / b.diffChars) * 100
        : 0
    parts.push(
      `${fmtCount(b.droppedFiles)} of ${fmtCount(total)} files dropped, ${fmtPercent(unreviewed)} of the diff unreviewed`
    )
  } else {
    const left = Math.max(0, b.tierChars - b.diffChars)
    const pct = b.tierChars > 0 ? (left / b.tierChars) * 100 : 0
    parts.push(`${fmtCount(left)} left (${fmtPercent(pct)})`)
  }
  return `${head}: ${parts.join(' · ')}${serverConfigSegment(b)}`
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
 * LUM-762 — the hunt's per-task read-out, nested under the Exploit paths
 * row (LUM-1091: a small aligned table, formerly one `·`-joined line): a
 * `2/3 planned tasks done` line, then one row per planned task —
 * `t2  injection  72.0s  done (2 attempts)`. Elapsed time is summed over a
 * task's attempts; a skipped task has none to print.
 *
 * LUM-758: a plan may hold two tasks of the same category, so the row is led
 * by its task id. Pre-task-graph audits carry no id — the id column is then
 * dropped.
 */
export function formatHuntCoverageLines(hunt: HuntCoverageInput): string[] {
  const withId = hunt.categories.some(c => c.taskId !== undefined)
  const rows = hunt.categories.map(c => {
    const attempts = c.attempts > 1 ? ` (${c.attempts} attempts)` : ''
    const spent =
      c.stopped === 'skipped' ? '' : `${(c.elapsedMs / 1000).toFixed(1)}s`
    const cells = [
      sanitizeField(c.category),
      spent,
      `${sanitizeField(c.stopped)}${attempts}`,
    ]
    return withId
      ? [c.taskId === undefined ? '' : sanitizeField(c.taskId), ...cells]
      : cells
  })
  const spentCol = withId ? 2 : 1
  const align: Array<'left' | 'right' | undefined> = []
  align[spentCol] = 'right'
  return [
    `${hunt.done}/${hunt.total} planned tasks done`,
    ...renderTable(rows, { color: false, align }).split('\n'),
  ]
}
