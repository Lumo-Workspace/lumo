import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
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
  remindOnDelivery,
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
import { testCaseReviewService } from '@/lib/services/test-case-review.service'
import { reviewSentBackStatement } from '@/lib/test-cases/review'
import type {
  FindingProvenance,
  FindingSeverity,
} from '@/lib/repositories/pr-security-scan.repository'
import {
  aggregateRetroStruggle,
  type RetroStruggleAggregate,
} from '@/lib/services/retro-struggle'

/**
 * Version of the task-status read model served by GET /api/tasks/[id]/status
 * and emitted by `lumo task status --json`. Consumers pin on it; a breaking
 * change to the payload shape requires a major bump (additive fields don't).
 * v2 (LUM-942): acceptance criteria + verification rounds removed.
 */
export const TASK_STATUS_SCHEMA_VERSION = 2

/**
 * The honest "struggle trail" (LUM-561): the rework signals a clean report
 * would otherwise wipe — PR cycles and status reopens. Both arrays empty is a
 * legitimate (honest) state; the renderer must still state the basis for
 * "nothing outstanding" rather than silently dropping the section.
 */
export interface StruggleTrail {
  /** PRs opened against the task, oldest-first. A single PR is the happy path;
   *  >1 PR is the dominant rework signal (LUM-557). */
  pullRequests: Array<{ number: number; url: string }>
  /** Status reopens — a transition from IN_REVIEW/DONE back to IN_PROGRESS/TODO
   *  (from the STATUS_CHANGED activity log). */
  reopens: Array<{ from: string; to: string; at: string }>
}

/**
 * The honest cost read-out (LUM-560). Every number is read from
 * {@link retrospectiveRepository.loadActuals} — the SAME server-side source the
 * web delivery card consumes — so the two reports cannot drift.
 */
export interface TaskCost {
  /** Total tokens across every session linked to the task. `null` = NOT
   *  measured (no session usage recorded), distinct from a measured 0. */
  tokenCost: number | null
  /** Agent active (non-idle) seconds — Σ per-turn `STOP − prompt` (LUM-487). */
  activeTimeSec: number
}

/**
 * The honest "trend" (LUM-562): per-session cost and accrued rework across the
 * task's attempts, instead of a single-point snapshot. Σ of `cost[].total`
 * equals {@link TaskCost.tokenCost} (same source).
 */
