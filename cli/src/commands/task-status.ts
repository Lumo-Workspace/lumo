import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { sanitizeField } from '../lib/sanitize'
import {
  externalFailureReason,
  findingCountPhrase,
  isCodeReviewFinding,
  secretDowngradeNote,
} from '../../../shared/src/security-scan'
import {
  formatHuntCoverageLine,
  formatSizeCapLines,
  formatScanStatus,
  formatTurnedOffLines,
  formatScanningOffLines,
  formatScanLayerTail,
  type PrTooLargeLine,
} from '../lib/scan-format'
import {
  fetchOpenCrossings,
  dispositionUrl,
  type OpenCrossingsResult,
  type CrossingAttribution,
} from '../lib/open-crossings'

export interface TaskStatusOptions {
  /** Emit the versioned machine-readable payload instead of prose. */
  json?: boolean
  /** LUM-733: also print the dashboard sections (cost, struggle/rework
   *  trail, trend). Off by default — the agent self-check is the next actions
   *  (undispositioned security findings, test-case advisories) and any open
   *  crossings. */
  full?: boolean
}

/** Extra render inputs layered onto the status read model (LUM-448): the task's
 *  OPEN boundary-crossings read result + the web disposition panel link.
 *  The result carries an explicit failure state (LUM-480) so a failed check
 *  renders a warning instead of an implicitly-safe empty block. Absent
 *  (`undefined`) means no read was attempted — e.g. a direct `formatTaskStatus`
 *  call in a unit test — and the block is skipped entirely. */
export interface TaskStatusExtras {
  /** LUM-733: render the dashboard sections too (see TaskStatusOptions.full). */
  full?: boolean
  openCrossings?: OpenCrossingsResult
  dispositionUrl?: string
}

/** One-line a possibly-multiline crossing detail and cap it so the safety block
 *  stays a glance, never a wall. */
const CROSSING_DETAIL_CAP = 160
function oneLineDetail(detail: string): string {
  const firstLine = detail.split('\n')[0] ?? ''
  const clean = sanitizeField(firstLine).trim()
  return clean.length > CROSSING_DETAIL_CAP
    ? `${clean.slice(0, CROSSING_DETAIL_CAP)}…`
    : clean
}

/** Mirrors TaskStatusReport served by GET /api/tasks/[id]/status (v2, LUM-942:
 *  acceptance criteria + verification rounds removed). */
