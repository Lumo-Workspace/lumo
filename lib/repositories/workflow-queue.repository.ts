/**
 * LUM-1030 ruling ④ — the self-hosted Postgres World's job queue
 * (graphile-worker, schema `graphile_worker`). Not a Prisma model: the World
 * owns these tables, so this goes through graphile-worker's own maintenance
 * API (`WorkerUtils.cleanup`) and never through SQL of ours.
 *
 * Loaded lazily: graphile-worker is only present at runtime where the
 * Postgres World is selected, and the Vercel path must not load it.
 */

/** graphile-worker's documented cleanup tasks, all three. */
export const WORKFLOW_QUEUE_CLEANUP_TASKS = [
  // attempts = max_attempts and no longer locked: never run again. This is
  // where a killed worker's job ends up once graphile releases its lock.
  'DELETE_PERMAFAILED_JOBS',
  // Named job queues with no jobs left.
  'GC_JOB_QUEUES',
  // Task identifiers with no jobs left (the World's own two are kept).
  'GC_TASK_IDENTIFIERS',
] as const

export const workflowQueueRepository = {
  async cleanup(input: {
    connectionString: string
    taskIdentifiersToKeep: string[]
  }): Promise<void> {
    const { makeWorkerUtils } = await import('graphile-worker')
    const utils = await makeWorkerUtils({
      connectionString: input.connectionString,
    })
    try {
      await utils.cleanup({
        tasks: [...WORKFLOW_QUEUE_CLEANUP_TASKS],
        taskIdentifiersToKeep: input.taskIdentifiersToKeep,
      })
    } finally {
      await utils.release()
    }
  },
}
