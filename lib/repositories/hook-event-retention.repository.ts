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
}

// ── HookEvent retention repository (LUM-859) ─────────────────────────────────

export const hookEventRetentionRepository = {
  /** Workspaces that opted into a retention window. */
  async listWorkspacesWithRetention(): Promise<
    { id: string; hookEventRetentionDays: number }[]
  > {
    const rows = await prisma.workspace.findMany({
      where: { hookEventRetentionDays: { not: null } },
      select: { id: true, hookEventRetentionDays: true },
    })
    return rows.flatMap(r =>
      r.hookEventRetentionDays == null
        ? []
        : [{ id: r.id, hookEventRetentionDays: r.hookEventRetentionDays }]
    )
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
    const { workspaceId, before, openTaskIds, afterId, take } = params
    const where: Prisma.HookEventWhereInput = {
      workspaceId,
      payloadPrunedAt: null,
      createdAt: { lt: before },
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
      // LUM-863: the ciphertext goes too — reads prefer it over `payload`.
      data: {
        payload: prunedPayload,
        payloadEncrypted: null,
        payloadPrunedAt: prunedAt,
      },
    })
    return count
  },
}
