import { runInTransaction } from '@/lib/db/transaction'
import { isUnmetForDisplay } from '@/lib/acceptance/unmet-display'
import { taskRepository } from '@/lib/repositories/task.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import {
  verificationRunRepository,
  isPassVerdict,
  deriveMachinePassedCriteria,
  isRunWithdrawn,
  type CreateVerificationRunInput,
  type VerificationRunRow,
} from '@/lib/repositories/verification-run.repository'
import { verificationRunWithdrawalRepository } from '@/lib/repositories/verification-run-withdrawal.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { claimFaithfulnessVerdictRepository } from '@/lib/repositories/claim-faithfulness-verdict.repository'
import {
  deriveFaithfulness,
  type ClaimFaithfulness,
} from '@/lib/claim-faithfulness/faithfulness'
import {
  resolveClaimForReadModel,
  type TaskClaim,
} from '@/lib/services/task-claim'
import {
  deriveSendBackResolution,
  type SendBackResolution,
} from '@/lib/services/send-back-lifecycle'
import { notifyWorkspaceOwners } from '@/lib/notifications/notifyWorkspaceOwners'
import { taskService } from '@/lib/services/task.service'
import { taskClaimSnapshotService } from '@/lib/services/task-claim-snapshot.service'
import { taskCriteriaSnapshotService } from '@/lib/services/task-criteria-snapshot.service'
import { isValidTaskTransition } from '@/lib/task/state-machine'
import { sanitizeField } from '@/lib/utils/sanitize'
import {
  remindOnDelivery,
  renderTestCaseVerifyNudge,
  testCaseAddCommand,
  TEST_CASE_ADVISORY_STATEMENT,
} from '@/lib/context/render/test-case-reminder'
import { testCaseReminderService } from '@/lib/services/test-case-reminder.service'
import { logger } from '@/lib/logger'
import {
  prSecurityReminderService,
  type TaskSecurityScanSummary,
} from '@/lib/services/pr-security-reminder.service'
import {
  findingStatement,
  type UnconfirmedPr,
} from '@/lib/security-scan/agent-reminder'
import { readTestCaseAdvisories } from '@/lib/services/done-verdict.service'
import { readCriterionCoverage } from '@/lib/services/criterion-coverage.service'
import { deriveCoverageGaps, type LinkedCase } from '@/lib/test-cases/coverage'
import type {
  FindingProvenance,
  FindingSeverity,
} from '@/lib/repositories/pr-security-scan.repository'
import {
  aggregateRetroStruggle,
  type RetroStruggleAggregate,
} from '@/lib/services/retro-struggle'
import type { MachineVerdictInput } from '@/lib/validation/acceptance'

/**
 * Default ceiling on machine verification rounds (milestone spec). The
 * effective cap is now per-workspace (Workspace.verificationMaxRounds, LUM-429)
 * and this constant is the fallback when a workspace has no value / can't be
 * resolved — so an unconfigured workspace behaves exactly as before: rounds
 * 1..3 may record, a round-3 fail escalates to a human, and any later machine
 * round is refused. Derived state only — the task carries no round column
 * (milestone rule 8). The cap governs ONLY the machine loop; a human
 * adjudication (recordHumanVerdict) is never bounded by it.
 */
export const VERIFICATION_MAX_ROUNDS = 3

export interface VerificationAttribution {
  /** WorkspaceMember id of the caller (CLI bearer → human member). */
  actorMemberId: string
  /** Clerk user id of the caller — needed by the status-transition fan-out. */
  actorClerkId: string
  /** Claude Code session that drove this round, when known. */
  sourceSessionId: string | null
}

export interface MachineRoundResult {
  criterionId: string
  statement: string
  verdict: 'PASS' | 'FAIL'
  evidencePointer: string | null
  rejectionReason: string | null
}

export interface MachineRoundOutcome {
  round: number
  maxRounds: number
  allPassed: boolean
  /** True when this round hit the cap with failures and a human was paged. */
  escalated: boolean
  /** Task status after this round (IN_REVIEW only on an all-pass round). */
  taskStatus: string
  results: MachineRoundResult[]
  /** Unmet criteria the agent should address next — empty on all-pass. */
  nextActions: Array<{
    criterionId: string
    statement: string
    checkpointer: string | null
    rejectionReason: string | null
  }>
  /**
   * LUM-807: one-line reminder to record the script this round was verified
   * by hand with, rendered only on an all-pass round that delivered a task
   * with a PR and no test case. `null` everywhere else — including every FAIL
   * round, where the agent has failures to read, not scripts to write.
   * Advisory: it neither gates the round nor touches the DONE path.
   */
  testCaseNudge: string | null
}

/**
 * Version of the acceptance-status read model served by
 * GET /api/tasks/[id]/status and emitted by `lumo task status --json`.
 * Consumers pin on it; a breaking change to the payload shape requires a
 * major bump (additive fields don't).
 */
export const TASK_STATUS_SCHEMA_VERSION = 1

/** Latest verdict event for one criterion, lifted off the append-only log. */
export interface CriterionLatestVerdict {
  round: number
  verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
  /** Who produced this verdict — lets a read model mark a human override
   *  (a PASS authored by HUMAN) distinctly from a machine PASS. Additive to
   *  the v1 read model (derived from an existing column, no schema change). */
  verifierType: 'MACHINE' | 'HUMAN' | 'AGENT'
  evidencePointer: string | null
  rejectionReason: string | null
  rejectionReasonEnum: string | null
  recordedAt: string
}