export interface TrendModel {
  cost: Array<{
    sessionId: string
    total: number
    loopCount: number
    at: string
  }>
  /** Cumulative rework, decomposed by signal. Monotonic. */
  rework: {
    reopens: number
    /** PR cycles beyond the first (>1 PR is the churn signal, LUM-557). */
    extraPrCycles: number
    total: number
  }
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
  /** LUM-819: 仅 `UNPROVEN_PASS` 带——被哪条边界封顶。 */
  ceilingReason?: 'environment' | 'unobserved' | 'no-evidence'
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
 * One entry of the declarative plan. `kind` discriminates: SECURITY_FINDING is
 * an undispositioned PR security finding (a hard constraint on DONE when
 * `blocking`); the test-case kinds are advisory only.
 */
export type NextAction =
  | NextActionTestCaseVerdict
  | NextActionSecurityFinding
  | NextActionTestCase
export interface TaskSecurityFindingsSummary {
  open: number
  blocking: number
  unconfirmedPrs: UnconfirmedPr[]
  /** LUM-735 — per-PR scan summary passed through from the reminder service,
   *  for `lumo task status` to render one line per scan. Additive: optional
   *  so an older cached/serialized summary without it still type-checks. */
  scans?: TaskSecurityScanSummary[]
}

export interface TaskStatusReport {
  version: typeof TASK_STATUS_SCHEMA_VERSION
  task: { id: string; identifier: string; title: string; status: string }
  /** Rework traces (LUM-561) — PR cycles and reopens. */
  struggleTrail: StruggleTrail
  /** Honest cost read-out (LUM-560). tokenCost null = not measured. */
  cost: TaskCost
  /** Movement of cost / rework across the task's attempts (LUM-562). */
  trend: TrendModel
  /** The agent's CLAIM — what it SAYS it did (LUM-564). Same-source with the
   *  web card's latestRunSummary; an unverified self-report. */
  claim: TaskClaim
  /** Whether the CLAIM faithfully reflects the delivery (LUM-583), read from
   *  the persisted ClaimFaithfulnessVerdict (no LLM at read time). */
  faithfulness: ClaimFaithfulness
  /** Undispositioned security findings + test-case advisories. */
  nextActions: NextAction[]
  /** LUM-737: security-scan read-out. `null` = the read failed (could NOT
   *  confirm) — distinct from `{ open: 0, … }`. */
  securityFindings: TaskSecurityFindingsSummary | null
}

/** Defensive reader for untyped activity JSON payloads. */
function readJsonString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

const REOPEN_FROM = new Set(['IN_REVIEW', 'DONE'])
const REOPEN_TO = new Set(['IN_PROGRESS', 'TODO'])

export const taskStatusService = {
  /**
   * The task-status read model (LUM-344) — the agent's self-check entry
   * point. Pure read, no LLM: rework, cost, claim, security findings and
   * test-case advisories, all derived on the fly.
   */
  async statusForTask(taskId: string): Promise<TaskStatusReport> {
    const [
      header,
      lifecyclePrs,
      statusEvents,
      actuals,
      perSessionCost,
      latestRunClaim,
      claimSnapshot,
      faithfulnessVerdict,
      securityState,
      testCaseState,
      testCaseVerdicts,
      reviewSentBacks,
    ] = await Promise.all([
      taskRepository.findHeaderById(taskId),
      pullRequestRepository.listForLifecycle(taskId),
      activityRepository.listByTaskAndType(taskId, 'STATUS_CHANGED'),
      // LUM-560: the SAME actuals the web delivery card reads — so the cost
      // section of task status cannot drift from the web card.
      retrospectiveRepository.loadActuals(taskId),
      // LUM-562: per-session spend — Σ reconciles with the Cost-section total.
      retrospectiveRepository.loadPerSessionCost(taskId),
      // LUM-564: live fallback claim until the LUM-573 snapshot is frozen.
      sessionRepository.loadLatestRunClaim(taskId),
      // LUM-573: the frozen task-level claim snapshot (authoritative).
      taskRepository.loadClaimSnapshot(taskId),
      // LUM-583: persisted claim-faithfulness verdict (LUM-582); null → PENDING.
      claimFaithfulnessVerdictRepository.findByTaskId(taskId),
      // LUM-737: undispositioned PR security findings. Fail-closed: a read
      // failure becomes `securityFindings: null` ("could not confirm").
      prSecurityReminderService
        .loadOpenFindingsForTask(taskId)
        .catch((error: unknown) => {
          logger.warn('taskStatus.securityRead.failed', {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        }),
      // LUM-807: same reminder service every other surface uses.
      testCaseReminderService
        .stateForTask({ taskId, taskDone: false })
        .catch(() => null),
      // LUM-808: per-case latest-run verdict signal (same derivation as the
      // DONE gate), fail-soft.
      readTestCaseAdvisories(taskId),
      // LUM-819: latest runs sent back on spot-check review. Advisory only.
      testCaseReviewService.sentBackForTask(taskId),
    ])
    if (!header) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }
    const identifier = `${header.team.identifier}-${header.number}`

    const pullRequests = lifecyclePrs.map(p => ({
      number: p.number,
      url: p.url,
    }))
    // Reopens: a backward transition from IN_REVIEW/DONE to IN_PROGRESS/TODO.
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

    const cost: TaskCost = {
      tokenCost: actuals?.tokenCost ?? null,
      activeTimeSec: actuals?.totalDurationSec ?? 0,
    }

    const extraPrCycles = Math.max(0, pullRequests.length - 1)
    const trend: TrendModel = {
      cost: perSessionCost.map(s => ({
        sessionId: s.sessionId,
        total: s.tokenCost,
        loopCount: s.loopCount,
        at: s.startedAt.toISOString(),
      })),
      rework: {
        reopens: reopens.length,
        extraPrCycles,
        total: reopens.length + extraPrCycles,
      },
    }

    // LUM-573 claim: field read of the frozen snapshot, falling back to the
    // live latest-session material before it is frozen (LUM-564).
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
    const faithfulness = deriveFaithfulness(
      faithfulnessVerdict,
      claimSnapshot?.claimSnapshotAt ?? null
    )

    return {
      version: TASK_STATUS_SCHEMA_VERSION,
      task: {
        id: header.id,
        identifier,
        title: header.title,
        status: header.status,
      },
      struggleTrail: { pullRequests, reopens },
      cost,
      trend,
      claim,
      faithfulness,
      nextActions: [
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
        // LUM-807: advisory-only. A missing test case never refuses DONE.
        ...(testCaseState !== null &&
        remindOnDelivery({
          ...testCaseState,
          taskDone: header.status === 'DONE',
        })
          ? [
              {
                kind: 'TEST_CASE' as const,
                statement: TEST_CASE_ADVISORY_STATEMENT,
                command: testCaseAddCommand(identifier),
                advisory: true as const,
              },
            ]
          : []),
        // LUM-808: verdict-layer advisories — never change whether DONE is allowed.
        ...testCaseVerdicts.map(
          (v): NextActionTestCaseVerdict => ({
            kind: 'TEST_CASE_VERDICT',
            signal: v.signal,
            number: v.number,
            title: v.title,
            ...(v.ceilingReason ? { ceilingReason: v.ceilingReason } : {}),
            advisory: true,
          })
        ),
        // LUM-819: a spot-check sent this PASS back. Reuses `TEST_CASE` so old
        // CLIs render it as advisory.
        ...reviewSentBacks.map(
          (r): NextActionTestCase => ({
            kind: 'TEST_CASE',
            statement: reviewSentBackStatement(r),
            command: `lumo task testcase show ${identifier}/TC${r.number}`,
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
   * Roll the per-task struggle trail up across a set of tasks (LUM-506) for a
   * milestone/sprint retro. Reads through {@link statusForTask} so the retro
   * cannot drift from task status. A task that 404s is dropped.
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
        }))
    )
  },
}

/**
 * LUM-942: CLIs ≤ the release that removed acceptance criteria read the v1
 * payload and dereference its criteria / verification fields unguarded. Pad
 * the v2 report with empty v1 fields so an old `lumo task status` keeps
 * rendering (as "no criteria") instead of crashing. Route-level only — the
 * service's own type stays v2. Safe to drop once old CLIs age out.
 */
export function withLegacyV1Fields(report: TaskStatusReport) {
  return {
    ...report,
    currentRound: 0,
    maxRounds: 0,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    undoableHumanVerdict: null,
    lastVerdictWithdrawal: null,
    struggleTrail: {
      ...report.struggleTrail,
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
    },
    cost: { ...report.cost, reworkRounds: 0 },
    trend: {
      ...report.trend,
      passRate: [],
      rework: { ...report.trend.rework, reworkRounds: 0 },
    },
  }
}
