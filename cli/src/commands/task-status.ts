import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { sanitizeField } from '../lib/sanitize'
import {
  externalFailureReason,
  secretDowngradeNote,
} from '../../../shared/src/security-scan'
import {
  formatHuntCoverageLine,
  formatSizeCapLines,
  formatScanStatus,
  formatTurnedOffLines,
  formatScanLayerTail,
} from '../lib/scan-format'
import {
  fetchOpenCrossings,
  dispositionUrl,
  type OpenCrossingsResult,
  type CrossingAttribution,
} from '../lib/open-crossings'
import {
  formatEvidenceDrilldown,
  resolveRepoWebUrl,
} from '../lib/evidence-display'
// LUM-789 whole-branch review (Findings 1/2): the CLI must not run a second,
// disagreeing "is this criterion unmet" rule against the server's nextActions
// split — both derive from the same isUnmetForDisplay so a tacit-pass HUMAN
// row reads as settled everywhere in one report, never "0 unmet" in the
// header and an open circle in the body. Zero-import — safe to pull into the
// CLI package the same way client components pull it into the web bundle.
import { isUnmetForDisplay } from '../../../lib/acceptance/unmet-display'

export interface TaskStatusOptions {
  /** Emit the versioned machine-readable payload instead of prose. */
  json?: boolean
  /** LUM-733: also print the dashboard sections (verification rollup,
   *  history, cost, struggle/rework trail, trend). Off by default — the agent
   *  self-check is the criteria, the next actions (including undispositioned
   *  security findings, LUM-737), and any open crossings. */
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
  /** The repo's https web base (e.g. https://github.com/owner/repo), resolved
   *  from the local git remote, used to turn a `commit:` evidence pointer into a
   *  navigable URL (LUM-563). Null/absent → the `git show <hash>` fallback. */
  repoWebUrl?: string | null
}

/** One-line a possibly-multiline crossing detail and cap it so the safety block
 *  stays a glance, never a wall (it must not overshadow the criteria). */
const CROSSING_DETAIL_CAP = 160
function oneLineDetail(detail: string): string {
  const firstLine = detail.split('\n')[0] ?? ''
  const clean = sanitizeField(firstLine).trim()
  return clean.length > CROSSING_DETAIL_CAP
    ? `${clean.slice(0, CROSSING_DETAIL_CAP)}…`
    : clean
}

