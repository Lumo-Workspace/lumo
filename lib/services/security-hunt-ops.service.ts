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
import type { PartialCause } from '@/shared/src/security-scan'
import {
  prSecurityScanRepository,
  type StalePendingHunt,
} from '@/lib/repositories/pr-security-scan.repository'
import { stopRepoSandboxesByTag } from '@/lib/integrations/vercel-sandbox'
import {
  HUNT_CEILING_ALERT_TAG,
  HUNT_MAX_ATTEMPTS,
  HUNT_RETRY_MAX_DELAY_MS,
  HUNT_SANDBOX_TAG,
  type HuntJob,
} from './security-hunt.config'
import { cancelHuntRun, startSecurityHunt } from './security-hunt-start'
import { SANDBOX_TIMEOUT_WITH_HUNT_MS } from './security-managed-scan.config'
import { securityPrReviewService } from './security-pr-review.service'

/**
 * A hunt runs inside a VM that the platform kills at
 * `SANDBOX_TIMEOUT_WITH_HUNT_MS` (35 min), and its own clock tops out well
 * under that (cap × batch window + one retry). Five minutes past the VM's
 * hard stop, a PENDING hunt cannot still be making progress.
 */
// LUM-832: a retry may wait out its backoff before it starts, while the
// layer is already PENDING at the claimed attempt — that wait is added, so a
// sleeping retry is never mistaken for a dead one.
export const HUNT_PENDING_DEAD_MS =
  SANDBOX_TIMEOUT_WITH_HUNT_MS + HUNT_RETRY_MAX_DELAY_MS + 5 * 60 * 1000
/** Stage A's start plus the one retry (LUM-832: shared with the in-run re-queue). */
export { HUNT_MAX_ATTEMPTS }
/** Rows one tick handles; a retry costs a run, a failure a GitHub sync. */
export const HUNT_SWEEP_BATCH_LIMIT = 25

