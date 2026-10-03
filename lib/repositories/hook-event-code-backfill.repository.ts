import type { HookEventType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  openHookPayloads,
  sealHookPayload,
} from '@/lib/hook-event/payload-cipher'

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

/** One planned payload replacement (`workspaceId` picks the sealing key). */
export interface PayloadRewrite {
  id: string
  workspaceId: string
  payload: Prisma.InputJsonValue
}

// ── HookEvent code backfill repository (LUM-855) ─────────────────────────────

export const hookEventCodeBackfillRepository = {
  /** One keyset page of unpruned code-bearing events, in id order. */
  async findPage(afterId: string | null, take: number): Promise<BackfillRow[]> {
    const rows = await prisma.hookEvent.findMany({
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
        payloadEncrypted: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
      take,
    })
    return openHookPayloads(rows)
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

  /** Unpruned events among `ids` (any type), in id order. */
  async findUnprunedByIds(ids: string[]): Promise<BackfillRow[]> {
    if (ids.length === 0) return []
    const rows = await prisma.hookEvent.findMany({
      where: { id: { in: ids }, payloadPrunedAt: null },
      select: {
        id: true,
        type: true,
        workspaceId: true,
        payload: true,
        payloadEncrypted: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    })
    return openHookPayloads(rows)
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
  async rewritePayloads(updates: PayloadRewrite[]): Promise<number> {
    let written = 0
    for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
      // Sealed before the transaction: key lookup / creation stays out of it.
      const chunk = await Promise.all(
        updates.slice(i, i + WRITE_CHUNK).map(async u => ({
          id: u.id,
          sealed: await sealHookPayload(u.workspaceId, u.payload),
        }))
      )
      written += await prisma.$transaction(
        async tx => {
          let count = 0
          for (const u of chunk) {
            const r = await tx.hookEvent.updateMany({
              where: { id: u.id, payloadPrunedAt: null },
              data: {
                payload: u.sealed.payload,
                payloadEncrypted: u.sealed.payloadEncrypted,
              },
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
