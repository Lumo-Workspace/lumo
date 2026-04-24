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