export interface TaskStatusResponse {
  version: number
  task: { id: string; identifier: string; title: string; status: string }
  /** LUM-560: honest cost read-out — token / active time (non-idle, LUM-487),
   *  read from the same server-side loadActuals source as the web delivery
   *  card. tokenCost null = NOT measured (≠ a measured 0). Optional so the
   *  renderer never fabricates a section the server did not emit. */
  cost?: {
    tokenCost: number | null
    activeTimeSec: number
  }
  /** LUM-561: rework traces (PR cycles, reopens), preserved even on a clean
   *  task so the report never wipes the struggle. */
  struggleTrail?: {
    pullRequests: Array<{ number: number; url: string }>
    reopens: Array<{ from: string; to: string; at: string }>
  }
  /** LUM-562: movement of cost / rework across the task's attempts. */
  trend?: {
    cost: Array<{
      sessionId: string
      total: number
      loopCount: number
      at: string
    }>
    rework: {
      reopens: number
      extraPrCycles: number
      total: number
    }
  }
  /** LUM-564: the agent's CLAIM — what it SAYS it did (an unverified
   *  self-report). Not rendered in the terminal; --json carries it. */
  claim?: {
    text: string | null
    source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST' | null
  }
  /** LUM-583: whether the CLAIM faithfully reflects the delivery, read from
   *  the persisted verdict. Not rendered in the terminal; --json carries it. */
  faithfulness?: {
    state:
      | 'FAITHFUL'
      | 'UNDERREPORT'
      | 'OVERSTATED'
      | 'UNJUDGEABLE'
      | 'PENDING'
      | 'STALE'
    verdict: 'FAITHFUL' | 'UNDERREPORT' | 'OVERSTATED' | 'UNJUDGEABLE' | null
    evidence: string[]
    reasoning: string | null
    diffShas: string[]
    prNumbers: number[]
    judgedAt: string | null
    judgedClaimAt: string | null
  }
  /** LUM-737: `kind` discriminates. */
  nextActions: Array<
    | {
        kind: 'TEST_CASE_VERDICT'
        signal: 'PROVEN_DEFECT' | 'UNPROVEN_PASS' | 'CASE_OUTDATED'
        number: number
        title: string
        /** LUM-819: 仅 UNPROVEN_PASS 带。老服务端不回这个字段。 */
        ceilingReason?: 'environment' | 'unobserved' | 'no-evidence'
        advisory: true
      }
    | {
        kind: 'SECURITY_FINDING'
        findingId: string
        statement: string
        severity: 'LOW' | 'MEDIUM' | 'HIGH'
        provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
        blocking: boolean
        prNumber: number
        ruleId: string
        filePath: string
        line: number | null
        /** LUM-758 follow-up: why a secret row is LOW. Absent on an older server. */
        secretDowngrade?: string | null
      }
    /** LUM-807: advisory only — never blocks DONE. */
    | {
        kind: 'TEST_CASE'
        statement: string
        command: string
        advisory: true
      }
  >
  /** LUM-737: security-scan read-out. `null` = the read failed (could NOT
   *  confirm); optional so a new CLI tolerates an older server. */
  securityFindings?: {
    open: number
    blocking: number
    unconfirmedPrs: Array<{
      number: number
      /** LUM-1079: TOO_LARGE — the PR was too large to scan at all. */
      reason:
        | 'NONE'
        | 'FAILED'
        | 'PENDING'
        | 'RUNNING'
        | 'SCANNING_OFF'
        | 'TOO_LARGE'
    }>
    /** LUM-735 — one entry per linked PR with a latest scan (open or closed
     *  PRs alike). Optional/absent on an older server — additive field. */
    scans?: Array<{
      prNumber: number
      status: 'PENDING' | 'RUNNING' | 'CLEAN' | 'FINDINGS' | 'FAILED'
      stages: Partial<
        Record<
          'secrets' | 'external' | 'supplyChain' | 'judge' | 'hunt',
          string
        >
      >
      partial: boolean
      error: string | null
      externalFindings: number
      openFindings: number
      /** LUM-738 — optional: absent on an older server. */
      dependencyFindings?: number
      persistingFindings?: number
      /** LUM-775 — undispositioned rows that left the queue when the PR
       *  merged / closed, by reason (`RESOLVED_ON_MAIN` / `MERGED_UNREVIEWED`
       *  / `PR_CLOSED`). Absent on an older server, `{}` on an open PR. */
      queueExits?: Partial<Record<string, number>>
      /** LUM-832 — a batched hunt's covered source files; absent on an older server. */
      huntProgress?: { coveredFiles: number; totalFiles: number } | null
      /** LUM-832 — absent on an older server. */
      partialCauses?: string[]
      /** LUM-832 — the file cap left files out; absent on an older server. */
      huntOverCap?: { sourceFiles: number; capFiles: number } | null
      /** LUM-832 — the AI review did not run: over its size cap; absent on an older server. */
      judgeOverCap?: { diffChars: number; capChars: number } | null
      /** LUM-1079 — the whole PR was too large to scan; absent on an older server. */
      prTooLarge?: PrTooLargeLine | null
      /** LUM-901 — the workspace has scanning off; absent on an older server. */
      scanningOff?: boolean
      /** LUM-762 — per-task L3 hunt coverage read off `huntAudit`.
       *  Absent on an older server, null when the scan stored no usable
       *  audit (a pre-LUM-739 row, or a hunt that failed before its first
       *  batch). LUM-758: a row is one PLANNED TASK, so `taskId` is what
       *  tells two rows of the same category apart — absent on pre-task-graph
       *  audits and on an older server. */
      hunt?: {
        total: number
        done: number
        categories: Array<{
          taskId?: string
          objective?: string
          category: string
          stopped: string
          elapsedMs: number
          tokens: number
          candidates: number
          attempts: number
        }>
      } | null
    }>
  } | null
}

type NextActionItem = TaskStatusResponse['nextActions'][number]
type SecurityAction = Extract<NextActionItem, { kind: 'SECURITY_FINDING' }>
type TestCaseAction = Extract<NextActionItem, { kind: 'TEST_CASE' }>
export type TestCaseVerdictAction = Extract<
  NextActionItem,
  { kind: 'TEST_CASE_VERDICT' }
>

