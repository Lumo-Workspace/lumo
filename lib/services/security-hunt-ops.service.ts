/**
 * LUM-822 — the stale-hunt sweep. The hunt workflow stamps its own outcome on
 * every path it can reach (RAN / PARTIAL / SKIPPED / FAILED, then a PR summary
 * sync), but a run that dies without reaching any of them — the process
 * killed, the run lost — leaves `stages.hunt = PENDING` for good, and the PR
 * summary reads "Exploit paths: scanning" forever. LUM-745's sweep never saw
 * it: that one is keyed on `stages.external`.
 *
 * A hunt still PENDING past `HUNT_PENDING_DEAD_MS` is:
 *   first attempt, job on the row, PR not moved on → retried ONCE with the
 *     job stage A started (claim → cancel + stop the old run → start);
 *   otherwise → stamped FAILED with the reason in `huntAudit`, the old run
 *     cancelled and its VM stopped, and the PR summary re-synced.
 *
 * Claim-then-kill is the order here (LUM-745 is stamp-then-kill for the same
 * reason): the claim bumps `huntAttempts`, after which the old attempt's late
 * result is dropped by `persistHuntResult`, so a cancel that fails can cost a
 * wasted run but never a double write.
 *
 * Layering: service — the database through the repository, the workflow
 * through `security-hunt-start`, the sandbox through the integration module.
 */
import { logger } from '@/lib/logger'
import {
  prSecurityScanRepository,
  type StalePendingHunt,
} from '@/lib/repositories/pr-security-scan.repository'
import { stopRepoSandboxesByTag } from '@/lib/integrations/vercel-sandbox'
import { HUNT_SANDBOX_TAG, type HuntJob } from './security-hunt.config'
import { cancelHuntRun, startSecurityHunt } from './security-hunt-start'
import { SANDBOX_TIMEOUT_WITH_HUNT_MS } from './security-managed-scan.config'
import { securityPrReviewService } from './security-pr-review.service'

/**
 * A hunt runs inside a VM that the platform kills at
 * `SANDBOX_TIMEOUT_WITH_HUNT_MS` (35 min), and its own clock tops out well
 * under that (cap × batch window + one retry). Five minutes past the VM's
 * hard stop, a PENDING hunt cannot still be making progress.
 */
export const HUNT_PENDING_DEAD_MS = SANDBOX_TIMEOUT_WITH_HUNT_MS + 5 * 60 * 1000
/** Stage A's start plus the one retry. */
export const HUNT_MAX_ATTEMPTS = 2
/** Rows one tick handles; a retry costs a run, a failure a GitHub sync. */
export const HUNT_SWEEP_BATCH_LIMIT = 25

const DEAD_MINUTES = Math.round(HUNT_PENDING_DEAD_MS / 60_000)
export const HUNT_STALE_REASONS = {
  afterRetry: `hunt did not report within ${DEAD_MINUTES} min, again after one retry`,
  noJob: `hunt did not report within ${DEAD_MINUTES} min (no stored job to retry)`,
  superseded: `hunt did not report within ${DEAD_MINUTES} min; not retried — the PR has a newer head`,
  retryNotStarted: `hunt did not report within ${DEAD_MINUTES} min, and the retry could not be started`,
} as const

