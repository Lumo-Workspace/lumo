import { hookEventPayloadEncryptionRepository } from '@/lib/repositories/hook-event-payload-encryption.repository'
import { isHookPayloadEncryptionEnabled } from '@/lib/hook-event/payload-cipher'

export interface PayloadEncryptionBackfillOptions {
  /** Write only when true; the default is a dry run that changes nothing. */
  apply?: boolean
  afterId?: string | null
  /** Stop after scanning this many rows. */
  limit?: number
  batchSize?: number
  onBatch?: (stats: PayloadEncryptionBackfillStats) => void
}

export interface PayloadEncryptionBackfillStats {
  scanned: number
  written: number
  lastId: string | null
}

// ── HookEvent payload-encryption backfill (LUM-863) ─────────────────────────

/**
 * Encrypt HookEvent rows stored before LUM-863 (plaintext `payload`) with
 * their workspace's data key. Dry-run unless `apply: true`. The next step of
 * the migration — dropping the plaintext column — is a separate change.
 */
export const hookEventPayloadEncryptionBackfillService = {
  async run(
    options: PayloadEncryptionBackfillOptions = {}
  ): Promise<PayloadEncryptionBackfillStats> {
    const apply = options.apply === true
    if (apply && !isHookPayloadEncryptionEnabled()) {
      throw Object.assign(
        new Error(
          'WORKSPACE_KEKS is not configured — nothing can be encrypted'
        ),
        { status: 500 }
      )
    }
    const take = options.batchSize ?? 200
    const stats: PayloadEncryptionBackfillStats = {
      scanned: 0,
      written: 0,
      lastId: options.afterId ?? null,
    }
    for (;;) {
      const remaining =
        options.limit !== undefined ? options.limit - stats.scanned : take
      if (remaining <= 0) break
      // Keyset paging by id: a dry run (which writes nothing) still advances.
      const page = await hookEventPayloadEncryptionRepository.findPlaintextPage(
        stats.lastId,
        Math.min(take, remaining)
      )
      if (page.length === 0) break
      stats.scanned += page.length
      stats.lastId = page[page.length - 1]!.id
      if (apply) {
        stats.written +=
          await hookEventPayloadEncryptionRepository.encryptRows(page)
      }
      options.onBatch?.(stats)
    }
    return stats
  },
}
