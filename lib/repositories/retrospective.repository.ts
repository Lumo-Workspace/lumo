import { Prisma, type HookEventType } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  eventsForTask,
  eventsForTasks,
  inferredTopLevelSessionsForTask,
  taskHasSessions,
} from '@/lib/repositories/task-attribution-where'
import type { Interval } from '@/lib/forecast/types'
import { sumActiveDurationSec } from '@/lib/agent-run/active-time'
import {
  mergeModelCosts,
  toModelCosts,
  usageMapTotal,
  type ModelCost,
  type ModelUsage,
} from '@/lib/services/model-cost'
import {
  foldInferredBySession,
  inferredUsageForTasks,
} from '@/lib/repositories/inferred-usage.repository'

/** Flat cumulative token total of one session-shaped row (nulls → 0). */
function flatTokens(s: {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}): number {
  return (
    (s.inputTokens ?? 0) +
    (s.outputTokens ?? 0) +
    (s.cacheReadTokens ?? 0) +
    (s.cacheCreationTokens ?? 0)
  )
}

/** Converts a nullable Interval to a Prisma-compatible nullable JSON value. */
function toJsonValue(
  v: Interval | null
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return v !== null ? (v as unknown as Prisma.InputJsonValue) : Prisma.DbNull
}

export interface SnapshotRow {
  iterations: Interval | null
  interactionRounds: Interval | null
  tokenCost: Interval | null
  cohortSize: number
  tokenCostBasis: number
  capturedAt: Date
}

export interface SnapshotPayload {
  iterations: Interval | null
  interactionRounds: Interval | null
  tokenCost: Interval | null
  cohortSize: number
  tokenCostBasis: number
}

export interface RetrospectiveActuals {
  projectId: string
  tokenCost: number | null
  iterations: number
  interactionRounds: number
  totalDurationSec: number
}

/**
 * Batched actuals over a task set (LUM-627 milestone rollup). Same-source with
 * `loadActuals`: token sums read the same cumulative `Session.*` columns with
 * the same per-task measured gate (some session has non-null outputTokens), so
 * `tokenCost` here equals Σ of the member tasks' `loadActuals.tokenCost` —
 * fail-closed `null` when NO task is measured (没测到 ≠ 花了0).
 */
export interface TaskSetActuals {
  tokenCost: number | null
  activeTimeSec: number
  /** Tasks with ≥1 usage-bearing session — the coverage numerator. */
  measuredTasks: number
  /** LUM-636 per-model split of the SAME measured sessions' spend
   * (`Session.usageByModel`, STOP-settled), merged across sessions and
   * sorted by total desc. Empty when no measured session carries a map —
   * the flat `tokenCost` stays authoritative either way. */
  models: ModelCost[]
  /** `tokenCost − Σ models.total`, clamped ≥0 — spend from sessions whose
   * usageByModel predates LUM-298 (flat columns only). Rendered as an
   * explicit line, never silently folded into a model. 0 when tokenCost is null. */
  modelUnattributedTokens: number
}

/** Hook-event types the active-time computation consumes. Shared by
 * `loadActuals` and `loadActualsForTasks` so the two streams cannot drift. */
const ACTIVE_TIME_EVENT_TYPES: HookEventType[] = [
  'USER_PROMPT_SUBMIT',
  'STOP',
  'STOP_FAILURE',
  'PRE_TOOL_USE',
  'POST_TOOL_USE',
  'POST_TOOL_USE_FAILURE',
  'POST_TOOL_BATCH',
  'SUBAGENT_START',
  'SUBAGENT_STOP',
  'PERMISSION_REQUEST',
  'PERMISSION_DENIED',
  'NOTIFICATION',
  'ELICITATION',
  'ELICITATION_RESULT',
]

/** One TOP-LEVEL session's token spend for the cost trajectory (LUM-562;
 *  LUM-932 P3: explicit children and unattached work's per-turn usage fold
 *  into their family root). Summed from the SAME parts `loadActuals` totals,
 *  over the SAME task-linked set — so Σ over a task's points equals that task's
 *  `loadActuals.tokenCost` (the Cost-section total), and the report's cost total
 *  and its trajectory cannot drift. */
export interface PerSessionCost {
  sessionId: string
  tokenCost: number
  loopCount: number
  startedAt: Date
}

