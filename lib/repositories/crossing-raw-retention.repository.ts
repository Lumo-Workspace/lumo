import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/** Activity types that carry a copy of a crossing's raw text. */
const CROSSING_ACTIVITY_TYPES = [
  'BOUNDARY_CROSSING_DETECTED',
  'BOUNDARY_CROSSING_DISPOSITIONED',
  'BOUNDARY_CROSSING_REJUDGED',
] as const

export interface PurgeableCrossing {
  id: string
  taskId: string | null
  category: string
  target: string | null
}

export interface CrossingPurgeWrite {
  crossingId: string
  /** Same window the candidate was read with — re-checked inside the write. */
  since: Date
  before: Date
  detail: string
  target: string | null
  activityPayloads: { id: string; payload: Prisma.InputJsonValue }[]
  now: Date
}

// ── Boundary-crossing raw retention repository (LUM-912) ─────────────────────

export const crossingRawRetentionRepository = {
  /** Every workspace's crossing raw-retention setting. */
  async listWorkspaceSettings(): Promise<
    {
      id: string
      crossingRawRetentionDays: number
      crossingRawRetentionSince: Date
    }[]
  > {
    return prisma.workspace.findMany({
      select: {
        id: true,
        crossingRawRetentionDays: true,
        crossingRawRetentionSince: true,
      },
      orderBy: { id: 'asc' },
    })
  },

  /**
   * Dispositioned, not-yet-purged crossings of a workspace whose disposition
   * falls in [since, before], in id order. The workspace is reached through
   * the crossing's task, or its milestone for a steward crossing (LUM-640).
   */
  async findPurgeable(params: {
    workspaceId: string
    since: Date
    before: Date
    afterId: string | null
    take: number
  }): Promise<PurgeableCrossing[]> {
    const { workspaceId, since, before, afterId, take } = params
    return prisma.boundaryCrossing.findMany({
      where: {
        rawPurgedAt: null,
        disposition: { not: null },
        dispositionedAt: { gte: since, lte: before },
        ...(afterId ? { id: { gt: afterId } } : {}),
        OR: [
          { task: { is: { team: { workspaceId } } } },
          { milestone: { is: { project: { workspaceId } } } },
        ],
      },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, taskId: true, category: true, target: true },
    })
  },

  /** The crossing's timeline activities (they copy its detail / evidence). */
  async findCrossingActivities(
    taskId: string,
    crossingId: string
  ): Promise<{ id: string; payload: Prisma.JsonValue }[]> {
    return prisma.taskActivity.findMany({
      where: {
        taskId,
        type: { in: [...CROSSING_ACTIVITY_TYPES] },
        payload: { path: ['boundaryCrossingId'], equals: crossingId },
      },
      select: { id: true, payload: true },
    })
  },

  /**
   * Replace a crossing's raw text in one transaction: the row (detail,
   * target, cached explanation), its agent explanations and the given
   * activity payloads. Guarded on the row still being dispositioned inside
   * the window and not purged, so a reopen or a concurrent run makes this a
   * no-op. Returns whether this call purged it.
   */
  async purgeCrossing(write: CrossingPurgeWrite): Promise<boolean> {
    return prisma.$transaction(async tx => {
      const { count } = await tx.boundaryCrossing.updateMany({
        where: {
          id: write.crossingId,
          rawPurgedAt: null,
          disposition: { not: null },
          dispositionedAt: { gte: write.since, lte: write.before },
        },
        data: {
          detail: write.detail,
          target: write.target,
          systemExplanation: null,
          rawPurgedAt: write.now,
        },
      })
      if (count === 0) return false
      await tx.boundaryCrossingExplanation.updateMany({
        where: { crossingId: write.crossingId },
        data: { note: '' },
      })
      for (const a of write.activityPayloads) {
        await tx.taskActivity.update({
          where: { id: a.id },
          data: { payload: a.payload },
        })
      }
      return true
    })
  },
}
