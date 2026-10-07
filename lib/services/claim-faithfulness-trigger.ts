import { waitUntil } from '@/lib/runtime/wait-until'
import { claimFaithfulnessService } from '@/lib/services/claim-faithfulness.service'

/**
 * Fire-and-forget claim-faithfulness judging on PR merge. Detached via
 * waitUntil (runs after the webhook response); fail-soft so a judging error
 * never fails the webhook. No-op for non-merge states — only a merged delivery
 * has a diff to judge.
 */
export function enqueueFaithfulnessJudgeOnMerge(
  state: string,
  taskId: string
): void {
  if (state !== 'merged') return
  waitUntil(claimFaithfulnessService.judgeTask(taskId).catch(() => {}))
}