export const retrospectiveRepository = {
  /** 读快照（已转 domain 形状）。无则 null。 */
  async findSnapshot(taskId: string): Promise<SnapshotRow | null> {
    const row = await prisma.taskForecastSnapshot.findUnique({
      where: { taskId },
    })
    if (!row) return null
    return {
      iterations: row.iterations as Interval | null,
      interactionRounds: row.interactionRounds as Interval | null,
      tokenCost: row.tokenCost as Interval | null,
      cohortSize: row.cohortSize,
      tokenCostBasis: row.tokenCostBasis,
      capturedAt: row.capturedAt,
    }
  },

  /** keep-first 落库：唯一冲突（P2002）静默吞掉，其他错误抛出。 */
  async createSnapshotIfAbsent(
    taskId: string,
    p: SnapshotPayload
  ): Promise<void> {
    const capturedAt = new Date()
    try {
      await prisma.taskForecastSnapshot.create({
        data: {
          taskId,
          iterations: toJsonValue(p.iterations),
          interactionRounds: toJsonValue(p.interactionRounds),
          tokenCost: toJsonValue(p.tokenCost),
          cohortSize: p.cohortSize,
          tokenCostBasis: p.tokenCostBasis,
          capturedAt,
        },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return
      throw e
    }
  },

  /**
   * 实算 actual：token 求和（无 usage→null）、session 数、USER_PROMPT_SUBMIT 数
   * （交互轮次）、agent 活跃时长（每 turn `STOP − prompt` 之和，排除轮次间空闲 —
   * 见 `lib/agent-run/active-time`）。
   */
  async loadActuals(taskId: string): Promise<RetrospectiveActuals | null> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        projectId: true,
        sessions: {
          select: {
            parentSessionId: true,
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
          },
        },
      },
    })
    if (!task) return null

    // Active time from the full hook-event stream for every session linked to
    // the task — wider type list lets active-time exclude mid-turn human-wait
    // intervals (PERMISSION_REQUEST / NOTIFICATION / ELICITATION) in addition
    // to the inter-turn idle that was already excluded.
    const [turnEvents, inferred, inferredSessionCount] = await Promise.all([
      prisma.hookEvent.findMany({
        where: {
          ...eventsForTask(taskId),
          type: { in: ACTIVE_TIME_EVENT_TYPES },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { sessionId: true, type: true, createdAt: true },
      }),
      inferredUsageForTasks([taskId]),
      prisma.session.count({ where: inferredTopLevelSessionsForTask(taskId) }),
    ])

    // LUM-932 P3 hybrid cost: explicit sessions' cumulative columns (as
    // before) + unattached work's per-turn usage rows attributed to the task.
    // Null only when neither part carries usage (没测到 ≠ 花了0).
    const hasUsage =
      task.sessions.some(s => s.outputTokens !== null) || inferred.length > 0
    const tokenCost = hasUsage
      ? task.sessions.reduce((sum, s) => sum + flatTokens(s), 0) +
        inferred.reduce((sum, r) => sum + usageMapTotal(r.usageByModel), 0)
      : null
    const totalDurationSec = sumActiveDurationSec(
      turnEvents.map(e => ({
        sessionId: e.sessionId ?? '__none__',
        type: e.type,
        createdAt: e.createdAt,
      }))
    )

    // Interaction rounds = USER_PROMPT_SUBMIT events for the task (reuses the
    // turn-event fetch above — no extra query). Replaces the dead AGENT_CLARIFY
    // notification count (workspace-wide that signal was ~always 0).
    const interactionRounds = turnEvents.filter(
      e => e.type === 'USER_PROMPT_SUBMIT'
    ).length

    return {
      projectId: task.projectId,
      tokenCost,
      // LUM-932 P3: distinct TOP-LEVEL sessions — explicit ones bound to the
      // task + unattached ones inferred onto it. Subagent children are part of
      // their parent's run, never an iteration of their own.
      iterations:
        task.sessions.filter(s => !s.parentSessionId).length +
        inferredSessionCount,
      interactionRounds,
      totalDurationSec,
    }
  },

  /**
   * Batched actuals over a task set — the LUM-627 milestone cost rollup. Reads
   * the SAME cumulative `Session.*` token columns as `loadActuals`, with the
   * same per-task measured gate (a task counts as measured iff some linked
   * session has non-null outputTokens; the columns are written all-or-none),
   * so `tokenCost` reconciles exactly with Σ per-task `loadActuals.tokenCost`.
   * `activeTimeSec` feeds the union hook-event stream of every member task
   * through the canonical `sumActiveDurationSec` (per-session turn windows) —
   * one pass over the merged stream rather than N per-task passes.
   * Fail-closed: zero measured tasks → `tokenCost: null`, never a fake 0.
   */
  async loadActualsForTasks(taskIds: string[]): Promise<TaskSetActuals> {
    if (taskIds.length === 0) {
      return {
        tokenCost: null,
        activeTimeSec: 0,
        measuredTasks: 0,
        models: [],
        modelUnattributedTokens: 0,
      }
    }

    const [explicitSessions, inferred] = await Promise.all([
      prisma.session.findMany({
        where: { taskId: { in: taskIds } },
        select: {
          taskId: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
          usageByModel: true,
        },
      }),
      inferredUsageForTasks(taskIds),
    ])
    // LUM-932 P3: unattached work joins as per-(task, session) rows whose flat
    // columns are the per-kind totals of their summed per-turn usage maps, so
    // the measured gate, Σ and per-model split below treat both alike.
    const sessions: Array<{
      taskId: string | null
      inputTokens: number | null
      outputTokens: number | null
      cacheReadTokens: number | null
      cacheCreationTokens: number | null
      usageByModel: unknown
    }> = [...explicitSessions, ...foldInferredBySession(inferred)]

    const measured = new Set<string>()
    for (const s of sessions) {
      if (s.taskId !== null && s.outputTokens !== null) measured.add(s.taskId)
    }
    // Sum every session of a measured task (null columns coalesce to 0) —
    // exactly what loadActuals does per task, so the Σ identity holds.
    let tokenSum = 0
    for (const s of sessions) {
      if (s.taskId === null || !measured.has(s.taskId)) continue
      tokenSum += flatTokens(s)
    }

    // Per-model split of the SAME measured sessions (LUM-636): merge each
    // session's STOP-settled usageByModel map. Sessions predating LUM-298
    // carry no map — their spend stays in the flat sum only and surfaces as
    // the explicit unattributed remainder, never as a fabricated model row.
    const models = mergeModelCosts(
      sessions
        .filter(s => s.taskId !== null && measured.has(s.taskId))
        .map(s =>
          toModelCosts(s.usageByModel as Record<string, ModelUsage> | null)
        )
    )
    const modelTotal = models.reduce((sum, m) => sum + m.total, 0)
    const modelUnattributedTokens =
      measured.size > 0 ? Math.max(0, tokenSum - modelTotal) : 0

    const turnEvents = await prisma.hookEvent.findMany({
      where: {
        ...eventsForTasks(taskIds),
        type: { in: ACTIVE_TIME_EVENT_TYPES },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { sessionId: true, type: true, createdAt: true },
    })
    const activeTimeSec = sumActiveDurationSec(
      turnEvents.map(e => ({
        sessionId: e.sessionId ?? '__none__',
        type: e.type,
        createdAt: e.createdAt,
      }))
    )

    return {
      tokenCost: measured.size > 0 ? tokenSum : null,
      activeTimeSec,
      measuredTasks: measured.size,
      models,
      modelUnattributedTokens,
    }
  },

  /**
   * Raw rows for the LUM-632 per-member spend rollup — the member-grouped
   * variant of `loadActualsForTasks`, same 口径 by construction: the SAME
   * cumulative `Session.*` token columns (now with `id` +
   * `workspaceMemberId`, the attribution keys) and the SAME hook-event
   * stream/filters. The pure fold (`computeMilestoneDeliveryStats`) applies
   * the identical per-task measured gate and `activeDurationMsBySession`
   * windows, so the per-member rows reconcile exactly with the LUM-627
   * costRollup totals — the Σ-identity is same-source, not a coincidence.
   */
  async loadMemberActualRowsForTasks(taskIds: string[]): Promise<{
    sessions: Array<{
      id: string
      taskId: string | null
      workspaceMemberId: string
      inputTokens: number | null
      outputTokens: number | null
      cacheReadTokens: number | null
      cacheCreationTokens: number | null
      /** STOP-settled per-model map (LUM-298 JSON) — the LUM-636 per-member
       * model split reads it through the same measured gate as the sums. */
      usageByModel: unknown
    }>
    /** `taskId` = the event's attributed task (its own taskId, else its
     * session's explicit task — the `eventsForTasks` rule), so per-task
     * active time buckets by event, not by session (LUM-932). */
    turnEvents: Array<{
      sessionId: string | null
      taskId: string | null
      type: HookEventType
      createdAt: Date
    }>
  }> {
    if (taskIds.length === 0) {
      return { sessions: [], turnEvents: [] }
    }
    const [explicitSessions, rawTurnEvents, inferred] = await Promise.all([
      prisma.session.findMany({
        where: { taskId: { in: taskIds } },
        select: {
          id: true,
          taskId: true,
          workspaceMemberId: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
          usageByModel: true,
        },
      }),
      prisma.hookEvent.findMany({
        where: {
          ...eventsForTasks(taskIds),
          type: { in: ACTIVE_TIME_EVENT_TYPES },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          sessionId: true,
          taskId: true,
          type: true,
          createdAt: true,
          session: { select: { taskId: true } },
        },
      }),
      inferredUsageForTasks(taskIds),
    ])
    const turnEvents = rawTurnEvents.map(e => ({
      sessionId: e.sessionId,
      taskId: e.taskId ?? e.session?.taskId ?? null,
      type: e.type,
      createdAt: e.createdAt,
    }))
    // LUM-932 P3: unattached work joins as per-(task, session) rows keyed by
    // the unattached session id + the member on its usage rows.
    const sessions = [
      ...explicitSessions,
      ...foldInferredBySession(inferred).map(r => ({
        id: r.id,
        taskId: r.taskId,
        workspaceMemberId: r.workspaceMemberId,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheCreationTokens: r.cacheCreationTokens,
        usageByModel: r.usageByModel as unknown,
      })),
    ]
    return { sessions, turnEvents }
  },

  /**
   * Lean session token rows over a task set — the LUM-633 shared-agent
   * attribution basis ("the member who spent the most tokens on the task").
   * Reads the SAME cumulative `Session.*` token columns and
   * `workspaceMemberId` key as `loadMemberActualRowsForTasks`, without the
   * hook-event stream (the delivery rollup needs no active time).
   */
  async loadSessionTokenRowsForTasks(taskIds: string[]): Promise<
    Array<{
      taskId: string | null
      workspaceMemberId: string
      inputTokens: number | null
      outputTokens: number | null
      cacheReadTokens: number | null
      cacheCreationTokens: number | null
    }>
  > {
    if (taskIds.length === 0) return []
    const [explicitRows, inferred] = await Promise.all([
      prisma.session.findMany({
        where: { taskId: { in: taskIds } },
        select: {
          taskId: true,
          workspaceMemberId: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
        },
      }),
      inferredUsageForTasks(taskIds),
    ])
    // LUM-932 P3: unattached work's spend joins the top-spender basis.
    return [
      ...explicitRows,
      ...foldInferredBySession(inferred).map(r => ({
        taskId: r.taskId,
        workspaceMemberId: r.workspaceMemberId,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheCreationTokens: r.cacheCreationTokens,
      })),
    ]
  },

  /**
   * Per-session token spend for the task's cost trajectory (LUM-562, 規律7),
   * oldest-first by session start. Sums the SAME cumulative `Session.*` columns
   * `loadActuals` totals, over the SAME task-linked session set, so the
   * trajectory reconciles exactly with the Cost-section total (Σ here ==
   * `loadActuals.tokenCost`). Only usage-bearing sessions are returned (the
   * token columns are written atomically — all four set or all null, per the
   * Session schema — so a non-usage session contributes 0 and is omitted; this
   * keeps the trajectory free of 0-token points without breaking the Σ identity).
   */
  async loadPerSessionCost(taskId: string): Promise<PerSessionCost[]> {
    const [sessions, inferred] = await Promise.all([
      prisma.session.findMany({
        where: { taskId, outputTokens: { not: null } },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          parentSessionId: true,
          startedAt: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
          loopCount: true,
        },
      }),
      inferredUsageForTasks([taskId]),
    ])

    // LUM-932 P3: one point per TOP-LEVEL session. An explicit child folds
    // into its parent's point only when that parent is itself in this task's
    // explicit set (otherwise it is its own point here); unattached work's
    // per-turn rows fold into their family root's point, dated by the root's
    // start carried on the same usage query. Both parts are exactly what
    // loadActuals sums, so Σ points == loadActuals.tokenCost.
    const explicitIds = new Set(sessions.map(s => s.id))
    const points = new Map<string, PerSessionCost>()
    const add = (
      rootId: string,
      startedAt: Date | null,
      tokens: number,
      loops: number
    ) => {
      const cur = points.get(rootId) ?? {
        sessionId: rootId,
        tokenCost: 0,
        loopCount: 0,
        startedAt: new Date(0),
      }
      if (startedAt !== null) cur.startedAt = startedAt
      cur.tokenCost += tokens
      cur.loopCount += loops
      points.set(rootId, cur)
    }
    for (const s of sessions) {
      const folds =
        s.parentSessionId != null && explicitIds.has(s.parentSessionId)
      add(
        folds ? s.parentSessionId! : s.id,
        folds ? null : s.startedAt,
        flatTokens(s),
        s.loopCount ?? 0
      )
    }
    for (const r of inferred) {
      // A turn is a main-transcript STOP; subagent rows add spend, not turns.
      const loops = r.type === 'SUBAGENT_STOP' ? 0 : 1
      add(
        r.rootSessionId,
        // An explicit point keeps its own start; inferred roots carry theirs.
        explicitIds.has(r.rootSessionId) ? null : r.rootStartedAt,
        usageMapTotal(r.usageByModel),
        loops
      )
    }

    const out = [...points.values()]
    return out.sort(
      (a, b) =>
        a.startedAt.getTime() - b.startedAt.getTime() ||
        (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
    )
  },

  /** 参考库规模 = 项目内 DONE 且有 session 的任务数（= forecast 候选 universe）。
   *  LUM-932 P3: a task worked only through unattached sessions counts too. */
  async countReferenceLibrary(projectId: string): Promise<number> {
    return prisma.task.count({
      where: { projectId, status: 'DONE', ...taskHasSessions },
    })
  },
}