export interface TaskStatusCriterion {
  id: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer: string | null
  evidenceRequired: boolean
  /** Agent-drafted human-judging guidance for a HUMAN criterion (LUM-465);
   *  null = none drafted (legacy / MACHINE) → the card shows a fallback hint. */
  judgeSteps: string | null
  /** LUM-602: the declarable referent kind for this criterion — what it anchors.
   *  null for legacy rows predating the field. */
  referentKind:
    | 'EXTERNAL_FACT'
    | 'AGENT_CONSTRUCTED_STATE'
    | 'PENDING_OUTCOME'
    | null
  source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
  addedAtRound: number
  latestVerdict: CriterionLatestVerdict | null
  /** The latest MACHINE-authored verdict for this criterion, independent of
   *  whether a later HUMAN verdict overrode `latestVerdict` (LUM-611). Carries
   *  the round and `cmd:` evidence pointer of the checkpointer run, so the
   *  acceptance surfaces can show "machine-verified @rN" + its evidence even
   *  after a human PASS sign-off pushed the latest verdict to HUMAN. null when
   *  no MACHINE run exists. Additive to the v1 read model (derived from the same
   *  log as machinePassed, no schema change). */
  machineVerdict?: CriterionLatestVerdict | null
  /** Whether a checkpointer currently vouches for this criterion — true only
   *  for a MACHINE criterion whose latest MACHINE-authored verdict is a PASS
   *  (LUM-456). A passing MACHINE criterion with this false is being carried by
   *  a human override, never by a machine run; HUMAN criteria are always false.
   *  Derived from the existing log, no schema change. */
  machinePassed: boolean
  /** Whether the latest verdict predates the criterion's last edit — i.e. the
   *  criterion was changed (reworded / checkpointer swapped / …) after it was
   *  judged, so the verdict vouches for a stale version (LUM-457). Derived as
   *  `criterion.updatedAt > latestVerdict.recordedAt`; false when there is no
   *  verdict yet. Render-only signal — it does NOT make a passing criterion
   *  unmet. */
  verdictStale: boolean
  /** Whether a MACHINE criterion's current machine PASS was produced by a
   *  different command than its current checkpointer — the evidence pointer's
   *  `cmd:<command>#…` prefix no longer matches `cmd:<checkpointer>#` (LUM-457).
   *  True only when a genuine machine PASS exists to compare against (a human
   *  override or HUMAN criterion is always false). Render-only, like
   *  {@link verdictStale}. */
  checkMismatch: boolean
  /** Whether this active criterion entered or was reworded after work started
   *  (LUM-437). 'edited' wins over 'added' when both apply; null = part of the
   *  original round-0 draft, untouched since. */
  changeState: 'added' | 'edited' | null
  /** Round the add/edit happened (addedAtRound for 'added', the latest UPDATED
   *  drift event's round for 'edited'); null when changeState is null. */
  changedAtRound: number | null
  /** For 'edited', the statement before/after the latest reword; else null. */
  lastEdit: { before: string; after: string } | null
  /** LUM-511 Phase 5: the send-back lifecycle for this criterion — a HUMAN/AGENT
   *  FAIL that is now resolved (with the resolving round + best-effort closing
   *  PR) or still open; null when the criterion was never sent back. */
  sendBackResolution: SendBackResolution | null
  /** LUM-789: 人确认这条合同项的时间（ISO），null = 未确认。未确认**不**是
   *  待办、**不**拦 DONE —— 它只让 `task status` 与 web 任务详情各出现一处
   *  可选的追认入口。 */
  confirmedAt: string | null
  /** LUM-815: 声明覆盖本标准的用例（按序号），各带最近一次执行。空数组 =
   *  **没有任何用例覆盖它** —— 这条标准至今只有话，没有可复跑的证据。
   *
   *  纯渲染信号：用例跑绿**不**抬升 latestVerdict、**不**改 unmet 计数、
   *  **不**参与 DONE 闸。它只回答「验没验」，从不回答「验得对不对」。 */
  linkedCases: LinkedCase[]
}

/** A criterion that was removed (soft-deleted / tombstoned) from the live
 *  contract after work started — surfaced so the UI can show what dropped out
 *  with its preserved last verdict and run count (LUM-437). */
export interface RemovedCriterion {
  id: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  removedAtRound: number | null
  runCount: number
  lastVerdict: CriterionLatestVerdict | null
}

export interface VerificationHistoryRound {
  round: number
  /** When the round was recorded (first verdict's timestamp). */
  recordedAt: string
  passed: number
  failed: number
  verdicts: Array<{
    criterionId: string
    verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
    verifierType: 'MACHINE' | 'HUMAN' | 'AGENT'
    evidencePointer: string | null
    rejectionReason: string | null
    rejectionReasonEnum: string | null
    /** True when the run's verdictActionId has been withdrawn (LUM-586).
     *  The run stays visible in history — only the latest-verdict derivation
     *  skips it — so the UI can render a "withdrawn" badge. */
    withdrawn: boolean
  }>
}

/**
 * Honest machine-verification rollup over the active MACHINE criteria (LUM-456).
 * `machineVerified` counts ONLY criteria a checkpointer actually passed and that
 * are still passing — so the summary never claims machine verification that no
 * checkpointer produced. A MACHINE criterion currently passing on a human
 * override (no current machine pass) lands in `humanOverridden`, not
 * `machineVerified`. The two passing buckets are disjoint; `total` minus both is
 * the count of MACHINE criteria not currently passing.
 */
export interface MachineVerificationSummary {
  /** Active MACHINE criteria on the contract. */
  total: number
  /** MACHINE criteria a checkpointer passed and that are still passing. */
  machineVerified: number
  /** MACHINE criteria currently passing only via a human override. */
  humanOverridden: number
}

/**
 * The honest "struggle trail" (LUM-561): the rework / send-back / leftover
 * signals a clean all-pass report would otherwise wipe. Derived from the
 * append-only run log so the renderer can force a "難点/返工/遺留" section that
 * survives a 0-unmet task — preserving the traces of where the work was hard
 * instead of collapsing them to a single PASS count. All three arrays empty is
 * a legitimate (honest) state — the renderer must still state the basis for
 * "nothing outstanding" rather than silently dropping the section.
 */
export interface StruggleTrail {
  /** Verification rounds that recorded ≥1 FAIL — the agent had to rework. */
  reworkRounds: Array<{ round: number; failed: number }>
  /** Criteria sent back at least once (a HUMAN/AGENT FAIL, not a MACHINE
   *  verify-loop FAIL), across the live AND removed contract — so a struggle
   *  on a since-deleted criterion is preserved, not wiped. */
  sendBacks: Array<{
    criterionId: string
    statement: string
    status: 'open' | 'resolved'
    failedAtRound: number
    resolvedAtRound: number | null
  }>
  /** Criteria whose latest verdict is PASS_WITH_FOLLOWUP — passed but left
   *  follow-up work behind. */
  followUps: Array<{ criterionId: string; statement: string; round: number }>
  /** PRs opened against the task, oldest-first. A single PR is the happy path;
   *  >1 PR is the dominant rework signal for PR-cycle-driven tasks — the verify
   *  loop runs once while the real iteration happens across follow-up PRs
   *  (LUM-561 follow-up: measured on LUM-557, ~10 PRs vs 1 verify round). */
  pullRequests: Array<{ number: number; url: string }>
  /** Status reopens — a transition from IN_REVIEW/DONE back to IN_PROGRESS/TODO
   *  (from the STATUS_CHANGED activity log). The task reached review/done and
   *  got bounced; this rework leaves no FAIL verdict, so it would otherwise be
   *  invisible to the trail. */
  reopens: Array<{ from: string; to: string; at: string }>
}

/**
 * The honest cost read-out (LUM-560) — 规律 1: put the costs a human should
 * weigh on the same report as the acceptance verdict, instead of scattering
 * them across the web delivery card and `task lineage`. Every number is read
 * from {@link retrospectiveRepository.loadActuals} — the SAME server-side source
 * the web delivery card (progress / retrospective services) consumes — so the
 * two reports cannot drift (same-source guarantee, mirroring LUM-470's machine-
 * verification rollup). No independent re-summation lives here.
 */
export interface TaskCost {
  /** Total tokens (input + output + cache read + cache creation) across every
   *  session linked to the task. `null` = NOT measured (no session usage was
   *  ever recorded — e.g. no session bound), kept deliberately distinct from a
   *  measured 0 (LUM-559's 花了0 vs 没测到). */
  tokenCost: number | null
  /** Agent active (non-idle) seconds — Σ per-turn `STOP − prompt`, excluding the
   *  gaps between turns (LUM-487). A measured 0 is legitimate. */
  activeTimeSec: number
  /** Verification rounds that recorded ≥1 FAIL — how many times the work had to
   *  be reworked through the machine loop. Derived from the same run log as the
   *  struggle trail; 0 = no machine rework (a clean or never-verified task). */
  reworkRounds: number
}

