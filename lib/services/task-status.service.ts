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
import { collectTaskStatusSections } from '@/lib/plugins/agent-context'
import {
  readDoneGateInputs,
  readTestCaseAdvisories,
} from '@/lib/services/done-verdict.service'
import {
  doneGateReadout,
  type DoneGateReadout,
} from '@/lib/acceptance/done-gate'
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

/**
 * LUM-807: the advisory row for a task that has a PR but no recorded test
 * case. Deliberately shaped like a finding row minus everything that gates:
 * no severity, no `blocking` flag to be true — it can only ever be advice.
 * The DONE gate never reads it.
 */
/**
 * LUM-808: 一条用例最新 run 的**判决**信号，信号本身来自与 DONE 闸同一个纯函数。
 *
 * LUM-1186: LUM-812 之后 `PROVEN_DEFECT` 且这条 run 还没人裁定时**拦 DONE**
 * （`computeDoneVerdict` 的 TEST_CASE_DEFECT blocker，409）。`blocking` 如实
 * 说出这一点，`advisory` 是它的反面——其余信号（UNPROVEN / 过时 / 已裁定的
 * defect）从不拦。
 */
export interface NextActionTestCaseVerdict {
  kind: 'TEST_CASE_VERDICT'
  signal: 'PROVEN_DEFECT' | 'UNPROVEN_PASS' | 'CASE_OUTDATED'
  /** 用例序号（LUM-42/TC3 里的 3）。 */
  number: number
  title: string
  /** LUM-819: 仅 `UNPROVEN_PASS` 带——被哪条边界封顶。 */
  ceilingReason?: 'environment' | 'unobserved' | 'skipped' | 'no-evidence'
  /** LUM-1186: a proven defect no human has ruled on yet — refuses DONE. */
  blocking: boolean
  /** Always `!blocking`. */
  advisory: boolean
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
 * LUM-1061 — next-action kinds contributed by plugins, keyed by `kind`. A
 * plugin adds its rows by declaration merging (the security plugin adds
 * `SECURITY_FINDING`, see ee/security/task-status.ts); without a plugin the
 * map is empty and only the core kinds below exist.
 */
export interface PluginNextActionKinds {}

/**
 * LUM-1061 — top-level report fields contributed by plugins (declaration
 * merging, like {@link PluginNextActionKinds}). The security plugin adds
 * `securityFindings`; without it the field is absent, which the CLI already
 * reads as "older server" (no security read-out).
 */
export interface TaskStatusPluginFields {}

/**
 * One entry of the declarative plan. `kind` discriminates: plugin rows come
 * first (with the security plugin: SECURITY_FINDING, a hard constraint on
 * DONE when `blocking`); the test-case kinds are advisory only.
 */
export type NextAction =
  | PluginNextActionKinds[keyof PluginNextActionKinds]
  | NextActionTestCaseVerdict
  | NextActionTestCase

export interface TaskStatusReport extends TaskStatusPluginFields {
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
  /** Plugin rows (security findings) + test-case advisories. */
  nextActions: NextAction[]
  /**
   * LUM-1186: the Done gate — the web Record tab's headline and rows, from
   * the same `deriveDoneGate`. Absent when the caller passed no workspace
   * (internal roll-ups); `confirmed: false` when a plane could not be read.
   */
  doneGate?: DoneGateReadout
}

/** Defensive reader for untyped activity JSON payloads. */
function readJsonString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

const REOPEN_FROM = new Set(['IN_REVIEW', 'DONE'])
const REOPEN_TO = new Set(['IN_PROGRESS', 'TODO', 'BACKLOG'])

export const taskStatusService = {
  /**
   * The task-status read model (LUM-344) — the agent's self-check entry
   * point. Pure read, no LLM: rework, cost, claim, security findings and
   * test-case advisories, all derived on the fly.
   */
  async statusForTask(
    taskId: string,
    /** LUM-1186: the caller's workspace — enables the `doneGate` read-out. */
    workspaceId?: string
  ): Promise<TaskStatusReport> {
    const [
      header,
      lifecyclePrs,
      statusEvents,
      actuals,
      perSessionCost,
      latestRunClaim,
      claimSnapshot,
      faithfulnessVerdict,
      pluginStatus,
      testCaseState,
      testCaseVerdicts,
      doneGateInputs,
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
      // LUM-737 / LUM-1061: plugin sections — the security plugin's
      // undispositioned PR findings and its `securityFindings` read-out
      // (fail-closed inside the plugin: a read failure is `null`, "could not
      // confirm"). No plugin → no rows, no field.
      collectTaskStatusSections(taskId),
      // LUM-807: same reminder service every other surface uses.
      testCaseReminderService
        .stateForTask({ taskId, taskDone: false })
        .catch(() => null),
      // LUM-808: per-case latest-run verdict signal (same derivation as the
      // DONE gate), fail-soft.
      readTestCaseAdvisories(taskId),
      // LUM-1186: the Done gate's reads (fail-closed inside, never throws);
      // derived below once the header's status is known.
      workspaceId === undefined
        ? Promise.resolve(undefined)
        : readDoneGateInputs(taskId, workspaceId),
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

    const report: TaskStatusReport = {
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
        ...(pluginStatus.nextActions as PluginNextActionKinds[keyof PluginNextActionKinds][]),
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
        ...testCaseVerdicts.map((v): NextActionTestCaseVerdict => {
          // Same predicate as computeDoneVerdict's TEST_CASE_DEFECT blocker.
          const blocking = v.signal === 'PROVEN_DEFECT' && !v.dispositioned
          return {
            kind: 'TEST_CASE_VERDICT',
            signal: v.signal,
            number: v.number,
            title: v.title,
            ...(v.ceilingReason ? { ceilingReason: v.ceilingReason } : {}),
            blocking,
            advisory: !blocking,
          }
        }),
      ],
      ...(doneGateInputs
        ? { doneGate: doneGateReadout(doneGateInputs, header.status) }
        : {}),
    }
    // Plugin fields come last and never replace a core field.
    for (const [key, value] of Object.entries(pluginStatus.fields)) {
      if (
        key !== '__proto__' &&
        !Object.prototype.hasOwnProperty.call(report, key)
      )
        (report as unknown as Record<string, unknown>)[key] = value
    }
    return report
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
