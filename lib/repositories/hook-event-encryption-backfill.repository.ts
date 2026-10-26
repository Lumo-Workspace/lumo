import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/** Rows per write transaction, and its timeout (see sealRows). */
export const SEAL_WRITE_CHUNK = 25
const WRITE_TIMEOUT_MS = 30_000

export interface PlaintextPayloadRow {
  id: string
  workspaceId: string
  payload: Prisma.JsonValue
}

/** Rows still stored as plaintext: no data key recorded. */
const PLAINTEXT = { payloadKeyId: null }

// ── HookEvent payload encryption backfill repository (LUM-1302) ──────────────

export const hookEventEncryptionBackfillRepository = {
  /** Plaintext rows per workspace, for the dry-run report. */
  async countPlaintextByWorkspace(): Promise<
    { workspaceId: string; rows: number }[]
  > {
    const groups = await prisma.hookEvent.groupBy({
      by: ['workspaceId'],
      where: PLAINTEXT,
      _count: { _all: true },
      orderBy: { workspaceId: 'asc' },
    })
    return groups.map(g => ({
      workspaceId: g.workspaceId,
      rows: g._count._all,
    }))
  },

  /** One keyset page of plaintext rows, in id order. */
  async findPage(
    afterId: string | null,
    take: number
  ): Promise<PlaintextPayloadRow[]> {
    return prisma.hookEvent.findMany({
      where: { ...PLAINTEXT, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true, workspaceId: true, payload: true },
      orderBy: { id: 'asc' },
      take,
    })
  },

  /**
   * Write each row's payload back; the client's encryption extension seals
   * it and records the key. Guarded on the row still being plaintext: every
   * payload write since encryption shipped records a key, so a row changed
   * in between (pruned, rewritten) is left alone and a re-run writes 0.
   * Small interactive transactions with an explicit timeout — a large one
   * from this Mac to Neon runs past Prisma's 5s default (LUM-855).
   */
  async sealRows(rows: PlaintextPayloadRow[]): Promise<number> {
    let written = 0
    for (let i = 0; i < rows.length; i += SEAL_WRITE_CHUNK) {
      const chunk = rows.slice(i, i + SEAL_WRITE_CHUNK)
      written += await prisma.$transaction(
        async tx => {
          let count = 0
          for (const row of chunk) {
            const r = await tx.hookEvent.updateMany({
              where: { id: row.id, workspaceId: row.workspaceId, ...PLAINTEXT },
              data: { payload: row.payload as Prisma.InputJsonValue },
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
