import { prisma } from '@/lib/db/prisma'
import type { Prisma, TaskArtifactAgent } from '@prisma/client'

interface UpsertSessionData {
  id: string
  workspaceId: string
  workspaceMemberId: string
  cwd: string | null
  /**
   * Coding agent that owns the session. Set once on create; never overwritten
   * on update (the agent is fixed for a session's lifetime). Omitted when the
   * hook carried no `X-Lumo-Agent` header, so the DB default (CLAUDE_CODE)
   * applies — accurate today, since only Claude Code emits hooks.
   */
  agent?: TaskArtifactAgent
  now: Date
}

interface UpsertWithTaskIdData {
  id: string
  workspaceId: string
  workspaceMemberId: string
  taskId: string
  now: Date
}

export const sessionRepository = {
  /**
   * Idempotent per hook event: create the session on first touch, otherwise
   * bump lastActivityAt and eventCount. cwd is backfilled if the first event
   * didn't include it but a later one does. Returns the row's current taskId
   * so the caller can tag the HookEvent without a second query.
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
        taskId: null,
        ...(data.agent !== undefined ? { agent: data.agent } : {}),
        startedAt: data.now,
        lastActivityAt: data.now,
        eventCount: 1,
      },
      update: setOnUpdate,
      select: { id: true, taskId: true },
    })
  },

  /**
   * Create-or-update a session row with a task binding. Used by
   * `lumo session attach` — the session row may not exist yet (attach
   * happens before any hook fires), so we cannot require it. On an
   * existing row owned by a different member, returns `ownedByOther: true`
   * so the service can throw 403 without a second round-trip.
   */
  async upsertWithTaskId(
    data: UpsertWithTaskIdData
  ): Promise<
    | { ownedByOther: true }
    | { ownedByOther: false; session: { id: string; taskId: string | null } }
  > {
    return prisma.$transaction(async tx => {
      const existing = await tx.session.findUnique({
        where: { id: data.id },
        select: { workspaceMemberId: true },
      })
      if (existing) {
        if (existing.workspaceMemberId !== data.workspaceMemberId) {
          return { ownedByOther: true } as const
        }
        const updated = await tx.session.update({
          where: { id: data.id },
          data: { taskId: data.taskId },
          select: { id: true, taskId: true },
        })
        return { ownedByOther: false, session: updated } as const
      }
      const created = await tx.session.create({
        data: {
          id: data.id,
          workspaceId: data.workspaceId,
          workspaceMemberId: data.workspaceMemberId,
          taskId: data.taskId,
          startedAt: data.now,
          lastActivityAt: data.now,
          eventCount: 0,
        },
        select: { id: true, taskId: true },
      })
      return { ownedByOther: false, session: created } as const
    })
  },

  /**
   * Read the coding agent that owns a session. Used by Layer 1 memory
   * extraction so an auto-sedimented memory inherits the session's agent.
   * Returns null when the session row is missing.
   */
  async findAgent(id: string): Promise<TaskArtifactAgent | null> {
    const row = await prisma.session.findUnique({
      where: { id },
      select: { agent: true },
    })
    return row?.agent ?? null
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
   * Ownership-scoped lookup: return the session row + current task binding
   * for the given member, or `null` if the session doesn't exist or belongs
   * to a different member. Used by `lumo session status` and `session
   * detach` so unrelated bearer tokens cannot read or mutate someone else's
   * session.
   */
  async findForMemberWithBinding(sessionId: string, workspaceMemberId: string) {
    const row = await prisma.session.findFirst({
      where: { id: sessionId, workspaceMemberId },
      select: {
        id: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!row) return null
    return row
  },

  /**
   * Member-scoped read for `lumo session wrap`: returns the bound task (flat
   * identifier) plus the progress-comment watermark, or null if the session
   * doesn't exist / belongs to another member. Task fields are null when the
   * session has no binding.
   */
  async findProgressContextForMember(
    sessionId: string,
    workspaceMemberId: string
  ): Promise<{
    taskId: string | null
    taskIdentifier: string | null
    taskTitle: string | null
    lastProgressCommentAt: Date | null
  } | null> {
    const row = await prisma.session.findFirst({
      where: { id: sessionId, workspaceMemberId },
      select: {
        lastProgressCommentAt: true,
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!row) return null
    return {
      taskId: row.task?.id ?? null,
      taskIdentifier: row.task
        ? `${row.task.team.identifier}-${row.task.number}`
        : null,
      taskTitle: row.task?.title ?? null,
      lastProgressCommentAt: row.lastProgressCommentAt,
    }
  },

  /** Advance the progress-comment watermark after a wrap posts a comment. */
  async setLastProgressCommentAt(sessionId: string, at: Date) {
    return prisma.session.update({
      where: { id: sessionId },
      data: { lastProgressCommentAt: at },
      select: { id: true },
    })
  },

  /**
   * Ownership-scoped detach: clear taskId on the session, but only if the
   * caller owns it. Returns the previous binding for the caller to report,
   * or `null` if the session does not exist / is not owned / had no binding.
   */
  async clearTaskIdForMember(sessionId: string, workspaceMemberId: string) {
    return prisma.$transaction(async tx => {
      const existing = await tx.session.findFirst({
        where: { id: sessionId, workspaceMemberId },
        select: {
          taskId: true,
          task: {
            select: {
              number: true,
              title: true,
              team: { select: { identifier: true } },
            },
          },
        },
      })
      if (!existing) return null
      if (existing.taskId === null) {
        return { alreadyUnbound: true as const }
      }
      await tx.session.update({
        where: { id: sessionId },
        data: { taskId: null },
      })
      return {
        alreadyUnbound: false as const,
        previous: {
          taskIdentifier: `${existing.task!.team.identifier}-${existing.task!.number}`,
          taskTitle: existing.task!.title,
        },
      }
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
    | { bound: true; taskId: string; taskIdentifier: string; taskTitle: string }
    | { bound: false }
  > {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        taskId: true,
        task: {
          select: {
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!session?.task || !session.taskId) return { bound: false }
    return {
      bound: true,
      taskId: session.taskId,
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