/**
 * The honest "trend" (LUM-562, 規律7 趨勢非快照): the *movement* of the task's
 * key quantities across its attempts, not a single-point snapshot. History
 * rounds, per-session cost, and the rework signals are all time series the
 * snapshot report flattens — a 1-round pass reads as a single point and the
 * climb/spend/rework across reopen & session is invisible. This rolls them up
 * so the report can show direction (pass rate climbing, cost per session
 * rising/falling, rework accruing) rather than only the latest value. Derived
 * from the same append-only logs (pass rate, rework) + the same session-usage
 * source as the LUM-560 Cost block (cost) — no new state, and the cost
 * trajectory reconciles with the Cost-section total.
 */
export interface TrendModel {
  /** Pass rate per verification round, oldest-first. A single entry is honestly
   *  a single point, not a trajectory. */
  passRate: Array<{ round: number; passed: number; failed: number }>
  /** Per-session token spend, oldest-first by session start — the cost
   *  trajectory across the task's sessions. Σ of `total` equals the Cost
   *  block's `tokenCost` (same source). Empty when no usage was measured. */
  cost: Array<{
    sessionId: string
    total: number
    loopCount: number
    at: string
  }>
  /** Cumulative rework, decomposed by signal. Monotonic — it only grows from a
   *  clean baseline of 0, so the "trend" is the accrual itself. */
  rework: {
    reworkRounds: number
    reopens: number
    /** PR cycles beyond the first (>1 PR is the churn signal, LUM-557). */
    extraPrCycles: number
    total: number
  }
}

export interface NextActionCriterion {
  kind: 'CRITERION'
  criterionId: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer: string | null
  judgeSteps: string | null
  source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
  addedAtRound: number
  rejectionReason: string | null
}
export interface NextActionSecurityFinding {
  kind: 'SECURITY_FINDING'
  findingId: string
  statement: string
  severity: FindingSeverity
  provenance: FindingProvenance
  blocking: boolean
  prNumber: number
  ruleId: string
  filePath: string
  line: number | null
  /**
   * LUM-758 follow-up (secret: rows) — why the severity was lowered to LOW.
   * Additive: absent on an older server, and on any row with no downgrade.
   */
  secretDowngrade?: string | null
}
/**
 * One entry of the declarative plan. `kind` discriminates (LUM-737):
 * CRITERION = an unmet acceptance criterion (the pre-737 shape, now tagged);
 * SECURITY_FINDING = an undispositioned PR security finding — outside the
 * contract but a hard constraint on DONE when `blocking`. Additive: consumers
 * that pre-date `kind` should treat a missing kind as CRITERION.
 */
/**
 * LUM-807: the advisory row for a task that has a PR but no recorded test
 * case. Deliberately shaped like a finding row minus everything that gates:
 * no severity, no `blocking` flag to be true — it can only ever be advice.
 * The DONE gate never reads it.
 */
/**
 * LUM-808: 一条用例最新 run 的**判决**信号。和上面的 TEST_CASE 一样只是建议
 * ——`blocking` 这个字段根本不存在，DONE 闸不读它（用例从不拦 DONE，LUM-801）。
 * 信号本身来自与闸同一个纯函数，所以这里和 409 不会各说各话。
 */
export interface NextActionTestCaseVerdict {
  kind: 'TEST_CASE_VERDICT'
  signal: 'PROVEN_DEFECT' | 'UNPROVEN_PASS' | 'CASE_OUTDATED'
  /** 用例序号（LUM-42/TC3 里的 3）。 */
  number: number
  title: string
  advisory: true
}

export interface NextActionTestCase {
  kind: 'TEST_CASE'
  statement: string
  /** The command that resolves it; the CLI prints it verbatim. */
  command: string
  /** Always `true` — spelled out so a reader never has to infer it. */
  advisory: true
}

/**
 * LUM-815: 一条**没有任何用例覆盖**的验收标准。
 *
 * 和上面两个 test-case 信号一样纯属建议——`blocking` 这个字段根本不存在，
 * DONE 闸不读它。缺口不是失败：它只是说「这条标准至今没有可复跑的证据撑着」。
 * 拿它拦门会立刻把这个功能变成新的摩擦，然后被关掉。
 */
export interface NextActionCoverageGap {
  kind: 'COVERAGE_GAP'
  criterionId: string
  statement: string
  /** 解决它的命令；CLI 逐字打印。 */
  command: string
  advisory: true
}

export type NextAction =
  | NextActionTestCaseVerdict
  | NextActionCriterion
  | NextActionSecurityFinding
  | NextActionTestCase
  | NextActionCoverageGap
export interface TaskSecurityFindingsSummary {
  open: number
  blocking: number
  unconfirmedPrs: UnconfirmedPr[]
  /** LUM-735 — per-PR scan summary passed through from the reminder service,
   *  for `lumo task status` to render one line per scan. Additive: optional
   *  so an older cached/serialized summary without it still type-checks. */
  scans?: TaskSecurityScanSummary[]
}

export interface TaskAcceptanceStatus {
  version: typeof TASK_STATUS_SCHEMA_VERSION
  task: { id: string; identifier: string; title: string; status: string }
  /** Rounds used so far — max(VerificationRun.round), 0 when never verified. */
  currentRound: number
  maxRounds: number
  /** True when the machine loop is exhausted (cap reached with failures). */
  escalated: boolean
  criteria: TaskStatusCriterion[]
  /** Honest machine-verification rollup — genuine checkpointer passes vs human
   *  overrides over the active MACHINE criteria (LUM-456). */
  machineVerification: MachineVerificationSummary
  /** Rework / send-back / leftover-follow-up traces (LUM-561) — preserved even
   *  on a clean all-pass task so the report never wipes the struggle. */
  struggleTrail: StruggleTrail
  /** Honest cost read-out (LUM-560) — token / active time / rework rounds, read
   *  from the same loadActuals source as the web delivery card so the two never
   *  drift. tokenCost null = not measured (≠ a measured 0). */
  cost: TaskCost
  /** Movement of pass rate / cost / rework across the task's attempts (LUM-562)
   *  — the trend the single-point snapshot would otherwise hide. */
  trend: TrendModel
  /** The agent's CLAIM — what it SAYS it did (LUM-564), surfaced beside the
   *  measured verification verdict so the report shows 声称 vs 核验 as two
   *  columns. Same-source with the web card's latestRunSummary; an unverified
   *  self-report (estimate-tier), never a measurement. */
  claim: TaskClaim
  /** Whether the agent's CLAIM faithfully reflects the delivery (LUM-583) — the
   *  third state over the 声称/核验 columns, read from the persisted LUM-582
   *  ClaimFaithfulnessVerdict (no LLM at read time). PENDING when not yet
   *  judged (≠ UNJUDGEABLE); STALE when judged against an older claim snapshot. */
  faithfulness: ClaimFaithfulness
  /** Criteria removed (tombstoned) from the contract after work started, with
   *  their preserved last verdict + run count (LUM-437). Empty when none. */
  removedCriteria: RemovedCriterion[]
  verificationHistory: VerificationHistoryRound[]
  /** FAIL verdicts of the most recent round — why the last round was rejected. */
  lastRoundFailures: Array<{
    criterionId: string
    statement: string
    rejectionReason: string | null
    rejectionReasonEnum: string | null
  }>
  /** Unmet criteria + undispositioned security findings — the declarative plan. */
  nextActions: NextAction[]
  /** LUM-737: security-scan read-out. `null` = the read failed (could NOT
   *  confirm) — distinct from `{ open: 0, … }`, a successful read with
   *  nothing open. */
  securityFindings: TaskSecurityFindingsSummary | null
  /** The latest live (non-withdrawn) human verdict action — the one the undo
   *  button targets (LUM-586). Null when no live human verdict exists (nothing
   *  to undo). actorName is null when the member row cannot be resolved cheaply
   *  from the builder's existing data loads. */
  undoableHumanVerdict: {
    verdictActionId: string
    verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
    actorName: string | null
    at: string
  } | null
  /** The most-recent withdrawal, so the UI can show "last undo: PASS verdict
   *  withdrawn at …" (LUM-586). Null when no withdrawal has ever occurred for
   *  this task. The `verdict` is the verdict that was withdrawn. */
  lastVerdictWithdrawal: {
    verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
    actorName: string | null
    at: string
  } | null
}

