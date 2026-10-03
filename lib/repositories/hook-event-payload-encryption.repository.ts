import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { sealHookPayload } from '@/lib/hook-event/payload-cipher'

export interface PlaintextPayloadRow {
  id: string
  workspaceId: string
  payload: Prisma.JsonValue
}

/** Rows per write transaction (same sizing as the LUM-855 code backfill). */
const WRITE_CHUNK = 25
const WRITE_TIMEOUT_MS = 30_000

// ── HookEvent payload-encryption backfill repository (LUM-863) ──────────────

export const hookEventPayloadEncryptionRepository = {
  /**
   * One keyset page of rows still holding a plaintext payload: not yet
   * encrypted, not pruned by retention (a pruned row holds only the marker).
   */
  async findPlaintextPage(
    afterId: string | null,
    take: number
  ): Promise<PlaintextPayloadRow[]> {
    const rows = await prisma.hookEvent.findMany({
      where: {
        payloadEncrypted: null,
        payloadPrunedAt: null,
        payload: { not: Prisma.DbNull },
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: { id: true, workspaceId: true, payload: true },
      orderBy: { id: 'asc' },
      take,
    })
    return rows.map(r => ({ ...r, payload: r.payload ?? null }))
  },

  /**
   * Seal each row's payload with its workspace's data key and clear the
   * plaintext column. Guarded so a row encrypted or pruned in the meantime is
   * left alone. Returns how many rows were written.
   */
  async encryptRows(rows: PlaintextPayloadRow[]): Promise<number> {
    let written = 0
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = await Promise.all(
        rows.slice(i, i + WRITE_CHUNK).map(async r => ({
          id: r.id,
          sealed: await sealHookPayload(
            r.workspaceId,
            r.payload as Prisma.InputJsonValue
          ),
        }))
      )
      written += await prisma.$transaction(
        async tx => {
          let count = 0
          for (const { id, sealed } of chunk) {
            if (sealed.payloadEncrypted == null) continue
            const r = await tx.hookEvent.updateMany({
              where: { id, payloadEncrypted: null, payloadPrunedAt: null },
              data: {
                payload: Prisma.DbNull,
                payloadEncrypted: sealed.payloadEncrypted,
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