function isSecurityAction(a: NextActionItem): a is SecurityAction {
  return a.kind === 'SECURITY_FINDING'
}
function isTestCaseVerdictAction(
  a: NextActionItem
): a is TestCaseVerdictAction {
  return a.kind === 'TEST_CASE_VERDICT'
}
/** Advisory rows: the known TEST_CASE kind, plus (LUM-819) any advisory of a
 *  kind this CLI version does not know yet — rendered generically. */
function isAdvisoryAction(a: NextActionItem): a is TestCaseAction {
  const raw = a as { kind?: unknown; advisory?: unknown }
  return raw.kind === 'TEST_CASE' || raw.advisory === true
}
export function splitNextActions(actions: NextActionItem[]): {
  security: SecurityAction[]
  testCase: TestCaseAction[]
  testCaseVerdict: TestCaseVerdictAction[]
} {
  const security: SecurityAction[] = []
  const testCase: TestCaseAction[] = []
  const testCaseVerdict: TestCaseVerdictAction[] = []
  for (const a of actions) {
    if (isSecurityAction(a)) security.push(a)
    else if (isTestCaseVerdictAction(a)) testCaseVerdict.push(a)
    // Anything else is advisory-only (a server-side rule): a kind this CLI
    // does not know yet without the advisory flag is dropped rather than
    // guessed at, so it can never read as a DONE blocker.
    else if (isAdvisoryAction(a)) testCase.push(a)
  }
  return { security, testCase, testCaseVerdict }
}

/** One advisory line + the command that clears it (LUM-807). */
export function pushTestCaseActions(
  lines: string[],
  actions: TestCaseAction[]
): void {
  for (const a of actions) {
    // LUM-819: an unknown advisory kind may lack either field — never print
    // "undefined"; fall back to its kind.
    const statement =
      typeof a.statement === 'string' ? a.statement : String(a.kind)
    lines.push(`  • [TEST CASE] ${sanitizeField(statement)} (advisory)`)
    if (typeof a.command === 'string')
      lines.push(`    run: ${sanitizeField(a.command)}`)
  }
}

/**
 * LUM-808: 判决层的 advisory。措辞刻意与 FAIL 分开 —— UNPROVEN 不是失败，
 * 是「没能确认」；把它写成红的会让人去修一个没坏的东西。
 */
const VERDICT_LABEL: Record<TestCaseVerdictAction['signal'], string> = {
  PROVEN_DEFECT: 'implementation defect, with evidence',
  UNPROVEN_PASS: 'reported PASS, capped to UNPROVEN',
  CASE_OUTDATED: 'the case is out of date, not the code',
}

/**
 * LUM-819: UNPROVEN 的原因，括在判决标签后面。措辞同样避开失败词汇——
 * 「没有证据」说的是「别人没法复看」，不是「它坏了」。
 */
const CEILING_REASON_LABEL: Record<
  NonNullable<TestCaseVerdictAction['ceilingReason']>,
  string
> = {
  environment: 'not run where it can prove anything',
  unobserved: 'some verification steps went unobserved',
  'no-evidence': 'no evidence attached',
}

/** 一条判决层 advisory 渲染成一行。导出给测试用。 */
export function formatTestCaseVerdictAction(a: TestCaseVerdictAction): string {
  const why =
    a.signal === 'UNPROVEN_PASS' && a.ceilingReason
      ? ` (${CEILING_REASON_LABEL[a.ceilingReason]})`
      : ''
  return `  • [TEST CASE] TC${a.number} ${sanitizeField(a.title)} — ${VERDICT_LABEL[a.signal]}${why} (advisory)`
}

export function pushTestCaseVerdictActions(
  lines: string[],
  actions: TestCaseVerdictAction[]
): void {
  for (const a of actions) lines.push(formatTestCaseVerdictAction(a))
}

/** Same line grammar as the session-start / PreToolUse reminders. */
function formatSecurityAction(a: SecurityAction): string {
  const where = a.line == null ? a.filePath : `${a.filePath}:${a.line}`
  const title = sanitizeField(a.statement.split(' — ').slice(1).join(' — '))
  const tag = a.blocking ? 'blocks DONE' : 'advisory'
  // LUM-758 follow-up: a downgraded row is still reported on purpose, so the
  // line has to say WHY it is LOW — otherwise a placeholder the scanner already
  // recognised reads as an unexplained credential.
  const note = sanitizeField(secretDowngradeNote(a.secretDowngrade))
  return `[${a.severity}] ${a.provenance} ${sanitizeField(a.ruleId)} — ${sanitizeField(where)} — ${title} (PR #${a.prNumber} · ${tag}${note})`
}

