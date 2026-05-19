import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

interface UpsertSessionData {
  id: string
  workspaceId: string
  workspaceMemberId: string
  cwd: string | null
  /**
   * Task to tag the Session with when this event creates the row. Ignored on
   * update — the create-time taskId is authoritative for the session's
   * lifetime, since re-tagging mid-session would silently rewrite historical
   * context in ways `lumo task context` would not surface.
   */
  taskId?: string | null
  now: Date
}

export const sessionRepository = {
  /**
   * Idempotent per hook event: create the session on first touch, otherwise
   * bump lastActivityAt and eventCount. cwd is backfilled if the first event
   * didn't include it but a later one does.
   */
  async upsertForHookEvent(data: UpsertSessionData) {
    const setOnUpdate: Prisma.SessionUpdateInput = {
      lastActivityAt: data.now,
      eventCount: { increment: 1 },
    }
    if (data.cwd !== null) setOnUpdate.cwd = data.cwd

    return prisma.session.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        workspaceId: data.workspaceId,
        workspaceMemberId: data.workspaceMemberId,
        cwd: data.cwd,
        taskId: data.taskId ?? null,
        startedAt: data.now,
        lastActivityAt: data.now,
        eventCount: 1,
      },
      update: setOnUpdate,
      select: { id: true },
    })
  },

  /**
   * Most recently active session for a workspace member. Used by
   * `lumo session attach <task>` to identify "the session the user is
   * currently in" without requiring them to know its UUID.
   *
   * Pass `withinMinutes` to bound how stale "current" can be — a 24h-
   * old session almost certainly isn't what the user means.
   */
  async findMostRecentForMember(workspaceMemberId: string, withinMinutes = 60) {
    const cutoff = new Date(Date.now() - withinMinutes * 60_000)
    return prisma.session.findFirst({
      where: { workspaceMemberId, lastActivityAt: { gte: cutoff } },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true,
        taskId: true,
        startedAt: true,
        lastActivityAt: true,
      },
    })
  },

  /**
   * Resolve a sessionId to its workspace. Used by routes that need to do a
   * workspace-membership check before serving a session-scoped resource.
   */
  async findWorkspaceId(id: string) {
    return prisma.session.findUnique({
      where: { id },
      select: { workspaceId: true },
    })
  },

  /**
   * Re-tag a session's task association. Bypasses the write-once
   * guardrail in `upsertForHookEvent` because the user has explicitly
   * asked for the retag (via `lumo session attach`) — they accept that
   * `lumo task context` will now route this session under the new
   * task.
   */
  async updateTaskId(id: string, taskId: string) {
    return prisma.session.update({
      where: { id },
      data: { taskId },
      select: { id: true, taskId: true },
    })
  },

  /**
   * Check whether a session is bound to a task. Used by the session-start
   * hook to return task binding status in the response, so the CLI can
   * inject it into Claude Code's conversation context via stdout.
   */
  async findTaskBinding(
    sessionId: string
  ): Promise<
    | { bound: true; taskIdentifier: string; taskTitle: string }
    | { bound: false }
  > {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        task: {
          select: {
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!session?.task) return { bound: false }
    return {
      bound: true,
      taskIdentifier: `${session.task.team.identifier}-${session.task.number}`,
      taskTitle: session.task.title,
    }
  },

  /**
   * List all sessions tagged with the given task, newest first. Used by
   * `lumo task context` to surface the coding agent's prior runs on a task.
   * Structured summary + summaryType are returned as-is so the caller can
   * project type-appropriate fields (e.g. `summary.unresolved`).
   */
  async listForTask(taskId: string, limit = 20) {
    return prisma.session.findMany({
      where: { taskId },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      select: {
        id: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
      },
    })
  },

  async listForMember(workspaceMemberId: string, limit = 50) {
    return prisma.session.findMany({
      where: { workspaceMemberId },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      select: {
        id: true,
        cwd: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
      },
    })
  },

  async listForClerkUser(clerkId: string, limit = 50) {
    return prisma.session.findMany({
      where: { member: { clerkId } },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      select: {
        id: true,
        cwd: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
      },
    })
  },

  async findByIdForMember(id: string, workspaceMemberId: string) {
    return prisma.session.findFirst({
      where: { id, workspaceMemberId },
      select: {
        id: true,
        cwd: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        workspaceId: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
        summaryClassifyModel: true,
        summaryContentModel: true,
        summaryEventCount: true,
      },
    })
  },

  async listEventsForSession(sessionId: string) {
    return prisma.hookEvent.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        toolName: true,
        payload: true,
        createdAt: true,
      },
    })
  },

  async updateSummary(input: {
    id: string
    summary: Prisma.InputJsonValue
    summaryType: string
    generatedAt: Date
    classifyModel: string | null
    contentModel: string
    eventCount: number
  }) {
    return prisma.session.update({
      where: { id: input.id },
      data: {
        summary: input.summary,
        summaryType: input.summaryType,
        summaryGeneratedAt: input.generatedAt,
        summaryClassifyModel: input.classifyModel,
        summaryContentModel: input.contentModel,
        summaryEventCount: input.eventCount,
      },
      select: {
        id: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
        summaryClassifyModel: true,
        summaryContentModel: true,
        summaryEventCount: true,
      },
    })
  },
}
