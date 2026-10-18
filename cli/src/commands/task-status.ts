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
  formatSizeCapLines,
  formatScanStatus,
  formatTurnedOffLines,
  formatScanningOffLines,
  scanFields,
  type JudgeOverCapLine,
  type JudgePartialLine,
  type PrTooLargeLine,
} from '../lib/scan-format'
import {
  fetchOpenCrossings,
  dispositionUrl,
  type OpenCrossing,
  type OpenCrossingsResult,
  type CrossingAttribution,
} from '../lib/open-crossings'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  bulletLines,
  commandLine,
  fieldLines,
  sectionHeading,
  wrapLines,
  type Field,
  type LayoutOptions,
} from '../lib/report-layout'
import { colorEnabled, enumColor, terminalWidth } from '../lib/ui'
import { doneGateSection, type DoneGateReadout } from '../lib/done-gate-format'
import { emptyState, fmtTokens, formatDurationSec } from '../lib/format'
import {
  fetchTaskTestCases,
  type TaskTestCasesResult,
} from '../lib/task-test-cases-read'
import { formatTestCasesSummary } from '../lib/test-case-report'
import { formatListRow } from './task-testcase-list'
import { shortRef } from '../../../shared/src/short-ref'
import {
  assessReadiness,
  assessWorktrees,
  formatDoneReadiness,
  readJson,
  readinessNextCommand,
  type ReadinessInput,
  type ReadinessTask,
} from '../lib/done-readiness'

export interface TaskStatusOptions {
  /** Emit the versioned machine-readable payload instead of prose. */
  json?: boolean
  /** LUM-733: also print the dashboard sections (cost, struggle/rework
   *  trail, trend, and — LUM-1186 — each test case's latest run). Off by default — the agent self-check is the next actions
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
  /** LUM-1186: the `--full` Test cases section's read (same payload as
   *  `lumo task testcase list`). Absent = not read, section skipped. */
  testCases?: TaskTestCasesResult | undefined
  /** LUM-1091: report width (default 100) and styling (default off — the
   *  command passes `colorEnabled()`, so a pure call stays plain text). */
  width?: number | undefined
  color?: boolean | undefined
  /** LUM-1232 D-4: `false` = piped, no hard wrapping. */
  tty?: boolean | undefined
  /** LUM-1233: the DONE-readiness section (formerly `task wrapup`), rendered
   *  only when the task is READY. Absent = not READY or not assessed. */
  readinessLines?: string[] | undefined
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
   *  self-report). JSON-only: the text report does not render it. */
  claim?: {
    text: string | null
    source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST' | null
  }
  /** LUM-583: whether the CLAIM faithfully reflects the delivery, read from
   *  the persisted verdict. JSON-only: the text report does not render it. */
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
        ceilingReason?: 'environment' | 'unobserved' | 'skipped' | 'no-evidence'
        /** LUM-1186: a proven defect nobody has ruled on — refuses DONE.
         *  Absent on an older server. */
        blocking?: boolean
        advisory: boolean
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
  /** LUM-1186: the Done gate, derived server-side by the web Record tab's
   *  `deriveDoneGate`. Absent on an older server (rendered as "cannot
   *  confirm"). */
  doneGate?: DoneGateReadout
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
      judgeOverCap?: JudgeOverCapLine | null
      /** LUM-1144 — the AI review read part of an over-cap diff; absent on an older server. */
      judgePartial?: JudgePartialLine | null
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

/**
 * One advisory item + the command that clears it (LUM-807). LUM-1091: the
 * item wraps at the report width and ends in `— run:`; the command follows
 * alone on its own line.
 */
