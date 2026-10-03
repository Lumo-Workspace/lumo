import type { Prisma } from '@prisma/client'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import {
  DEAD_LETTER_PAYLOAD_RETENTION_DAYS,
  DEAD_LETTER_RETENTION_DAYS,
  buildPurgedDeadLetterPayload,
  deadLetterPurgeCutoff,
  type DeadLetterRetentionDays,
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

/**
 * LUM-941: the workspace filter for one tier. The default tier also takes
 * every out-of-tier value (only a manual DB edit), so no dead letter is
 * ever left out of the sweep.
 */
export function workspaceFilterForTier(
  days: DeadLetterRetentionDays
): { equals: number } | { notIn: number[] } {
  if (days !== DEAD_LETTER_PAYLOAD_RETENTION_DAYS) return { equals: days }
  return {
    notIn: DEAD_LETTER_RETENTION_DAYS.filter(
      d => d !== DEAD_LETTER_PAYLOAD_RETENTION_DAYS
    ),
  }
}

export const prCommentDeadLetterRetentionService = {
  /**
   * LUM-913: drop the GitHub webhook payload of PR comment sync jobs that
   * entered DEAD_LETTER more than the workspace's retention window ago
   * (LUM-941: 7 / 30 / 90 days, default 7), keeping troubleshooting
   * metadata (operation / event, task, PR, error, timestamps). Batched and
   * idempotent; dead letters from before LUM-913 are not touched.
   */
  async purgeExpiredPayloads(
    now: Date = new Date()
  ): Promise<DeadLetterPurgeResult> {
    const result: DeadLetterPurgeResult = { purged: 0, capped: false }
    let scanned = 0
    for (const days of DEAD_LETTER_RETENTION_DAYS) {
      const before = deadLetterPurgeCutoff(now, days)
      const workspaceRetentionDays = workspaceFilterForTier(days)
      let afterId: string | null = null
      for (;;) {
        const rows = await prCommentSyncJobRepository.findPurgeableDeadLetters({
          before,
          afterId,
          take: DEAD_LETTER_PURGE_BATCH_SIZE,
          workspaceRetentionDays,
        })
        if (rows.length === 0) break
        for (const row of rows) {
          const purged =
            await prCommentSyncJobRepository.purgeDeadLetterPayload(
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
          return result
        }
      }
    }
    return result
  },
}
