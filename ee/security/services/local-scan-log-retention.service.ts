/**
 * LUM-1259 — retention of the local scan log (user ruling, option A): the
 * runs, and their findings by cascade, follow the workspace's session record
 * setting (Settings → Data retention, LUM-859 / LUM-910 / LUM-933):
 *
 * - RETAIN with a day tier (`hookEventRetentionDays`): a run is deleted once
 *   it arrived more than that many days ago.
 * - USED_UP: a run is deleted 30 days after it arrived.
 * - RETAIN with no tier (keep forever, the default): runs are kept.
 *
 * As for session records, a stricter setting governs only what arrived after
 * the change (`hookEventRetentionSince`); older runs follow
 * `hookEventRetentionLegacyDays` (null = kept). Turning the log off keeps
 * the runs already logged; deleting the workspace deletes them (cascade).
 *
 * Run daily by the core prune cron through the plugin `retention.sweep`
 * extension point. Layering: service — the database through repositories.
 */
import { hookEventRetentionRepository } from '@/lib/repositories/hook-event-retention.repository'
import { localScanLogRepository } from '@/ee/security/repositories/local-scan-log.repository'

const DAY_MS = 24 * 60 * 60 * 1000

/** Days a run is kept in USED_UP mode. */
export const LOCAL_SCAN_USED_UP_DAYS = 30

export interface LocalScanRetentionResult {
  /** Runs deleted, across workspaces. */
  localScanRuns: number
}

type RetentionSetting = Awaited<
  ReturnType<typeof hookEventRetentionRepository.listWorkspacesWithRetention>
>[number]

const daysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS)

/** The days the workspace's current setting keeps a run; null = forever. */
export function localScanRetentionDays(ws: RetentionSetting): number | null {
  if (ws.hookEventRetentionMode === 'USED_UP') return LOCAL_SCAN_USED_UP_DAYS
  return ws.hookEventRetentionDays ?? null
}

async function sweepWorkspace(
  ws: RetentionSetting,
  now: Date
): Promise<number> {
  let deleted = 0
  const since = ws.hookEventRetentionSince
  const days = localScanRetentionDays(ws)
  if (days !== null)
    deleted += await localScanLogRepository.deleteArrivedBefore(
      ws.id,
      daysAgo(now, days),
      { createdFrom: since }
    )
  if (since && ws.hookEventRetentionLegacyDays != null)
    deleted += await localScanLogRepository.deleteArrivedBefore(
      ws.id,
      daysAgo(now, ws.hookEventRetentionLegacyDays),
      { createdBefore: since }
    )
  return deleted
}

export const localScanLogRetentionService = {
  /** Delete every expired run (keep-forever workspaces are never listed). */
  async sweep(now: Date = new Date()): Promise<LocalScanRetentionResult> {
    const workspaces =
      await hookEventRetentionRepository.listWorkspacesWithRetention()
    let localScanRuns = 0
    for (const ws of workspaces) localScanRuns += await sweepWorkspace(ws, now)
    return { localScanRuns }
  },
}