/** Mirrors TaskAcceptanceStatus served by GET /api/tasks/[id]/status (v1). */
export interface TaskStatusResponse {
  version: number
  task: { id: string; identifier: string; title: string; status: string }
  currentRound: number
  maxRounds: number
  escalated: boolean
  criteria: Array<{
    id: string
    statement: string
    verifierType: 'MACHINE' | 'HUMAN'
    checkpointer: string | null
    evidenceRequired: boolean
    /** Agent-drafted human-judging guidance for a HUMAN criterion (LUM-465). */
    judgeSteps: string | null
    source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
    addedAtRound: number
    /** The latest verdict predates the criterion's last edit (LUM-457). */
    verdictStale: boolean
    /** A MACHINE pass whose evidence ran a different command than the current
     *  checkpointer (LUM-457). */
    checkMismatch: boolean
    /** Whether a checkpointer currently vouches for this criterion — true only
     *  for a MACHINE criterion whose latest MACHINE-authored verdict is a PASS
     *  (LUM-456). A passing MACHINE criterion with this false is carried by a
     *  human override, never a machine run; HUMAN criteria are always false.
     *  Read from the server read model so the CLI matches web — never inferred
     *  from latestVerdict alone (LUM-470). */
    machinePassed: boolean
    latestVerdict: {
      round: number
      verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
      evidencePointer: string | null
      rejectionReason: string | null
      rejectionReasonEnum: string | null
      recordedAt: string
    } | null
    /** LUM-511 Phase 5: send-back lifecycle for this criterion (null = never
     *  sent back). */
    sendBackResolution?: {
      status: 'open' | 'resolved'
      failedAtRound: number
      resolvedAtRound?: number
      closingPrNumber?: number
      closingPrUrl?: string
    } | null
    /** LUM-789: when a human confirmed this contract item (ISO), null =
     *  unconfirmed. Never blocks DONE — only feeds the `task status` nudge. */
    confirmedAt: string | null
    /** LUM-815: 声明覆盖本标准的用例,各带最近一次执行。空数组 = 没有任何
     *  用例覆盖它。Optional —— 旧服务端不发这个字段。
     *
     *  纯渲染：用例的结果**不**参与这条标准的裁定,也不进 unmet 计数。 */
    linkedCases?: Array<{
      number: number
      title: string
      latestRun: {
        result: 'PASS' | 'FAIL' | 'BLOCKED'
        ceiling: {
          effective: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNPROVEN'
          reason?: string
        }
        environment: 'LOCAL' | 'PREVIEW' | 'PRODUCTION'
        commitSha: string | null
        commitDirty: boolean | null
        recordedAt: string
      } | null
    }>
  }>
  /** Honest machine-verification rollup over the active MACHINE criteria
   *  (LUM-456): genuine checkpointer passes vs human overrides. Mirrored from
   *  the server read model so the terminal rollup never reads as all-human when
   *  criteria were machine-verified (LUM-470). */
  machineVerification: {
    total: number
    machineVerified: number
    humanOverridden: number
  }
  /** LUM-560: honest cost read-out — token / active time (non-idle, LUM-487) /
   *  rework rounds, read from the same server-side loadActuals source as the web
   *  delivery card so the two never drift. tokenCost null = NOT measured (≠ a
   *  measured 0). Optional so a new CLI tolerates an older server. */
  cost?: {
    tokenCost: number | null
    activeTimeSec: number
    reworkRounds: number
  }
  /** LUM-561: rework / send-back / leftover-follow-up traces, preserved even on
   *  a clean all-pass task so the report never wipes the struggle. Optional so a
   *  new CLI tolerates an older server that doesn't yet emit it. */
  struggleTrail?: {
    reworkRounds: Array<{ round: number; failed: number }>
    sendBacks: Array<{
      criterionId: string
      statement: string
      status: 'open' | 'resolved'
      failedAtRound: number
      resolvedAtRound: number | null
    }>
    followUps: Array<{ criterionId: string; statement: string; round: number }>
    pullRequests: Array<{ number: number; url: string }>
    reopens: Array<{ from: string; to: string; at: string }>
  }
  /** LUM-562: movement of pass rate / cost / rework across the task's attempts
   *  — the trend the single-point History/Cost snapshot hides. Optional so a new
   *  CLI tolerates an older server that doesn't yet emit it. */
  trend?: {
    passRate: Array<{ round: number; passed: number; failed: number }>
    cost: Array<{
      sessionId: string
      total: number
      loopCount: number
      at: string
    }>
    rework: {
      reworkRounds: number
      reopens: number
      extraPrCycles: number
      total: number
    }
  }
  /** LUM-564: the agent's CLAIM — what it SAYS it did — surfaced beside the
   *  measured verification conclusion so the report shows 声称 vs 核验 as two
   *  columns, not just the verification one. LUM-573: sourced from the frozen
   *  task-level claim snapshot (the AUTHORITATIVE merged-lineage session, not
   *  the trailing latest session), falling back to the live latest-session
   *  summary before a snapshot is frozen; same-source with the web card through
   *  the server's TaskAcceptanceStatus.claim. An unverified self-report
   *  (estimate-tier), never a measurement. Optional so a new CLI tolerates an
   *  older server that doesn't emit it. */
  claim?: {
    text: string | null
    // LUM-597: 'AGENT' = the agent's own verify self-report (authoritative);
    // RUN_SUMMARY/DIGEST = a summarizer paraphrase fallback (SYNTHESIZED).
    source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST' | null
  }
  /** LUM-583: whether the CLAIM faithfully reflects the delivery — the third
   *  state over 声称/核验, read from the persisted LUM-582 verdict (no LLM at
   *  read time). PENDING = not yet judged (≠ UNJUDGEABLE); STALE = judged
   *  against an older claim snapshot, the verdict still surfaced. Optional so a
   *  new CLI tolerates an older server that doesn't emit it. */
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
  verificationHistory: Array<{
    round: number
    recordedAt: string
    passed: number
    failed: number
  }>
  lastRoundFailures: Array<{
    criterionId: string
    statement: string
    rejectionReason: string | null
    rejectionReasonEnum: string | null
  }>
  /** LUM-737: `kind` discriminates; absent (older server) = CRITERION. */
  nextActions: Array<
    | {
        kind?: 'CRITERION'
        criterionId: string
        statement: string
        verifierType: 'MACHINE' | 'HUMAN'
        checkpointer: string | null
        judgeSteps: string | null
        source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
        addedAtRound: number
        rejectionReason: string | null
      }
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
    /** LUM-807: advisory only — never blocks DONE, never counted as unmet. */
    | {
        kind: 'TEST_CASE'
        statement: string
        command: string
        advisory: true
      }
    /** LUM-815: 一条没有任何用例覆盖的标准。同样 advisory-only。 */
    | {
        kind: 'COVERAGE_GAP'
        criterionId: string
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
      reason: 'NONE' | 'FAILED' | 'PENDING' | 'RUNNING' | 'SCANNING_OFF'
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

const REASON_TAIL = 400

function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(-max)}` : s
}

/** LUM-815: 掐头的反面 —— 保留开头。用例标题/标准原文靠前面认人。 */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

type NextActionItem = TaskStatusResponse['nextActions'][number]
/** LUM-815: 判据从 `{ criterionId }` 收紧到带 verifierType 的那一支 ——
 *  COVERAGE_GAP 也带 criterionId,只按它 Extract 会把 advisory 悄悄并进
 *  criteria 桶(tsc 抓到了,但这条注释是给下一个加 action kind 的人看的)。 */
type CriterionAction = Extract<
  NextActionItem,
  { criterionId: string; verifierType: 'MACHINE' | 'HUMAN' }
>
type SecurityAction = Extract<NextActionItem, { kind: 'SECURITY_FINDING' }>
type TestCaseAction = Extract<NextActionItem, { kind: 'TEST_CASE' }>
export type TestCaseVerdictAction = Extract<
  NextActionItem,
  { kind: 'TEST_CASE_VERDICT' }
>
type CoverageGapAction = Extract<NextActionItem, { kind: 'COVERAGE_GAP' }>

/** A missing `kind` is an older server's criterion entry (LUM-737 additive rule). */
function isSecurityAction(a: NextActionItem): a is SecurityAction {
  return a.kind === 'SECURITY_FINDING'
}
/** LUM-807. Split out explicitly: the default bucket is the *criteria* one,
 *  which feeds `unmet` arithmetic and the verify prompt — an advisory row
 *  landing there would read as a criterion the task must satisfy. */
function isTestCaseAction(a: NextActionItem): a is TestCaseAction {
  return a.kind === 'TEST_CASE'
}
/** LUM-808. Same reason as above — an advisory must never land in the
 *  criteria bucket, where it would read as something the task must satisfy. */
function isTestCaseVerdictAction(
  a: NextActionItem
): a is TestCaseVerdictAction {
  return a.kind === 'TEST_CASE_VERDICT'
}
/** LUM-815. Same reason again: a coverage gap is a fact about evidence, not a
 *  criterion the task has to satisfy — it must never land in the criteria
 *  bucket that feeds the `unmet` arithmetic. */
function isCoverageGapAction(a: NextActionItem): a is CoverageGapAction {
  return a.kind === 'COVERAGE_GAP'
}
/** LUM-819: a newer server's advisory kind, unknown to this CLI version. */
function isUnknownAdvisory(a: NextActionItem): a is TestCaseAction {
  const raw = a as { kind?: unknown; advisory?: unknown }
  return (
    raw.advisory === true &&
    typeof raw.kind === 'string' &&
    raw.kind !== 'CRITERION'
  )
}
export function splitNextActions(actions: NextActionItem[]): {
  criteria: CriterionAction[]
  security: SecurityAction[]
  testCase: TestCaseAction[]
  testCaseVerdict: TestCaseVerdictAction[]
  coverageGap: CoverageGapAction[]
} {
  const criteria: CriterionAction[] = []
  const security: SecurityAction[] = []
  const testCase: TestCaseAction[] = []
  const testCaseVerdict: TestCaseVerdictAction[] = []
  const coverageGap: CoverageGapAction[] = []
  for (const a of actions) {
    if (isSecurityAction(a)) security.push(a)
    else if (isTestCaseAction(a)) testCase.push(a)
    else if (isTestCaseVerdictAction(a)) testCaseVerdict.push(a)
    else if (isCoverageGapAction(a)) coverageGap.push(a)
    // LUM-819: an advisory of a kind this CLI does not know yet must never
    // land in the criteria bucket (it would read as an unmet criterion and
    // skew the `unmet` count). Render it as a generic test-case advisory.
    else if (isUnknownAdvisory(a)) testCase.push(a)
    else criteria.push(a)
  }
  return { criteria, security, testCase, testCaseVerdict, coverageGap }
}

/**
 * LUM-815: 覆盖缺口。
 *
 * **措辞红线（这条是本单唯一的人工验收项）**：这几行说的是「这条标准还没人
 * 验过」，不是「这条标准挂了」。所以——自成一段、不进 Next actions 的未满足
 * 清单、不用 ✗ / fail / unmet 任何一个失败词、动词是「还没有」而不是「缺少」。
 * 一个没有上下文的人扫过来不该以为任务出了问题。
 */
function pushCoverageGapActions(
  lines: string[],
  actions: CoverageGapAction[]
): void {
  if (actions.length === 0) return
  lines.push('')
  lines.push(
    `Not yet covered by a test case (${actions.length} of the contract) — advisory, never blocks DONE:`
  )
  for (const a of actions) {
    lines.push(`  ${a.criterionId}  ${sanitizeField(clip(a.statement, 90))}`)
  }
  lines.push(`  cover one: ${sanitizeField(actions[0]!.command)}`)
}

/** 一条挂在标准下的用例 + 最近一次执行,压成一行。导出给测试用。 */
export function formatLinkedCase(c: {
  number: number
  title: string
  latestRun: {
    result: 'PASS' | 'FAIL' | 'BLOCKED'
    ceiling: {
      effective: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNPROVEN'
      reason?: string
    }
    environment: 'LOCAL' | 'PREVIEW' | 'PRODUCTION'
    commitSha: string | null
    commitDirty: boolean | null
    recordedAt: string
  } | null
}): string {
  const head = `TC${c.number} ${sanitizeField(clip(c.title, 50))}`
  const run = c.latestRun
  // 从没跑过 ≠ 失败。措辞同上：陈述事实,不报警。
  if (!run) return `${head} — not run yet`
  // 上报值与封顶后的结论不同时两个都打印：只打印封顶结果会藏掉「它报的是
  // PASS」,只打印上报值则是在替它宣传一个证不了的绿。
  const verdict =
    run.ceiling.effective === run.result
      ? run.result
      : `${run.result}→${run.ceiling.effective}${
          // LUM-819: 零证据封顶要当场说清，否则读起来像「挂了」。
          run.ceiling.reason === 'no-evidence' ? ' (no evidence)' : ''
        }`
  const at = run.commitSha
    ? ` @${run.commitSha.slice(0, 7)}${run.commitDirty ? '+dirty' : ''}`
    : ''
  return `${head} — ${verdict} in ${run.environment}${at}`
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

/** Render the `[SECURITY]` next-action lines (LUM-737 review): shared by the
 *  criteria-present Next actions block and the zero-criteria early return so
 *  undispositioned findings render identically either way. */
export function pushSecurityActions(
  lines: string[],
  securityActions: SecurityAction[]
): void {
  for (const a of securityActions) {
    lines.push(`  • [SECURITY] ${formatSecurityAction(a)}`)
  }
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
    `  PR #${s.prNumber} · scan ${formatScanStatus(s.status, s.stages)}` +
    formatScanLayerTail({
      status: s.status,
      stages: s.stages,
      huntProgress: s.huntProgress,
      partialCauses: s.partialCauses,
      huntOverCap: s.huntOverCap,
      judgeOverCap: s.judgeOverCap,
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
            : `security scan still ${u.reason}`
    lines.push(`⚠ PR #${u.number}: ${why} — could not confirm it is clean.`)
  }
}

/**
 * Finding 2: the closing line for a fully-settled contract (no unmet
 * criteria, no open security findings). Mirrors the web's three-way split
 * (AcceptanceTab.tsx's humanNoneJudged / humanSomeJudged /
 * humanAllExplicitlyJudged, from commit 749bdbf2) instead of unconditionally
 * claiming "awaiting human adjudication" — which is false the moment even one
 * HUMAN criterion settled as a tacit pass rather than an actual verdict.
 */
export function contractSettledLine(
  criteria: TaskStatusResponse['criteria']
): string {
  const humanCriteria = criteria.filter(c => c.verifierType === 'HUMAN')
  if (humanCriteria.length === 0) {
    return 'All criteria met by their latest verdicts.'
  }
  const judgedCount = humanCriteria.filter(c => c.latestVerdict != null).length
  if (judgedCount === humanCriteria.length) {
    return 'All criteria met by their latest verdicts — human-judged.'
  }
  if (judgedCount === 0) {
    return 'All criteria met — no objection raised on the HUMAN criteria; not individually judged.'
  }
  return `All criteria met — ${judgedCount}/${humanCriteria.length} HUMAN criteria explicitly judged, the rest accepted as drafted.`
}

/**
 * Render the acceptance status as prose. Same row grammar as
 * `criteria list` (`<id>  [TYPE]  SOURCE@rN  statement`) with a verdict
 * glyph in front — ✓ pass, ✗ fail, ○ no verdict yet, ~ tacit pass (settled,
 * un-adjudicated HUMAN criterion) — so REVIEW_ADDED provenance stays
 * explicitly visible in every row.
 */
export function formatTaskStatus(
  data: TaskStatusResponse,
  extras: TaskStatusExtras = {}
): string {
  const lines: string[] = []
  const t = data.task
  lines.push(`${t.identifier}  ${sanitizeField(t.title)}`)
  const roundLabel =
    data.currentRound === 0
      ? 'no verification rounds yet'
      : `verification round ${data.currentRound}/${data.maxRounds}`
  lines.push(`Status: ${t.status} · ${roundLabel}`)

  // LUM-789: 追认入口。出现在用户本来就要打开这个任务的时刻,永不拦 DONE。
  // Finding 5: the migration is backfill-free, so every pre-LUM-789 contract
  // reads unconfirmed forever — without the DONE guard this nudge would sit
  // on every historical and every closed task forever, inviting exactly the
  // after-delivery "confirm" that defeats the point of moving the touchpoint
  // earlier. Mirrors AcceptanceTab.tsx's `contractUnconfirmed` guard.
  const unconfirmed =
    t.status === 'DONE' ? [] : data.criteria.filter(c => c.confirmedAt == null)
  if (unconfirmed.length > 0) {
    lines.push(
      `Contract unconfirmed (${unconfirmed.length} criteri${unconfirmed.length === 1 ? 'on' : 'a'}) — lumo task criteria confirm ${t.identifier}`
    )
  }

  if (data.escalated) {
    lines.push(
      '⚠ Escalated: the machine loop is exhausted — a human has been paged. Stop retrying lumo verify.'
    )
  }

  // LUM-737 (whole-branch review): split once, up front, so both the
  // zero-criteria early return below and the --full rollup can render/count
  // undispositioned security findings without either dropping them or
  // subtracting them from the criteria-met arithmetic.
  const {
    criteria: unmetCriteria,
    security: securityActions,
    testCase: testCaseActions,
    testCaseVerdict: testCaseVerdictActions,
    coverageGap: coverageGapActions,
  } = splitNextActions(data.nextActions)

  if (data.criteria.length === 0) {
    lines.push('')
    lines.push(
      `No acceptance criteria on ${t.identifier} — draft them and submit with lumo task criteria set ${t.identifier} --file <criteria.json>`
    )
    if (securityActions.length > 0) {
      lines.push('')
      lines.push(
        `Next actions (0 unmet · ${securityActions.length} security finding${securityActions.length === 1 ? '' : 's'}):`
      )
      pushSecurityActions(lines, securityActions)
      lines.push(SECURITY_HINT)
    }
    if (testCaseActions.length > 0) {
      lines.push('')
      pushTestCaseActions(lines, testCaseActions)
    }
    if (testCaseVerdictActions.length > 0) {
      lines.push('')
      pushTestCaseVerdictActions(lines, testCaseVerdictActions)
    }
    pushCoverageGapActions(lines, coverageGapActions)
    pushSecurityCoverage(lines, data)
    pushOpenCrossings(lines, extras)
    return lines.join('\n') + '\n'
  }

  // LUM-733: the default report is the agent's self-check — criteria, next
  // actions (including undispositioned security findings, LUM-737), and any
  // open crossings. The dashboard sections (verification rollup, history,
  // cost, struggle trail, trend) are human-dashboard material and cost
  // context, so they only render under --full. The claim / faithfulness
  // columns are no longer rendered in the terminal at all (the judge still
  // runs server-side; --json carries its fields).
  if (extras.full) pushVerificationRollup(lines, unmetCriteria.length, data)

  lines.push('')
  lines.push(
    `Criteria (${data.criteria.length} total, ${unmetCriteria.length} unmet):`
  )
  for (const c of data.criteria) {
    // Finding 1: derive from the same isUnmetForDisplay the header's
    // `unmet` count and the server's nextActions already use. A HUMAN
    // criterion with no verdict is a tacit pass (settled, nobody objected) —
    // it must not render as an open circle awaiting something, but it also
    // didn't get an actual verdict, so it stays visually distinct from a
    // real ✓ pass (LUM-789's "keep the judged-vs-tacit distinction honest").
    const unmet = isUnmetForDisplay(c, c.latestVerdict ?? undefined)
    const glyph =
      c.latestVerdict == null
        ? unmet
          ? '○' // MACHINE, no verdict — genuinely still open
          : '~' // HUMAN, no verdict — tacit pass, settled but unjudged
        : c.latestVerdict.verdict === 'FAIL'
          ? '✗'
          : '✓'
    const provenance = `${c.source}@r${c.addedAtRound}`
    const evidence = c.evidenceRequired ? '  [evidence]' : ''
    lines.push(
      `  ${glyph} ${c.id}  [${c.verifierType}]  ${provenance}${evidence}  ${sanitizeField(c.statement)}`
    )
    if (c.checkpointer) {
      lines.push(`      ↳ check: ${sanitizeField(c.checkpointer)}`)
    }
    // LUM-465: agent-drafted human-judging guidance, rendered as an indented
    // block under a HUMAN criterion (multi-line steps stay aligned).
    if (c.judgeSteps) {
      const judgeLines = sanitizeField(c.judgeSteps).split('\n')
      lines.push(`      ↳ judge: ${judgeLines[0]}`)
      for (const jl of judgeLines.slice(1)) {
        lines.push(`              ${jl}`)
      }
    }
    const v = c.latestVerdict
    if (v == null) {
      lines.push(
        unmet
          ? '      (no verdict yet)'
          : '      (tacit pass — no objection raised, not individually judged)'
      )
    } else if (v.verdict === 'FAIL') {
      const why = v.rejectionReason
        ? ` — ${sanitizeField(tail(v.rejectionReason, REASON_TAIL))}`
        : ''
      lines.push(`      ✗ FAIL@r${v.round}${why}`)
    } else {
      // LUM-470: tag a passing MACHINE criterion by the read model's
      // machinePassed flag, not the latest verdict — a criterion a checkpointer
      // verified reads as machine-verified even after a human signs off, and a
      // pass with no machine run underneath reads as a human override.
      const machineTag =
        c.verifierType === 'MACHINE'
          ? c.machinePassed
            ? ' · machine-verified'
            : ' · human override (no machine pass)'
          : ''
      lines.push(`      ✓ ${v.verdict}@r${v.round}${machineTag}`)
      // LUM-457: a pass that vouches for a pre-edit version of the criterion —
      // render-only downgrade, the criterion still counts met.
      if (c.verdictStale || c.checkMismatch) {
        lines.push(
          '      ⚠ pre-edit version — criterion changed since this check; re-run `lumo verify` to re-confirm'
        )
      }
    }
    // LUM-563: drill the verdict's evidence into a navigable / re-runnable
    // reference instead of the inert raw pointer that used to ride the verdict
    // line — a commit URL (or `git show` fallback), a clickable path:line, or
    // the actual command + exit. Rendered for PASS and FAIL alike so a failure
    // is just as reproducible. When a criterion requires evidence but none is
    // recorded yet, say so explicitly (fail-closed) rather than leaving the
    // bare `[evidence]` tag pointing at nothing.
    if (v?.evidencePointer) {
      lines.push(
        `        ↳ evidence: ${sanitizeField(formatEvidenceDrilldown(v.evidencePointer, extras.repoWebUrl ?? null))}`
      )
    } else if (c.evidenceRequired) {
      lines.push('        ↳ evidence: pending — no reference recorded yet')
    }
    // LUM-815: 挂在这条标准下的用例 + 各自最近一次执行。排在裁定之后,因为
    // 它回答的是另一个问题 —— 裁定说「这条算不算满足」,这几行说「有没有
    // 可复跑的证据撑着」。两者永远分开渲染,也永远不互相推导。
    for (const lc of c.linkedCases ?? []) {
      lines.push(`      ↳ case ${sanitizeField(formatLinkedCase(lc))}`)
    }

    // LUM-511 Phase 5: send-back lifecycle (was this criterion's send-back
    // resolved, and by which PR).
    const sb = c.sendBackResolution
    if (sb) {
      if (sb.status === 'resolved') {
        const pr = sb.closingPrNumber ? ` · PR #${sb.closingPrNumber}` : ''
        lines.push(
          `      ↳ send-back (r${sb.failedAtRound}) resolved in r${sb.resolvedAtRound}${pr}`
        )
      } else {
        lines.push(`      ↳ send-back (r${sb.failedAtRound}) open`)
      }
    }
  }

  if (extras.full && data.verificationHistory.length > 0) {
    lines.push('')
    lines.push('History:')
    for (const h of data.verificationHistory) {
      lines.push(
        `  r${h.round} · ${h.recordedAt} · ${h.passed} PASS / ${h.failed} FAIL`
      )
    }
  }

  if (data.lastRoundFailures.length > 0) {
    lines.push('')
    lines.push(`Last round (r${data.currentRound}) failures:`)
    for (const f of data.lastRoundFailures) {
      lines.push(`  • ${sanitizeField(f.statement)}`)
      if (f.rejectionReason) {
        lines.push(
          `    why: ${sanitizeField(tail(f.rejectionReason, REASON_TAIL))}`
        )
      }
    }
  }

  if (extras.full) {
    pushCost(lines, data)
    pushStruggleTrail(lines, data)
    pushTrend(lines, data)
  }

  lines.push('')
  const securityLabel =
    securityActions.length === 0
      ? ''
      : ` · ${securityActions.length} security finding${securityActions.length === 1 ? '' : 's'}`
  if (unmetCriteria.length === 0 && securityActions.length === 0) {
    lines.push(
      data.currentRound > 0
        ? contractSettledLine(data.criteria)
        : 'Nothing unmet — but no verification has run; run `lumo verify` to judge the contract.'
    )
    // LUM-807: a settled contract is exactly when the advisory is worth
    // reading — nothing is being blocked, and the script is still unrecorded.
    pushTestCaseActions(lines, testCaseActions)
  } else {
    lines.push(`Next actions (${unmetCriteria.length} unmet${securityLabel}):`)
    for (const a of unmetCriteria) {
      lines.push(`  • [${a.verifierType}] ${sanitizeField(a.statement)}`)
      if (a.checkpointer) {
        lines.push(`    check: ${sanitizeField(a.checkpointer)}`)
      }
      if (a.rejectionReason) {
        lines.push(
          `    why: ${sanitizeField(tail(a.rejectionReason, REASON_TAIL))}`
        )
      }
    }
    // LUM-737: findings after the contract — constraints on DONE, not criteria.
    pushSecurityActions(lines, securityActions)
    // LUM-807: advisory last — after everything that can actually hold DONE.
    pushTestCaseActions(lines, testCaseActions)
    if (data.escalated) {
      lines.push('Wait for human direction before touching these.')
    } else if (unmetCriteria.length > 0) {
      const hasMachine = unmetCriteria.some(a => a.verifierType === 'MACHINE')
      const left = data.maxRounds - data.currentRound
      lines.push(
        hasMachine
          ? `Fix the unmet criteria, then run \`lumo verify\` (${left} round${left === 1 ? '' : 's'} left).`
          : // LUM-789: 未裁定的 HUMAN 项已按 tacit pass 处理，不会走到这里。
            // 剩下的 HUMAN 项只可能是被明确送回的 —— 说送回，不说交接。
            'The remaining criteria were sent back by a human — address the reasons above, then run `lumo verify`.'
      )
    }
    if (securityActions.length > 0) lines.push(SECURITY_HINT)
  }
  // LUM-808: 判决层 advisory 在两条分支之外统一渲染 —— 它和「有没有未满足的
  // 验收项」无关，读的是用例最新一次跑出来的结论。
  pushTestCaseVerdictActions(lines, testCaseVerdictActions)
  // LUM-815: 覆盖缺口同理,而且**刻意排在未满足清单之外、自成一段** ——
  // 「还没人验过」与「这条挂了」必须一眼分得开。
  pushCoverageGapActions(lines, coverageGapActions)
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
 * Append the "Claim vs verification" pairing (LUM-564) — 規律2 声称vs核验. The
 * verification conclusion (machine-verified vs human-override, LUM-470) was the
 * whole-system template, but the agent's run summary — its CLAIM of what it did
 * — lived on a different surface, so the "two-column" contrast was really one
 * column. This puts them side by side: the unverified self-report (estimate-
 * tier — 估, not 测) against the measured verdict (测), so a reader can weigh
 * 声称 against 核验 at a glance.
 *
 * Fail-closed on every axis: a missing claim renders an explicit "not generated
 * yet" line (never a fabricated claim); a not-yet-verified task renders the
 * verification side as explicitly unconfirmed (never an implied pass). The
 * claim text is same-source with the web card (latest session's LLM run
 * summary, else its STOP turn digest) so the two surfaces cannot drift.
 */
/**
 * LUM-733: the measured verification rollup (--full only) — machine-verified
 * vs human-override over the MACHINE criteria, and how many criteria are met.
 * The former "Claim vs verification" pairing (claim text + faithfulness
 * verdict) is no longer rendered in the terminal.
 */
function pushVerificationRollup(
  lines: string[],
  unmetCriteriaCount: number,
  data: TaskStatusResponse
): void {
  lines.push('')
  lines.push('Verification:')
  const mv = data.machineVerification
  if (data.currentRound === 0) {
    lines.push('  no verification has run yet')
    return
  }
  if (mv.total > 0) {
    lines.push(
      `  ${mv.machineVerified} machine-verified / ${mv.humanOverridden} human override (of ${mv.total} MACHINE criteria)`
    )
  }
  // LUM-737 (whole-branch review): `unmetCriteriaCount` excludes SECURITY_FINDING
  // next actions — met/unmet counts criteria only, never security findings.
  //
  // Relocation six (whole-branch review, third pass): `unmetCriteriaCount` is
  // now isUnmetForDisplay-filtered (Findings 1/2) — a tacit-pass HUMAN
  // criterion (no verdict, never adjudicated) counts as met here too. "met by
  // their latest verdict" asserted a verdict that row doesn't have; dropped
  // the claim rather than the count, so this line agrees with the `~` row
  // and the closing line instead of contradicting them.
  const met = data.criteria.length - unmetCriteriaCount
  lines.push(`  ${met} of ${data.criteria.length} criteria met`)
}

/**
 * Append the honest "Cost" section (LUM-560) — 规律 1: surface the costs a human
 * should weigh (token spend, active time, machine rework) on the same report as
 * the acceptance verdict, instead of leaving them scattered across the web
 * delivery card and `task lineage`. Every number is the server's, read from the
 * same loadActuals source as the web card (no drift). Token cost is fail-closed:
 * a null reads as an explicit "not recorded" line, never a silent or fake 0, so
 * 没测到 (no session usage) stays distinct from a measured 花了0. Skipped only
 * when the server didn't emit the field (older server) — never fabricated.
 */
function pushCost(lines: string[], data: TaskStatusResponse): void {
  const cost = data.cost
  if (!cost) return // older server: can't fabricate cost, so don't claim any.

  lines.push('')
  lines.push('Cost:')
  lines.push(
    cost.tokenCost == null
      ? '  Tokens: not recorded (no session usage captured)'
      : `  Tokens: ${fmtTokens(cost.tokenCost)}`
  )
  lines.push(`  Active time: ${fmtDuration(cost.activeTimeSec)} (non-idle)`)
  lines.push(
    `  Rework rounds: ${cost.reworkRounds}${cost.reworkRounds === 0 ? ' (no machine rework)' : ''}`
  )
}

/**
 * Append the honest "Struggle / rework / outstanding" section (LUM-561) — the
 * anti-mum-and-deaf block (kills a silent "Nothing outstanding"). It is ALWAYS
 * rendered when the contract exists, even on a clean 0-unmet task: a passing
 * task that bounced, was sent back, or left a follow-up behind still shows its
 * scars. When the trail is genuinely empty the block states the *basis* for
 * that ("none — N rounds run, 0 FAIL …"), or, when nothing has been verified,
 * that absence cannot be confirmed — never a bare clean slate. Skipped only
 * when the server didn't emit the field (older server).
 */
function pushStruggleTrail(lines: string[], data: TaskStatusResponse): void {
  const trail = data.struggleTrail
  if (!trail) return // older server: can't fabricate, so don't claim "none".

  lines.push('')
  lines.push('Struggle / rework / outstanding:')

  // A single PR is the happy path; >1 PR is the iteration signal. Reopens (a
  // bounce after IN_REVIEW/DONE) always count. These two catch the rework that
  // lives in PR cycles / status flips rather than in FAIL verdicts (LUM-561
  // follow-up — without them a 10-PR task like LUM-557 reads as one hiccup).
  const prIterated = trail.pullRequests.length > 1
  const empty =
    trail.reworkRounds.length === 0 &&
    trail.sendBacks.length === 0 &&
    trail.followUps.length === 0 &&
    trail.reopens.length === 0 &&
    !prIterated

  if (empty) {
    if (data.currentRound === 0) {
      // Honest fail-open: nothing was verified, so we cannot claim there were
      // no difficulties — say so rather than render an implicitly-clean slate.
      lines.push(
        '  No verification has run yet — cannot confirm there were no difficulties. Run `lumo verify`.'
      )
    } else {
      const rounds = `${data.currentRound} verification round${data.currentRound === 1 ? '' : 's'}`
      lines.push(
        `  None recorded — ${rounds} run, 0 FAIL, no send-backs, no reopens, no leftover follow-ups.`
      )
    }
    return
  }

  if (trail.reworkRounds.length > 0) {
    const parts = trail.reworkRounds.map(
      r => `round ${r.round} (${r.failed} FAIL)`
    )
    lines.push(`  Rework rounds: ${parts.join(', ')}`)
  }
  if (trail.sendBacks.length > 0) {
    lines.push('  Send-backs:')
    for (const s of trail.sendBacks) {
      const lifecycle =
        s.status === 'resolved'
          ? `resolved (sent back r${s.failedAtRound}${s.resolvedAtRound != null ? ` → r${s.resolvedAtRound}` : ''})`
          : `open (sent back r${s.failedAtRound})`
      lines.push(`    • ${sanitizeField(s.statement)} — ${lifecycle}`)
    }
  }
  if (trail.followUps.length > 0) {
    lines.push('  Follow-ups left behind:')
    for (const f of trail.followUps) {
      lines.push(`    • ${sanitizeField(f.statement)} — flagged r${f.round}`)
    }
  }
  // PR iteration — the dominant rework signal when the verify loop only ran
  // once but the work churned across many PRs (LUM-557). Only when >1 PR.
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

/** Pass rate of one round as an integer percent (0 verdicts → 0%). */
function passPct(p: { passed: number; failed: number }): number {
  const total = p.passed + p.failed
  return total === 0 ? 0 : Math.round((p.passed / total) * 100)
}

/**
 * Append the "Trend" section (LUM-562, 規律7 趨勢非快照) — the *movement* of the
 * task's key quantities across its attempts, not a single-point snapshot. Where
 * History lists each round's PASS/FAIL, Cost shows the running total, and
 * Struggle lists the scars, this shows direction: pass rate climbing, cost per
 * session rising/falling, rework accruing. The honesty rule (mirrors the
 * struggle trail): a single data point is NOT a trajectory — with one round and
 * one session the section says so outright rather than drawing a fake arrow off
 * a single value, closing the named "1-round pass = single point" gap. The
 * per-session cost reuses the same source as the Cost section, so the
 * trajectory's points sum to the Cost total (no in-report drift). Skipped only
 * when the server didn't emit the field (older server) — never fabricated.
 */
function pushTrend(lines: string[], data: TaskStatusResponse): void {
  const trend = data.trend
  if (!trend) return // older server: no trend data — don't invent one.

  const rounds = trend.passRate
  const cost = trend.cost
  const rw = trend.rework

  lines.push('')

  // Nothing to trend at all — no verification, no measured cost.
  if (rounds.length === 0 && cost.length === 0) {
    lines.push('Trend:')
    lines.push(
      '  No verification rounds or measured cost yet — nothing to trend. Run `lumo verify`.'
    )
    return
  }

  // A trajectory needs ≥2 points in at least one dimension. With a single
  // round AND a single session, every quantity is one data point — say so
  // plainly instead of implying a flat/healthy trend (the named gap).
  const hasTrajectory = rounds.length >= 2 || cost.length >= 2
  if (!hasTrajectory) {
    lines.push('Trend:')
    lines.push(
      '  Single attempt so far — no trajectory yet (a trend needs ≥2 rounds or sessions).'
    )
    const bits: string[] = []
    if (rounds.length === 1)
      bits.push(`pass rate r${rounds[0]!.round} ${passPct(rounds[0]!)}%`)
    if (cost.length === 1) bits.push(`cost ${fmtTokens(cost[0]!.total)} tokens`)
    bits.push(rw.total === 0 ? 'rework none' : `rework ${rw.total}`)
    lines.push(`  ${bits.join(' · ')}`)
    return
  }

  const sessionWord = cost.length === 1 ? 'session' : 'sessions'
  lines.push(`Trend (${rounds.length} rounds · ${cost.length} ${sessionWord}):`)

  // Pass rate across rounds — the climb (or fall) of the verify loop.
  if (rounds.length >= 2) {
    const seq = rounds.map(r => `r${r.round} ${passPct(r)}%`).join(' → ')
    const delta = passPct(rounds[rounds.length - 1]!) - passPct(rounds[0]!)
    const sign = delta > 0 ? `+${delta}` : `${delta}`
    lines.push(`  Pass rate: ${seq}  (${arrow(delta)} ${sign}pts)`)
  } else if (rounds.length === 1) {
    lines.push(
      `  Pass rate: r${rounds[0]!.round} ${passPct(rounds[0]!)}% (1 round — single point)`
    )
  }

  // Cost per session across the task's sessions — the spend trajectory.
  if (cost.length >= 2) {
    const first = cost[0]!.total
    const last = cost[cost.length - 1]!.total
    const total = cost.reduce((a, c) => a + c.total, 0)
    lines.push(
      `  Cost/session: ${fmtTokens(first)} → ${fmtTokens(last)} tokens  (${arrow(last - first)}), ${fmtTokens(total)} total over ${cost.length} sessions`
    )
  } else if (cost.length === 1) {
    lines.push(
      `  Cost: ${fmtTokens(cost[0]!.total)} tokens (1 session — single point)`
    )
  }

  // Rework accrual — monotonic from a clean baseline of 0.
  if (rw.total === 0) {
    lines.push('  Rework: none accrued (0) — clean across every attempt')
  } else {
    const parts: string[] = []
    if (rw.reworkRounds > 0)
      parts.push(
        `${rw.reworkRounds} FAIL round${rw.reworkRounds === 1 ? '' : 's'}`
      )
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
 * the human-only web disposition panel. Trailing (after the criteria) and
 * silent when there are none, so it never overshadows the acceptance contract.
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
 * `lumo task status [task] [--json]` — the agent's read-only self-check
 * (LUM-344): contract + latest verdicts + verification history + next
 * actions, straight from the server's derived read model. Run it first when
 * resuming a task in a new session or after a round was rejected. Defaults
 * to the session-bound task; an explicit identifier overrides.
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
  // it still never throws, so it can't block the primary acceptance status. The
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
      // LUM-563: resolve the local repo's web base so a `commit:` evidence
      // pointer drills to a navigable URL; null (not a git repo / no origin)
      // falls back to a `git show` hint in the renderer.
      repoWebUrl: resolveRepoWebUrl(),
    })
  )
}
