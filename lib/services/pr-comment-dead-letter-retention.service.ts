import type { Prisma } from '@prisma/client'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import {
  buildPurgedDeadLetterPayload,
  deadLetterPurgeCutoff,
} from '@/lib/integrations/github/dead-letter-retention'

/** Rows read per query. */
export const DEAD_LETTER_PURGE_BATCH_SIZE = 200

/**
 * Ceiling on rows examined per run so the cron stays inside its time budget;
 * the next daily run continues where this one stopped.
 */
const MAX_SCANNED_PER_RUN = 10_000

export interface DeadLetterPurgeResult {
  purged: number
  /** True when the per-run ceiling stopped the scan early. */
  capped: boolean
}

export const prCommentDeadLetterRetentionService = {
  /**
   * LUM-913: drop the GitHub webhook payload of PR comment sync jobs that
   * entered DEAD_LETTER more than 7 days ago, keeping troubleshooting
   * metadata (operation / event, task, PR, error, timestamps). Batched and
   * idempotent; dead letters from before LUM-913 are not touched.
   */
  async purgeExpiredPayloads(
    now: Date = new Date()
  ): Promise<DeadLetterPurgeResult> {
    const before = deadLetterPurgeCutoff(now)
    const result: DeadLetterPurgeResult = { purged: 0, capped: false }
    let afterId: string | null = null
    let scanned = 0
    for (;;) {
      const rows = await prCommentSyncJobRepository.findPurgeableDeadLetters({
        before,
        afterId,
        take: DEAD_LETTER_PURGE_BATCH_SIZE,
      })
      if (rows.length === 0) break
      for (const row of rows) {
        const purged = await prCommentSyncJobRepository.purgeDeadLetterPayload(
          row.id,
          buildPurgedDeadLetterPayload(
            row.payload
          ) as unknown as Prisma.InputJsonValue,
          now
        )
        if (purged) result.purged++
      }
      scanned += rows.length
      afterId = rows[rows.length - 1]!.id
      if (rows.length < DEAD_LETTER_PURGE_BATCH_SIZE) break
      if (scanned >= MAX_SCANNED_PER_RUN) {
        result.capped = true
        break
      }
    }
    return result
  },
}
