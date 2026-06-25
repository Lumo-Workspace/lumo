import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { Interval } from '@/lib/forecast/types'
import { sumActiveDurationSec } from '@/lib/agent-run/active-time'

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

/** One session's token spend for the cost trajectory (LUM-562). Summed from the
 *  SAME cumulative `Session.*` columns `loadActuals` totals, over the SAME
 *  task-linked session set — so Σ over a task's sessions equals that task's
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
    try {
      await prisma.taskForecastSnapshot.create({
        data: {
          taskId,
          iterations: toJsonValue(p.iterations),
          interactionRounds: toJsonValue(p.interactionRounds),
          tokenCost: toJsonValue(p.tokenCost),
          cohortSize: p.cohortSize,
          tokenCostBasis: p.tokenCostBasis,
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
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
          },
        },
      },
    })
    if (!task) return null

    const hasUsage = task.sessions.some(s => s.outputTokens !== null)
    const tokenCost = hasUsage
      ? task.sessions.reduce(
          (sum, s) =>
            sum +
            (s.inputTokens ?? 0) +
            (s.outputTokens ?? 0) +
            (s.cacheReadTokens ?? 0) +
            (s.cacheCreationTokens ?? 0),
          0
        )
      : null

    // Active time from the full hook-event stream for every session linked to
    // the task — wider type list lets active-time exclude mid-turn human-wait
    // intervals (PERMISSION_REQUEST / NOTIFICATION / ELICITATION) in addition
    // to the inter-turn idle that was already excluded.
    const turnEvents = await prisma.hookEvent.findMany({
      where: {
        OR: [{ taskId }, { taskId: null, session: { taskId } }],
        type: {
          in: [
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
          ],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { sessionId: true, type: true, createdAt: true },
    })
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
      iterations: task.sessions.length,
      interactionRounds,
      totalDurationSec,
    }
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
    const sessions = await prisma.session.findMany({
      where: { taskId, outputTokens: { not: null } },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        startedAt: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        loopCount: true,
      },
    })
    return sessions.map(s => ({
      sessionId: s.id,
      tokenCost:
        (s.inputTokens ?? 0) +
        (s.outputTokens ?? 0) +
        (s.cacheReadTokens ?? 0) +
        (s.cacheCreationTokens ?? 0),
      loopCount: s.loopCount ?? 0,
      startedAt: s.startedAt,
    }))
  },

  /** 参考库规模 = 项目内 DONE 且有 session 的任务数（= forecast 候选 universe）。 */
  async countReferenceLibrary(projectId: string): Promise<number> {
    return prisma.task.count({
      where: { projectId, status: 'DONE', sessions: { some: {} } },
    })
  },
}
