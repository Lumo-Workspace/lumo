import { prisma } from '@/lib/db/prisma'
import type { Prisma, TaskArtifactAgent } from '@prisma/client'

export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/**
 * Per-turn per-model delta = next cumulative minus prior cumulative, clamped
 * to >= 0 per field (a transcript can shrink on compaction, which would make a
 * naive subtraction negative). Models present only in `next` yield their full
 * value (first turn using that model). Pure + exported for unit testing.
 */
export function diffUsageByModel(
  prior: Record<string, ModelUsage> | null | undefined,
  next: Record<string, ModelUsage>
): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = {}
  for (const [model, n] of Object.entries(next)) {
    const p = prior?.[model]
    out[model] = {
      input: Math.max(0, n.input - (p?.input ?? 0)),
      output: Math.max(0, n.output - (p?.output ?? 0)),
      cacheRead: Math.max(0, n.cacheRead - (p?.cacheRead ?? 0)),
      cacheCreation: Math.max(0, n.cacheCreation - (p?.cacheCreation ?? 0)),
    }
  }
  return out
}

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
  /**
   * Cumulative session token totals from the CLI transcript. Carried by STOP
   * (full settlement) and POST_TOOL_BATCH (mid-turn, flat columns only).
   */
  usage?:
    | {
        inputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheCreationTokens: number
        /** Cumulative per-model map keyed by raw model string. */
        byModel: Record<string, ModelUsage>
      }
    | null
    | undefined
  /** True when this event is a STOP/STOP_FAILURE -> bump loopCount. */
  isStop?: boolean | undefined
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
   *
   * When `usage` is present, cumulative token columns are OVERWRITTEN (not
   * incremented) — the CLI re-reads the whole transcript each time, so the
   * latest value is the running total. On STOP all columns including
   * usageByModel are settled (with the per-turn delta computed against the
   * prior usageByModel); mid-turn (POST_TOOL_BATCH) only the flat columns are
   * written so the STOP delta anchor stays intact. `isStop` increments
   * loopCount.
   */
  async upsertForHookEvent(data: UpsertSessionData) {
    // STOP carrying usage: compute the per-turn per-model delta atomically
    // against the prior cumulative, then overwrite cumulative columns.
    if (data.isStop && data.usage) {
      const usage = data.usage
      return prisma.$transaction(async tx => {
        const prior = await tx.session.findUnique({
          where: { id: data.id },
          select: { usageByModel: true },
        })
        const turnUsageByModel = diffUsageByModel(
          (prior?.usageByModel as Record<string, ModelUsage> | null) ?? null,
          usage.byModel
        )
        const flat = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          usageByModel: usage.byModel as unknown as Prisma.InputJsonValue,
        }
        const row = await tx.session.upsert({
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
            ...flat,
            loopCount: 1,
          },
          update: {
            lastActivityAt: data.now,
            eventCount: { increment: 1 },
            ...(data.cwd !== null ? { cwd: data.cwd } : {}),
            ...flat,
            loopCount: { increment: 1 },
          },
          select: { id: true, taskId: true },
        })
        return { taskId: row.taskId, turnUsageByModel }
      })
    }

    // Mid-turn usage (POST_TOOL_BATCH, LUM-345): overwrite ONLY the flat
    // cumulative columns so the delivery card shows live burn during a long
    // turn. usageByModel is deliberately untouched — it is the anchor the
    // STOP settlement diffs against, so advancing it here would shrink the
    // next per-turn delta. No transaction needed: there is no delta to settle.
    const midTurnFlat =
      !data.isStop && data.usage
        ? {
            inputTokens: data.usage.inputTokens,
            outputTokens: data.usage.outputTokens,
            cacheReadTokens: data.usage.cacheReadTokens,
            cacheCreationTokens: data.usage.cacheCreationTokens,
          }
        : null

    // Non-STOP (or STOP without usage): cheap single upsert, no token write
    // beyond the optional mid-turn flat overwrite. A STOP without usage still
    // bumps loopCount.
    const setOnUpdate: Prisma.SessionUpdateInput = {
      lastActivityAt: data.now,
      eventCount: { increment: 1 },
      ...(midTurnFlat ?? {}),
    }
    if (data.cwd !== null) setOnUpdate.cwd = data.cwd
    if (data.isStop) setOnUpdate.loopCount = { increment: 1 }

    const row = await prisma.session.upsert({
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
        ...(midTurnFlat ?? {}),
        ...(data.isStop ? { loopCount: 1 } : {}),
      },
      update: setOnUpdate,
      select: { id: true, taskId: true },
    })
    return { taskId: row.taskId, turnUsageByModel: null }
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
    lastMemoryReviewAt: Date | null
  } | null> {
    const row = await prisma.session.findFirst({
      where: { id: sessionId, workspaceMemberId },
      select: {
        lastProgressCommentAt: true,
        lastMemoryReviewAt: true,
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
      lastMemoryReviewAt: row.lastMemoryReviewAt,
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

  /** Advance the memory-review watermark after a wrap applies a review. */
  async setLastMemoryReviewAt(sessionId: string, at: Date) {
    return prisma.session.update({
      where: { id: sessionId },
      data: { lastMemoryReviewAt: at },
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
        agent: true,
        workspaceMemberId: true,
        // clerkId feeds the per-person token rollup (LUM-307); resolved to a
        // display name + avatar in the service via enrichClerkUsers.
        member: { select: { clerkId: true } },
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
        usageByModel: true,
        loopCount: true,
      },
    })
  },

  /**
   * The session that immediately precedes `currentSessionId` for the same
   * member, by `lastActivityAt` desc. Self-references off the current
   * session's member so callers don't need to resolve the memberId
   * separately. Returns null when the current session is unknown or it's the
   * member's first session.
   *
   * Used by the Layer 2 session-start review (LUM-165): the PROJECT memories
   * the previous session consolidated are surfaced for review exactly once —
   * at the next session-start. Anchoring on the member (not the task) is
   * deliberate: Layer 2 is project-scoped, so the relevant prior session may
   * have been working a different task in the same project. Uses the
   * `@@index([workspaceMemberId, lastActivityAt])` index.
   */
  async findPreviousSessionIdForMember(
    currentSessionId: string
  ): Promise<string | null> {
    const current = await prisma.session.findUnique({
      where: { id: currentSessionId },
      select: { workspaceMemberId: true },
    })
    if (!current) return null
    const prev = await prisma.session.findFirst({
      where: {
        workspaceMemberId: current.workspaceMemberId,
        id: { not: currentSessionId },
      },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
    return prev?.id ?? null
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

  /**
   * Point every session whose `cwd` equals a worktree's path at that worktree
   * (LUM-150 ②). Called when a WORKTREE_CREATE hook fires — the cwd↔path match
   * is how a session is associated with the worktree it runs in, so the
   * collision warning can later name that session's branch. Idempotent.
   */
  async linkToWorktreeByCwd(params: {
    workspaceId: string
    path: string
    worktreeId: string
  }) {
    return prisma.session.updateMany({
      where: { workspaceId: params.workspaceId, cwd: params.path },
      data: { worktreeId: params.worktreeId },
    })
  },

  /**
   * Returns the task title for a given session, used by the cron backstop in
   * the fragment-usage audit (LUM-314). Returns null when the session has no
   * bound task or the session doesn't exist.
   */
  async findTaskTitleForSession(sessionId: string) {
    const row = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { task: { select: { title: true } } },
    })
    return row?.task ?? null
  },
}
