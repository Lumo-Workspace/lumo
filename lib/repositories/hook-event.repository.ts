import { prisma } from '@/lib/db/prisma'
import type { HookEventType, Prisma } from '@prisma/client'

// ── Types ────────────────────────────────────────────────────────────────────

interface CreateHookEventData {
  workspaceId: string
  workspaceMemberId: string
  type: HookEventType
  toolName: string | null
  payload: Prisma.InputJsonValue
  sessionId?: string | null
  taskId?: string | null
  /**
   * File this event concerns, lifted out of the raw payload by the service so
   * it's queryable/indexable (cross-session "who touched this file" lookups,
   * LUM-146 "last file changed"). Null for events that carry no file path.
   */
  filePath?: string | null
}

interface FindRecentOtherSessionWritesParams {
  workspaceId: string
  filePath: string
  /** The current session, excluded so a session never collides with itself. */
  excludeSessionId: string
  /** Lower bound on createdAt — the caller's collision time window. */
  since: Date
  /** Tool names that count as a write (caller owns this policy). */
  toolNames: string[]
}

// ── HookEvent Repository ──────────────────────────────────────────────────────

export const hookEventRepository = {
  /** Record a Claude Code hook event for audit and activity tracking. */
  async createHookEvent(data: CreateHookEventData) {
    return prisma.hookEvent.create({
      data: {
        workspaceId: data.workspaceId,
        workspaceMemberId: data.workspaceMemberId,
        sessionId: data.sessionId ?? null,
        taskId: data.taskId ?? null,
        type: data.type,
        toolName: data.toolName,
        filePath: data.filePath ?? null,
        payload: data.payload,
      },
      select: { id: true },
    })
  },

  /**
   * Recent write events to `filePath` from sessions other than the caller's,
   * within the `since` window — the raw signal for the parallel-edit collision
   * warning (LUM-150 step ③). Index-served by
   * `@@index([workspaceId, filePath, createdAt])`; toolName/session are residual
   * filters on the already-narrow path+time slice. Returns up to 50 rows newest-
   * first (the service dedupes them by session); each row carries its session's
   * `agent` so the warning can name who else is editing.
   */
  async findRecentOtherSessionWritesToFile(
    params: FindRecentOtherSessionWritesParams
  ) {
    return prisma.hookEvent.findMany({
      where: {
        workspaceId: params.workspaceId,
        filePath: params.filePath,
        sessionId: { not: params.excludeSessionId },
        createdAt: { gte: params.since },
        toolName: { in: params.toolNames },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        sessionId: true,
        toolName: true,
        createdAt: true,
        session: { select: { agent: true } },
      },
    })
  },

  /**
   * Bulk-tag every null-taskId event in a session with the given
   * taskId. Used by `lumo session attach` to retroactively pull the
   * already-emitted events of the running session under the newly
   * attached task. Events that already carry a taskId are left alone
   * — they're authoritative.
   */
  async bulkSetTaskIdForNullEventsInSession(sessionId: string, taskId: string) {
    const result = await prisma.hookEvent.updateMany({
      where: { sessionId, taskId: null },
      data: { taskId },
    })
    return { count: result.count }
  },

  /**
   * Persist the LLM-generated turn summary onto a STOP / STOP_FAILURE
   * row. Best-effort — if the event row was already deleted (run reset,
   * workspace cascade) we swallow the P2025 silently rather than throw,
   * since the caller is fire-and-forget.
   */
  async setTurnSummary(eventId: string, summary: string) {
    try {
      await prisma.hookEvent.update({
        where: { id: eventId },
        data: { turnSummary: summary },
        select: { id: true },
      })
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code !== 'P2025') throw error
    }
  },

  /**
   * All hook events for a task, ordered by time. Used by the Agent Run
   * timeline to reconstruct what Claude Code did during each session.
   *
   * Per-event taskId takes precedence over session.taskId so a session
   * that was re-tagged mid-flight (`lumo session attach <other-task>`)
   * routes each event to the task that was active when it fired:
   *   1. HookEvent.taskId set → only the matching task sees this event.
   *   2. HookEvent.taskId NULL → fall through to Session.taskId (the
   *      legacy bucket — covers events written before the per-event tag
   *      fix as well as sessions that never switched).
   *
   * Without the `taskId IS NULL` guard on branch 2, an event that was
   * explicitly tagged for the new task would also leak into the old
   * task's timeline via session.taskId, causing duplicate display.
   */
  async findByTaskId(taskId: string) {
    return prisma.hookEvent.findMany({
      where: {
        OR: [{ taskId }, { taskId: null, session: { taskId } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        sessionId: true,
        type: true,
        toolName: true,
        payload: true,
        turnSummary: true,
        createdAt: true,
      },
    })
  },
}
