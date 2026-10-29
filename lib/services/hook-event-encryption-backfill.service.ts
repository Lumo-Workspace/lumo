import { hookEventEncryptionBackfillRepository } from '@/lib/repositories/hook-event-encryption-backfill.repository'
import { isEncryptionKeyConfigured } from '@/lib/crypto'

/**
 * LUM-1302 backfill — encrypt the HookEvent payloads stored before payload
 * encryption shipped. A dry run only counts; an apply re-writes each
 * plaintext row so the client extension seals it with its workspace key.
 */

const PAGE_SIZE = 200

export interface EncryptionBackfillStats {
  /** Plaintext rows seen (dry run: counted). */
  scanned: number
  written: number
  workspaces: number
  lastId: string | null
}

export interface EncryptionBackfillOptions {
  dryRun: boolean
  afterId?: string | null
  /** Stop after this many rows scanned (apply only). */
  limit?: number
  onBatch?: (stats: EncryptionBackfillStats) => void
}

export const hookEventEncryptionBackfillService = {
  async run(
    options: EncryptionBackfillOptions
  ): Promise<EncryptionBackfillStats> {
    if (!isEncryptionKeyConfigured())
      throw new Error(
        'ENCRYPTION_KEY is not set: payloads cannot be encrypted on this deployment.'
      )
    const repo = hookEventEncryptionBackfillRepository
    if (options.dryRun) {
      const groups = await repo.countPlaintextByWorkspace()
      return {
        scanned: groups.reduce((n, g) => n + g.rows, 0),
        written: 0,
        workspaces: groups.length,
        lastId: null,
      }
    }

    const stats: EncryptionBackfillStats = {
      scanned: 0,
      written: 0,
      workspaces: 0,
      lastId: options.afterId ?? null,
    }
    const seen = new Set<string>()
    for (;;) {
      const room =
        options.limit !== undefined ? options.limit - stats.scanned : PAGE_SIZE
      if (room <= 0) break
      const page = await repo.findPage(stats.lastId, Math.min(PAGE_SIZE, room))
      if (page.length === 0) break
      stats.written += await repo.sealRows(page)
      stats.scanned += page.length
      for (const row of page) seen.add(row.workspaceId)
      stats.workspaces = seen.size
      stats.lastId = page[page.length - 1]!.id
      options.onBatch?.(stats)
    }
    return stats
  },
}
