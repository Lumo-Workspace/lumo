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

/** Total tokens across all models/kinds in a cumulative snapshot. */
function snapshotTotal(
  s: Record<string, ModelUsage> | null | undefined
): number {
  if (!s) return -1
  let t = 0
  for (const u of Object.values(s)) {
    t += u.input + u.output + u.cacheRead + u.cacheCreation
  }
  return t
}

/**
 * The more recent of two cumulative snapshots (the one with the larger total).
 * Cumulative token maps grow monotonically within a session, so "larger total"
 * = "later snapshot". Used as the baseline for a POST_TOOL_BATCH per-step delta:
 * the previous snapshot is either the last batch (liveUsageByModel) or the last
 * STOP (usageByModel), whichever is more recent. Null-safe.
 */
export function pickLatestCumulative(
  a: Record<string, ModelUsage> | null | undefined,
  b: Record<string, ModelUsage> | null | undefined
): Record<string, ModelUsage> | null {
  const ta = snapshotTotal(a)
  const tb = snapshotTotal(b)
  if (ta < 0 && tb < 0) return null
  return ta >= tb
    ? (a as Record<string, ModelUsage>)
    : (b as Record<string, ModelUsage>)
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

interface UpsertWithMilestoneIdData {
  id: string
  workspaceId: string
  workspaceMemberId: string
  milestoneId: string
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
   * prior usageByModel); mid-turn (POST_TOOL_BATCH) writes the flat columns +
   * liveUsageByModel and returns a per-STEP delta (LUM-523) without advancing
   * the STOP usageByModel anchor. `isStop` increments loopCount.
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

    // Mid-turn usage (POST_TOOL_BATCH, LUM-345): overwrite the flat cumulative
    // columns + the live per-model snapshot for the delivery card's in-flight
    // burn. LUM-523 ALSO computes a per-STEP delta against the previous snapshot
    // (last batch or last STOP cumulative) and returns it so the caller can
    // store it on the HookEvent row's usageByModel — the per-operation read
    // model buckets these deltas by the tool that ran in the step. The STOP
    // anchor (Session.usageByModel) is still untouched here.
    if (!data.isStop && data.usage) {
      const usage = data.usage
      return prisma.$transaction(async tx => {
        const prior = await tx.session.findUnique({
          where: { id: data.id },
          select: { usageByModel: true, liveUsageByModel: true },
        })
        const baseline = pickLatestCumulative(
          (prior?.usageByModel as Record<string, ModelUsage> | null) ?? null,
          (prior?.liveUsageByModel as Record<string, ModelUsage> | null) ?? null
        )
        const batchStepDelta = diffUsageByModel(baseline, usage.byModel)
        const midTurnFlat = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          liveUsageByModel: usage.byModel as unknown as Prisma.InputJsonValue,
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
            ...midTurnFlat,
          },
          update: {
            lastActivityAt: data.now,
            eventCount: { increment: 1 },
            ...(data.cwd !== null ? { cwd: data.cwd } : {}),
            ...midTurnFlat,
          },
          select: { id: true, taskId: true },
        })
        return { taskId: row.taskId, turnUsageByModel: batchStepDelta }
      })
    }

    // Non-STOP without usage (or STOP without usage): cheap single upsert.
    const setOnUpdate: Prisma.SessionUpdateInput = {
      lastActivityAt: data.now,
      eventCount: { increment: 1 },
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
   * Create-or-update a session row with a STEWARD milestone binding (LUM-640).
   * Mirrors `upsertWithTaskId` — the row may not exist yet (attach can run
   * before any hook fires) — but stamps `role: STEWARD` alongside the
   * milestoneId. The lifetime-lock checks (already task-bound / bound to a
   * different milestone) live in the service; this is the raw write.
   */
  async upsertWithMilestoneId(data: UpsertWithMilestoneIdData): Promise<
    | { ownedByOther: true }
    | {
        ownedByOther: false
        session: { id: string; milestoneId: string | null }
      }
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
          data: { milestoneId: data.milestoneId, role: 'STEWARD' },
          select: { id: true, milestoneId: true },
        })
        return { ownedByOther: false, session: updated } as const
      }
      const created = await tx.session.create({
        data: {
          id: data.id,
          workspaceId: data.workspaceId,
          workspaceMemberId: data.workspaceMemberId,
          milestoneId: data.milestoneId,
          role: 'STEWARD',
          startedAt: data.now,
          lastActivityAt: data.now,
          eventCount: 0,
        },
        select: { id: true, milestoneId: true },
      })
      return { ownedByOther: false, session: created } as const
    })
  },

  /**
   * LUM-640: a session's steward binding, if any — the detector backstop reads
   * this to decide whether an unbound-looking hook event actually belongs to a
   * milestone-bound governance session. Returns null when the session row is
   * missing OR the session is not a STEWARD session with a milestone.
   */
  async findStewardBinding(id: string): Promise<{
    milestoneId: string
    milestoneName: string
  } | null> {
    const row = await prisma.session.findUnique({
      where: { id },
      select: {
        role: true,
        milestone: { select: { id: true, name: true } },
      },
    })
    if (!row || row.role !== 'STEWARD' || !row.milestone) return null
    return {
      milestoneId: row.milestone.id,
      milestoneName: row.milestone.name,
    }
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
   * Attribution projection (LUM-511) for crossings recorded without a hook
   * event: the owner, agent, worktree branch, and cumulative per-model usage
   * needed to fill the LUM-469 attribution view from the session directly.
   * Mirrors `hookEventRepository.findManyByIdsForAttribution`. Skipped when no id.
   */
  async findManyForAttribution(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.session.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        workspaceMemberId: true,
        agent: true,
        usageByModel: true,
        worktree: { select: { branch: true } },
      },
    })
  },

  /**
   * Minimal projection for the server-side blocked-tag automation (LUM-544):
   * the bound task and the attribution fields (agent + cumulative per-model
   * usage map). Returns null when the session row is missing.
   */
  async findTaskAndAttribution(id: string): Promise<{
    taskId: string | null
    workspaceId: string
    agent: TaskArtifactAgent
    usageByModel: unknown
  } | null> {
    return prisma.session.findUnique({
      where: { id },
      select: {
        taskId: true,
        workspaceId: true,
        agent: true,
        usageByModel: true,
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
        // LUM-640: the steward form of the binding — role + milestone ride
        // along so the guard/attach paths can classify without a second read.
        role: true,
        milestone: { select: { id: true, name: true } },
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
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
   * identifier) plus the memory-review watermark, or null if the session
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
    lastMemoryReviewAt: Date | null
  } | null> {
    const row = await prisma.session.findFirst({
      where: { id: sessionId, workspaceMemberId },
      select: {
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
      lastMemoryReviewAt: row.lastMemoryReviewAt,
    }
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
        runSummary: true,
        usageByModel: true,
        // Flat cumulative columns: mid-turn events update these but not
        // usageByModel, so the timeline derives the in-flight burn from the
        // difference (LUM-345); liveUsageByModel attributes it per model.
        liveUsageByModel: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
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
      select: {
        task: {
          select: {
            title: true,
            // LUM-778: the usage audit reads the constitution per (project, workspace).
            projectId: true,
            project: { select: { workspaceId: true } },
          },
        },
      },
    })
    return row?.task ?? null
  },

  /**
   * Ids of sessions on a task that have no run summary yet (LUM-481),
   * newest-first. LUM-579: returns ids only — the generation service loads each
   * session's full event stream (`listEventsForSession`) and compacts it, rather
   * than reading the sparse STOP-row `turnSummary`s (which systematically
   * under-reported delivery work).
   */
  async listForTaskMissingRunSummary(taskId: string): Promise<string[]> {
    const rows = await prisma.session.findMany({
      where: { taskId, runSummary: null },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * LUM-579: ALL session ids on a task, newest-first, regardless of whether a
   * run summary already exists — the force-regeneration path overwrites stale
   * summaries (e.g. the early-biased ones the old sparse-input generation wrote).
   */
  async listSessionIdsForTask(taskId: string): Promise<string[]> {
    const rows = await prisma.session.findMany({
      where: { taskId },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * LUM-576 backfill: distinct ids of completed (DONE/IN_REVIEW) tasks that
   * still have at least one qualified session missing its runSummary — a
   * session with `runSummary: null` AND ≥1 STOP/STOP_FAILURE event carrying a
   * turnSummary (i.e. generation has material). These are the tasks whose
   * run-summaries were dropped when generation ran fire-and-forget in the
   * cramped task-route waitUntil. The orchestrator re-runs `generateForTask`
   * for each; idempotent — once summarized, the session no longer matches.
   */
  async listCompletedTaskIdsMissingRunSummary(): Promise<string[]> {
    const rows = await prisma.session.findMany({
      where: {
        runSummary: null,
        task: { status: { in: ['DONE', 'IN_REVIEW'] } },
        events: {
          some: {
            type: { in: ['STOP', 'STOP_FAILURE'] },
            turnSummary: { not: null },
          },
        },
      },
      select: { taskId: true },
      distinct: ['taskId'],
    })
    return rows.map(r => r.taskId).filter((id): id is string => id !== null)
  },

  /**
   * The latest session's run-claim material for a task (LUM-564) — newest by
   * lastActivityAt, the SAME session the web delivery card surfaces as
   * `runs[0]` (sessions list ordered lastActivityAt desc). Returns its LLM
   * `runSummary` plus the raw STOP/STOP_FAILURE turn digest (oldest-first, last
   * MAX lines applied by the caller) so the read model can mirror the web's
   * two-layer claim rule (runSummary, else digest) without drift. Null when the
   * task has no session at all.
   */
  async loadLatestRunClaim(taskId: string) {
    return prisma.session.findFirst({
      where: { taskId },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        // LUM-573: id so the snapshot synthesizer can record which session it
        // selected (provenance) on the fallback (no-MERGED) path.
        id: true,
        runSummary: true,
        events: {
          where: {
            type: { in: ['STOP', 'STOP_FAILURE'] },
            turnSummary: { not: null },
          },
          orderBy: { createdAt: 'asc' },
          select: { turnSummary: true },
        },
      },
    })
  },

  /**
   * LUM-573: run-claim material for SPECIFIC sessions (the authoritative-session
   * resolver picks the ids from MERGED lineage edges; this loads each one's LLM
   * runSummary + STOP turn digest), newest-by-activity first. Mirrors
   * loadLatestRunClaim's per-session select so the same two-layer claim rule
   * applies, but here the RESOLVER — not lastActivityAt across all sessions —
   * decides which session's claim becomes the task's.
   */
  async loadRunClaimForSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) return []
    return prisma.session.findMany({
      where: { id: { in: sessionIds } },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true,
        lastActivityAt: true,
        runSummary: true,
        events: {
          where: {
            type: { in: ['STOP', 'STOP_FAILURE'] },
            turnSummary: { not: null },
          },
          orderBy: { createdAt: 'asc' },
          select: { turnSummary: true },
        },
      },
    })
  },

  /**
   * LUM-573: distinct ids of all completed (DONE/IN_REVIEW) tasks — the work
   * list for the claim-snapshot backfill. Unlike
   * `listCompletedTaskIdsMissingRunSummary`, this is NOT gated on a session
   * missing its runSummary: the snapshot must be (re)synthesized for tasks whose
   * sessions were ALREADY summarized by the LUM-576 backfill, since those are
   * exactly the tasks the structural 573 bug now surfaces.
   */
  async listCompletedTaskIds(): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: { status: { in: ['DONE', 'IN_REVIEW'] } },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * Persist a generated run summary on a session (LUM-481). `at` doubles as the
   * idempotency watermark so a re-DONE can skip already-summarized sessions.
   */
  async setRunSummary(sessionId: string, summary: string, at: Date) {
    return prisma.session.update({
      where: { id: sessionId },
      data: { runSummary: summary, runSummaryGeneratedAt: at },
      select: { id: true },
    })
  },
}
