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

/** Rows per write transaction, and its timeout (see rewritePayloads). */
export const WRITE_CHUNK = 25
const WRITE_TIMEOUT_MS = 30_000

export interface BackfillRow {
  id: string
  type: HookEventType
  workspaceId: string
  payload: Prisma.JsonValue
  createdAt: Date
}

/**
 * LUM-933: only USED_UP workspaces strip code. RETAIN workspaces (keep
 * forever / N days) keep their session record whole, so the backfill never
 * reads or rewrites their events.
 */
const USED_UP_WORKSPACE = {
  workspace: { is: { hookEventRetentionMode: 'USED_UP' as const } },
}

// ── HookEvent code backfill repository (LUM-855) ─────────────────────────────

export const hookEventCodeBackfillRepository = {
  /** One keyset page of unpruned code-bearing events of USED_UP workspaces, in id order. */
  async findPage(afterId: string | null, take: number): Promise<BackfillRow[]> {
    return prisma.hookEvent.findMany({
      where: {
        type: { in: CODE_BEARING_HOOK_TYPES },
        payloadPrunedAt: null,
        ...USED_UP_WORKSPACE,
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

  /** Every hook event id a boundary crossing points at, in id order. */
  async listCrossingReferencedEventIds(): Promise<string[]> {
    const rows = await prisma.boundaryCrossing.findMany({
      where: { hookEventId: { not: null } },
      select: { hookEventId: true },
      distinct: ['hookEventId'],
      orderBy: { hookEventId: 'asc' },
    })
    return rows.flatMap(r => (r.hookEventId ? [r.hookEventId] : []))
  },

  /** Unpruned events among `ids` (any type) of USED_UP workspaces, in id order. */
  async findUnprunedByIds(ids: string[]): Promise<BackfillRow[]> {
    if (ids.length === 0) return []
    return prisma.hookEvent.findMany({
      where: { id: { in: ids }, payloadPrunedAt: null, ...USED_UP_WORKSPACE },
      select: {
        id: true,
        type: true,
        workspaceId: true,
        payload: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
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
   * Replace each event's payload. A row the retention sweep pruned in the
   * meantime is left alone (`payloadPrunedAt: null` guard). Rows are
   * independent, so writes go in small transactions: one 200-row transaction
   * against production ran past Prisma's 5s default and rolled back.
   * Returns how many rows were written.
   */
  async rewritePayloads(
    updates: { id: string; payload: Prisma.InputJsonValue }[]
  ): Promise<number> {
    let written = 0
    for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
      const chunk = updates.slice(i, i + WRITE_CHUNK)
      written += await prisma.$transaction(
        async tx => {
          let count = 0
          for (const u of chunk) {
            // Re-checked at write time: a workspace switched to RETAIN
            // between the read and this write keeps its event whole.
            const r = await tx.hookEvent.updateMany({
              where: { id: u.id, payloadPrunedAt: null, ...USED_UP_WORKSPACE },
              data: { payload: u.payload },
            })
            count += r.count
          }
          return count
        },
        { timeout: WRITE_TIMEOUT_MS }
      )
    }
    return written
  },
}