export const SECURITY_HINT =
  'Fix the findings and push (a fixed finding disappears on the next scan), or ask a human to disposition them in the web delivery panel — disposition is human-only, you cannot disposition them yourself, and a blocking finding refuses DONE with 409.'

/**
 * Render the `[SECURITY]` next-action lines (LUM-737). LUM-988: an AI-review
 * correctness finding (`review:<kind>`) is tagged `[BUG]` — it rides the same
 * scan and the same disposition flow, but it is not a security finding.
 */
export function pushSecurityActions(
  lines: string[],
  securityActions: SecurityAction[]
): void {
  for (const a of securityActions) {
    const tag = isCodeReviewFinding(a.ruleId) ? 'BUG' : 'SECURITY'
    lines.push(`  • [${tag}] ${formatSecurityAction(a)}`)
  }
}

/** `Next actions (2 security findings):`, or split when bugs are present (LUM-988). */
export function securityActionsHeading(
  securityActions: SecurityAction[]
): string {
  const ruleIds = securityActions.map(a => a.ruleId)
  if (!ruleIds.some(isCodeReviewFinding))
    return `Next actions (${ruleIds.length} security finding${ruleIds.length === 1 ? '' : 's'}):`
  return `Next actions (${findingCountPhrase(ruleIds)}):`
}

/** Fail-closed security coverage lines (LUM-737): a failed read and every
 *  open PR without a successful scan are stated, never left silent. */
type ScanSummary = NonNullable<
  NonNullable<TaskStatusResponse['securityFindings']>['scans']
>[number]

/** LUM-735 — one line per linked PR's latest scan: `PR #945 · scan CLEAN ·
 *  Secrets: checked · Code scan: checked (2 external findings) · …` — the
 *  layer grammar lives in `cli/src/lib/scan-format.ts`, shared with
 *  `lumo pr scan` (LUM-788) so the two surfaces cannot drift.
 *  LUM-756 (P8): `error` has two writers — only the prefixed, scrubbed
 *  scanner reason may be printed, and only when the layer FAILED. */
function formatScanSummaryLine(s: ScanSummary): string {
  return (
    `  PR #${s.prNumber} · scan ${formatScanStatus(s.status, s.stages, s.scanningOff === true, s.prTooLarge != null)}` +
    formatScanLayerTail({
      status: s.status,
      stages: s.stages,
      huntProgress: s.huntProgress,
      partialCauses: s.partialCauses,
      huntOverCap: s.huntOverCap,
      judgeOverCap: s.judgeOverCap,
      prTooLarge: s.prTooLarge,
      partial: s.partial,
      externalFindings: s.externalFindings,
      dependencyFindings: s.dependencyFindings,
      persistingFindings: s.persistingFindings,
      queueExits: s.queueExits,
      externalFailureReason:
        s.stages.external === 'FAILED' ? externalFailureReason(s.error) : null,
    })
  )
}

export function pushSecurityCoverage(
  lines: string[],
  data: TaskStatusResponse
): void {
  if (data.securityFindings === undefined) return // older server
  if (data.securityFindings === null) {
    lines.push(
      '⚠ Security-scan check failed — could not confirm whether any findings are undispositioned.'
    )
    return
  }
  // LUM-735: absent `scans` = older server; tolerate silently, no block.
  for (const s of data.securityFindings.scans ?? []) {
    lines.push(formatScanSummaryLine(s))
    // LUM-832: the file cap, stated like CodeRabbit states its own.
    for (const l of formatSizeCapLines(s)) lines.push(`    ${l}`)
    // LUM-892: layers turned off in settings — the customer's choice.
    for (const l of formatTurnedOffLines(s.stages)) lines.push(`    ${l}`)
    // LUM-901: scanning itself is off — this scan is for an earlier commit.
    for (const l of formatScanningOffLines(s.scanningOff))
      lines.push(`    ${l}`)
    // LUM-762: absent/null = older server or no usable audit — stay silent.
    if (s.hunt && s.hunt.categories.length > 0) {
      lines.push(`    ${formatHuntCoverageLine(s.hunt)}`)
    }
  }
  for (const u of data.securityFindings.unconfirmedPrs) {
    const why =
      u.reason === 'SCANNING_OFF'
        ? "security scanning is turned off in this workspace's settings"
        : u.reason === 'NONE'
          ? 'no security scan has run'
          : u.reason === 'FAILED'
            ? "security scan didn't finish on our side"
            : u.reason === 'TOO_LARGE'
              ? 'the PR is too large to scan, so nothing in it was scanned (split it or narrow its scope to get it scanned)'
              : `security scan still ${u.reason}`
    lines.push(`⚠ PR #${u.number}: ${why} — could not confirm it is clean.`)
  }
}