export function pushTestCaseActions(
  lines: string[],
  actions: TestCaseAction[],
  opts: LayoutOptions = {}
): void {
  for (const a of actions) {
    // LUM-819: an unknown advisory kind may lack either field — never print
    // "undefined"; fall back to its kind.
    const statement =
      typeof a.statement === 'string' ? a.statement : String(a.kind)
    const hasCommand = typeof a.command === 'string'
    lines.push(
      ...bulletLines(
        `[TEST CASE] ${sanitizeField(statement)} (advisory)${hasCommand ? ' — run:' : ''}`,
        2,
        opts
      )
    )
    if (hasCommand) lines.push(commandLine(sanitizeField(a.command), 4))
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
  skipped: 'some steps were skipped',
  'no-evidence': 'no evidence attached',
}

/**
 * LUM-1186: what the DONE gate does with a verdict row. A proven defect whose
 * latest run nobody has ruled on refuses DONE (409, `computeDoneVerdict`'s
 * TEST_CASE_DEFECT blocker); once ruled on, or for any other signal, it never
 * does. An older server sends no `blocking` — a proven defect then may block,
 * and is never called advisory.
 */
export function testCaseVerdictGate(a: TestCaseVerdictAction): string {
  if (a.signal !== 'PROVEN_DEFECT') return 'advisory'
  if (a.blocking === true) return 'blocks DONE until the user rules on it'
  if (a.blocking === false) return 'ruled on — does not block DONE'
  return 'blocks DONE unless that run was already ruled on'
}

/** A verdict row that holds DONE back (or may, on an older server). */
export function testCaseVerdictBlocks(a: TestCaseVerdictAction): boolean {
  return a.signal === 'PROVEN_DEFECT' && a.blocking !== false
}

/** The text of one verdict row, without its bullet. */
export function testCaseVerdictText(a: TestCaseVerdictAction): string {
  const why =
    a.signal === 'UNPROVEN_PASS' && a.ceilingReason
      ? ` (${CEILING_REASON_LABEL[a.ceilingReason]})`
      : ''
  return `[TEST CASE] TC${a.number} ${sanitizeField(a.title)} — ${VERDICT_LABEL[a.signal]}${why} (${testCaseVerdictGate(a)})`
}

/** 一条判决层 advisory 渲染成一行。导出给测试用。 */
export function formatTestCaseVerdictAction(a: TestCaseVerdictAction): string {
  return `  • ${testCaseVerdictText(a)}`
}

export function pushTestCaseVerdictActions(
  lines: string[],
  actions: TestCaseVerdictAction[],
  opts: LayoutOptions = {}
): void {
  for (const a of actions)
    lines.push(...bulletLines(testCaseVerdictText(a), 2, opts))
}

/**
 * One security next-action as an item (LUM-1091): the title on the bullet
 * line, then labelled rows — rule + provenance, where (file:line, PR), and
 * whether it blocks DONE. Same facts, in the same words, as the one-line
 * grammar it replaces.
 */
function securityActionLines(a: SecurityAction, opts: LayoutOptions): string[] {
  const where = a.line == null ? a.filePath : `${a.filePath}:${a.line}`
  const title = sanitizeField(a.statement.split(' — ').slice(1).join(' — '))
  const gate = a.blocking ? 'blocks DONE' : 'advisory'
  // LUM-758 follow-up: a downgraded row is still reported on purpose, so the
  // row has to say WHY it is LOW — otherwise a placeholder the scanner already
  // recognised reads as an unexplained credential.
  const note = sanitizeField(secretDowngradeNote(a.secretDowngrade))
  // LUM-988: an AI-review correctness finding (`review:<kind>`) is tagged
  // `[BUG]` — same scan, same disposition flow, not a security finding.
  const tag = isCodeReviewFinding(a.ruleId) ? 'BUG' : 'SECURITY'
  const rule = sanitizeField(a.ruleId)
  return [
    ...bulletLines(`[${tag}] [${a.severity}] ${title || rule}`, 2, opts),
    ...fieldLines(
      [
        { label: 'Rule', value: `${rule} (${a.provenance})` },
        {
          label: 'Where',
          value: `${sanitizeField(where)} · PR #${a.prNumber}`,
        },
        { label: 'Gate', value: `${gate}${note}` },
        // LUM-1128 / LUM-1230: the short ref `lumo finding disposition` takes.
        { label: 'Ref', value: sanitizeField(shortRef(a.findingId)) },
      ],
      4,
      opts
    ),
  ]
}

export const SECURITY_HINT =
  'Fix the findings and push (a fixed finding disappears on the next scan), or relay them to the user — the ruling is theirs. The command below prints an exit-4 envelope; add --confirm only after the user approves it (the web delivery panel also works). Never self-approve; a blocking finding refuses DONE with 409:'

/** LUM-1128: the user's terminal path for a finding, on a line of its own. */
export const SECURITY_DISPOSITION_COMMAND =
  'lumo finding disposition <id...> --false-positive | --accepted-risk'

/** The hint under the `[SECURITY]` items: prose, then the command line. */
export function securityHintLines(opts: LayoutOptions = {}): string[] {
  return [
    ...wrapLines(SECURITY_HINT, 2, opts),
    commandLine(SECURITY_DISPOSITION_COMMAND, 4),
  ]
}

/** Render the `[SECURITY]` / `[BUG]` next-action items (LUM-737, LUM-988). */
export function pushSecurityActions(
  lines: string[],
  securityActions: SecurityAction[],
  opts: LayoutOptions = {}
): void {
  for (const a of securityActions) lines.push(...securityActionLines(a, opts))
}

/** `Next actions (2 security findings)`, or split when bugs are present (LUM-988). */
export function securityActionsHeading(
  securityActions: SecurityAction[]
): string {
  const ruleIds = securityActions.map(a => a.ruleId)
  if (!ruleIds.some(isCodeReviewFinding))
    return `Next actions (${ruleIds.length} security finding${ruleIds.length === 1 ? '' : 's'})`
  return `Next actions (${findingCountPhrase(ruleIds)})`
}

/** Fail-closed security coverage lines (LUM-737): a failed read and every
 *  open PR without a successful scan are stated, never left silent. */
type ScanSummary = NonNullable<
  NonNullable<TaskStatusResponse['securityFindings']>['scans']
>[number]

/**
 * LUM-735 — one block per linked PR's latest scan: a `PR #945 · scan CLEAN`
 * line, then one labelled row per layer (LUM-1091) — the layer grammar lives
 * in `cli/src/lib/scan-format.ts`, shared with `lumo pr show` (LUM-788) so
 * the two surfaces cannot drift. LUM-756 (P8): `error` has two writers —
 * only the prefixed, scrubbed scanner reason may be printed, and only when
 * the layer FAILED.
 */
function scanSummaryLines(s: ScanSummary, opts: LayoutOptions): string[] {
  const lines = [
    `  PR #${s.prNumber} · scan ${formatScanStatus(s.status, s.stages, s.scanningOff === true, s.prTooLarge != null)}`,
  ]
  lines.push(
    ...fieldLines(
      scanFields(
        {
          status: s.status,
          stages: s.stages,
          huntProgress: s.huntProgress,
          partialCauses: s.partialCauses,
          huntOverCap: s.huntOverCap,
          judgeOverCap: s.judgeOverCap,
          judgePartial: s.judgePartial,
          prTooLarge: s.prTooLarge,
          partial: s.partial,
          externalFindings: s.externalFindings,
          dependencyFindings: s.dependencyFindings,
          persistingFindings: s.persistingFindings,
          queueExits: s.queueExits,
          externalFailureReason:
            s.stages.external === 'FAILED'
              ? externalFailureReason(s.error)
              : null,
        },
        // LUM-762: absent/null = older server or no usable audit — silent.
        { hunt: s.hunt ?? null }
      ),
      4,
      opts
    )
  )
  // LUM-832: the file cap, stated plainly as a limit on the change.
  // LUM-892: layers turned off in settings — the customer's choice.
  // LUM-901: scanning itself is off — this scan is for an earlier commit.
  for (const l of [
    ...formatSizeCapLines(s),
    ...formatTurnedOffLines(s.stages),
    ...formatScanningOffLines(s.scanningOff),
  ])
    lines.push(...wrapLines(l, 4, opts))
  return lines
}

export function pushSecurityCoverage(
  lines: string[],
  data: TaskStatusResponse,
  opts: LayoutOptions = {}
): void {
  if (data.securityFindings === undefined) return // older server
  if (data.securityFindings === null) {
    lines.push(
      ...wrapLines(
        '⚠ Security-scan check failed — could not confirm whether any findings are undispositioned.',
        2,
        opts
      )
    )
    return
  }
  // LUM-735: absent `scans` = older server; tolerate silently, no block.
  for (const s of data.securityFindings.scans ?? [])
    lines.push(...scanSummaryLines(s, opts))
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
    lines.push(
      ...wrapLines(
        `⚠ PR #${u.number}: ${why} — could not confirm it is clean.`,
        2,
        opts
      )
    )
  }
}