/** A folded CRITERION_CHANGED UPDATED event — the latest reword of one
 *  criterion lifted off the drift log. */
interface ChangeEventDigest {
  round: number
  before: string
  after: string
}

/** Defensive readers for untyped CRITERION_CHANGED JSON payloads. */
function readJsonString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function readJsonNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
/** Pull `.statement` off a before/after criterion snapshot, defaulting to ''. */
function readSnapshotStatement(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') return ''
  return readJsonString((snapshot as Record<string, unknown>).statement) ?? ''
}

const ACTIVITY_STATEMENT_MAX = 160
const ACTIVITY_EVIDENCE_MAX = 200

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** sanitize + trim a nullable free-text field; empty results collapse to null. */
function cleanNullable(value: string | null | undefined): string | null {
  if (value == null) return null
  const cleaned = sanitizeField(value).trim()
  return cleaned.length > 0 ? cleaned : null
}

/**
 * LUM-807: the all-pass verify nudge. Reads the reminder state and renders the
 * one-liner only when a PR exists and no script is recorded. Self-catching —
 * a passing round must never fail because a reminder could not be computed.
 */
async function testCaseDeliveryNudge(
  taskId: string,
  detail: unknown
): Promise<string | null> {
  try {
    const d = detail as {
      number?: number
      status?: string
      team?: { identifier?: string }
    } | null
    const prefix = d?.team?.identifier
    if (!prefix || d?.number == null) return null
    const state = await testCaseReminderService.stateForTask({
      taskId,
      taskDone: d.status === 'DONE',
    })
    if (!remindOnDelivery(state)) return null
    return renderTestCaseVerifyNudge(`${prefix}-${d.number}`)
  } catch {
    return null
  }
}