/**
 * Render the task status as prose (v2, LUM-942): header, next actions
 * (undispositioned security findings first — the only ones that can hold
 * DONE — then the advisory test-case rows), the security-scan coverage
 * lines, and open boundary crossings. `--full` adds the dashboard sections
 * (cost, struggle/rework trail, trend).
 */
export function formatTaskStatus(
  data: TaskStatusResponse,
  extras: TaskStatusExtras = {}
): string {
  const lines: string[] = []
  const t = data.task
  lines.push(`${t.identifier}  ${sanitizeField(t.title)}`)
  lines.push(`Status: ${t.status}`)

  const {
    security: securityActions,
    testCase: testCaseActions,
    testCaseVerdict: testCaseVerdictActions,
  } = splitNextActions(data.nextActions)

  if (extras.full) {
    pushCost(lines, data)
    pushStruggleTrail(lines, data)
    pushTrend(lines, data)
  }

  lines.push('')
  if (securityActions.length > 0) {
    lines.push(securityActionsHeading(securityActions))
    pushSecurityActions(lines, securityActions)
    lines.push(SECURITY_HINT)
  } else if (
    testCaseActions.length === 0 &&
    testCaseVerdictActions.length === 0
  ) {
    lines.push('Next actions: none on record.')
  } else {
    lines.push('Next actions (advisory only):')
  }
  // LUM-807: advisory last — after everything that can actually hold DONE.
  pushTestCaseActions(lines, testCaseActions)
  // LUM-808: 判决层 advisory 读的是用例最新一次跑出来的结论。
  pushTestCaseVerdictActions(lines, testCaseVerdictActions)
  pushSecurityCoverage(lines, data)

  pushOpenCrossings(lines, extras)
  return lines.join('\n') + '\n'
}

/** Compact a token count for the terminal — 1_200_000 → "1.2M", 850_000 →
 *  "850K", 0 → "0". Uses the SAME Intl compact formatter the web card's
 *  fmtCompact uses (notation:'compact', maximumFractionDigits:1) so the same
 *  number reads identically in both surfaces — no presentation drift (LUM-560). */
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
function fmtTokens(n: number): string {
  return TOKEN_FMT.format(n)
}