const DEAD_MINUTES = Math.round(HUNT_PENDING_DEAD_MS / 60_000)
export const HUNT_STALE_REASONS = {
  afterRetry: `hunt did not report within ${DEAD_MINUTES} min, again after ${HUNT_MAX_ATTEMPTS} tries`,
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

/** LUM-832 — which try of its batch a job is; pre-LUM-832 jobs meant `attempt`. */
function triesOf(job: HuntJob): number {
  return job.tries ?? job.attempt ?? 1
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
  counts: HuntSweepCounts,
  causes: PartialCause[] = []
): Promise<void> {
  const stamped = await prSecurityScanRepository.failStaleHunt(
    row.id,
    atAttempt,
    reason,
    causes
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
  const nextJob: HuntJob = {
    ...job,
    attempt: next,
    // LUM-832: only a batched job carries its own try count; a legacy job's
    // tries ARE the row's attempts, and it stays exactly as it was.
    ...(job.tries !== undefined ? { tries: job.tries + 1 } : {}),
    // The managed scan's VM is long gone; waiting 30 s to attach to it would
    // only eat the retry's own window.
    managedScanStarted: false,
  }
  const claimed = await prSecurityScanRepository.claimHuntRetry(
    row.id,
    row.huntAttempts,
    job.tries !== undefined ? { huntJob: { ...nextJob } } : {}
  )
  // Another tick claimed it, or the hunt landed after the read.
  if (!claimed) return
  await killAttempt(row, counts)
  const runId = await startSecurityHunt(nextJob)
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
  const job = storedJob(row)
  // LUM-832: a batched job counts tries per batch; everything else counts
  // the row's attempts, as before.
  const tries = job?.tries !== undefined ? job.tries : row.huntAttempts
  if (tries >= HUNT_MAX_ATTEMPTS) {
    // LUM-832: the retry ceiling is a safety net, never a routine outcome —
    // reaching it is an outage or a bug of ours, so it is an alert.
    logger.error(
      `${HUNT_CEILING_ALERT_TAG} retry ceiling scan=${row.id} tries=${tries}: hunt never reported`
    )
    return fail(row, row.huntAttempts, HUNT_STALE_REASONS.afterRetry, counts, [
      'HUNT_CEILING',
    ])
  }
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

/** LUM-832 — why an in-run re-queue did not happen (the run then persists as before). */
export type HuntRequeueOutcome =
  | { requeued: true; attempt: number }
  | {
      requeued: false
      reason: 'exhausted' | 'superseded' | 'claim-lost' | 'start-failed'
    }

export interface HuntRequeueInput {
  job: HuntJob
  /** What went wrong on our side — kept in the handed-over audit. */
  reason: string
  tokenSpent: number
  audit: Record<string, unknown>
}

export const securityHuntOpsService = {
  /**
   * LUM-832 — a batch of an oversized diff landed (its findings are on the
   * row, the layer still PENDING): start the next batch. `next` is computed by
   * the deterministic workflow body — the same plan, the next index, a fresh
   * try budget, the fence one up.
   *
   * Same claim CAS as a retry, so a stale sweep and this can never both start
   * a run. A start that fails leaves the layer PENDING at the claimed attempt
   * with `huntJob` = `next`, which is exactly what the stale sweep retries from
   * — so the batch is still owed, never dropped.
   */
  async continueBatchedHunt(input: {
    job: HuntJob
    next: HuntJob
  }): Promise<boolean> {
    const { job, next } = input
    const claimed = await prSecurityScanRepository.claimHuntRetry(
      job.scanId,
      job.attempt ?? 1,
      { huntJob: { ...next } }
    )
    if (!claimed) return false
    const label = `batch=${(next.batchIndex ?? 0) + 1}/${next.batches?.length ?? 1}`
    const runId = await startSecurityHunt(next)
    if (!runId) {
      logger.warn(
        `[security-hunt-ops] next batch did not start scan=${job.scanId} ${label}; left for the stale sweep`
      )
      return false
    }
    try {
      await prSecurityScanRepository.setHuntRunId(job.scanId, runId)
    } catch (error) {
      logger.warn(
        `[security-hunt-ops] run id write failed scan=${job.scanId}: ${describe(error)}`
      )
    }
    logger.info(
      `[security-hunt-ops] continued batched hunt scan=${job.scanId} ${label} run=${runId}`
    )
    return true
  },

  /**
   * LUM-832 — an attempt that ended on OUR fault (a VM, the gateway, a
   * clock, a step that exhausted its retries) is not a conclusion. While an
   * attempt is left, the run hands its place to the next attempt instead of
   * persisting a PARTIAL / FAILED hunt: the layer stays PENDING, so the
   * customer reads "scanning" until the retry lands.
   *
   * Same claim as the stale-hunt sweep (`claimHuntRetry`: CAS on
   * `huntAttempts` while PENDING), so the sweep and this path can never both
   * start a run, and the older attempt's late write is dropped. Not killed:
   * the caller IS the old run, and it ends right after this returns. Its
   * audit and spend move onto the row with the claim; the retry's result adds
   * to the spend.
   *
   * `requeued: false` means "persist as before" — retries exhausted, the PR
   * moved on, or another writer claimed first. A start that fails AFTER the
   * claim stamps the hunt FAILED here (the old attempt can no longer write).
   */
  async requeueFaultedHunt(
    input: HuntRequeueInput
  ): Promise<HuntRequeueOutcome> {
    const { job } = input
    const attempt = job.attempt ?? 1
    // The budget is per batch (LUM-832): `attempt` keeps counting across
    // an oversized diff's batches, `tries` restarts at 1 for each.
    const tries = triesOf(job)
    if (tries >= HUNT_MAX_ATTEMPTS)
      return { requeued: false, reason: 'exhausted' }
    if (await prSecurityScanRepository.hasNewerScanThan(job.scanId))
      return { requeued: false, reason: 'superseded' }
    const next = attempt + 1
    const nextJob: HuntJob = {
      ...job,
      attempt: next,
      tries: tries + 1,
      // Whatever VM the managed scan had is not worth waiting 30 s for.
      managedScanStarted: false,
    }
    const claimed = await prSecurityScanRepository.claimHuntRetry(
      job.scanId,
      attempt,
      {
        faulted: {
          huntAudit: {
            ...input.audit,
            requeued: {
              fromAttempt: attempt,
              reason: input.reason.slice(0, 500),
            },
          },
          tokenSpent: input.tokenSpent,
        },
        huntJob: { ...nextJob },
      }
    )
    if (!claimed) return { requeued: false, reason: 'claim-lost' }
    const runId = await startSecurityHunt(nextJob)
    if (!runId) {
      await prSecurityScanRepository.failStaleHunt(
        job.scanId,
        next,
        HUNT_STALE_REASONS.retryNotStarted
      )
      await securityPrReviewService.sync(job.scanId)
      return { requeued: false, reason: 'start-failed' }
    }
    try {
      await prSecurityScanRepository.setHuntRunId(job.scanId, runId)
    } catch (error) {
      // Only the stale sweep's cancel is lost; the run itself is fine.
      logger.warn(
        `[security-hunt-ops] run id write failed scan=${job.scanId}: ${describe(error)}`
      )
    }
    logger.info(
      `[security-hunt-ops] re-queued faulted hunt scan=${job.scanId} attempt=${next} run=${runId}: ${input.reason.slice(0, 200)}`
    )
    return { requeued: true, attempt: next }
  },

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