export const taskVerificationService = {
  /**
   * Record one machine verification round — the server-side judge of the
   * loop (执行在客户端，裁判在服务端). The CLI ran every MACHINE
   * checkpointer locally and reports structured verdicts; this method:
   *
   * 1. checks coverage — one verdict per MACHINE criterion of the live
   *    contract, no extras, no duplicates;
   * 2. assigns the round number (previous max + 1) and refuses to run past
   *    the cap once an escalation round has been recorded (409);
   * 3. appends one VerificationRun per criterion (verifierType hard-coded
   *    MACHINE — the human-verdict write path does not exist here, milestone
   *    rule 5) plus a mirroring VERIFICATION_RUN_RECORDED TaskActivity in the
   *    same transaction (born with the event, never backfilled — LUM-296);
   * 4. on all-pass, transitions the task to IN_REVIEW through the existing
   *    state machine so the TASK_IN_REVIEW fan-out fires; on a round-3 fail,
   *    escalates exactly once (AGENT_VERIFY, requiresAction) — rounds are
   *    strictly increasing, so the escalation round is unrepeatable.
   */
  async recordMachineRound(
    taskId: string,
    workspaceId: string,
    results: MachineVerdictInput[],
    attribution: VerificationAttribution,
    // LUM-597: the agent's required self-report. Frozen as the AGENT claim when
    // an all-pass round lands the task in IN_REVIEW (the moment the汇报者
    // requests acceptance) — null for an old CLI / non-verify path, which
    // degrades to the SYNTHESIZED paraphrase at DONE.
    note?: string | null
  ): Promise<MachineRoundOutcome> {
    const criteria = await acceptanceCriterionRepository.listByTask(taskId)
    const machine = criteria.filter(c => c.verifierType === 'MACHINE')
    if (machine.length === 0) {
      throw Object.assign(
        new Error(
          'This task has no MACHINE acceptance criteria to verify — nothing for the machine loop to run'
        ),
        { status: 400 }
      )
    }

    const machineById = new Map(machine.map(c => [c.id, c]))
    const seen = new Set<string>()
    for (const r of results) {
      if (seen.has(r.criterionId)) {
        throw Object.assign(
          new Error(`Duplicate verdict for criterion ${r.criterionId}`),
          { status: 400 }
        )
      }
      seen.add(r.criterionId)
      if (!machineById.has(r.criterionId)) {
        throw Object.assign(
          new Error(
            `Criterion ${r.criterionId} is not a MACHINE criterion of this task`
          ),
          { status: 400 }
        )
      }
    }
    const missing = machine.filter(c => !seen.has(c.id))
    if (missing.length > 0) {
      throw Object.assign(
        new Error(
          `A machine round must cover every MACHINE criterion — missing verdicts for: ${missing
            .map(c => c.id)
            .join(', ')}`
        ),
        { status: 400 }
      )
    }

    // Effective cap is per-workspace (LUM-429); fall back to the default when
    // unconfigured / unresolvable so behavior is unchanged for old workspaces.
    const maxRounds =
      (await workspaceRepository.findVerificationMaxRounds(workspaceId)) ??
      VERIFICATION_MAX_ROUNDS

    const currentRound =
      (await verificationRunRepository.maxRoundByTask(taskId)) ?? 0
    if (currentRound >= maxRounds) {
      throw Object.assign(
        new Error(
          `Machine verification is capped at ${maxRounds} rounds and this task has used them — it has been escalated to a human; stop and wait for their adjudication`
        ),
        { status: 409 }
      )
    }
    const round = currentRound + 1

    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    // Clean the agent-authored free text before it can reach storage or any
    // renderer (LUM-346 口径); the pointer format is already regex-bound.
    const cleaned: MachineRoundResult[] = results.map(r => {
      const c = machineById.get(r.criterionId)!
      return {
        criterionId: r.criterionId,
        statement: c.statement,
        verdict: r.verdict,
        evidencePointer: cleanNullable(r.evidencePointer),
        rejectionReason: cleanNullable(r.rejectionReason),
      }
    })
    const rejectionEnumByCriterion = new Map(
      results.map(r => [r.criterionId, r.rejectionReasonEnum ?? null])
    )

    await runInTransaction(async tx => {
      const rows: CreateVerificationRunInput[] = cleaned.map(r => ({
        taskId,
        criterionId: r.criterionId,
        round,
        verifierType: 'MACHINE',
        verdict: r.verdict,
        evidencePointer: r.evidencePointer,
        rejectionReason: r.rejectionReason,
        rejectionReasonEnum:
          rejectionEnumByCriterion.get(r.criterionId) ?? null,
        // LUM-640: session provenance on machine rows too (same audit pointer
        // the agent-verdict rows carry).
        sourceSessionId: attribution.sourceSessionId,
      }))
      await verificationRunRepository.createMany(rows, tx)

      // Mirror events are born inside the write transaction — a cron can
      // never backfill what wasn't recorded at birth (LUM-296).
      for (const r of cleaned) {
        await activityRepository.create(
          {
            taskId,
            actorId,
            type: 'VERIFICATION_RUN_RECORDED',
            payload: {
              criterionId: r.criterionId,
              statement: truncate(r.statement, ACTIVITY_STATEMENT_MAX),
              round,
              verdict: r.verdict,
              evidencePointer: r.evidencePointer
                ? truncate(r.evidencePointer, ACTIVITY_EVIDENCE_MAX)
                : null,
              rejectionReasonEnum:
                rejectionEnumByCriterion.get(r.criterionId) ?? null,
            },
          },
          tx
        )
      }
    })

    const failed = cleaned.filter(r => r.verdict === 'FAIL')

    if (failed.length === 0) {
      let taskStatus = 'IN_REVIEW'
      const detail = await taskService.getTaskDetail(taskId)
      if (detail) {
        const status = (detail as { status?: string }).status ?? ''
        if (status === 'IN_REVIEW' || status === 'DONE') {
          // Re-verification of an already-reviewable/closed task — judging
          // recorded above; the status owner is now the human.
          taskStatus = status
        } else if (
          isValidTaskTransition(
            status as Parameters<typeof isValidTaskTransition>[0],
            'IN_REVIEW'
          )
        ) {
          await taskService.updateTaskWithSideEffects(
            taskId,
            { status: 'IN_REVIEW' },
            detail,
            actorId,
            attribution.actorClerkId,
            attribution.sourceSessionId
          )
          // LUM-609: freeze the acceptance contract at this delivery. Only on a
          // FRESH IN_REVIEW transition (this branch) — re-verification while
          // already IN_REVIEW (the branch above) does NOT re-freeze, so each
          // snapshot marks one delivery; a reopen→re-deliver appends another.
          // Append-only & best-effort (swallows internally): the freeze never
          // fails the round.
          await taskCriteriaSnapshotService.recordDeliverySnapshot(taskId, {
            sessionId: attribution.sourceSessionId,
          })
        } else {
          taskStatus = status || taskStatus
        }
      }
      // LUM-597: freeze the agent's self-report as the AGENT claim at the
      // moment the task is in review (just transitioned or re-verified while
      // IN_REVIEW). Skipped when the task is DONE (claim locked) or the round
      // came from an old CLI with no note (degrades to SYNTHESIZED). Best-effort
      // inside the service — a snapshot write failure never fails the round.
      if (note && taskStatus === 'IN_REVIEW') {
        await taskClaimSnapshotService.recordAgentSelfClaim(
          taskId,
          note,
          attribution.sourceSessionId
        )
      }
      // LUM-807: the delivery moment — the agent has just re-run something by
      // hand, so this is the cheapest point to ask for it in a re-runnable
      // form. Best-effort: a read failure must never fail a passing round.
      const testCaseNudge = await testCaseDeliveryNudge(taskId, detail)
      return {
        round,
        maxRounds,
        allPassed: true,
        escalated: false,
        taskStatus,
        results: cleaned,
        nextActions: [],
        testCaseNudge,
      }
    }

    // FAIL round: status untouched (stays wherever it was, typically
    // IN_PROGRESS); unmet criteria become the agent's next actions.
    const escalate = round >= maxRounds
    if (escalate) {
      // Synchronous like the mirror events — the escalation must exist the
      // moment the cap is hit. triggerActorId stays null: the escalation is
      // machine-triggered, and a non-null trigger would exclude a sole owner
      // from their own page.
      await activityRepository.create({
        taskId,
        actorId,
        type: 'VERIFICATION_ESCALATED',
        payload: {
          round,
          maxRounds,
          failedCriterionIds: failed.map(r => r.criterionId),
        },
      })
      await notifyWorkspaceOwners({
        workspaceId,
        taskId,
        type: 'AGENT_VERIFY',
        triggerActorId: null,
        requiresAction: true,
      })
    }

    const currentStatus = await taskRepository.findStatus(taskId)

    return {
      round,
      maxRounds,
      allPassed: false,
      escalated: escalate,
      taskStatus: currentStatus?.status ?? 'IN_PROGRESS',
      results: cleaned,
      nextActions: failed.map(r => ({
        criterionId: r.criterionId,
        statement: r.statement,
        checkpointer: machineById.get(r.criterionId)?.checkpointer ?? null,
        rejectionReason: r.rejectionReason,
      })),
      // A failing round has failures to read; a test-case ask here would
      // compete with them for attention (LUM-807).
      testCaseNudge: null,
    }
  },

  /**
   * The acceptance-status read model (LUM-344) — the agent's self-check
   * entry point. Pure read, no LLM: everything is derived on the fly from
   * AcceptanceCriterion + the append-only VerificationRun log (the task
   * carries no derived columns, milestone rule 8). `nextActions` is the
   * declarative plan: exactly the criteria whose latest verdict is not a
   * pass — there is no separately maintained plan state to drift.
   */
  async statusForTask(taskId: string): Promise<TaskAcceptanceStatus> {
    const [
      header,
      criteria,
      runs,
      allCriteria,
      changeEvents,
      lifecyclePrs,
      statusEvents,
      actuals,
      perSessionCost,
      latestRunClaim,
      claimSnapshot,
      faithfulnessVerdict,
      withdrawnActionIds,
      latestWithdrawal,
      latestHumanVerdictAction,
      securityState,
      testCaseState,
      testCaseVerdicts,
      coverage,
    ] = await Promise.all([
      taskRepository.findHeaderById(taskId),
      acceptanceCriterionRepository.listByTask(taskId),
      verificationRunRepository.listByTask(taskId),
      acceptanceCriterionRepository.listByTaskIncludingDeleted(taskId),
      activityRepository.listByTaskAndType(taskId, 'CRITERION_CHANGED'),
      pullRequestRepository.listForLifecycle(taskId),
      activityRepository.listByTaskAndType(taskId, 'STATUS_CHANGED'),
      // LUM-560: the SAME actuals the web delivery card reads (progress /
      // retrospective services both call loadActuals) — so the cost section of
      // task status cannot drift from the web card. Returns null only when the
      // task row is gone (handled below as not-measured).
      retrospectiveRepository.loadActuals(taskId),
      // LUM-562: per-session spend for the cost trajectory — same session-usage
      // source `loadActuals` totals, so Σ reconciles with the Cost-section total.
      retrospectiveRepository.loadPerSessionCost(taskId),
      // LUM-564: the latest session's run-claim material (LLM run summary +
      // STOP turn digest) — the live fallback used until the LUM-573 snapshot is
      // frozen (e.g. an in-progress task).
      sessionRepository.loadLatestRunClaim(taskId),
      // LUM-573: the frozen task-level claim snapshot (authoritative, merged
      // session). When present, the claim degrades to a field read of this.
      taskRepository.loadClaimSnapshot(taskId),
      // LUM-583: the persisted claim-faithfulness verdict (LUM-582). Read-only
      // — a field read, never an LLM call; null when this task hasn't been
      // judged yet (→ PENDING, distinct from a UNJUDGEABLE verdict).
      claimFaithfulnessVerdictRepository.findByTaskId(taskId),
      // LUM-586: withdrawn action ids — used to skip withdrawn human runs when
      // deriving latestByCriterion so the undo is reflected in the read model.
      verificationRunWithdrawalRepository.actionIdsByTask(taskId),
      // LUM-586: most-recent withdrawal row — used to populate lastVerdictWithdrawal.
      verificationRunWithdrawalRepository.latestByTask(taskId),
      // LUM-586: latest live (non-withdrawn) human verdict action — the undo target.
      verificationRunRepository.latestHumanVerdictAction(taskId),
      // LUM-737: undispositioned PR security findings. Fail-closed: a read
      // failure becomes `securityFindings: null` ("could not confirm"), never a
      // 500 on the whole self-check and never an implicit "clean".
      prSecurityReminderService
        .loadOpenFindingsForTask(taskId)
        .catch((error: unknown) => {
          logger.warn('taskStatus.securityRead.failed', {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        }),
      // LUM-807: two existence checks behind the same service every other
      // surface uses, so the advisory row can never disagree with the `Next:`
      // suggestion or the attach nudge. `taskDone` is refined off the header
      // below — the read itself doesn't need it.
      testCaseReminderService
        .stateForTask({ taskId, taskDone: false })
        .catch(() => null),
      // LUM-808: 每条用例最新 run 的判决信号。与 DONE 闸同一份推导
      // （done-verdict.service），fail-soft —— advisory 读不出来不该拖垮 status。
      readTestCaseAdvisories(taskId),
      // LUM-815: 用例覆盖。fail-soft **向沉默的方向**——读不出来时 cases 为
      // null，一条缺口都不报（兜底成空数组会把每条标准都报成未覆盖）。
      readCriterionCoverage(taskId),
    ])
    if (!header) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    // Fold the CRITERION_CHANGED drift log (append-only, oldest-first) into a
    // per-criterion view: the latest UPDATED event (reword) and latest DELETED
    // event (removal round). Payload is untyped JSON — read defensively.
    const editByCriterion = new Map<string, ChangeEventDigest>()
    const deletedRoundByCriterion = new Map<string, number>()
    for (const ev of changeEvents) {
      const p = ev.payload
      if (!p || typeof p !== 'object') continue
      const rec = p as Record<string, unknown>
      const criterionId = readJsonString(rec.criterionId)
      const op = readJsonString(rec.op)
      if (!criterionId || !op) continue
      const round = readJsonNumber(rec.round) ?? 0
      if (op === 'UPDATED') {
        editByCriterion.set(criterionId, {
          round,
          before: readSnapshotStatement(rec.before),
          after: readSnapshotStatement(rec.after),
        })
      } else if (op === 'DELETED') {
        deletedRoundByCriterion.set(criterionId, round)
      }
    }

    // Run count per criterion — counts every run, including runs that belong to
    // a now-tombstoned criterion (listByTask returns all runs for the task).
    const runCountByCriterion = new Map<string, number>()
    for (const run of runs) {
      runCountByCriterion.set(
        run.criterionId,
        (runCountByCriterion.get(run.criterionId) ?? 0) + 1
      )
    }

    // Effective cap is the task's workspace setting (LUM-429), falling back to
    // the default for older / unconfigured workspaces.
    const maxRounds =
      header.project?.workspace?.verificationMaxRounds ??
      VERIFICATION_MAX_ROUNDS

    // listByTask is ordered (round asc, createdAt asc) → last write per
    // criterion is its latest verdict, same contract as latestRunsByCriterion.
    const latestByCriterion = new Map<string, VerificationRunRow>()
    // Latest MACHINE-authored row per criterion — the evidence that a
    // checkpointer (not a human) currently vouches for (LUM-457 checkMismatch).
    const latestMachineByCriterion = new Map<string, VerificationRunRow>()
    const runsByRound = new Map<number, VerificationRunRow[]>()
    let currentRound = 0
    for (const run of runs) {
      // LUM-586: a withdrawn human run no longer counts as the criterion's
      // latest verdict — skipping it lets the prior surviving row (the machine
      // PASS, or nothing) win, so an undo is reflected in the read model. The
      // run still flows into runsByRound below, so it stays visible in the
      // verification history (badged "withdrawn"), never erased.
      if (!isRunWithdrawn(run, withdrawnActionIds)) {
        latestByCriterion.set(run.criterionId, run)
        if (run.verifierType === 'MACHINE')
          latestMachineByCriterion.set(run.criterionId, run)
      }
      const bucket = runsByRound.get(run.round)
      if (bucket) bucket.push(run)
      else runsByRound.set(run.round, [run])
      if (run.round > currentRound) currentRound = run.round
    }

    const verificationHistory: VerificationHistoryRound[] = [
      ...runsByRound.entries(),
    ]
      .sort(([a], [b]) => a - b)
      .map(([round, rows]) => ({
        round,
        recordedAt: rows[0]!.createdAt.toISOString(),
        passed: rows.filter(r => isPassVerdict(r.verdict)).length,
        failed: rows.filter(r => r.verdict === 'FAIL').length,
        verdicts: rows.map(r => ({
          criterionId: r.criterionId,
          verdict: r.verdict,
          verifierType: r.verifierType,
          evidencePointer: r.evidencePointer,
          rejectionReason: r.rejectionReason,
          rejectionReasonEnum: r.rejectionReasonEnum,
          withdrawn: isRunWithdrawn(r, withdrawnActionIds),
        })),
      }))

    const statementById = new Map(criteria.map(c => [c.id, c.statement]))
    const lastRoundFailures = (runsByRound.get(currentRound) ?? [])
      .filter(r => r.verdict === 'FAIL')
      .map(r => ({
        criterionId: r.criterionId,
        statement: statementById.get(r.criterionId) ?? '',
        rejectionReason: r.rejectionReason,
        rejectionReasonEnum: r.rejectionReasonEnum,
      }))

    const unmet = criteria.filter(c =>
      isUnmetForDisplay(c, latestByCriterion.get(c.id))
    )

    // LUM-456: a MACHINE criterion is genuinely machine-verified only when an
    // actual checkpointer run passed it (its latest MACHINE-authored verdict is
    // a PASS) — single source shared with the human-verdict fan-out. A passing
    // MACHINE criterion absent from this set is being carried by a human
    // override, and is counted as such so the rollup never impersonates machine
    // verification.
    const machinePassedSet = deriveMachinePassedCriteria(runs)
    const machineActive = criteria.filter(c => c.verifierType === 'MACHINE')
    let machineVerified = 0
    let humanOverridden = 0
    for (const c of machineActive) {
      if (!isPassVerdict(latestByCriterion.get(c.id)?.verdict)) continue
      if (machinePassedSet.has(c.id)) machineVerified++
      else humanOverridden++
    }
    const machineVerification: MachineVerificationSummary = {
      total: machineActive.length,
      machineVerified,
      humanOverridden,
    }

    // LUM-561 struggle trail: rework / send-back / leftover signals the
    // all-pass report would otherwise erase. Derived from the same run log —
    // no new state, no derived columns (milestone rule 8).
    const statementByIdAll = new Map(allCriteria.map(c => [c.id, c.statement]))
    const reworkRounds = verificationHistory
      .filter(h => h.failed > 0)
      .map(h => ({ round: h.round, failed: h.failed }))
    // Send-backs across the live AND removed contract, so a struggle on a
    // since-deleted criterion is preserved rather than wiped with it.
    const sendBacks = allCriteria
      .map(c => {
        const sb = deriveSendBackResolution(c.id, runs, lifecyclePrs)
        if (!sb) return null
        return {
          criterionId: c.id,
          statement: statementByIdAll.get(c.id) ?? '',
          status: sb.status,
          failedAtRound: sb.failedAtRound,
          resolvedAtRound: sb.resolvedAtRound ?? null,
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
    // Leftover follow-ups: criteria whose latest verdict still carries a
    // follow-up flag (passed, but with work left behind).
    const followUps = criteria
      .filter(
        c => latestByCriterion.get(c.id)?.verdict === 'PASS_WITH_FOLLOWUP'
      )
      .map(c => ({
        criterionId: c.id,
        statement: c.statement,
        round: latestByCriterion.get(c.id)!.round,
      }))
    // PR iteration: the verify loop often runs once while the real rework
    // happens across follow-up PRs (LUM-557: ~10 PRs, 1 verify round) — so the
    // PR list is a first-class struggle signal, not just send-back attribution.
    const pullRequests = lifecyclePrs.map(p => ({
      number: p.number,
      url: p.url,
    }))
    // Reopens: a backward transition from IN_REVIEW/DONE to IN_PROGRESS/TODO —
    // the task was bounced after reaching review/done, leaving no FAIL verdict.
    const REOPEN_FROM = new Set(['IN_REVIEW', 'DONE'])
    const REOPEN_TO = new Set(['IN_PROGRESS', 'TODO'])
    const reopens = statusEvents
      .map(ev => {
        const p = ev.payload
        if (!p || typeof p !== 'object') return null
        const rec = p as Record<string, unknown>
        const from = readJsonString(rec.from)
        const to = readJsonString(rec.to)
        if (!from || !to) return null
        return { from, to, at: ev.createdAt.toISOString() }
      })
      .filter((r): r is { from: string; to: string; at: string } => r !== null)
      .filter(r => REOPEN_FROM.has(r.from) && REOPEN_TO.has(r.to))
    const struggleTrail: StruggleTrail = {
      reworkRounds,
      sendBacks,
      followUps,
      pullRequests,
      reopens,
    }

    // LUM-560 cost read-out: token + active time straight from the web card's
    // actuals source (no re-summation here — same-source guarantee), rework
    // rounds reused from the run-log-derived reworkRounds above. `actuals` is
    // null only when the task row is gone; both that and a usage-less task read
    // as tokenCost null = not measured (≠ a measured 0).
    const cost: TaskCost = {
      tokenCost: actuals?.tokenCost ?? null,
      activeTimeSec: actuals?.totalDurationSec ?? 0,
      reworkRounds: reworkRounds.length,
    }

    // LUM-562 trend: roll the three time series the snapshot flattens —
    // pass rate per round, per-session spend, accrued rework — into movement.
    // Pass rate reuses the verification history; cost reuses the per-session
    // spend (same session-usage source as the Cost block, so Σ reconciles with
    // cost.tokenCost); rework decomposes the struggle signals into a monotonic
    // accrual. No new state.
    const extraPrCycles = Math.max(0, pullRequests.length - 1)
    const trend: TrendModel = {
      passRate: verificationHistory.map(h => ({
        round: h.round,
        passed: h.passed,
        failed: h.failed,
      })),
      cost: perSessionCost.map(s => ({
        sessionId: s.sessionId,
        total: s.tokenCost,
        loopCount: s.loopCount,
        at: s.startedAt.toISOString(),
      })),
      rework: {
        reworkRounds: reworkRounds.length,
        reopens: reopens.length,
        extraPrCycles,
        total: reworkRounds.length + reopens.length + extraPrCycles,
      },
    }

    // LUM-573 claim: degrade to a field read of the frozen task-level snapshot
    // (the authoritative, merged-lineage session — no longer the trailing
    // exploration session the old latest-session rule echoed). Before a snapshot
    // is frozen (e.g. an in-progress task) it falls back to the live
    // latest-session material under the same two-layer rule (LUM-564), so web
    // (HonestReportSections) and CLI (task-status) stay same-source through
    // TaskAcceptanceStatus.claim. A synthesized null snapshot stays null
    // (fail-closed), never resurrecting the buggy latest-session claim.
    const claim = resolveClaimForReadModel(
      claimSnapshot && claimSnapshot.claimSnapshotAt != null
        ? {
            text: claimSnapshot.claimSnapshot,
            source: claimSnapshot.claimSnapshotSource as TaskClaim['source'],
            synthesized: true,
          }
        : null,
      latestRunClaim
        ? {
            runSummary: latestRunClaim.runSummary,
            turnSummaries: latestRunClaim.events.map(e => e.turnSummary ?? ''),
          }
        : null
    )

    // LUM-583 faithfulness: degrade to a field read of the persisted LUM-582
    // verdict, judged against the same claim snapshot the claim above resolves
    // from. No verdict row → PENDING; a verdict judged before the current
    // snapshot → STALE (re-judged by the next batch). No LLM at read time.
    const faithfulness = deriveFaithfulness(
      faithfulnessVerdict,
      claimSnapshot?.claimSnapshotAt ?? null
    )

    // Map a raw verification run to the latest-verdict read shape (shared by
    // active criteria and removed criteria).
    const toLatestVerdict = (
      run: VerificationRunRow | undefined
    ): CriterionLatestVerdict | null =>
      run
        ? {
            round: run.round,
            verdict: run.verdict,
            verifierType: run.verifierType,
            evidencePointer: run.evidencePointer,
            rejectionReason: run.rejectionReason,
            rejectionReasonEnum: run.rejectionReasonEnum,
            recordedAt: run.createdAt.toISOString(),
          }
        : null

    // Removed criteria: tombstoned rows, with preserved last verdict + run count.
    const removedCriteria: RemovedCriterion[] = allCriteria
      .filter(c => c.deletedAt != null)
      .map(t => ({
        id: t.id,
        statement: t.statement,
        verifierType: t.verifierType,
        removedAtRound: deletedRoundByCriterion.get(t.id) ?? null,
        runCount: runCountByCriterion.get(t.id) ?? 0,
        lastVerdict: toLatestVerdict(latestByCriterion.get(t.id)),
      }))

    // LUM-586: the undo affordance + correction-line data. `undoableHumanVerdict`
    // is the latest live human verdict (the undo target); `lastVerdictWithdrawal`
    // is the most-recent withdrawal, with the withdrawn verdict read off the
    // surviving (append-only) run rows for that action — no extra query, no
    // hardcoded value. actorName is left null (tolerated): the UI falls back to a
    // generic "a reviewer" rather than fabricating a name.
    const undoableHumanVerdict = latestHumanVerdictAction
      ? {
          verdictActionId: latestHumanVerdictAction.verdictActionId,
          verdict: latestHumanVerdictAction.verdict,
          actorName: null,
          at: latestHumanVerdictAction.recordedAt.toISOString(),
        }
      : null
    const withdrawnVerdictValue = latestWithdrawal
      ? (runs.find(r => r.verdictActionId === latestWithdrawal.verdictActionId)
          ?.verdict ?? null)
      : null
    const lastVerdictWithdrawal =
      latestWithdrawal && withdrawnVerdictValue
        ? {
            verdict: withdrawnVerdictValue,
            actorName: null,
            at: latestWithdrawal.createdAt.toISOString(),
          }
        : null

    return {
      version: TASK_STATUS_SCHEMA_VERSION,
      task: {
        id: header.id,
        identifier: `${header.team.identifier}-${header.number}`,
        title: header.title,
        status: header.status,
      },
      currentRound,
      maxRounds,
      escalated: currentRound >= maxRounds && lastRoundFailures.length > 0,
      undoableHumanVerdict,
      lastVerdictWithdrawal,
      criteria: criteria.map(c => {
        const edit = editByCriterion.get(c.id)
        // An edit recorded after work started (round > 0) marks the criterion
        // 'edited'; otherwise an after-start birth (addedAtRound > 0) marks it
        // 'added'. 'edited' takes precedence. A pure round-0 draft is null.
        const edited = edit != null && edit.round > 0
        const added = c.addedAtRound > 0
        const changeState: 'added' | 'edited' | null = edited
          ? 'edited'
          : added
            ? 'added'
            : null

        // LUM-457 staleness: the latest verdict predates the criterion's last
        // edit — it judged a now-stale version. No verdict → nothing to stale.
        const latest = latestByCriterion.get(c.id)
        const verdictStale =
          latest != null &&
          c.updatedAt != null &&
          c.updatedAt.getTime() > latest.createdAt.getTime()
        // checkMismatch: the machine PASS currently vouching for this criterion
        // ran a different command than the present checkpointer. Only compare
        // when a genuine machine PASS exists (machinePassedSet) — a human
        // override or HUMAN criterion has no machine check to mismatch.
        const machineLatest = latestMachineByCriterion.get(c.id)
        const checkMismatch =
          c.verifierType === 'MACHINE' &&
          machinePassedSet.has(c.id) &&
          c.checkpointer != null &&
          !(machineLatest?.evidencePointer ?? '').startsWith(
            `cmd:${c.checkpointer}#`
          )

        return {
          id: c.id,
          statement: c.statement,
          verifierType: c.verifierType,
          checkpointer: c.checkpointer,
          evidenceRequired: c.evidenceRequired,
          judgeSteps: c.judgeSteps,
          referentKind: c.referentKind ?? null,
          source: c.source,
          addedAtRound: c.addedAtRound,
          latestVerdict: toLatestVerdict(latestByCriterion.get(c.id)),
          // LUM-611: the machine round below the latest verdict — surfaced so a
          // human override never hides the checkpointer evidence that ran.
          machineVerdict: toLatestVerdict(machineLatest),
          machinePassed: machinePassedSet.has(c.id),
          verdictStale,
          checkMismatch,
          changeState,
          changedAtRound: edited ? edit!.round : added ? c.addedAtRound : null,
          lastEdit: edited
            ? { before: edit!.before, after: edit!.after }
            : null,
          sendBackResolution: deriveSendBackResolution(
            c.id,
            runs,
            lifecyclePrs
          ),
          confirmedAt: c.confirmedAt ? c.confirmedAt.toISOString() : null,
          linkedCases: coverage.byCriterion.get(c.id) ?? [],
        }
      }),
      machineVerification,
      struggleTrail,
      cost,
      trend,
      claim,
      faithfulness,
      removedCriteria,
      verificationHistory,
      lastRoundFailures,
      nextActions: [
        ...unmet.map((c): NextActionCriterion => {
          const latest = latestByCriterion.get(c.id)
          return {
            kind: 'CRITERION',
            criterionId: c.id,
            statement: c.statement,
            verifierType: c.verifierType,
            checkpointer: c.checkpointer,
            judgeSteps: c.judgeSteps,
            source: c.source,
            addedAtRound: c.addedAtRound,
            rejectionReason:
              latest?.verdict === 'FAIL' ? latest.rejectionReason : null,
          }
        }),
        // LUM-737: findings come after the contract — they are constraints on
        // DONE, not criteria; already severity/provenance-sorted by the service.
        ...(securityState?.findings ?? []).map(
          (f): NextActionSecurityFinding => ({
            kind: 'SECURITY_FINDING',
            findingId: f.id,
            statement: findingStatement(f),
            severity: f.severity,
            provenance: f.provenance,
            blocking: f.blocking,
            prNumber: f.prNumber,
            ruleId: f.ruleId,
            filePath: f.filePath,
            line: f.line,
            secretDowngrade: f.secretDowngrade ?? null,
          })
        ),
        // LUM-807: last, and advisory-only. A missing test case is not a
        // constraint on DONE — unlike a blocking finding it never refuses the
        // transition, and `unmetCriteriaCount` (contract rows only) ignores it.
        ...(testCaseState !== null &&
        remindOnDelivery({
          ...testCaseState,
          taskDone: header.status === 'DONE',
        })
          ? [
              {
                kind: 'TEST_CASE' as const,
                statement: TEST_CASE_ADVISORY_STATEMENT,
                command: testCaseAddCommand(
                  `${header.team.identifier}-${header.number}`
                ),
                advisory: true as const,
              },
            ]
          : []),
        // LUM-815: 覆盖缺口 —— 合同里一条用例都没有的标准。advisory-only,
        // 不计入 unmetCriteriaCount(那只数合同行的裁定), 不进 DONE 闸的
        // blocker 集合。`coverage.cases === null` = 没读出来 → 一条都不报。
        ...(coverage.cases === null
          ? []
          : deriveCoverageGaps(criteria, coverage.cases).map(
              (gap): NextActionCoverageGap => ({
                kind: 'COVERAGE_GAP',
                criterionId: gap.id,
                statement: gap.statement,
                command: `lumo task testcase add ${header.team.identifier}-${header.number} --criterion ${gap.id.slice(0, 8)} --title "<title>" --step "<step>" --expected "<result>"`,
                advisory: true,
              })
            )),
        // LUM-808: 判决层的 advisory —— 已举证的实现缺陷、被封顶成 UNPROVEN
        // 的 PASS、过时的用例。永远排在最后，永远不改「能不能 DONE」。
        ...testCaseVerdicts.map(
          (v): NextActionTestCaseVerdict => ({
            kind: 'TEST_CASE_VERDICT',
            signal: v.signal,
            number: v.number,
            title: v.title,
            advisory: true,
          })
        ),
      ],
      securityFindings: securityState
        ? {
            open: securityState.findings.length,
            blocking: securityState.blockingCount,
            unconfirmedPrs: securityState.unconfirmedPrs,
            scans: securityState.scans,
          }
        : null,
    }
  },

  /**
   * Roll the per-task struggle trail / machine-verification rollup up across a
   * set of tasks (LUM-506) — the cross-task input a milestone/sprint retro
   * needs to stop reporting an all-green title list. Reads each task's struggle
   * signals through {@link statusForTask} (the SAME LUM-561/456 source `lumo
   * task status` reads) and hands them to the pure {@link aggregateRetroStruggle},
   * so the retro's negative-class section cannot drift from task status. A task
   * that 404s (e.g. deleted mid-window) is dropped rather than failing the whole
   * retro.
   */
  async aggregateStruggleForTasks(
    taskIds: string[]
  ): Promise<RetroStruggleAggregate> {
    const statuses = await Promise.all(
      taskIds.map(async id => {
        try {
          return await this.statusForTask(id)
        } catch {
          return null
        }
      })
    )
    return aggregateRetroStruggle(
      statuses
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map(s => ({
          task: { identifier: s.task.identifier, title: s.task.title },
          struggleTrail: s.struggleTrail,
          machineVerification: s.machineVerification,
        }))
    )
  },
}