/**
 * Render the task status as prose (v2, LUM-942): header, next actions
 * (undispositioned security findings first — the only ones that can hold
 * DONE — then the advisory test-case rows), the security-scan coverage, and
 * open boundary crossings. `--full` adds the dashboard sections (cost,
 * struggle/rework trail, trend). LUM-1091: every section is a heading over
 * labelled rows, nested at most three levels deep; prose wraps at the report
 * width and commands keep a line of their own.
 */
export function formatTaskStatus(
  data: TaskStatusResponse,
  extras: TaskStatusExtras = {}
): string {
  const opts: LayoutOptions = {
    width: extras.width,
    color: extras.color,
    tty: extras.tty,
  }
  const lines: string[] = []
  const t = data.task
  lines.push(`${t.identifier}  ${sanitizeField(t.title)}`)
  lines.push(`Status: ${enumColor(t.status, opts.color === true)}`)
  // LUM-1186: the single verdict first — the web Record tab's Done gate.
  lines.push(...doneGateSection(data.doneGate, opts))
  // The claim / faithfulness verdict is NOT rendered here (user ruling
  // 2026-10-17); it stays in `--json` (additive-only contract).

  const {
    security: securityActions,
    testCase: testCaseActions,
    testCaseVerdict: testCaseVerdictActions,
  } = splitNextActions(data.nextActions)

  if (extras.full) {
    pushCost(lines, data, opts)
    pushStruggleTrail(lines, data, opts)
    pushTrend(lines, data, opts)
    pushTestCases(lines, extras.testCases, data.task.identifier, opts)
  }

  if (securityActions.length > 0) {
    lines.push(...sectionHeading(securityActionsHeading(securityActions), opts))
    pushSecurityActions(lines, securityActions, opts)
    lines.push(...securityHintLines(opts))
  } else if (
    testCaseActions.length === 0 &&
    testCaseVerdictActions.length === 0
  ) {
    lines.push(...sectionHeading('Next actions', opts))
    lines.push(`  ${emptyState('next actions')}`)
  } else if (testCaseVerdictActions.some(testCaseVerdictBlocks)) {
    // LUM-1186: a proven defect holds DONE — never "advisory only".
    lines.push(...sectionHeading('Next actions', opts))
  } else {
    lines.push(...sectionHeading('Next actions (advisory only)', opts))
  }
  // LUM-807: advisory last — after everything that can actually hold DONE.
  pushTestCaseActions(lines, testCaseActions, opts)
  // LUM-808: 判决层 advisory 读的是用例最新一次跑出来的结论。
  pushTestCaseVerdictActions(lines, testCaseVerdictActions, opts)

  const coverage: string[] = []
  pushSecurityCoverage(coverage, data, opts)
  if (coverage.length > 0) {
    lines.push(...sectionHeading('Security scans', opts))
    lines.push(...coverage)
  }

  pushOpenCrossings(lines, extras, opts)
  if (extras.readinessLines) lines.push(...extras.readinessLines)
  return lines.join('\n') + '\n'
}

