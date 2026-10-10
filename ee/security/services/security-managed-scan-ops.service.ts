/**
 * LUM-745 — operational closure for the Lumo-managed scan (spec §6 L1
 * "known gaps", §12 R1). Three entry points, each best-effort towards the
 * outside world:
 *
 *   supersedeOlderRuns  stage A, before starting a run for a newer head:
 *                       stamp SUPERSEDED → cancel the run → stop the VM
 *   enforceHourlyCap    stage A, before start(): this workspace's managed
 *                       runs in the trailing hour vs the cap
 *   sweepStalePending   the every-15-minute cron: external PENDING > 45 min
 *                       → FAILED + reason; cancel + stop for managed rows;
 *                       re-sync the PR summary
 *
 * Write-then-kill is a hard order: the sandbox step's entry guard reads the
 * stamp, so a retry after the cancel can never boot another VM. A row whose
 * stamp fails therefore keeps its run — better one wasted sandbox than a
 * run the guard cannot stop.
 *
 * Layering: service — the database through the repository, the workflow
 * through its cancel wrapper, the sandbox through the integration module.
 */
import { logger } from '@/lib/logger'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { stopRepoSandboxesByTag } from '@/ee/security/integrations/vercel-sandbox'
import {
  EXTERNAL_ERROR_PREFIX,
  type ScanStages,
} from '@/ee/security/security-scan'
import { cancelManagedRun } from './security-managed-scan-cancel'
import { securityPrReviewService } from './security-pr-review.service'
import {
  EXTERNAL_PENDING_DEAD_MS,
  MANAGED_SCAN_HOURLY_WINDOW_MS,
  SANDBOX_SCAN_TAG,
  managedScanHourlyCap,
} from './security-managed-scan.config'

/** Rows one sweep tick handles; each costs a GitHub sync, so keep it bounded. */
export const SWEEP_BATCH_LIMIT = 50
/** The reason stamped on a swept row (after `EXTERNAL_ERROR_PREFIX`). */
export const SWEEP_REASON = 'scanner did not report within 45 min'
/** The reason stamped on a superseded row, followed by the new head's short sha. */
export const SUPERSEDED_REASON_PREFIX = 'superseded by '

export interface KillCounts {
  cancelled: number
  sandboxesStopped: number
}

export type CapVerdict = { capped: false } | { capped: true; reason: string }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** external always; supplyChain only while it is still waiting on the same run. */
function patchFor(
  state: 'SUPERSEDED' | 'FAILED',
  stages: ScanStages | null
): ScanStages {
  const patch: ScanStages = { external: state }
  if (stages?.supplyChain === 'PENDING') patch.supplyChain = state
  return patch
}

/** Cancel the run, then stop its tagged VM. Both best-effort; counts record what worked. */
async function killRun(
  scanId: string,
  runId: string | null,
  counts: KillCounts
): Promise<void> {
  if (!runId) return
  if (await cancelManagedRun(runId, scanId)) counts.cancelled += 1
  try {
    counts.sandboxesStopped += await stopRepoSandboxesByTag({
      [SANDBOX_SCAN_TAG]: scanId,
    })
  } catch (error) {
    logger.warn(
      `[security-managed-scan-ops] sandbox stop failed scan=${scanId}: ${describe(error)}`
    )
  }
}

