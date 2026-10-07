/**
 * LUM-1030 ruling ③ — cancelling a run does not interrupt the step that is
 * executing: `run.cancel()` stops every LATER step, but the in-flight step
 * body runs to completion and keeps its side effects (core behaviour on every
 * World; LUM-1029 reproduced it on the Postgres World). A step whose side
 * effect must not outlive a cancel asks this before (or right after) making
 * it durable, and undoes or skips it when the run was cancelled.
 *
 * Call ONLY from inside a `'use step'` function — `getWorkflowMetadata()`
 * throws anywhere else. Fail-open: a lookup error answers "not cancelled", so
 * the normal path never depends on this extra read.
 */
import { getWorkflowMetadata } from 'workflow'
import { getRun } from 'workflow/api'
import { logger } from '@/lib/logger'

export async function isCurrentRunCancelled(): Promise<boolean> {
  let runId: string | undefined
  try {
    runId = getWorkflowMetadata().workflowRunId
    return (await getRun(runId).status) === 'cancelled'
  } catch (error) {
    logger.warn(
      `[workflow] run status lookup failed run=${runId ?? '?'}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return false
  }
}