/**
 * LUM-1186: the `--full` "Test cases" section — one line per case, the very
 * row `lumo task testcase list` prints (`formatListRow`: number, sanitized
 * title, steps, latest result with its ceiling / cause / step progress / date,
 * or `never run`), then the server-computed `N/M passing · …` summary. Only
 * renders; every verdict comes from the server. A failed read says so
 * (fail-closed) instead of looking like "no test cases".
 */
export function pushTestCases(
  lines: string[],
  read: TaskTestCasesResult | undefined,
  identifier: string,
  opts: LayoutOptions = {}
): void {
  if (!read) return
  lines.push(...sectionHeading('Test cases', opts))
  if (read.status === 'error') {
    lines.push(
      `  ⚠ could not read test cases (${sanitizeField(read.reason)}) — retry with: lumo task testcase list ${identifier}`
    )
    return
  }
  if (read.testCases.length === 0) {
    lines.push('  None recorded.')
    return
  }
  for (const c of read.testCases) lines.push(`  ${formatListRow(c)}`)
  const summary = formatTestCasesSummary(read.summary, 'task')
  if (summary) lines.push(`  ${summary}`)
}

/**
 * Append the honest "Cost" section (LUM-560): token spend and active time,
 * read from the same loadActuals source as the web card (no drift). Token
 * cost is fail-closed: a null reads as an explicit "not recorded" row, never
 * a silent or fake 0. Skipped only when the server didn't emit the field.
 */