export const securityManagedScanOpsService = {
  /**
   * Every older PENDING managed run on this PR is moot once a newer head
   * exists. Never throws — stage A must start the new run regardless.
   */
  async supersedeOlderRuns(input: {
    pullRequestId: string
    exceptScanId: string
    newHeadSha: string
  }): Promise<{ superseded: number } & KillCounts> {
    const counts = { superseded: 0, cancelled: 0, sandboxesStopped: 0 }
    let older
    try {
      older = await prSecurityScanRepository.findPendingManagedByPullRequest(
        input.pullRequestId,
        input.exceptScanId
      )
    } catch (error) {
      logger.warn(
        `[security-managed-scan-ops] supersede lookup failed pr=${input.pullRequestId}: ${describe(error)}`
      )
      return counts
    }
    const reason = `${EXTERNAL_ERROR_PREFIX}${SUPERSEDED_REASON_PREFIX}${input.newHeadSha.slice(0, 7)}`
    for (const row of older) {
      try {
        await prSecurityScanRepository.mergeStages(
          row.id,
          patchFor('SUPERSEDED', row.stages),
          { error: reason }
        )
        counts.superseded += 1
      } catch (error) {
        // Unstamped → the guard could not stop a retry → leave the run alone.
        logger.warn(
          `[security-managed-scan-ops] supersede stamp failed scan=${row.id}: ${describe(error)}`
        )
        continue
      }
      await killRun(row.id, row.managedRunId, counts)
    }
    if (counts.superseded > 0) {
      logger.info(
        `[security-managed-scan-ops] superseded ${counts.superseded} run(s) pr=${input.pullRequestId} cancelled=${counts.cancelled} sandboxesStopped=${counts.sandboxesStopped}`
      )
    }
    return counts
  },

  /**
   * Managed runs this workspace started in the trailing hour vs the cap.
   * Only rows with a run id count, so a start() that failed costs nothing.
   * A repository error propagates: stage A's A2 catch stamps external
   * FAILED, the same as any other lookup failure there.
   */
  async enforceHourlyCap(
    input: { workspaceId: string },
    now: Date = new Date()
  ): Promise<CapVerdict> {
    const cap = managedScanHourlyCap()
    const since = new Date(now.getTime() - MANAGED_SCAN_HOURLY_WINDOW_MS)
    const started = await prSecurityScanRepository.countManagedRunsSince(
      input.workspaceId,
      since
    )
    if (started < cap) return { capped: false }
    logger.warn(
      `[security-managed-scan-ops] hourly cap hit workspace=${input.workspaceId} started=${started} cap=${cap}`
    )
    return {
      capped: true,
      reason: `${EXTERNAL_ERROR_PREFIX}rate-limited: ${started} managed scans started in the last hour (cap ${cap})`,
    }
  },

  /**
   * The every-15-minute sweep. Managed AND BYO rows: a PENDING external
   * layer older than `EXTERNAL_PENDING_DEAD_MS` is dead either way. Managed
   * rows also get their run cancelled and their VM stopped; every swept row
   * gets its PR summary refreshed (sync never throws).
   */
  async sweepStalePending(
    opts: { now?: Date; limit?: number } = {}
  ): Promise<{ swept: number } & KillCounts> {
    const now = opts.now ?? new Date()
    const limit = opts.limit ?? SWEEP_BATCH_LIMIT
    const before = new Date(now.getTime() - EXTERNAL_PENDING_DEAD_MS)
    const rows = await prSecurityScanRepository.findStalePendingExternal(
      before,
      limit
    )
    const counts = { swept: 0, cancelled: 0, sandboxesStopped: 0 }
    for (const row of rows) {
      try {
        await prSecurityScanRepository.mergeStages(
          row.id,
          patchFor('FAILED', row.stages),
          { error: `${EXTERNAL_ERROR_PREFIX}${SWEEP_REASON}` }
        )
        counts.swept += 1
      } catch (error) {
        logger.warn(
          `[security-managed-scan-ops] sweep stamp failed scan=${row.id}: ${describe(error)}`
        )
        continue
      }
      await killRun(row.id, row.managedRunId, counts)
      await securityPrReviewService.sync(row.id)
    }
    if (rows.length > 0) {
      logger.info(
        `[security-managed-scan-ops] swept ${counts.swept}/${rows.length} stale PENDING scan(s) cancelled=${counts.cancelled} sandboxesStopped=${counts.sandboxesStopped}`
      )
    }
    return counts
  },
}
