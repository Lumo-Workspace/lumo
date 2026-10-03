import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FindExpiredEventIdsParams {
  workspaceId: string
  /** Events created strictly before this instant are expired. */
  before: Date
  /** Tasks whose events must be kept (not yet DONE). */
  openTaskIds: string[]
  /** Keyset cursor: only ids strictly greater than this. */
  afterId: string | null
  take: number
  /** LUM-933: only events created at or after this instant (the cutoff). */
  createdFrom?: Date | null
}

// ── HookEvent retention repository (LUM-859) ─────────────────────────────────

export const hookEventRetentionRepository = {
  /**
   * Workspaces whose session record is pruned at all: a RETAIN day tier
   * (LUM-859) or USED_UP mode (LUM-910). RETAIN-forever workspaces — the
   * default — are never listed.
   */
  async listWorkspacesWithRetention(): Promise<
    {
      id: string
      hookEventRetentionMode: 'RETAIN' | 'USED_UP'
      hookEventRetentionDays: number | null
      hookEventRetentionSince: Date | null
      hookEventRetentionLegacyDays: number | null
    }[]
  > {
    return prisma.workspace.findMany({
      where: {
        OR: [
          { hookEventRetentionDays: { not: null } },
          { hookEventRetentionMode: 'USED_UP' },
          { hookEventRetentionLegacyDays: { not: null } },
        ],
      },
      select: {
        id: true,
        hookEventRetentionMode: true,
        hookEventRetentionDays: true,
        hookEventRetentionSince: true,
        hookEventRetentionLegacyDays: true,
      },
    })
  },

  /** Ids of the workspace's tasks that are not DONE. */
  async findOpenTaskIds(workspaceId: string): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: { team: { workspaceId }, status: { not: 'DONE' } },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * Expired, not-yet-pruned events of a workspace whose task is not open, in
   * id order. An event's task is its own `taskId`, falling back to its
   * session's `taskId` when unset (same precedence as
   * `hookEventRepository.findByTaskId`); an event with neither is taskless and
   * eligible. This is the NEGATED form of that rule ("task not open"), so it
   * is written out here rather than built from `eventsForTask` (LUM-932).
   */
  async findExpiredEventIds(
    params: FindExpiredEventIdsParams
  ): Promise<string[]> {
    const { workspaceId, before, openTaskIds, afterId, take, createdFrom } =
      params
    const where: Prisma.HookEventWhereInput = {
      workspaceId,
      payloadPrunedAt: null,
      createdAt: { lt: before, ...(createdFrom ? { gte: createdFrom } : {}) },
      ...(afterId ? { id: { gt: afterId } } : {}),
      OR: [
        // Own task set: SQL `NOT IN` never matches NULL, so this arm only
        // covers tagged events.
        { taskId: { notIn: openTaskIds } },
        { taskId: null, sessionId: null },
        {
          taskId: null,
          session: {
            is: {
              OR: [{ taskId: null }, { taskId: { notIn: openTaskIds } }],
            },
          },
        },
      ],
    }
    const rows = await prisma.hookEvent.findMany({
      where,
      orderBy: { id: 'asc' },
      take,
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  // ── LUM-910: used-up mode ──────────────────────────────────────────────────

  /**
   * The workspace's not-DONE tasks with their latest agent activity: the
   * newest hook event tagged with the task, or the latest activity of a
   * session bound to it — whichever is later. Null when neither exists.
   */
  async findOpenTasksLastActivity(
    workspaceId: string
  ): Promise<{ id: string; lastActivityAt: Date | null }[]> {
    const tasks = await prisma.task.findMany({
      where: { team: { workspaceId }, status: { not: 'DONE' } },
      select: { id: true },
    })
    if (tasks.length === 0) return []
    const ids = tasks.map(t => t.id)
    const [events, sessions] = await Promise.all([
      prisma.hookEvent.groupBy({
        by: ['taskId'],
        where: { workspaceId, taskId: { in: ids } },
        _max: { createdAt: true },
      }),
      prisma.session.groupBy({
        by: ['taskId'],
        where: { taskId: { in: ids } },
        _max: { lastActivityAt: true },
      }),
    ])
    const latest = new Map<string, Date>()
    const bump = (taskId: string | null, at: Date | null | undefined) => {
      if (!taskId || !at) return
      const prev = latest.get(taskId)
      if (!prev || at > prev) latest.set(taskId, at)
    }
    for (const e of events) bump(e.taskId, e._max.createdAt)
    for (const s of sessions) bump(s.taskId, s._max.lastActivityAt)
    return ids.map(id => ({ id, lastActivityAt: latest.get(id) ?? null }))
  },

  /**
   * The workspace's DONE tasks last changed after `since`, each with whether
   * any of its sessions still has a fragment-usage vote outstanding (an edge
   * with no `usedAt`). `updatedAt` stands in for the DONE time: it is never
   * earlier, so the grace period can only run long, never short.
   */
  async findRecentlyDoneTasks(
    workspaceId: string,
    since: Date
  ): Promise<{ id: string; doneAt: Date; usageVotePending: boolean }[]> {
    const tasks = await prisma.task.findMany({
      where: {
        team: { workspaceId },
        status: 'DONE',
        updatedAt: { gt: since },
      },
      select: { id: true, updatedAt: true },
    })
    if (tasks.length === 0) return []
    const pending = await prisma.lineageEdge.groupBy({
      by: ['taskId'],
      where: {
        taskId: { in: tasks.map(t => t.id) },
        sessionId: { not: null },
        usedAt: null,
      },
    })
    const pendingIds = new Set(pending.map(p => p.taskId))
    return tasks.map(t => ({
      id: t.id,
      doneAt: t.updatedAt,
      usageVotePending: pendingIds.has(t.id),
    }))
  },

  /**
   * Not-yet-pruned events of a USED_UP workspace whose work is used up, in id
   * order: the event's task (own `taskId`, else its session's) is not in
   * `keepTaskIds`; or it has no task and its session (or, sessionless, the
   * event itself) has been idle since before `idleBefore`.
   */
  async findUsedUpEventIds(params: {
    workspaceId: string
    keepTaskIds: string[]
    idleBefore: Date
    afterId: string | null
    take: number
    /** LUM-933: only events created at or after this instant (the cutoff). */
    createdFrom?: Date | null
  }): Promise<string[]> {
    const { workspaceId, keepTaskIds, idleBefore, afterId, take, createdFrom } =
      params
    // `not: null` alongside `notIn`: an empty `notIn` alone matches NULL too.
    const usedUpTask = { not: null, notIn: keepTaskIds }
    const rows = await prisma.hookEvent.findMany({
      where: {
        workspaceId,
        payloadPrunedAt: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
        ...(createdFrom ? { createdAt: { gte: createdFrom } } : {}),
        OR: [
          { taskId: usedUpTask },
          { taskId: null, sessionId: null, createdAt: { lt: idleBefore } },
          { taskId: null, session: { is: { taskId: usedUpTask } } },
          {
            taskId: null,
            session: {
              is: { taskId: null, lastActivityAt: { lt: idleBefore } },
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take,
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /** Every boundary crossing pointing at one of `eventIds`, with its disposition. */
  async findCrossingRefs(eventIds: string[]): Promise<
    {
      hookEventId: string
      disposition: string | null
      dispositionedAt: Date | null
    }[]
  > {
    if (eventIds.length === 0) return []
    const rows = await prisma.boundaryCrossing.findMany({
      where: { hookEventId: { in: eventIds } },
      select: { hookEventId: true, disposition: true, dispositionedAt: true },
    })
    return rows.flatMap(r =>
      r.hookEventId
        ? [
            {
              hookEventId: r.hookEventId,
              disposition: r.disposition,
              dispositionedAt: r.dispositionedAt,
            },
          ]
        : []
    )
  },

  /** The subset of `eventIds` a boundary crossing points at. */
  async findCrossingReferencedEventIds(eventIds: string[]): Promise<string[]> {
    if (eventIds.length === 0) return []
    const rows = await prisma.boundaryCrossing.findMany({
      where: { hookEventId: { in: eventIds } },
      select: { hookEventId: true },
    })
    return rows.flatMap(r => (r.hookEventId ? [r.hookEventId] : []))
  },

  /**
   * Replace each event's payload with `prunedPayload` and stamp
   * `payloadPrunedAt`. Only unpruned rows are touched, so a concurrent run
   * never re-stamps. Returns the number of rows changed.
   */
  async prunePayloads(
    eventIds: string[],
    prunedPayload: Prisma.InputJsonValue,
    prunedAt: Date
  ): Promise<number> {
    if (eventIds.length === 0) return 0
    const { count } = await prisma.hookEvent.updateMany({
      where: { id: { in: eventIds }, payloadPrunedAt: null },
      data: { payload: prunedPayload, payloadPrunedAt: prunedAt },
    })
    return count
  },
}