function pushCost(
  lines: string[],
  data: TaskStatusResponse,
  opts: LayoutOptions
): void {
  const cost = data.cost
  if (!cost) return // can't fabricate cost, so don't claim any.

  lines.push(...sectionHeading('Cost', opts))
  lines.push(
    ...fieldLines(
      [
        {
          label: 'Tokens',
          value:
            cost.tokenCost == null
              ? 'not recorded (no session usage captured)'
              : fmtTokens(cost.tokenCost),
        },
        {
          label: 'Active time',
          value: `${formatDurationSec(cost.activeTimeSec)} (non-idle)`,
        },
      ],
      2,
      opts
    )
  )
}

/**
 * Append the honest "Struggle / rework" section (LUM-561): PR cycles and
 * reopens, rendered even on a clean task so the report never wipes the
 * struggle. When the trail is genuinely empty the block states the basis for
 * that rather than leaving a bare clean slate.
 */
function pushStruggleTrail(
  lines: string[],
  data: TaskStatusResponse,
  opts: LayoutOptions
): void {
  const trail = data.struggleTrail
  if (!trail) return // can't fabricate, so don't claim "none".

  lines.push(...sectionHeading('Struggle / rework', opts))

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
  const fields: Field[] = []
  if (prIterated) {
    const PR_CAP = 12
    const nums = trail.pullRequests.map(p => `#${p.number}`)
    const shown = nums.slice(0, PR_CAP).join(', ')
    const overflow =
      nums.length > PR_CAP ? `, +${nums.length - PR_CAP} more` : ''
    fields.push({
      label: 'PR iterations',
      value: `${trail.pullRequests.length} PRs (${shown}${overflow})`,
    })
  }
  if (trail.reopens.length > 0) {
    fields.push({
      label: 'Reopened',
      value: `${trail.reopens.length}× (bounced back after review/done)`,
      sub: trail.reopens.map(r => `${r.from} → ${r.to}`),
    })
  }
  lines.push(...fieldLines(fields, 2, opts))
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
function pushTrend(
  lines: string[],
  data: TaskStatusResponse,
  opts: LayoutOptions
): void {
  const trend = data.trend
  if (!trend) return // no trend data — don't invent one.

  const cost = trend.cost
  const rw = trend.rework
  const reworkShort = rw.total === 0 ? 'none' : String(rw.total)

  if (cost.length === 0) {
    lines.push(...sectionHeading('Trend', opts))
    lines.push('  No measured cost yet — nothing to trend.')
    lines.push(
      ...fieldLines([{ label: 'Rework', value: reworkShort }], 2, opts)
    )
    return
  }
  if (cost.length === 1) {
    lines.push(...sectionHeading('Trend', opts))
    lines.push(
      ...wrapLines(
        'Single attempt so far — no trajectory yet (a trend needs ≥2 sessions).',
        2,
        opts
      )
    )
    lines.push(
      ...fieldLines(
        [
          { label: 'Cost', value: `${fmtTokens(cost[0]!.total)} tokens` },
          { label: 'Rework', value: reworkShort },
        ],
        2,
        opts
      )
    )
    return
  }

  lines.push(...sectionHeading(`Trend (${cost.length} sessions)`, opts))
  const first = cost[0]!.total
  const last = cost[cost.length - 1]!.total
  const total = cost.reduce((a, c) => a + c.total, 0)
  const fields: Field[] = [
    {
      label: 'Cost/session',
      value: `${fmtTokens(first)} → ${fmtTokens(last)} tokens (${arrow(last - first)})`,
    },
    {
      label: 'Total',
      value: `${fmtTokens(total)} tokens over ${cost.length} sessions`,
    },
  ]

  // Rework accrual — monotonic from a clean baseline of 0.
  if (rw.total === 0) {
    fields.push({
      label: 'Rework',
      value: 'none accrued (0) — clean across every attempt',
    })
  } else {
    const parts: string[] = []
    if (rw.reopens > 0)
      parts.push(`${rw.reopens} reopen${rw.reopens === 1 ? '' : 's'}`)
    if (rw.extraPrCycles > 0)
      parts.push(
        `+${rw.extraPrCycles} PR cycle${rw.extraPrCycles === 1 ? '' : 's'}`
      )
    fields.push({
      label: 'Rework',
      value: `${rw.total} accrued — ${parts.join(', ')} (↑ from 0)`,
    })
  }
  lines.push(...fieldLines(fields, 2, opts))
}

/** The gate wording of one open crossing — what the server DONE gate does with it. */
export function crossingGate(c: OpenCrossing): string {
  return c.blocking
    ? 'blocks DONE'
    : c.advisory
      ? 'advisory — does not block DONE'
      : 'below the workspace gate — does not block DONE'
}

/**
 * Append the OPEN boundary-crossings safety block (LUM-448) — a count, one
 * item per crossing (ref, severity, category, what the gate does with it)
 * with its re-judge evidence, clipped detail and attribution as labelled
 * rows, and a pointer to the disposition command and the human-only web
 * panel. Trailing, and silent when there are none.
 * Read-only awareness: it offers no way to clear a crossing from here
 * (LUM-426/435/422).
 */
function pushOpenCrossings(
  lines: string[],
  extras: TaskStatusExtras,
  opts: LayoutOptions
): void {
  const result = extras.openCrossings
  if (!result) return
  // LUM-480: a failed check is NOT "0 open / safe" — say so explicitly rather
  // than rendering an empty (implicitly-clear) block.
  if (result.status === 'error') {
    lines.push('')
    lines.push(
      ...wrapLines(
        '⚠ Boundary-crossing check failed (network/server error) — could not confirm whether any are undispositioned.',
        0,
        opts
      )
    )
    return
  }
  const open = result.crossings
  if (open.length === 0) return
  // LUM-771: say which rows the server DONE gate actually counts — advisory
  // rows (and, with the gate off, non-HIGH rows) are awareness, not blockers.
  const blocking = open.filter(c => c.blocking)
  const rest = open.filter(c => !c.blocking)
  lines.push(
    ...sectionHeading(
      `Open boundary crossings (${open.length} undispositioned: ${blocking.length} blocking DONE, ${rest.length} advisory / non-blocking)`,
      opts
    )
  )
  for (const c of open) {
    lines.push(
      ...bulletLines(
        `${sanitizeField(c.ref)} [${c.severity}] ${sanitizeField(c.category)} (${crossingGate(c)})`,
        2,
        opts
      )
    )
    const fields: Field[] = []
    // LUM-780: an advisory row that a SYSTEM re-judge produced says why, so
    // "advisory" reads as a reasoned state rather than a silent downgrade.
    if (!c.blocking && c.advisory && c.rejudge)
      fields.push({ label: 'Re-judged', value: sanitizeField(c.rejudge) })
    const detail = oneLineDetail(c.detail)
    if (detail) fields.push({ label: 'Detail', value: detail })
    fields.push({ label: 'By', value: formatAttribution(c.attribution) })
    lines.push(...fieldLines(fields, 4, opts))
  }
  lines.push(
    ...wrapLines(
      "Disposition is the user's call: relay each crossing, then run (exit-4 envelope; never self-approve):",
      2,
      opts
    ),
    commandLine(
      'lumo crossing disposition <id> --false-positive | --confirmed',
      4
    )
  )
  if (extras.dispositionUrl) {
    lines.push('  Or the web acceptance panel:')
    lines.push(commandLine(extras.dispositionUrl, 4))
  }
}

/**
 * Compact attribution for an open crossing (LUM-469): which model + which
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
  return `model=${a.model ?? 'unknown'} · agent=${agent} · session=${session}`
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
    console.error(errNotLoggedIn())
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
    console.error(errAuth())
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${taskId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('task status', res.status))
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

  // LUM-1233: DONE readiness (formerly `task wrapup`) — the task and its
  // linked PRs plus the local worktrees decide whether the task is READY.
  const readinessInput = await readReadinessInput(
    base,
    creds.token,
    data,
    crossingsResult
  )
  const readiness = assessReadiness(readinessInput)

  if (options.json) {
    // JSON.stringify escapes control chars (…), so the payload is safe
    // to emit raw — and consumers get byte-faithful server data.
    // openCrossings rides alongside as an additive field: an array on success
    // (count = length), or `null` when the check failed (LUM-480) — distinct
    // from `[]`, which is a successful read with zero open crossings.
    const openCrossings =
      crossingsResult.status === 'ok' ? crossingsResult.crossings : null
    // LUM-1233: `readiness` is additive — the level, its reasons and, when
    // READY, the one command to run next.
    const readinessJson = {
      level: readiness.level,
      reasons: readiness.reasons,
      nextCommand: readinessNextCommand(readinessInput, readiness),
    }
    process.stdout.write(
      JSON.stringify(
        { ...data, openCrossings, readiness: readinessJson },
        null,
        2
      ) + '\n'
    )
    return
  }
  // LUM-1186: the test-case list is a --full section only — the default
  // report never pays for the extra read. `--json` stays unchanged.
  const testCases =
    options.full === true
      ? await fetchTaskTestCases(base, creds.token, taskId)
      : undefined
  process.stdout.write(
    formatTaskStatus(data, {
      full: options.full === true,
      openCrossings: crossingsResult,
      testCases,
      dispositionUrl: dispositionUrl(
        base,
        creds.workspaceSlug ?? 'lumo',
        data.task.identifier
      ),
      width: terminalWidth(),
      tty: Boolean(process.stdout.isTTY),
      color: colorEnabled(),
      readinessLines:
        readiness.level === 'READY'
          ? formatDoneReadiness(readinessInput, readiness, {
              width: terminalWidth(),
              tty: Boolean(process.stdout.isTTY),
              color: colorEnabled(),
            })
          : undefined,
    })
  )
}

/** The inputs of the DONE-readiness verdict for an already-read status. */
async function readReadinessInput(
  base: string,
  token: string,
  status: TaskStatusResponse,
  crossings: OpenCrossingsResult
): Promise<ReadinessInput> {
  const identifier = status.task.identifier
  const task = await readJson(
    `${base}/api/tasks/by-identifier/${encodeURIComponent(identifier)}`,
    token,
    body => {
      const t = (body as { task?: ReadinessTask }).task
      if (!t) throw new Error('no task in response')
      return t
    }
  )
  return {
    identifier,
    status: { ok: true, value: status },
    task,
    crossings,
    worktrees: assessWorktrees(identifier, task),
  }
}
