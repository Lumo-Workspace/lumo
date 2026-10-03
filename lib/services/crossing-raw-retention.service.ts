import type { Prisma } from '@prisma/client'
import {
  crossingRawRetentionRepository,
  type CrossingPurgeTxOptions,
  type PurgeableCrossing,
} from '@/lib/repositories/crossing-raw-retention.repository'
import {
  crossingRawPurgeCutoff,
  describeCrossingWithoutCode,
  hashCrossingTarget,
  scrubCrossingActivityPayload,
} from '@/lib/boundary-crossing/raw-retention'

/** Crossings read per query. */
const BATCH_SIZE = 200

/** Per-run ceiling on crossings examined, so the cron stays in its budget. */
const MAX_SCANNED_PER_RUN = 5_000

export interface CrossingRawPurgeResult {
  purged: number
  capped: boolean
}

/**
 * One crossing's raw text replaced (see `purgeExpired`): `detail` → code-free
 * description, `target` → hash, explanations and timeline copies scrubbed.
 * The write re-checks `window` (disposition inside it, not purged yet).
 * LUM-914: the pre-rule stock script purges with this same function, passing
 * an explicit transaction timeout. Returns whether this call purged it.
 */
export async function purgeCrossingRaw(
  row: PurgeableCrossing,
  window: { since: Date; before: Date },
  now: Date,
  txOptions?: CrossingPurgeTxOptions
): Promise<boolean> {
  const detail = describeCrossingWithoutCode(row)
  const activities = row.taskId
    ? await crossingRawRetentionRepository.findCrossingActivities(
        row.taskId,
        row.id
      )
    : []
  const activityPayloads = activities.flatMap(a => {
    const scrubbed = scrubCrossingActivityPayload(a.payload, detail)
    return scrubbed
      ? [{ id: a.id, payload: scrubbed as unknown as Prisma.InputJsonValue }]
      : []
  })
  return crossingRawRetentionRepository.purgeCrossing(
    {
      crossingId: row.id,
      since: window.since,
      before: window.before,
      detail,
      target: hashCrossingTarget(row.target),
      activityPayloads,
      now,
    },
    txOptions
  )
}

export const crossingRawRetentionService = {
  /**
   * LUM-912 — daily sweep. A crossing dispositioned at least the workspace's
   * `crossingRawRetentionDays` ago (7 by default) gives up its raw text:
   * `detail` becomes a code-free description (category + path or command
   * verb), `target` a hash, the cached system explanation and the agent
   * explanations are emptied, and its timeline copies are scrubbed the same
   * way. Category, severity, disposition and the human's ruling note stay.
   * Only crossings dispositioned at or after the workspace's
   * `crossingRawRetentionSince` are touched — deploying never purges the
   * historical stock. Batched and idempotent.
   */
  async purgeExpired(now: Date = new Date()): Promise<CrossingRawPurgeResult> {
    const result: CrossingRawPurgeResult = { purged: 0, capped: false }
    let scanned = 0
    const workspaces =
      await crossingRawRetentionRepository.listWorkspaceSettings()
    for (const ws of workspaces) {
      const since = ws.crossingRawRetentionSince
      const before = crossingRawPurgeCutoff(now, ws.crossingRawRetentionDays)
      if (before < since) continue
      let afterId: string | null = null
      for (;;) {
        const rows = await crossingRawRetentionRepository.findPurgeable({
          workspaceId: ws.id,
          since,
          before,
          afterId,
          take: BATCH_SIZE,
        })
        if (rows.length === 0) break
        for (const row of rows) {
          if (await purgeCrossingRaw(row, { since, before }, now))
            result.purged++
        }
        scanned += rows.length
        afterId = rows[rows.length - 1]!.id
        if (rows.length < BATCH_SIZE) break
        if (scanned >= MAX_SCANNED_PER_RUN) {
          result.capped = true
          return result
        }
      }
    }
    return result
  },
}
