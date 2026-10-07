import { waitUntil } from '@/lib/runtime/wait-until'
import { logger } from '@/lib/logger'

/**
 * LUM-780: fire-and-forget re-judge of a task's blocking TEST_FILE_DELETED
 * crossings when one of its PRs reaches a terminal state (merged or closed) —
 * the review window just shut, so "did the deletion land in any linked PR"
 * has its durable answer. Detached via waitUntil (after the webhook
 * response); fail-soft so a re-judge error never fails the webhook; no-op
 * while the PR is still open (the hourly cron covers that case). The service
 * is imported lazily so the webhook module graph stays light.
 */
export function enqueueCrossingRejudgeOnPrClose(
  state: string,
  taskId: string
): void {
  if (state === 'open') return
  waitUntil(
    import('@/lib/services/boundary-crossing-rejudge.service')
      .then(m =>
        m.boundaryCrossingRejudgeService.rejudgeTestFileDeletedForTask(taskId)
      )
      .catch(error => {
        logger.warn(
          `[crossing-rejudge] PR-close re-judge failed for task ${taskId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      })
  )
}
