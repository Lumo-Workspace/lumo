import type { HookEventType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/** Hook event types that carry tool input/output (the only ones with code). */
export const CODE_BEARING_HOOK_TYPES: HookEventType[] = [
  'PRE_TOOL_USE',
  'POST_TOOL_USE',
  'POST_TOOL_USE_FAILURE',
  'POST_TOOL_BATCH',
  'PERMISSION_REQUEST',
  'PERMISSION_DENIED',
]

export interface BackfillRow {
  id: string
  type: HookEventType
  workspaceId: string
  payload: Prisma.JsonValue
  createdAt: Date
}

// ── HookEvent code backfill repository (LUM-855) ─────────────────────────────

export const hookEventCodeBackfillRepository = {
  /** One keyset page of unpruned code-bearing events, in id order. */
  async findPage(afterId: string | null, take: number): Promise<BackfillRow[]> {
    return prisma.hookEvent.findMany({
      where: {
        type: { in: CODE_BEARING_HOOK_TYPES },
        payloadPrunedAt: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: {
        id: true,
        type: true,
        workspaceId: true,
        payload: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
      take,
    })
  },

  /** The subset of `eventIds` a boundary crossing points at. */
  async findCrossingReferencedIds(eventIds: string[]): Promise<Set<string>> {
    if (eventIds.length === 0) return new Set()
    const rows = await prisma.boundaryCrossing.findMany({
      where: { hookEventId: { in: eventIds } },
      select: { hookEventId: true },
    })
    return new Set(rows.flatMap(r => (r.hookEventId ? [r.hookEventId] : [])))
  },

  /**
   * Replace each event's payload in one transaction. A row the retention sweep
   * pruned in the meantime is left alone (`payloadPrunedAt: null` guard).
   * Returns how many rows were written.
   */
  async rewritePayloads(
    updates: { id: string; payload: Prisma.InputJsonValue }[]
  ): Promise<number> {
    if (updates.length === 0) return 0
    const results = await prisma.$transaction(
      updates.map(u =>
        prisma.hookEvent.updateMany({
          where: { id: u.id, payloadPrunedAt: null },
          data: { payload: u.payload },
        })
      )
    )
    return results.reduce((n, r) => n + r.count, 0)
  },
}
