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
        payload: data.payload,
      },
      select: { id: true },
    })
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
   * Two association paths are unioned:
   *   1. HookEvent.taskId — direct, set when the hook payload carried
   *      `task_id` and the FK validated against this workspace.
   *   2. HookEvent.session.taskId — indirect, through the Session row.
   *      Necessary because a Session-tagged task may not be re-asserted on
   *      every hook payload, so most events only carry sessionId. Without
   *      this branch the timeline silently drops 90%+ of real events.
   */
  async findByTaskId(taskId: string) {
    return prisma.hookEvent.findMany({
      where: {
        OR: [{ taskId }, { session: { taskId } }],
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