export interface HuntSweepCounts {
  retried: number
  failed: number
  cancelled: number
  sandboxesStopped: number
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The stored job, if it is one this row can be retried with. */
function storedJob(row: StalePendingHunt): HuntJob | null {
  const job = row.huntJob as Partial<HuntJob> | null
  if (!job || typeof job !== 'object') return null
  if (job.scanId !== row.id) return null
  if (typeof job.repo !== 'string' || typeof job.headSha !== 'string')
    return null
  if (typeof job.prNumber !== 'number') return null
  return job as HuntJob
}

/** Cancel the run, then stop the VM it booted. Both best-effort. */
async function killAttempt(
  row: StalePendingHunt,
  counts: HuntSweepCounts
): Promise<void> {
  if (row.huntRunId && (await cancelHuntRun(row.huntRunId, row.id)))
    counts.cancelled += 1
  try {
    counts.sandboxesStopped += await stopRepoSandboxesByTag({
      [HUNT_SANDBOX_TAG]: row.id,
    })
  } catch (error) {
    logger.warn(
      `[security-hunt-ops] sandbox stop failed scan=${row.id}: ${describe(error)}`
    )
  }
}

async function fail(
  row: StalePendingHunt,
  atAttempt: number,
  reason: string,
  counts: HuntSweepCounts
): Promise<void> {
  const stamped = await prSecurityScanRepository.failStaleHunt(
    row.id,
    atAttempt,
    reason
  )
  // A result landed between the read and the stamp: it wins, nothing to do.
  if (!stamped) return
  counts.failed += 1
  await killAttempt(row, counts)
  await securityPrReviewService.sync(row.id)
}

async function retry(
  row: StalePendingHunt,
  job: HuntJob,
  counts: HuntSweepCounts
): Promise<void> {
  const next = row.huntAttempts + 1
  const claimed = await prSecurityScanRepository.claimHuntRetry(
    row.id,
    row.huntAttempts
  )
  // Another tick claimed it, or the hunt landed after the read.
  if (!claimed) return
  await killAttempt(row, counts)
  const runId = await startSecurityHunt({
    ...job,
    attempt: next,
    // The managed scan's VM is long gone; waiting 30 s to attach to it would
    // only eat the retry's own window.
    managedScanStarted: false,
  })
  if (!runId) {
    await fail(
      { ...row, huntRunId: null },
      next,
      HUNT_STALE_REASONS.retryNotStarted,
      counts
    )
    return
  }
  counts.retried += 1
  try {
    await prSecurityScanRepository.setHuntRunId(row.id, runId)
  } catch (error) {
    // Only the next sweep's cancel is lost; the run itself is fine.
    logger.warn(
      `[security-hunt-ops] run id write failed scan=${row.id}: ${describe(error)}`
    )
  }
  logger.info(
    `[security-hunt-ops] retried stale hunt scan=${row.id} attempt=${next} run=${runId}`
  )
}

async function sweepOne(
  row: StalePendingHunt,
  counts: HuntSweepCounts
): Promise<void> {
  if (row.huntAttempts >= HUNT_MAX_ATTEMPTS)
    return fail(row, row.huntAttempts, HUNT_STALE_REASONS.afterRetry, counts)
  const job = storedJob(row)
  if (!job) return fail(row, row.huntAttempts, HUNT_STALE_REASONS.noJob, counts)
  if (
    await prSecurityScanRepository.hasNewerScan(
      row.pullRequestId,
      row.startedAt
    )
  )
    return fail(row, row.huntAttempts, HUNT_STALE_REASONS.superseded, counts)
  return retry(row, job, counts)
}

export const securityHuntOpsService = {
  /**
   * The every-15-minute cron's hunt half. Never throws past one row: a row
   * that fails is logged and the next one still runs.
   */
  async sweepStaleHunts(
    opts: { now?: Date; limit?: number } = {}
  ): Promise<HuntSweepCounts> {
    const now = opts.now ?? new Date()
    const before = new Date(now.getTime() - HUNT_PENDING_DEAD_MS)
    const rows = await prSecurityScanRepository.findStalePendingHunts(
      before,
      opts.limit ?? HUNT_SWEEP_BATCH_LIMIT
    )
    const counts: HuntSweepCounts = {
      retried: 0,
      failed: 0,
      cancelled: 0,
      sandboxesStopped: 0,
    }
    for (const row of rows) {
      try {
        await sweepOne(row, counts)
      } catch (error) {
        logger.warn(
          `[security-hunt-ops] sweep failed scan=${row.id}: ${describe(error)}`
        )
      }
    }
    if (rows.length > 0) {
      logger.info(
        `[security-hunt-ops] swept ${rows.length} stale hunt(s) retried=${counts.retried} failed=${counts.failed} cancelled=${counts.cancelled} sandboxesStopped=${counts.sandboxesStopped}`
      )
    }
    return counts
  },
}