/** Active (non-idle) seconds → a compact "2h 14m" / "3m 5s" / "12s". 0 → "0s". */
function fmtDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec))
  if (sec === 0) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  // Show seconds only when the duration is under an hour (keeps long runs tidy).
  if (s > 0 && h === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

/**
 * Append the honest "Cost" section (LUM-560): token spend and active time,
 * read from the same loadActuals source as the web card (no drift). Token
 * cost is fail-closed: a null reads as an explicit "not recorded" line, never
 * a silent or fake 0. Skipped only when the server didn't emit the field.
 */
function pushCost(lines: string[], data: TaskStatusResponse): void {
  const cost = data.cost
  if (!cost) return // can't fabricate cost, so don't claim any.

  lines.push('')
  lines.push('Cost:')
  lines.push(
    cost.tokenCost == null
      ? '  Tokens: not recorded (no session usage captured)'
      : `  Tokens: ${fmtTokens(cost.tokenCost)}`
  )
  lines.push(`  Active time: ${fmtDuration(cost.activeTimeSec)} (non-idle)`)
}

/**
 * Append the honest "Struggle / rework" section (LUM-561): PR cycles and
 * reopens, rendered even on a clean task so the report never wipes the
 * struggle. When the trail is genuinely empty the block states the basis for
 * that rather than leaving a bare clean slate.
 */
function pushStruggleTrail(lines: string[], data: TaskStatusResponse): void {
  const trail = data.struggleTrail
  if (!trail) return // can't fabricate, so don't claim "none".

  lines.push('')
  lines.push('Struggle / rework:')

  // A single PR is the happy path; >1 PR is the iteration signal (LUM-557).
  // Reopens (a bounce after IN_REVIEW/DONE) always count.
  const prIterated = trail.pullRequests.length > 1
  if (trail.reopens.length === 0 && !prIterated) {
    const prs = trail.pullRequests.length
    lines.push(
      `  None recorded — ${prs} PR${prs === 1 ? '' : 's'}, no reopens.`
    )
    return
  }
  if (prIterated) {
    const PR_CAP = 12
    const nums = trail.pullRequests.map(p => `#${p.number}`)
    const shown = nums.slice(0, PR_CAP).join(', ')
    const overflow =
      nums.length > PR_CAP ? `, +${nums.length - PR_CAP} more` : ''
    lines.push(
      `  PR iterations: ${trail.pullRequests.length} PRs (${shown}${overflow})`
    )
  }
  if (trail.reopens.length > 0) {
    lines.push(
      `  Reopened ${trail.reopens.length}× (bounced back after review/done):`
    )
    for (const r of trail.reopens) {
      lines.push(`    • ${r.from} → ${r.to}`)
    }
  }
}

/** Direction glyph for a delta — ↑ up, ↓ down, → flat. */
function arrow(delta: number): string {
  return delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
}

/**
 * Append the "Trend" section (LUM-562, 趋势非快照): cost per session and
 * accrued rework across the task's attempts. A single data point is NOT a
 * trajectory — with one session the section says so outright rather than
 * drawing a fake arrow. Per-session cost reuses the Cost section's source, so
 * the points sum to the Cost total.
 */
function pushTrend(lines: string[], data: TaskStatusResponse): void {
  const trend = data.trend
  if (!trend) return // no trend data — don't invent one.

  const cost = trend.cost
  const rw = trend.rework

  lines.push('')
  if (cost.length === 0) {
    lines.push('Trend:')
    lines.push('  No measured cost yet — nothing to trend.')
    lines.push(`  ${rw.total === 0 ? 'rework none' : `rework ${rw.total}`}`)
    return
  }
  if (cost.length === 1) {
    lines.push('Trend:')
    lines.push(
      '  Single attempt so far — no trajectory yet (a trend needs ≥2 sessions).'
    )
    lines.push(
      `  cost ${fmtTokens(cost[0]!.total)} tokens · ${rw.total === 0 ? 'rework none' : `rework ${rw.total}`}`
    )
    return
  }

  lines.push(`Trend (${cost.length} sessions):`)
  const first = cost[0]!.total
  const last = cost[cost.length - 1]!.total
  const total = cost.reduce((a, c) => a + c.total, 0)
  lines.push(
    `  Cost/session: ${fmtTokens(first)} → ${fmtTokens(last)} tokens  (${arrow(last - first)}), ${fmtTokens(total)} total over ${cost.length} sessions`
  )

  // Rework accrual — monotonic from a clean baseline of 0.
  if (rw.total === 0) {
    lines.push('  Rework: none accrued (0) — clean across every attempt')
  } else {
    const parts: string[] = []
    if (rw.reopens > 0)
      parts.push(`${rw.reopens} reopen${rw.reopens === 1 ? '' : 's'}`)
    if (rw.extraPrCycles > 0)
      parts.push(
        `+${rw.extraPrCycles} PR cycle${rw.extraPrCycles === 1 ? '' : 's'}`
      )
    lines.push(
      `  Rework: ${rw.total} accrued — ${parts.join(', ')}  (↑ from 0)`
    )
  }
}

/**
 * Append the OPEN boundary-crossings safety block (LUM-448) — a count, one line
 * per crossing with its severity + category + clipped detail, and a pointer to
 * the human-only web disposition panel. Trailing, and silent when there are
 * none.
 * Read-only awareness: the line points at the web UI; it offers no way to clear
 * a crossing from the terminal (LUM-426/435/422).
 */
function pushOpenCrossings(lines: string[], extras: TaskStatusExtras): void {
  const result = extras.openCrossings
  if (!result) return
  // LUM-480: a failed check is NOT "0 open / safe" — say so explicitly rather
  // than rendering an empty (implicitly-clear) block.
  if (result.status === 'error') {
    lines.push('')
    lines.push(
      '⚠ Boundary-crossing check failed (network/server error) — could not confirm whether any are undispositioned.'
    )
    return
  }
  const open = result.crossings
  if (open.length === 0) return
  // LUM-771: say which rows the server DONE gate actually counts — advisory
  // rows (and, with the gate off, non-HIGH rows) are awareness, not blockers.
  const blocking = open.filter(c => c.blocking)
  const rest = open.filter(c => !c.blocking)
  lines.push('')
  lines.push(
    `⚠ Open boundary crossings (${open.length} undispositioned: ${blocking.length} blocking DONE, ${rest.length} advisory / non-blocking):`
  )
  for (const c of open) {
    const detail = oneLineDetail(c.detail)
    const tail = detail ? ` — ${detail}` : ''
    // LUM-780: an advisory row that a SYSTEM re-judge produced says why, so
    // "advisory" reads as a reasoned state rather than a silent downgrade.
    const rejudged = c.rejudge
      ? ` · re-judged: ${sanitizeField(c.rejudge)}`
      : ''
    const gate = c.blocking
      ? ''
      : c.advisory
        ? ` (advisory — does not block DONE${rejudged})`
        : ' (below the workspace gate — does not block DONE)'
    lines.push(
      `  ${c.blocking ? '•' : '◦'} [${c.severity}] ${sanitizeField(c.category)}${gate}${tail}`
    )
    lines.push(`    ${formatAttribution(c.attribution)}`)
  }
  lines.push(
    "  Disposition is the user's call: relay each crossing, then `lumo crossing disposition <id> --false-positive | --confirmed` (exit-4 envelope; never self-approve), or the web acceptance panel:"
  )
  if (extras.dispositionUrl) {
    lines.push(`    ${extras.dispositionUrl}`)
  }
}

/**
 * Compact attribution line for an open crossing (LUM-469): which model + which
 * agent/session committed it, so a reviewer can audit who/what crossed from the
 * terminal. Every dimension that the server couldn't resolve renders `unknown`
 * — never a fabricated value. The session UUID is clipped to a correlatable
 * prefix; the worktree branch (which branch) is appended to the agent when known.
 */
function formatAttribution(a: CrossingAttribution): string {
  const agent = a.agent
    ? a.worktreeBranch
      ? `${a.agent}/${a.worktreeBranch}`
      : a.agent
    : 'unknown'
  const session = a.sessionId ? a.sessionId.slice(0, 8) : 'unknown'
  return `↳ by model=${a.model ?? 'unknown'} · agent=${agent} · session=${session}`
}

/**
 * `lumo task status [task] [--json] [--full]` — the agent's read-only
 * self-check (LUM-344): next actions (security findings, test-case
 * advisories), scan coverage and open crossings, straight from the server's
 * derived read model. Run it first when resuming a task in a new session.
 * Defaults to the session-bound task; an explicit identifier overrides.
 */
export async function taskStatus(
  identifier: string | undefined,
  options: TaskStatusOptions = {}
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))

  let taskId = identifier
  if (!taskId) {
    taskId = (await resolveBoundTaskIdentifier(base, creds.token)) ?? undefined
    if (!taskId) {
      console.error(
        'Error: no task given and this session is not bound to one.\n' +
          'Run `lumo task status <LUM-N>`, or bind first with `lumo session attach <LUM-N>`.'
      )
      return 1
    }
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/status`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${taskId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: task status failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as TaskStatusResponse

  // Read-only awareness (LUM-448): surface the task's OPEN boundary crossings
  // via the existing LUM-435 endpoint. fetchOpenCrossings returns a result that
  // distinguishes a check FAILURE from a genuine 0-open read (LUM-480), so this
  // supplementary safety signal never masquerades a hiccup as "all clear" — yet
  // it still never throws, so it can't block the primary status read. The
  // resolved taskId (the identifier the status was fetched for) is the key here.
  const crossingsResult = await fetchOpenCrossings(base, creds.token, taskId)

  if (options.json) {
    // JSON.stringify escapes control chars (…), so the payload is safe
    // to emit raw — and consumers get byte-faithful server data.
    // openCrossings rides alongside as an additive field: an array on success
    // (count = length), or `null` when the check failed (LUM-480) — distinct
    // from `[]`, which is a successful read with zero open crossings.
    const openCrossings =
      crossingsResult.status === 'ok' ? crossingsResult.crossings : null
    process.stdout.write(
      JSON.stringify({ ...data, openCrossings }, null, 2) + '\n'
    )
    return
  }
  process.stdout.write(
    formatTaskStatus(data, {
      full: options.full === true,
      openCrossings: crossingsResult,
      dispositionUrl: dispositionUrl(
        base,
        creds.workspaceSlug ?? 'lumo',
        data.task.identifier
      ),
    })
  )
}
