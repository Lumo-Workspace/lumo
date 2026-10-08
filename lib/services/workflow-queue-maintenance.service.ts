/**
 * LUM-1030 ruling ④ — periodic cleanup of the self-hosted Postgres World's
 * job queue (graphile-worker).
 *
 * What a killed app process leaves behind (reproduced in LUM-1029):
 *
 * - **Stale locked jobs.** The job the dead worker held stays locked with its
 *   `locked_by` pointing at a worker that no longer exists. No data is lost —
 *   `world.start()` re-enqueues every active run on boot — and graphile-worker
 *   itself releases any lock older than 4 hours (its periodic
 *   `resetLockedAt`). A released job with attempts left is simply re-run, a
 *   no-op replay; one whose attempts are spent is "permanently failed" and is
 *   never picked again, but its row stays. This cleanup deletes those rows.
 *   Locks younger than 4 hours are deliberately left alone: a delivery has no
 *   deadline (world-postgres sets none), so a young lock may belong to a live
 *   step on another instance.
 * - **Duplicate wake-up jobs.** Each boot re-enqueues every sleeping run, so a
 *   run that slept across N restarts has N+1 wake-ups queued. They are NOT
 *   deleted: they are consumed at wake time as empty replays (the workflow's
 *   event log makes them idempotent — LUM-1029 saw `expire` run exactly once),
 *   and deleting "the duplicates" could delete the one the run needs.
 *
 * Scheduled by the self-hosted crontab only (`deploy/self-host/crontab`); on
 * Vercel — or any deployment not on the Postgres World — it does nothing.
 */
import { logger } from '@/lib/logger'
import { resolveWorkflowWorld } from '@/lib/runtime/workflow-world'
import {
  WORKFLOW_QUEUE_CLEANUP_TASKS,
  workflowQueueRepository,
} from '@/lib/repositories/workflow-queue.repository'

export type WorkflowQueueCleanupResult =
  | { skipped: true; reason: string }
  | { skipped: false; tasks: string[] }

/**
 * The graphile task identifiers the 5.x World registers
 * (`getJobQueueName` / `executorTask` in
 * `@workflow/world-postgres/dist/queue.js:179-185, 694-699`):
 * `${WORKFLOW_POSTGRES_JOB_PREFIX || 'workflow_'}flows`, plus `…flows_executor`
 * when `WORKFLOW_POSTGRES_INVOKE=1`. Step deliveries ride the flows task since
 * 5.x (the 4.x `…steps` task is gone). Kept unconditionally so a cleanup never
 * garbage-collects an identifier a running worker has cached.
 */
export function workflowTaskIdentifiers(env: NodeJS.ProcessEnv): string[] {
  const prefix = env.WORKFLOW_POSTGRES_JOB_PREFIX || 'workflow_'
  return [`${prefix}flows`, `${prefix}flows_executor`]
}

export const workflowQueueMaintenanceService = {
  async cleanup(
    env: NodeJS.ProcessEnv = process.env,
    repo: Pick<
      typeof workflowQueueRepository,
      'cleanup'
    > = workflowQueueRepository
  ): Promise<WorkflowQueueCleanupResult> {
    if (resolveWorkflowWorld(env) !== 'postgres') {
      return { skipped: true, reason: 'not running on the Postgres World' }
    }
    const connectionString = env.WORKFLOW_POSTGRES_URL
    if (!connectionString) {
      throw Object.assign(new Error('WORKFLOW_POSTGRES_URL is not set'), {
        status: 500,
      })
    }
    await repo.cleanup({
      connectionString,
      taskIdentifiersToKeep: workflowTaskIdentifiers(env),
    })
    const tasks = [...WORKFLOW_QUEUE_CLEANUP_TASKS]
    logger.info(`[workflow-queue] cleanup ran: ${tasks.join(', ')}`)
    return { skipped: false, tasks }
  },
}
